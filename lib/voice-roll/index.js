/**
 * 语音掷骰功能的唯一对外入口。
 *
 * 负责：注册 voice:* 的 socket 事件，把「转写文本 → 意图 → 角色卡调整值 → 掷骰 → 广播」
 *       这条链串起来。
 * 不负责：规则判定（intent.js）、数值与掷骰（dice.js）、LLM 兜底（llm.js）、ASR（asr.js），
 *         也不负责持久化——聊天历史通过 deps.appendChatHistory 复用 server.js 的现有实现。
 *
 * 谁调用：server.js 在 io.on('connection') 回调里，对每个 socket 调一次
 *         registerVoiceRollHandlers(io, socket, deps)。
 * 依赖：./intent、./dice。**绝不能反向 require('../../server')**（会循环依赖）；
 *       需要的一切由 deps 注入。
 */

const { parseRollIntent } = require('./intent');
const { computeRollModifier, buildRollOutcome } = require('./dice');

/**
 * 给一个 socket 注册全部语音掷骰事件。
 *
 * @param {import('socket.io').Server} io 用于广播 dice:result
 * @param {import('socket.io').Socket} socket 当前连接
 * @param {object} deps 依赖注入
 * @param {() => ({name: string, role: string}|undefined)} deps.getPlayer 取当前 socket 的玩家（未登录返回 undefined）
 * @param {(name: string) => object|null} deps.getCharacter 按角色名取角色卡
 * @param {(entry: object) => void} deps.appendChatHistory 追加聊天历史（复用 server.js 的实现，保证回放一致）
 */
function registerVoiceRollHandlers(io, socket, deps) {
  // voice:text（Client → Server）{ text }
  // 调试用：跳过 ASR，直接喂一段文本走后续全流程。任何已登录的玩家都能触发，
  // 走的判定、数值、广播与真实语音路径完全一致。
  socket.on('voice:text', (data) => {
    const text = typeof data === 'string' ? data : (data && data.text);
    if (typeof text !== 'string' || !text.trim()) return;
    handleTranscript(io, socket, deps, text.trim());
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
 */
function handleTranscript(io, socket, deps, text) {
  const player = deps.getPlayer();
  if (!player) return;   // 未登录，照现有 guard 风格直接 return

  const intent = parseRollIntent(text);
  if (!intent) {
    socket.emit('voice:error', { message: '没听懂，请再说一次' });
    return;
  }
  if (intent.error) {
    socket.emit('voice:error', { message: intent.error });
    return;
  }

  rollAndBroadcast(io, socket, deps, player, intent, text);
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
 * @param {string} transcript 转写原文（只回给说话者，方便他判断是不是听错了）
 * @returns {boolean} 是否真的投了骰子
 */
function rollAndBroadcast(io, socket, deps, player, intent, transcript) {
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
  if (transcript) socket.emit('voice:rolled', { transcript, label: outcome.label });
  return true;
}

module.exports = { registerVoiceRollHandlers };
