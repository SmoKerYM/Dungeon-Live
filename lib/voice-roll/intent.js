/**
 * 掷骰意图的规则匹配层（纯函数，无 IO、无 gameState）。
 *
 * 负责：把 ASR 转写文本按 plan-voice-roll.md §6 的规则判成
 *       「哪一类检定 × 哪一项 × 是否优劣势」；判不出来就返回 null，交给 LLM 兜底。
 *       另外提供 validateIntent()，给 LLM 返回的 JSON 做严格校验。
 * 不负责：调用 LLM（llm.js）、读角色卡、算调整值、掷骰（dice.js）。
 *
 * 谁调用：lib/voice-roll/index.js（收到 ASR final 或 voice:text 之后第一步就走这里）、
 *         scripts/test-voice-intent.js。
 * 依赖：./vocab.js（词表单一数据源）。
 */

const V = require('./vocab');

/** 把正则元字符转义掉，别名里有 . 之类的字符时不至于炸 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 预处理转写文本：小写、全角转半角、标点转空格、合并空白、修正 ASR 常见错字。
 *
 * @param {string} raw 原始转写文本
 * @returns {{ spaced: string, compact: string }}
 *          spaced：保留单个空格，用于拉丁字母的单词边界匹配；
 *          compact：去掉全部空格，用于中文子串匹配
 */
function normalizeText(raw) {
  let s = String(raw || '');
  // 全角 → 半角（ASCII 区），全角空格单独处理
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
       .replace(/　/g, ' ')
       .toLowerCase();
  // 标点（中英）一律变空格，避免「敏捷（隐匿）」这种写法把词切开又粘住
  s = s.replace(/[，。、！？；：“”‘’（）【】《》…—,.!?;:"'()\[\]{}<>~`@#$%^&*_=|\\\/]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // 整词替换 ASR 同音错字，绝不做单字替换
  for (const [wrong, right] of V.ASR_TYPOS) {
    if (s.includes(wrong)) s = s.split(wrong).join(right);
  }
  return { spaced: s, compact: s.replace(/\s+/g, '') };
}

/** 中文子串命中：返回最早出现的位置，未命中返回 -1 */
function indexOfAnyCn(compact, words) {
  let best = -1;
  for (const w of words) {
    const i = compact.indexOf(w);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/** 拉丁字母按单词边界命中：返回最早位置，未命中返回 -1 */
function indexOfAnyEn(spaced, words) {
  let best = -1;
  for (const w of words) {
    const m = new RegExp(`\\b${escapeRe(w)}\\b`).exec(spaced);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * 在文本里找最早出现的属性。
 * @returns {{ key: string, viaCn: boolean }|null} viaCn 表示是通过中文别名命中的（「感知」歧义规则要用）
 */
function findAttribute(compact, spaced) {
  let hit = null;
  for (const key of V.ATTR_KEYS) {
    const cn = indexOfAnyCn(compact, V.ATTR_ALIAS_CN[key]);
    const en = indexOfAnyEn(spaced, V.ATTR_ALIAS_EN[key]);
    if (cn !== -1 && (!hit || cn < hit.at)) hit = { key, at: cn, viaCn: true };
    if (en !== -1 && (!hit || en < hit.at)) hit = { key, at: en, viaCn: false };
  }
  return hit ? { key: hit.key, viaCn: hit.viaCn } : null;
}

/** 在文本里找最早出现的技能 key，未命中返回 null */
function findSkill(compact, spaced) {
  let hit = null;
  for (const key of V.SKILL_KEYS) {
    const cn = indexOfAnyCn(compact, V.SKILL_ALIAS_CN[key]);
    const en = indexOfAnyEn(spaced, V.SKILL_ALIAS_EN[key]);
    if (cn !== -1 && (!hit || cn < hit.at)) hit = { key, at: cn };
    if (en !== -1 && (!hit || en < hit.at)) hit = { key, at: en };
  }
  return hit ? hit.key : null;
}

/**
 * 判断优势 / 劣势。两者同时出现按 5e 规则相互抵消，返回 normal。
 * 注意 disadvantage 包含 advantage，靠单词边界区分（\badvantage\b 不会命中 disadvantage）。
 *
 * @param {string} compact 去空格文本
 * @param {string} spaced  带空格文本
 * @returns {'normal'|'advantage'|'disadvantage'}
 */
function detectAdvantage(compact, spaced) {
  const hasDis = indexOfAnyCn(compact, V.DISADVANTAGE_CN) !== -1 ||
                 indexOfAnyEn(spaced, V.DISADVANTAGE_EN) !== -1;
  const hasAdv = indexOfAnyCn(compact, V.ADVANTAGE_CN) !== -1 ||
                 indexOfAnyEn(spaced, V.ADVANTAGE_EN) !== -1;
  if (hasDis && hasAdv) return 'normal';   // 优劣抵消
  if (hasDis) return 'disadvantage';
  if (hasAdv) return 'advantage';
  return 'normal';
}

/**
 * 规则匹配主入口。判定顺序见 plan-voice-roll.md §6.3，命中即停。
 *
 * @param {string} text ASR 转写文本（原始，函数内部自己做预处理）
 * @returns {null
 *          | { error: string }
 *          | { type: string, key: string|null, advantage: string, extraModifier: number,
 *              confidence: number, source: 'rule' }}
 *          null → 规则判不了，调用方应转 LLM 兜底；
 *          { error } → 明确判错且不该猜（例如说了「豁免」却没说哪一项），直接回 voice:error；
 *          其余 → 可直接使用的意图。
 */
function parseRollIntent(text) {
  const { spaced, compact } = normalizeText(text);
  if (!compact) return null;

  // 玩家明说了额外加减值（「再减二」）时规则层不接，整句交给 LLM，
  // 免得把这个修正值悄悄吃掉
  if (indexOfAnyCn(compact, V.EXTRA_MOD_HINTS) !== -1) return null;

  const advantage = detectAdvantage(compact, spaced);
  const done = (type, key) => ({
    type, key: key || null, advantage, extraModifier: 0, confidence: 1, source: 'rule'
  });

  // 1. 死亡豁免（豁免的例外 A，必须在普通豁免之前判）
  if (indexOfAnyCn(compact, V.DEATH_SAVE_CN) !== -1 ||
      indexOfAnyEn(spaced, V.DEATH_SAVE_EN) !== -1) {
    return done('deathSave', null);
  }

  // 1. 豁免：只要出现「豁免」就走豁免路径，「检定」二字不影响
  const isSave = indexOfAnyCn(compact, V.SAVE_WORDS_CN) !== -1 ||
                 indexOfAnyEn(spaced, V.SAVE_WORDS_EN) !== -1;
  if (isSave) {
    const attr = findAttribute(compact, spaced);
    // 例外 B：说了豁免却没说哪一项 —— 不猜，也不调 LLM
    if (!attr) return { error: '没听清是哪项豁免' };
    return done('save', attr.key);
  }

  // 2. 技能（属性名与技能名同时出现时取技能）
  const skill = findSkill(compact, spaced);
  if (skill) return done('skill', skill);

  // 3. 属性检定
  const attr = findAttribute(compact, spaced);
  if (attr) {
    const hasCheckWord = indexOfAnyCn(compact, V.CHECK_WORDS_CN) !== -1 ||
                         indexOfAnyEn(spaced, V.CHECK_WORDS_EN) !== -1;
    // 歧义：单独的「感知一下 / 感知周围」大概率是察觉技能，规则层放弃，交给 LLM
    if (attr.key === 'wisdom' && attr.viaCn && !hasCheckWord) return null;
    return done('ability', attr.key);
  }

  // 4. 先攻
  if (indexOfAnyCn(compact, V.INITIATIVE_CN) !== -1 ||
      indexOfAnyEn(spaced, V.INITIATIVE_EN) !== -1) {
    return done('initiative', null);
  }

  // 5. 交给 DeepSeek
  return null;
}

/**
 * 严格校验一个意图对象（主要用于 LLM 返回的 JSON）。任何一项不合法都返回 null，
 * 调用方据此回 voice:error，绝不把半个合法的意图投出去。
 *
 * @param {any} obj 待校验对象，形如 { type, key, advantage, extraModifier, confidence, note }
 * @returns {{ type: string, key: string|null, advantage: string, extraModifier: number,
 *             confidence: number, note: string }|null}
 */
function validateIntent(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const type = obj.type;
  if (!V.INTENT_TYPES.includes(type)) return null;

  let key = obj.key == null ? null : String(obj.key);
  if (type === 'ability' || type === 'save') {
    if (!key || !V.ATTR_KEYS.includes(key)) return null;
  } else if (type === 'skill') {
    if (!key || !V.SKILL_KEYS.includes(key)) return null;
  } else {
    key = null;   // initiative / deathSave 不带 key
  }

  const advantage = obj.advantage || 'normal';
  if (!V.ADVANTAGE_TYPES.includes(advantage)) return null;

  const extraModifier = obj.extraModifier == null ? 0 : Number(obj.extraModifier);
  if (!Number.isInteger(extraModifier) || extraModifier < -10 || extraModifier > 10) return null;

  let confidence = obj.confidence == null ? 0.5 : Number(obj.confidence);
  if (!Number.isFinite(confidence)) return null;
  confidence = Math.min(1, Math.max(0, confidence));

  const note = typeof obj.note === 'string' ? obj.note.slice(0, 40) : '';

  return { type, key, advantage, extraModifier, confidence, note };
}

module.exports = { parseRollIntent, validateIntent, normalizeText, detectAdvantage };
