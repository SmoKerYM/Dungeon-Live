/**
 * ASR（语音转文字）adapter：把音频流送进阿里云 Model Studio 的实时识别 WebSocket，
 * 把 partial / final 文本回调出来。
 *
 * 负责：WebSocket 会话的建立、run-task / finish-task 协议、音频帧转发、
 *       partial 与 final 的区分、超时与错误。
 * 不负责：音频采集与降采样（前端 pcm-worklet.js 干的）、意图判定（intent.js / llm.js）。
 *
 * 谁调用：lib/voice-roll/index.js，在 voice:start 时开一个会话，voice:chunk 时喂帧，
 *         voice:stop 时 finish()，voice:cancel / disconnect 时 cancel()。
 * 依赖：ws（显式装在 dependencies 里）、./vocab.js 的热词串。
 *       key 与模型名由 index.js 从 server.js 的环境变量透传，浏览器永远拿不到。
 *
 * 协议文档（2026-09 核对）：
 *   https://www.alibabacloud.com/help/en/model-studio/fun-asr-realtime-websocket-api
 *   客户端事件 fun-asr-client-events / 服务端事件 fun-asr-server-events
 */

const crypto = require('crypto');
const WebSocket = require('ws');
const { ASR_CONTEXT_PROMPT } = require('./vocab');

/** 音频参数：16kHz、单声道、PCM16 LE —— 前端必须按这个降采样 */
const SAMPLE_RATE = 16000;
const AUDIO_FORMAT = 'pcm';
/** 建连 + task-started 的等待上限 */
const CONNECT_TIMEOUT_MS = 8000;
/** 发完 finish-task 后等最终结果的上限 */
const FINISH_TIMEOUT_MS = 10000;

/**
 * 拼出 WebSocket 接入地址。
 * 新版 Model Studio 是按 workspace 分域名的（wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/…），
 * 老的 DashScope 国际站地址不带 workspace。两种都允许用环境变量指定，方便换地域/换账号。
 *
 * @param {{wsUrl?: string, workspaceId?: string, region?: string}} cfg
 * @returns {string}
 */
function buildWsUrl(cfg) {
  if (cfg.wsUrl) return cfg.wsUrl;
  const region = cfg.region || 'ap-southeast-1';
  if (cfg.workspaceId) {
    return `wss://${cfg.workspaceId}.${region}.maas.aliyuncs.com/api-ws/v1/inference`;
  }
  return 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference';
}

/**
 * 开一个流式识别会话。
 *
 * 音频帧在 task-started 之前先攒着，收到 task-started 再一起发出去，
 * 这样前端不用等握手完成就能开始说话。
 *
 * @param {object} cfg
 * @param {string} cfg.apiKey    ASR_API_KEY（只存在于服务端）
 * @param {string} cfg.model     ASR_MODEL，例如 qwen-audio-3.1-asr-flash-streaming
 * @param {string} [cfg.wsUrl]   直接指定接入地址（ASR_WS_URL）
 * @param {string} [cfg.workspaceId] Model Studio 的 WorkspaceId（ASR_WORKSPACE_ID）
 * @param {string} [cfg.region]  地域，默认 ap-southeast-1
 * @param {object} handlers
 * @param {(text: string) => void} [handlers.onPartial] 中间结果（sentence_end=false）
 * @param {(text: string) => void} [handlers.onFinal]   最终结果（识别结束时的完整文本）
 * @param {(err: Error) => void}   [handlers.onError]   任何失败，调用方据此回 voice:error
 * @returns {{ sendAudio: (buf: Buffer) => void, finish: () => void, cancel: () => void }}
 */
function createAsrSession(cfg, handlers) {
  const onPartial = handlers.onPartial || (() => {});
  const onFinal = handlers.onFinal || (() => {});
  const onError = handlers.onError || (() => {});

  const taskId = crypto.randomUUID();
  let started = false;      // 收到 task-started
  let closed = false;       // 会话已终结（正常或异常），之后一切回调都忽略
  let finishing = false;    // 已发 finish-task，在等最终结果
  const queue = [];         // task-started 之前攒下的音频帧
  /** 各 sentence_id 的最终文本：整段话可能被切成几句，最后拼起来 */
  const sentences = new Map();
  let lastPartial = '';

  const ws = new WebSocket(buildWsUrl(cfg), {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    handshakeTimeout: CONNECT_TIMEOUT_MS
  });

  let timer = setTimeout(() => fail(new Error('ASR 连接超时')), CONNECT_TIMEOUT_MS);

  /** 把已收到的句子拼成一段完整文本 */
  function joinedText() {
    const ids = [...sentences.keys()].sort((a, b) => a - b);
    const text = ids.map(id => sentences.get(id)).join('').trim();
    return text || lastPartial.trim();
  }

  function cleanup() {
    closed = true;
    clearTimeout(timer);
    try { ws.close(); } catch { /* 已经断了就算了 */ }
  }

  function fail(err) {
    if (closed) return;
    cleanup();
    onError(err);
  }

  function done() {
    if (closed) return;
    const text = joinedText();
    cleanup();
    onFinal(text);
  }

  ws.on('open', () => {
    ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: cfg.model,
        parameters: {
          format: AUDIO_FORMAT,
          sample_rate: SAMPLE_RATE,
          language_hints: ['zh', 'en'],
          semantic_punctuation_enabled: false
        },
        // 跑团黑话（豁免、奥秘、劣势…）是低频词，不给上下文的话 ASR 很容易写错字；
        // 「豁免」两个字尤其关键——它是服务端判豁免的硬规则
        input: {
          context: [
            { role: 'user', content: [{ type: 'input_text', text: ASR_CONTEXT_PROMPT }] }
          ]
        }
      }
    }));
  });

  ws.on('message', (data, isBinary) => {
    if (closed || isBinary) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;   // 非 JSON 的消息不关我们的事
    }
    const event = msg?.header?.event;

    if (event === 'task-started') {
      started = true;
      clearTimeout(timer);
      queue.forEach(buf => ws.send(buf));
      queue.length = 0;
      if (finishing) sendFinish();
      return;
    }

    if (event === 'result-generated') {
      const s = msg?.payload?.output?.sentence;
      if (!s) return;
      const text = (s.text || '').trim();
      if (s.sentence_end) {
        if (text) sentences.set(s.sentence_id ?? sentences.size, text);
        lastPartial = '';
      } else if (text) {
        lastPartial = text;
        onPartial((joinedText() + text).trim());
      }
      return;
    }

    if (event === 'task-finished') {
      done();
      return;
    }

    if (event === 'task-failed') {
      fail(new Error(`ASR 失败 ${msg?.header?.error_code || ''}: ${msg?.header?.error_message || '未知错误'}`));
    }
  });

  ws.on('error', err => fail(err));
  ws.on('unexpected-response', (_req, res) => {
    fail(new Error(`ASR 握手失败 HTTP ${res.statusCode}（检查 ASR_API_KEY 与接入地址/地域是否匹配）`));
  });
  ws.on('close', () => {
    // 正常结束时 done()/fail() 已经把 closed 置上了；否则说明是对端提前断开
    if (!closed) fail(new Error('ASR 连接被关闭'));
  });

  /** 真正发 finish-task，并给最终结果设一个等待上限 */
  function sendFinish() {
    try {
      ws.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} }
      }));
    } catch (err) {
      return fail(err);
    }
    clearTimeout(timer);
    // 到点还没收到 task-finished，就拿手头已有的文本交差，别把玩家晾着
    timer = setTimeout(() => { if (!closed) done(); }, FINISH_TIMEOUT_MS);
  }

  return {
    /**
     * 送一帧音频（16kHz / PCM16 LE / 单声道）。task-started 之前会先攒着。
     * @param {Buffer} buf
     */
    sendAudio(buf) {
      if (closed || !buf || !buf.length) return;
      if (!started) queue.push(buf);
      else if (ws.readyState === WebSocket.OPEN) ws.send(buf);
    },

    /** 音频发完了，等最终结果 */
    finish() {
      if (closed || finishing) return;
      finishing = true;
      if (started) sendFinish();
      // 还没 task-started 的话，等它到了再发（见上面的 handler）
    },

    /** 放弃本次识别，不会再有任何回调 */
    cancel() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
    }
  };
}

/**
 * 一次性转写一段完整音频（把 buffer 切成帧喂给流式会话）。
 * 给连通性测试和「没有流式采集时的降级路径」用。
 *
 * @param {Buffer} pcm 16kHz / PCM16 LE / 单声道的完整音频
 * @param {object} cfg 同 createAsrSession
 * @param {number} [frameMs=100] 每帧时长
 * @returns {Promise<string>} 最终文本
 */
function transcribeBuffer(pcm, cfg, frameMs = 100) {
  return new Promise((resolve, reject) => {
    const session = createAsrSession(cfg, { onFinal: resolve, onError: reject });
    const frameBytes = Math.floor(SAMPLE_RATE * 2 * frameMs / 1000);
    for (let i = 0; i < pcm.length; i += frameBytes) {
      session.sendAudio(pcm.subarray(i, i + frameBytes));
    }
    session.finish();
  });
}

module.exports = { createAsrSession, transcribeBuffer, buildWsUrl, SAMPLE_RATE, AUDIO_FORMAT };
