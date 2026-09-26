/**
 * 语音掷骰功能的唯一对外入口。
 *
 * 负责：注册 voice:* 的 socket 事件，把「转写文本 → 意图 → 预览确认 → 掷骰 → 广播」
 *       这条链串起来，并维护待确认意图表（pendingIntents）。
 * 不负责：规则判定（intent.js）、数值与掷骰（dice.js）、LLM 兜底（llm.js）、ASR（asr.js），
 *         也不负责持久化——聊天历史通过 deps.appendChatHistory 复用 server.js 的现有实现。
 *
 * 谁调用：server.js 在 io.on('connection') 回调里，对每个 socket 调一次
 *         registerVoiceRollHandlers(io, socket, deps)。
 * 依赖：./intent、./llm、./dice。**绝不能反向 require('../../server')**（会循环依赖）；
 *       需要的一切由 deps 注入。
 */

const crypto = require('crypto');
const { parseRollIntent } = require('./intent');
const { classifyWithDeepSeek } = require('./llm');
const { createAsrSession, SAMPLE_RATE } = require('./asr');
const {
  computeRollModifier, buildRollOutcome, buildRollLabel, buildRollExpr, buildModifierParts
} = require('./dice');

/**
 * 已识别、等玩家确认的意图：intentId → { socketId, name, intent, createdAt }。
 * 只在内存里，重启即清空（和撤销栈一样）。30 秒过期，确认时校验 socketId 必须一致，
 * 免得别人拿到 id 就能替你投。
 */
const pendingIntents = new Map();
const PENDING_TTL_MS = 30000;
/** 置信度达到这个值才自动确认，低于它必须玩家点一下（听错后投出的骰子是公开的） */
const AUTO_CONFIRM_CONFIDENCE = 0.9;
/** 单次录音最长 8 秒：前端到点会自动 stop，服务端按累计字节数再兜一道 */
const MAX_RECORD_MS = 8000;
/** 16kHz / PCM16 单声道 → 每秒 32000 字节；给 1 秒余量，超了就强制结束 */
const MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * (MAX_RECORD_MS / 1000 + 1);
/** 同一个 socket 两次开录之间的最小间隔，防止连点刷接口 */
const START_COOLDOWN_MS = 2000;
/** 文字入口（聊天框 @ai）两次提交的最小间隔。规则判不出来时会调 LLM，别让人连着刷 */
const TEXT_COOLDOWN_MS = 1000;

/** 清掉过期的待确认意图（每次新建时顺手扫一遍，不另起定时器） */
function sweepPendingIntents() {
  const now = Date.now();
  for (const [id, p] of pendingIntents) {
    if (now - p.createdAt > PENDING_TTL_MS) pendingIntents.delete(id);
  }
}

/**
 * 给一个 socket 注册全部语音掷骰事件。
 *
 * @param {import('socket.io').Server} io 用于广播 dice:result
 * @param {import('socket.io').Socket} socket 当前连接
 * @param {object} deps 依赖注入
 * @param {() => ({name: string, role: string}|undefined)} deps.getPlayer 取当前 socket 的玩家（未登录返回 undefined）
 * @param {(name: string) => object|null} deps.getCharacter 按角色名取角色卡
 * @param {(entry: object) => void} deps.appendChatHistory 追加聊天历史（复用 server.js 的实现，保证回放一致）
 * @param {{apiKey: string, model: string}} deps.deepseek DeepSeek 配置，规则判不出来时兜底用
 * @param {{apiKey: string, model: string, wsUrl?: string, workspaceId?: string, region?: string}} deps.asr
 *        ASR 配置；apiKey 为空时整个语音功能不可用（前端据 voiceRollEnabled 禁用麦克风按钮）
 */
function registerVoiceRollHandlers(io, socket, deps) {
  // 每个 socket 同时只允许一个录音会话；闭包变量天然就是 per-socket 的
  let recording = null;      // { asr, bytes, timer }
  let lastStartAt = 0;
  let lastTextAt = 0;        // 文字入口的上一次提交时间

  /** 关掉当前录音会话（放弃或已结束都走这里），确保 ASR 连接不会漏在那儿 */
  function closeRecording(cancel) {
    if (!recording) return;
    clearTimeout(recording.timer);
    if (cancel) recording.asr.cancel();
    recording = null;
  }

  // voice:start（Client → Server）{}
  // 开一次录音会话。未登录、DM、服务端没配 ASR key、或 2 秒内重复开录都直接拒绝
  socket.on('voice:start', () => {
    const player = deps.getPlayer();
    if (!player) return;
    if (!isVoiceRollEnabled(deps)) {
      socket.emit('voice:error', { message: '服务端未配置语音识别' });
      return;
    }
    // 连点刷接口：直接拒绝，但要出声——前端已经亮起录音状态了，
    // 静默丢弃的话玩家会对着一个「在录音」的按钮说半天，然后什么都不发生
    if (Date.now() - lastStartAt < START_COOLDOWN_MS) {
      socket.emit('voice:error', { message: '说太快了，稍等一下再试' });
      return;
    }
    lastStartAt = Date.now();

    closeRecording(true);   // 上一次没收尾就先扔掉

    const session = createAsrSession(deps.asr, {
      // 边说边显示，让玩家知道听到的是什么
      onPartial: (text) => socket.emit('voice:partial', { text }),
      onFinal: (text) => {
        closeRecording(false);
        if (!text || !text.trim()) {
          socket.emit('voice:error', { message: '没听清，请再说一次' });
          return;
        }
        handleTranscript(io, socket, deps, text.trim(), 'voice')
          .catch(err => console.error('语音掷骰处理转写文本失败:', err));
      },
      onError: (err) => {
        console.error('语音掷骰 ASR 出错:', err);
        closeRecording(false);
        socket.emit('voice:error', { message: '语音识别失败，请再试一次' });
      }
    });

    recording = {
      asr: session,
      bytes: 0,
      // 前端到点会自己 stop，这里是兜底：客户端不发 stop 也不能让会话一直挂着
      timer: setTimeout(() => { if (recording) recording.asr.finish(); }, MAX_RECORD_MS + 1000)
    };
  });

  // voice:chunk（Client → Server）ArrayBuffer
  // 一帧 16kHz / PCM16 LE / 单声道音频。累计超过上限就直接收尾，不再接收
  socket.on('voice:chunk', (chunk) => {
    if (!recording || !chunk) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    recording.bytes += buf.length;
    if (recording.bytes > MAX_AUDIO_BYTES) {
      recording.asr.finish();
      return;
    }
    recording.asr.sendAudio(buf);
  });

  // voice:stop（Client → Server）{} —— 松手，等最终结果
  socket.on('voice:stop', () => {
    if (recording) recording.asr.finish();
  });

  // voice:text（Client → Server）{ text, via }
  // 跳过 ASR，直接喂一段文本走后续全流程——判定、数值、预览、广播与语音路径完全一致。
  // via='text' 是玩家在聊天框里 @ai 打出来的；省略时按调试用途处理（控制台 VoiceRoll.debugText）。
  socket.on('voice:text', (data) => {
    const text = typeof data === 'string' ? data : (data && data.text);
    if (typeof text !== 'string' || !text.trim()) return;

    const via = (data && data.via) === 'text' ? 'text' : 'voice';
    if (via === 'text') {
      if (Date.now() - lastTextAt < TEXT_COOLDOWN_MS) {
        socket.emit('voice:error', { message: '太快了，稍等一下再试' });
        return;
      }
      lastTextAt = Date.now();
    }

    handleTranscript(io, socket, deps, text.trim(), via)
      .catch(err => console.error('语音掷骰处理转写文本失败:', err));
  });

  // voice:confirm（Client → Server）{ intentId }
  // 仅限发起该 intent 的同一 socket；30 秒过期。成功后 io.emit('dice:result', ...)
  socket.on('voice:confirm', (data) => {
    const player = deps.getPlayer();
    if (!player) return;

    const intentId = data && data.intentId;
    const pending = intentId ? pendingIntents.get(intentId) : null;
    if (!pending || pending.socketId !== socket.id) {
      socket.emit('voice:error', { message: '这次识别已经过期了，请再说一次' });
      return;
    }
    pendingIntents.delete(intentId);
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      socket.emit('voice:error', { message: '这次识别已经过期了，请再说一次' });
      return;
    }

    // 角色卡在掷骰这一刻才重新读，避免预览与确认之间卡被改
    rollAndBroadcast(io, socket, deps, player, pending.intent, pending.transcript, pending.via);
  });

  // voice:cancel（Client → Server）{ intentId }
  // 玩家放弃本次识别结果；同时也是录音中途放弃的入口（ASR 会话由第 5 期接管）
  socket.on('voice:cancel', (data) => {
    closeRecording(true);
    const intentId = data && data.intentId;
    if (intentId) {
      const pending = pendingIntents.get(intentId);
      if (pending && pending.socketId === socket.id) pendingIntents.delete(intentId);
    }
  });

  // 断线时清掉这个 socket 名下所有待确认的意图
  socket.on('disconnect', () => {
    closeRecording(true);
    for (const [id, p] of pendingIntents) {
      if (p.socketId === socket.id) pendingIntents.delete(id);
    }
  });
}

/**
 * 处理一段（来自 ASR 或调试事件的）转写文本：判意图 → 读角色卡 → 掷骰 → 广播。
 * 出错时只给说话者本人发 voice:error（中文），不打扰别人。
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {object} deps 见 registerVoiceRollHandlers
 * @param {string} text 转写文本
 * @param {'voice'|'text'} [via] 这段文本是说出来的还是在聊天框里打出来的（卡片上要区分）
 * @returns {Promise<void>}
 */
async function handleTranscript(io, socket, deps, text, via) {
  const player = deps.getPlayer();
  if (!player) return;   // 未登录，照现有 guard 风格直接 return

  const ruled = parseRollIntent(text);

  // 规则明确判错（例如说了「豁免」却没说哪一项）：不猜，也不浪费一次 LLM 调用
  if (ruled && ruled.error) {
    socket.emit('voice:error', { message: ruled.error });
    return;
  }

  if (ruled) {
    sendPreview(socket, deps, player, ruled, text, via);
    return;
  }

  // 规则判不了，交给 DeepSeek
  let intent = null;
  try {
    intent = await classifyWithDeepSeek(text, player.name, deps.deepseek);
  } catch (err) {
    console.error('语音掷骰 DeepSeek 兜底失败:', err);
    // 调不通（超时 / 网络断 / 接口报错）和「听懂了但判不出来」是两回事，
    // 报成「没听懂」会让玩家以为是自己说得不清楚，白白重说好几遍
    socket.emit('voice:error', {
      message: err.code === 'NO_KEY'
        ? '服务端未配置 DEEPSEEK_API_KEY'
        : 'AI 判定服务暂时不可用，请再试一次'
    });
    return;
  }

  if (!intent) {
    socket.emit('voice:error', { message: '没听懂，请再说一次' });
    return;
  }

  sendPreview(socket, deps, player, intent, text, via);
}

/**
 * 把识别结果做成预览发给说话者本人（voice:intent），并登记成待确认意图。
 * 听错后投出去的骰子是公开的、收不回来，所以先给玩家一眼看清的机会：
 * 高置信度 1.5 秒倒计时自动投（前端负责倒计时，可取消），低置信度必须点一下。
 *
 * voice:intent（Server → Client，只发给说话者）
 *   { intentId, transcript, intent, label, expr, modifier, source, confidence, autoConfirm }
 *
 * @param {import('socket.io').Socket} socket 说话者
 * @param {object} deps 见 registerVoiceRollHandlers
 * @param {{name: string, role: string}} player 说话者
 * @param {object} intent 已校验过的意图
 * @param {string} transcript 转写原文
 * @param {'voice'|'text'} [via] 输入方式，确认掷骰时写进结果条目
 */
function sendPreview(socket, deps, player, intent, transcript, via) {
  const card = deps.getCharacter(player.name);
  if (!card) {
    socket.emit('voice:error', { message: '未找到与你同名的角色卡' });
    return;
  }

  // 预览用的调整值只是给玩家看的，真正算数在 voice:confirm 时重新读卡再算一次
  const modifier = computeRollModifier(card, intent);
  const intentId = crypto.randomUUID();

  sweepPendingIntents();
  pendingIntents.set(intentId, {
    socketId: socket.id,
    name: player.name,
    intent,
    transcript,          // 卡片上要显示识别原话，确认时一并带进结果
    via: via === 'text' ? 'text' : 'voice',
    createdAt: Date.now()
  });

  socket.emit('voice:intent', {
    intentId,
    transcript,
    intent: {
      type: intent.type,
      key: intent.key,
      advantage: intent.advantage,
      extraModifier: intent.extraModifier || 0
    },
    label: buildRollLabel(intent, card),
    expr: buildRollExpr(modifier),
    modifier,
    source: intent.source || 'rule',
    confidence: typeof intent.confidence === 'number' ? intent.confidence : 1,
    autoConfirm: (typeof intent.confidence === 'number' ? intent.confidence : 1) >= AUTO_CONFIRM_CONFIDENCE
  });
}

/**
 * 读说话者的同名角色卡、算调整值、掷骰、写历史并广播 dice:result。
 * 角色卡在掷骰这一刻才读，避免预览与确认之间角色卡被改。
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {object} deps 见 registerVoiceRollHandlers
 * @param {{name: string, role: string}} player 掷骰者
 * @param {object} intent 已校验过的意图
 * @param {string} [transcript] 识别原话，会写进结果条目显示在卡片上
 * @param {'voice'|'text'} [via] 输入方式，卡片上区分「识别自」和「来自输入」
 * @returns {boolean} 是否真的投了骰子
 */
function rollAndBroadcast(io, socket, deps, player, intent, transcript, via) {
  const card = deps.getCharacter(player.name);
  if (!card) {
    socket.emit('voice:error', { message: '未找到与你同名的角色卡' });
    return false;
  }

  const outcome = buildRollOutcome(player, intent, {
    modifier: computeRollModifier(card, intent),
    modifierParts: buildModifierParts(card, intent),
    label: buildRollLabel(intent, card),
    transcript: transcript || '',
    intentSource: intent.source === 'llm' ? 'llm' : 'rule',
    inputMode: via === 'text' ? 'text' : 'voice'
  });

  deps.appendChatHistory(outcome);

  // 广播字段与手打掷骰（server.js 的 dice:roll）保持一致：实时用 playerName，历史回放用 name
  io.emit('dice:result', {
    playerName: outcome.name,
    role: outcome.role,
    sides: outcome.sides,
    result: outcome.result,
    expr: outcome.expr,
    rolls: outcome.rolls,
    kept: outcome.kept,
    modifier: outcome.modifier,
    count: outcome.count,
    advantage: outcome.advantage,
    label: outcome.label,
    // 可观测性字段：和 label 一样必须同时走实时广播与历史回放，
    // 否则刷新之后卡片就变了样（plan §5.4）
    modifierParts: outcome.modifierParts,
    transcript: outcome.transcript,
    intentSource: outcome.intentSource,
    source: outcome.source,
    timestamp: outcome.timestamp
  });
  return true;
}

/**
 * 服务端有没有配好语音识别。前端在 joinSuccess 里拿到这个标志，
 * 为 false 时麦克风按钮直接禁用（别让玩家按半天才发现没配 key）。
 *
 * @param {{asr?: {apiKey?: string}}} deps 同 registerVoiceRollHandlers 的 deps
 * @returns {boolean}
 */
function isVoiceRollEnabled(deps) {
  return !!(deps && deps.asr && deps.asr.apiKey);
}

module.exports = { registerVoiceRollHandlers, isVoiceRollEnabled };
