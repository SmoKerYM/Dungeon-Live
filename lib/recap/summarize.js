/**
 * 调 DeepSeek 把 DM 口述的转写文本总结成前情提要 + 重要人物表。
 *
 * 负责：拼输入（世界观背景 / 人名对照表 / 已有前情 / 本次转写）、调接口、校验返回的 JSON。
 * 不负责：合并进已有内容、落盘、广播（store.js / index.js）。
 *
 * 谁调用：lib/recap/index.js。
 * 依赖：./system-prompt.txt（启动时读一次）、./context.js，
 *       以及 index.js 透传的 { apiKey, model }（server.js 的 DEEPSEEK_API_KEY / DEEPSEEK_MODEL）。
 */

const fs = require('fs');
const path = require('path');
const { WORLD_BACKGROUND, buildChecklistText } = require('./context');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf8');

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
/** 输入可能是几千字的口述，比语音掷骰的 8 秒宽裕得多 */
const TIMEOUT_MS = 90000;
const MAX_OUTPUT_TOKENS = 2000;
const MAX_BRIEF_CHARS = 2000;
const MAX_PEOPLE = 40;

/**
 * 校验 DeepSeek 返回的对象。字段不对就当失败，不要半信半疑地写进前情提要。
 * @param {any} obj
 * @returns {{brief: string, people: {name: string, note: string}[]}|null}
 */
function validateSummary(obj) {
  if (!obj || typeof obj !== 'object' || typeof obj.brief !== 'string') return null;
  const people = Array.isArray(obj.people) ? obj.people : [];
  return {
    brief: obj.brief.trim().slice(0, MAX_BRIEF_CHARS),
    people: people
      .filter(p => p && typeof p.name === 'string' && p.name.trim())
      .slice(0, MAX_PEOPLE)
      .map(p => ({
        name: p.name.trim().slice(0, 40),
        note: typeof p.note === 'string' ? p.note.trim().slice(0, 60) : ''
      }))
  };
}

/**
 * 拼 user 消息。system prompt 固定不变（DeepSeek 前缀缓存能命中），变化的都放这里。
 * @param {string} transcript
 * @param {{brief: string, people: {name: string, note: string}[]}} current 已有的前情提要
 * @returns {string}
 */
function buildUserMessage(transcript, current) {
  const existingPeople = current.people.filter(p => p.name)
    .map(p => `- ${p.name}${p.note ? ` —— ${p.note}` : ''}`).join('\n');
  const existing = [current.brief.trim(), existingPeople && `重要人物：\n${existingPeople}`]
    .filter(Boolean).join('\n\n');

  return [
    `【世界观背景】\n${WORLD_BACKGROUND || '（无）'}`,
    `【人名对照表】\n${buildChecklistText()}`,
    `【已有的前情提要】\n${existing || '（无）'}`,
    `【本次口述转写】\n${transcript}`
  ].join('\n\n');
}

/**
 * 总结一段口述。
 * @param {string} transcript 转写文本
 * @param {{brief: string, people: {name: string, note: string}[]}} current 已有的前情提要（只作上下文）
 * @param {{apiKey: string, model: string}} cfg
 * @returns {Promise<{brief: string, people: {name: string, note: string}[]}>}
 * @throws {Error} 没配 key（err.code = 'NO_KEY'）、网络/接口错误、返回不合法
 */
async function summarizeRecap(transcript, current, cfg) {
  if (!cfg || !cfg.apiKey) {
    const err = new Error('服务端未配置 DEEPSEEK_API_KEY');
    err.code = 'NO_KEY';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(transcript, current) }
        ],
        // 要一点文采，但人名纠错和「不许编造」更重要，温度压低
        temperature: 0.5,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek 返回 ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('DeepSeek 返回内容为空');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`DeepSeek 返回的不是合法 JSON: ${raw.slice(0, 200)}`);
    }
    const summary = validateSummary(parsed);
    if (!summary) throw new Error(`DeepSeek 返回字段不合法: ${raw.slice(0, 200)}`);
    return summary;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { summarizeRecap, validateSummary, buildUserMessage, SYSTEM_PROMPT };
