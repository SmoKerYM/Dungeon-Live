/**
 * DeepSeek 兜底分类：规则层判不出来的口语说法，交给 LLM 判成意图枚举。
 *
 * 负责：调 DeepSeek chat/completions，把转写文本判成
 *       { type, key, advantage, extraModifier, confidence, note }。
 * 不负责：掷骰、算调整值、读角色卡——LLM 的职责边界就是**只输出枚举**
 *         （见 plan-voice-roll.md §2：LLM 的随机数不可信、算术偶尔出错）。
 *         结果的合法性由 intent.js 的 validateIntent() 把关，不是由 LLM 保证。
 *
 * 谁调用：lib/voice-roll/index.js，在 parseRollIntent() 返回 null 时。
 * 依赖：./system-prompt.txt（启动时读一次）、./intent.js 的 validateIntent、
 *       以及 index.js 通过 deps 传进来的 { apiKey, model }。
 *
 * 为什么不复用 server.js 的 generateCharacterSummary()：那段代码归角色卡功能所有，
 * 这里照抄调用方式即可，将来要合并成公共的 lib/deepseek.js 再单独提一个 commit。
 */

const fs = require('fs');
const path = require('path');
const { validateIntent } = require('./intent');

// system prompt 单独放文件，方便不改代码就调 prompt；nodemon 已监听 .txt
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf8');

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 8000;

/**
 * 让 DeepSeek 把一段转写文本判成掷骰意图。
 *
 * system prompt 固定不变（DeepSeek 有前缀缓存，固定 system 能命中缓存省钱），
 * 玩家名和转写文本放在 user 消息里。temperature 0，走 JSON 模式。
 *
 * @param {string} text 转写文本
 * @param {string} playerName 说话的玩家名（检定对象默认就是他本人）
 * @param {{apiKey: string, model: string}} cfg DeepSeek 配置，由 index.js 从 server.js 透传
 * @returns {Promise<{type: string, key: string|null, advantage: string, extraModifier: number,
 *                    confidence: number, note: string}|null>}
 *          校验通过的意图；LLM 判为 unknown、返回不合法、或调用失败时返回 null
 * @throws {Error} 网络/接口层面的错误（调用方捕获后回一条「语音识别失败」之类的提示）
 */
async function classifyWithDeepSeek(text, playerName, cfg) {
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `当前说话的玩家：${playerName}\n转写文本：「${text}」` }
        ],
        temperature: 0,
        max_tokens: 150,
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
      console.error('语音掷骰：DeepSeek 返回的不是合法 JSON:', raw.slice(0, 200));
      return null;
    }

    // type=unknown 以及任何不合法的字段组合都按「没听懂」处理，绝不半信半疑地投出去
    const intent = validateIntent(parsed);
    if (!intent) {
      console.log('语音掷骰：DeepSeek 判为无法识别', raw.slice(0, 120));
      return null;
    }
    return { ...intent, source: 'llm' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { classifyWithDeepSeek, SYSTEM_PROMPT };
