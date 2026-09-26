/**
 * 「前情提要」功能的唯一对外入口。
 *
 * 流程：DM 点「开始录制」→ 音频流经 ASR 实时转写（转写不回显给前端）→ DM 点「结束录制」
 *       → 转写全文 + 人名对照表 + 世界观背景 + **当前文本框里的前情与人物**交给 DeepSeek
 *       → DeepSeek 判断这次口述是续写、补细节、纠正还是删除，给出修订后的完整版本
 *       → 整份替换并广播给所有人。DM 之后可以随意手改，玩家只能看。
 *
 * 修订的底稿一律以 DM 前端文本框里的内容为准：recap:stop / recap:retry / recap:text
 * 都会带上文本框的当前内容，服务端先落下来再去总结（防抖中的手改不会被漏掉）。
 *
 * 负责：recap:* 的 socket 事件、录音会话（长录音按段轮换 ASR 连接）、处理阶段的状态广播。
 * 不负责：ASR 协议（复用 lib/voice-roll/asr.js）、DeepSeek 调用（summarize.js）、
 *         数据清洗与落盘（store.js）、人名表（context.js）。
 *
 * 谁调用：server.js 启动时 createRecap({...}) 一次，然后在 io.on('connection') 里
 *         对每个 socket 调 recap.register(socket, { getPlayer })。
 * 依赖：所有外部配置由参数注入，绝不 require('../../server')。
 *
 * Socket 事件：
 *   Client → Server
 *     recap:fetch                      任何已登录的人：要一份当前前情提要 + 处理状态
 *     recap:start                      DM：开始录制（点一下开始、再点一下结束，不用按住）
 *     recap:stop    { brief, people }  DM：结束录制，带上文本框当前内容作为修订底稿
 *     recap:chunk   ArrayBuffer        DM：一帧 16kHz / PCM16 LE / 单声道音频
 *     recap:cancel                     DM：放弃这次录制，什么都不总结
 *     recap:retry   { brief, people }  DM：上次总结失败了，用存下来的转写再总结一次
 *     recap:update  { brief, people }  DM：手改后的整份内容
 *     recap:clear                      DM：清空正文、人物和未总结的转写（前端已二次确认）
 *     recap:text    { text, brief, people } DM 调试：跳过 ASR 直接拿文本去总结
 *   Server → Client
 *     recap:sync    { brief, people: [{name, note, known}], updatedAt }
 *     recap:status  { phase, message, canRetry, asrEnabled, llmEnabled }
 *                   phase: idle / recording / transcribing / summarizing
 */

const { createAsrSession, SAMPLE_RATE } = require('../voice-roll/asr');
const { createRecapStore } = require('./store');
const { summarizeRecap } = require('./summarize');
const { isChecklistName, buildAsrContext } = require('./context');

const BYTES_PER_SEC = SAMPLE_RATE * 2;
/** 一条 ASR 连接最多录 5 分钟就换一条：长连接中途被对端掐掉的话，最多只丢这一段 */
const SEGMENT_BYTES = BYTES_PER_SEC * 5 * 60;
/** 单次讲述最长 30 分钟，到点自动结束并开始总结 */
const MAX_RECORD_MS = 30 * 60 * 1000;
/** 连续这么多段 ASR 失败就不再重连，用已经识别出的部分收尾 */
const MAX_ASR_ERRORS = 3;
/** 一帧音频（100ms = 3200 字节）的合理上限，超了多半是有人乱发 */
const MAX_CHUNK_BYTES = 64 * 1024;

/**
 * @param {object} opts
 * @param {import('socket.io').Server} opts.io
 * @param {string} opts.filePath recap.json 路径
 * @param {{apiKey: string, model: string}} opts.deepseek
 * @param {{apiKey: string, model: string, wsUrl?: string, workspaceId?: string, region?: string}} opts.asr
 */
function createRecap({ io, filePath, deepseek, asr }) {
  const store = createRecapStore(filePath);
  const asrCfg = { ...asr, contextPrompt: buildAsrContext() };

  // 整个房间只有一个 DM，同时只会有一段讲述在处理，所以状态放在模块级
  let phase = 'idle';
  /** 录音中的会话：{ socketId, segments: Promise<string>[], asr, segBytes, totalBytes, errors, hadError, timer, stopping } */
  let job = null;

  function syncPayload() {
    const d = store.get();
    return {
      brief: d.brief,
      // known=false 的是 AI 新加、对照表里没有的名字，前端标个「新」提醒 DM 核对写法
      people: d.people.map(p => ({ ...p, known: isChecklistName(p.name) })),
      updatedAt: d.updatedAt
    };
  }

  function statusPayload(message) {
    return {
      phase,
      message: message || '',
      canRetry: !!store.get().pendingTranscript,
      asrEnabled: !!asr.apiKey,
      llmEnabled: !!deepseek.apiKey
    };
  }

  /** 状态是公开的：玩家那边可以显示「DM 正在讲述…」 */
  function setPhase(next, message) {
    phase = next;
    io.emit('recap:status', statusPayload(message));
  }

  /** 开一段新的 ASR 连接，它的最终文本以 Promise 的形式排进 job.segments */
  function openSegment() {
    let resolveSeg;
    job.segments.push(new Promise(res => { resolveSeg = res; }));
    job.segBytes = 0;
    const session = createAsrSession(asrCfg, {
      onFinal: (text) => resolveSeg(text || ''),
      onError: (err) => {
        console.error('前情提要 ASR 出错:', err);
        resolveSeg(err.partialText || '');
        if (!job || job.asr !== session || job.stopping) return;
        job.hadError = true;
        job.errors += 1;
        // 反复失败（key 错、地域不对）就别无限重连了，拿已经识别出来的收尾
        if (job.errors >= MAX_ASR_ERRORS) finishRecording();
        else openSegment();
      }
    });
    job.asr = session;
  }

  /** 结束录制：等所有段的最终文本 → 拼起来 → 去总结 */
  async function finishRecording() {
    if (!job || job.stopping) return;
    const current = job;
    current.stopping = true;
    clearTimeout(current.timer);
    current.asr.finish();
    setPhase('transcribing');

    const texts = await Promise.all(current.segments);
    job = null;
    const text = texts.join('').trim();
    if (!text) {
      setPhase('idle', current.hadError ? '语音识别失败，请再试一次' : '没听清，请再录一次');
      return;
    }
    // 先把转写存盘再总结：DeepSeek 挂了的话还能重试，不用 DM 再讲一遍
    store.setPendingTranscript(text);
    await runSummary(text, current.hadError ? '识别中途断开过，前情可能不完整' : '');
  }

  /** 放弃录制，什么都不总结 */
  function cancelRecording() {
    // 已经点过「结束」就不能再取消了：finishRecording 正等着最终文本
    if (!job || job.stopping) return;
    clearTimeout(job.timer);
    job.stopping = true;
    try { job.asr.cancel(); } catch { /* 忽略 */ }
    job = null;
    setPhase('idle');
  }

  /**
   * 拿一段转写去修订前情提要，成功就整份替换并广播。
   * 底稿是 store 里的当前内容——调用前 DM 文本框的内容已经经 takeClientContent 落进来了。
   * @param {string} text
   * @param {string} [notice] 成功后附带给 DM 的提示
   */
  async function runSummary(text, notice) {
    setPhase('summarizing');
    try {
      const current = store.get();
      const revision = await summarizeRecap(text, current, deepseek);
      if (revision.unchanged) {
        store.setPendingTranscript('');
        setPhase('idle', '没从讲述里听出剧情，前情没有改动');
        return;
      }
      // 原来有内容、修订稿却是空的：多半是模型出了岔子，不能让它把整份前情抹掉。
      // 真要清空有「清空」按钮。转写留着，DM 可以重试
      if (!revision.brief && current.brief.trim()) {
        setPhase('idle', 'AI 返回了空的前情，已保留原内容，可以点「重试总结」');
        return;
      }
      store.setPendingTranscript('');
      store.applyRevision(revision);
      io.emit('recap:sync', syncPayload());
      setPhase('idle', [revision.changes && `AI：${revision.changes}`, notice].filter(Boolean).join('；'));
    } catch (err) {
      console.error('前情提要总结失败:', err);
      setPhase('idle', err.code === 'NO_KEY'
        ? '服务端未配置 DEEPSEEK_API_KEY'
        : 'AI 总结失败，转写已保存，可以点「重试总结」');
    }
  }

  /**
   * 给一个 socket 注册全部 recap:* 事件。
   * @param {import('socket.io').Socket} socket
   * @param {{getPlayer: () => ({name: string, role: string}|undefined)}} deps
   */
  function register(socket, deps) {
    const isDM = () => deps.getPlayer()?.role === 'DM';

    /**
     * 把 DM 文本框里的当前内容落下来，作为这次修订的底稿。
     * 没带内容（比如 DM 掉线触发的收尾）就沿用 store 里已有的
     * @param {any} data
     */
    function takeClientContent(data) {
      if (!data || typeof data !== 'object' || typeof data.brief !== 'string') return;
      store.setContent(data);
      socket.broadcast.emit('recap:sync', syncPayload());
    }

    socket.on('recap:fetch', () => {
      if (!deps.getPlayer()) return;
      socket.emit('recap:sync', syncPayload());
      socket.emit('recap:status', statusPayload());
    });

    socket.on('recap:start', () => {
      if (!isDM()) return;
      if (!asr.apiKey) {
        socket.emit('recap:status', statusPayload('服务端未配置语音识别'));
        return;
      }
      if (phase !== 'idle') {
        socket.emit('recap:status', statusPayload('上一段讲述还在处理，请稍等'));
        return;
      }
      job = {
        socketId: socket.id, segments: [], asr: null,
        segBytes: 0, totalBytes: 0, errors: 0, hadError: false, stopping: false,
        timer: setTimeout(() => finishRecording(), MAX_RECORD_MS)
      };
      openSegment();
      setPhase('recording');
    });

    socket.on('recap:chunk', (chunk) => {
      if (!job || job.stopping || job.socketId !== socket.id || !chunk) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!buf.length || buf.length > MAX_CHUNK_BYTES) return;
      // 当前这段录满了就换一条新连接；旧连接 finish 后自己交出最终文本
      if (job.segBytes + buf.length > SEGMENT_BYTES) {
        job.asr.finish();
        openSegment();
      }
      job.segBytes += buf.length;
      job.totalBytes += buf.length;
      job.asr.sendAudio(buf);
    });

    socket.on('recap:stop', (data) => {
      if (!job || job.socketId !== socket.id || job.stopping) return;
      takeClientContent(data);
      finishRecording();
    });

    socket.on('recap:cancel', () => {
      if (job && job.socketId === socket.id) cancelRecording();
    });

    socket.on('recap:retry', (data) => {
      if (!isDM() || phase !== 'idle') return;
      const text = store.get().pendingTranscript;
      if (!text) return;
      takeClientContent(data);
      runSummary(text);
    });

    socket.on('recap:text', (data) => {
      if (!isDM() || phase !== 'idle') return;
      const text = typeof data === 'string' ? data : (data && data.text);
      if (typeof text !== 'string' || !text.trim()) return;
      takeClientContent(data);
      store.setPendingTranscript(text.trim());
      runSummary(text.trim());
    });

    socket.on('recap:clear', () => {
      if (!isDM() || phase !== 'idle') return;
      store.clear();
      io.emit('recap:sync', syncPayload());
      setPhase('idle');
    });

    socket.on('recap:update', (data) => {
      if (!isDM() || !data || typeof data !== 'object') return;
      store.setContent(data);
      socket.broadcast.emit('recap:sync', syncPayload());
    });

    // DM 掉线（标签页被挂起之类）：讲了一半的内容不能扔，照常收尾去总结
    socket.on('disconnect', () => {
      if (job && job.socketId === socket.id) finishRecording();
    });
  }

  return { register };
}

module.exports = { createRecap };
