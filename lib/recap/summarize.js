/**
 * 调 DeepSeek 根据 DM 新的口述修订前情提要 + 重要人物表。
 *
 * 不是「总结一段、追加在后面」：模型拿到的是当前文本框里的全文（DM 可能手改过），
 * 自己判断这次口述是续写、补细节、纠正还是删除，输出**修订后的完整**正文和人物表。
 *
 * 负责：拼输入（世界观背景 / 人名对照表 / 当前前情 / 当前人物 / 本次转写）、调接口、校验返回的 JSON。
 * 不负责：落盘、广播（store.js / index.js）。
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
/** 输入可能是几千字的口述 + 整份前情，比语音掷骰的 8 秒宽裕得多 */
const TIMEOUT_MS = 120000;
/** 输出的是整份修订稿，前情越长输出越长 */
const MAX_OUTPUT_TOKENS = 8000;
const MAX_BRIEF_CHARS = 20000;
const MAX_PEOPLE = 100;

/**
 * 校验 DeepSeek 返回的对象。字段不对就当失败，不要半信半疑地写进前情提要。
 * @param {any} obj
 * @returns {{unchanged: true}|{brief: string, people: {name: string, note: string}[], changes: string}|null}
 */
function validateSummary(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.unchanged === true) return { unchanged: true };
  if (typeof obj.brief !== 'string') return null;
  const people = Array.isArray(obj.people) ? obj.people : [];
  return {
    brief: obj.brief.trim().slice(0, MAX_BRIEF_CHARS),
    changes: typeof obj.changes === 'string' ? obj.changes.trim().slice(0, 80) : '',
    people: people
      .filter(p => p && typeof p.name === 'string' && p.name.trim())
      .slice(0, MAX_PEOPLE)
      .map(p => ({
        name: p.name.trim().slice(0, 40),
        note: typeof p.note === 'string' ? p.note.trim().slice(0, 200) : ''
      }))
  };
}

/**
 * 拼 user 消息。system prompt 固定不变（DeepSeek 前缀缓存能命中），变化的都放这里。
 * 当前人物表用 JSON 给：模型要原样抄回没改动的条目，结构化的比「名字 —— 说明」好抄。
 * @param {string} transcript
 * @param {{brief: string, people: {name: string, note: string}[]}} current 当前文本框里的内容
 * @returns {string}
 */
function buildUserMessage(transcript, current) {
  const people = current.people.filter(p => p.name).map(p => ({ name: p.name, note: p.note }));
  return [
    `【世界观背景】\n${WORLD_BACKGROUND || '（无）'}`,
    `【人名对照表】\n${buildChecklistText()}`,
    `【当前前情提要】\n${current.brief.trim() || '（空）'}`,
    `【当前重要人物】\n${people.length ? JSON.stringify(people, null, 0) : '（空）'}`,
    `【本次口述转写】\n${transcript}`
  ].join('\n\n');
}

/**
 * 根据一段口述修订前情提要。
 * @param {string} transcript 转写文本
 * @param {{brief: string, people: {name: string, note: string}[]}} current 当前文本框里的内容（修订的底稿）
 * @param {{apiKey: string, model: string}} cfg
 * @returns {Promise<{unchanged: true}|{brief: string, people: {name: string, note: string}[], changes: string}>}
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
        // 要一点文采，但「没涉及的部分原样保留」和「不许编造」更重要，温度压低
        temperature: 0.4,
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
