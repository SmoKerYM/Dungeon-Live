/**
 * 前情提要的「背景资料」：人名对照表（checklist.json）与世界观背景（world-background.txt）。
 *
 * 负责：启动时读一次这两个文件，并把它们加工成 ASR 热词串、喂给 DeepSeek 的文本，
 *       以及判断一个名字是不是对照表里的（前端给新名字打「新」标记用）。
 * 不负责：调用 ASR / DeepSeek（index.js / summarize.js）。
 *
 * 谁调用：lib/recap/index.js、lib/recap/summarize.js。
 * 依赖：同目录下的 checklist.json、world-background.txt。改了它们 nodemon 会重启，重新读。
 */

const fs = require('fs');
const path = require('path');

/** @typedef {{name: string, aliases?: string[], note?: string}} ChecklistEntry */

/**
 * 读人名对照表。文件坏了不能让整个服务起不来，退化成空表并打日志。
 * @returns {{players: ChecklistEntry[], npcs: ChecklistEntry[]}}
 */
function loadChecklist() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.json'), 'utf8'));
    const clean = list => (Array.isArray(list) ? list : [])
      .filter(e => e && typeof e.name === 'string' && e.name.trim())
      .map(e => ({
        name: e.name.trim(),
        aliases: Array.isArray(e.aliases) ? e.aliases.filter(a => typeof a === 'string' && a.trim()) : [],
        note: typeof e.note === 'string' ? e.note.trim() : ''
      }));
    return { players: clean(raw.players), npcs: clean(raw.npcs) };
  } catch (err) {
    console.error('读取前情提要人名对照表失败:', err);
    return { players: [], npcs: [] };
  }
}

/** @returns {string} 世界观背景原文（可能是空串） */
function loadWorldBackground() {
  try {
    return fs.readFileSync(path.join(__dirname, 'world-background.txt'), 'utf8').trim();
  } catch (err) {
    console.error('读取前情提要世界观背景失败:', err);
    return '';
  }
}

const CHECKLIST = loadChecklist();
const WORLD_BACKGROUND = loadWorldBackground();

/** 对照表里所有写法（正名 + 别名），统一小写后用来判「是不是新名字」 */
const KNOWN_NAMES = new Set(
  [...CHECKLIST.players, ...CHECKLIST.npcs]
    .flatMap(e => [e.name, ...e.aliases])
    .map(n => n.toLowerCase())
);

/**
 * 名字是否在对照表里（正名或别名都算）。
 * @param {string} name
 * @returns {boolean}
 */
function isChecklistName(name) {
  return KNOWN_NAMES.has(String(name || '').trim().toLowerCase());
}

/**
 * ASR 的热词上下文：人名是低频词，不给上下文基本一定写成同音字。
 * 这里是识别阶段的第一道纠错，DeepSeek 按对照表再纠一道。
 * @returns {string}
 */
function buildAsrContext() {
  const names = [...CHECKLIST.players, ...CHECKLIST.npcs].flatMap(e => [e.name, ...e.aliases]);
  return `跑团（D&D）DM 讲述剧情经过。人物和势力：${names.join('、')}。`;
}

/**
 * 给 DeepSeek 看的对照表文本，一行一个。
 * @returns {string}
 */
function buildChecklistText() {
  const line = e => {
    const alias = e.aliases.length ? `（别名：${e.aliases.join('、')}）` : '';
    const note = e.note ? ` —— ${e.note}` : '';
    return `- ${e.name}${alias}${note}`;
  };
  const parts = [];
  if (CHECKLIST.players.length) parts.push('玩家角色：\n' + CHECKLIST.players.map(line).join('\n'));
  if (CHECKLIST.npcs.length) parts.push('NPC 与势力：\n' + CHECKLIST.npcs.map(line).join('\n'));
  return parts.join('\n\n') || '（无）';
}

module.exports = {
  CHECKLIST, WORLD_BACKGROUND,
  isChecklistName, buildAsrContext, buildChecklistText
};
