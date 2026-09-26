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
const { computeRollModifier, buildRollOutcome, buildRollLabel, buildRollExpr } = require('./dice');

/**
 * 已识别、等玩家确认的意图：intentId → { socketId, name, intent, createdAt }。
 * 只在内存里，重启即清空（和撤销栈一样）。30 秒过期，确认时校验 socketId 必须一致，
 * 免得别人拿到 id 就能替你投。
 */
const pendingIntents = new Map();
const PENDING_TTL_MS = 30000;
/** 置信度达到这个值才自动确认，低于它必须玩家点一下（听错后投出的骰子是公开的） */
const AUTO_CONFIRM_CONFIDENCE = 0.9;

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
 */
function registerVoiceRollHandlers(io, socket, deps) {
  // voice:text（Client → Server）{ text }
  // 调试用：跳过 ASR，直接喂一段文本走后续全流程。任何已登录的玩家都能触发，
  // 走的判定、数值、广播与真实语音路径完全一致。
  socket.on('voice:text', (data) => {
    const text = typeof data === 'string' ? data : (data && data.text);
    if (typeof text !== 'string' || !text.trim()) return;
    handleTranscript(io, socket, deps, text.trim())
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
    rollAndBroadcast(io, socket, deps, player, pending.intent);
  });

  // voice:cancel（Client → Server）{ intentId }
  // 玩家放弃本次识别结果；同时也是录音中途放弃的入口（ASR 会话由第 5 期接管）
  socket.on('voice:cancel', (data) => {
    const intentId = data && data.intentId;
    if (intentId) {
      const pending = pendingIntents.get(intentId);
      if (pending && pending.socketId === socket.id) pendingIntents.delete(intentId);
    }
  });

  // 断线时清掉这个 socket 名下所有待确认的意图
  socket.on('disconnect', () => {
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
 * @returns {Promise<void>}
 */
async function handleTranscript(io, socket, deps, text) {
  const player = deps.getPlayer();
  if (!player) return;   // 未登录，照现有 guard 风格直接 return

  const ruled = parseRollIntent(text);

  // 规则明确判错（例如说了「豁免」却没说哪一项）：不猜，也不浪费一次 LLM 调用
  if (ruled && ruled.error) {
    socket.emit('voice:error', { message: ruled.error });
    return;
  }

  if (ruled) {
    sendPreview(socket, deps, player, ruled, text);
    return;
  }

  // 规则判不了，交给 DeepSeek
  let intent = null;
  try {
    intent = await classifyWithDeepSeek(text, player.name, deps.deepseek);
  } catch (err) {
    console.error('语音掷骰 DeepSeek 兜底失败:', err);
    socket.emit('voice:error', {
      message: err.code === 'NO_KEY' ? '服务端未配置 DEEPSEEK_API_KEY' : '没听懂，请再说一次'
    });
    return;
  }

  if (!intent) {
    socket.emit('voice:error', { message: '没听懂，请再说一次' });
    return;
  }

  sendPreview(socket, deps, player, intent, text);
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
 */
function sendPreview(socket, deps, player, intent, transcript) {
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
    label: buildRollLabel(intent),
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
 * @returns {boolean} 是否真的投了骰子
 */
function rollAndBroadcast(io, socket, deps, player, intent) {
  const card = deps.getCharacter(player.name);
  if (!card) {
    socket.emit('voice:error', { message: '未找到与你同名的角色卡' });
    return false;
  }

  const modifier = computeRollModifier(card, intent);
  const outcome = buildRollOutcome(player, intent, modifier);

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
    source: outcome.source,
    timestamp: outcome.timestamp
  });
  return true;
}

module.exports = { registerVoiceRollHandlers };
