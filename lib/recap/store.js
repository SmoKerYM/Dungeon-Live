/**
 * 前情提要的数据：{ brief, people: [{name, note}], updatedAt, pendingTranscript }。
 *
 * 负责：读写 recap.json（500ms 防抖落盘，和笔记/人物记录一致）、
 *       清洗 DM 手改上来的数据、把一次新的 AI 总结并进已有内容。
 * 不负责：socket 事件（index.js）、调用 DeepSeek（summarize.js）。
 *
 * 谁调用：lib/recap/index.js。文件路径由 server.js 注入（生产环境在 Render 持久盘 /data）。
 * 依赖：无。
 */

const fs = require('fs');
const path = require('path');

const SAVE_DEBOUNCE_MS = 500;
/** DM 手改的上限：防一个超大 payload 把磁盘和广播撑爆 */
const MAX_BRIEF_CHARS = 20000;
const MAX_PEOPLE = 100;
const MAX_NAME_CHARS = 40;
const MAX_NOTE_CHARS = 200;

/** @typedef {{name: string, note: string}} RecapPerson */
/** @typedef {{brief: string, people: RecapPerson[], updatedAt: number|null, pendingTranscript: string}} RecapData */

/** @returns {RecapData} */
function emptyRecap() {
  return { brief: '', people: [], updatedAt: null, pendingTranscript: '' };
}

/**
 * 清洗人物列表：去掉空名字、截断超长字段、按名字去重（先出现的留下）。
 * @param {any} list
 * @returns {RecapPerson[]}
 */
function normalizePeople(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name || '').trim().slice(0, MAX_NAME_CHARS);
    const note = String(p.note || '').trim().slice(0, MAX_NOTE_CHARS);
    // 空名字的行允许留着（DM 刚点了「添加」还没填），但同名只留一个
    const key = name.toLowerCase();
    if (name && seen.has(key)) continue;
    if (name) seen.add(key);
    out.push({ name, note });
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}

/**
 * 把一次 AI 总结并进已有的前情提要：正文接在后面，人物按名字合并。
 * 已有的人物保留 DM 写过的说明（DM 手改过的比 AI 可信），只有说明为空时才用 AI 的补上。
 *
 * @param {RecapData} current
 * @param {{brief: string, people: RecapPerson[]}} summary
 * @returns {{brief: string, people: RecapPerson[]}}
 */
function mergeSummary(current, summary) {
  const brief = [current.brief.trim(), summary.brief.trim()].filter(Boolean).join('\n\n');

  const people = current.people.map(p => ({ ...p }));
  const index = new Map(people.map((p, i) => [p.name.toLowerCase(), i]));
  for (const p of summary.people) {
    const i = index.get(p.name.toLowerCase());
    if (i === undefined) {
      index.set(p.name.toLowerCase(), people.length);
      people.push({ name: p.name, note: p.note });
    } else if (!people[i].note && p.note) {
      people[i].note = p.note;
    }
  }
  return { brief: brief.slice(0, MAX_BRIEF_CHARS), people: normalizePeople(people) };
}

/**
 * 建一个前情提要存储。
 * @param {string} filePath recap.json 的路径
 */
function createRecapStore(filePath) {
  /** @type {RecapData} */
  let data = load();
  let saveTimer = null;

  function load() {
    try {
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          brief: typeof raw.brief === 'string' ? raw.brief : '',
          people: normalizePeople(raw.people),
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
          pendingTranscript: typeof raw.pendingTranscript === 'string' ? raw.pendingTranscript : ''
        };
      }
    } catch (err) {
      console.error('读取前情提要失败:', err);
    }
    return emptyRecap();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        console.error('保存前情提要失败:', err);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  return {
    /** @returns {RecapData} */
    get() { return data; },

    /**
     * DM 手改：整份替换正文和人物表。
     * @param {{brief?: any, people?: any}} patch
     */
    setContent(patch) {
      data.brief = String(patch.brief ?? '').slice(0, MAX_BRIEF_CHARS);
      data.people = normalizePeople(patch.people);
      data.updatedAt = Date.now();
      scheduleSave();
    },

    /** @param {{brief: string, people: RecapPerson[]}} summary */
    applySummary(summary) {
      const merged = mergeSummary(data, summary);
      data.brief = merged.brief;
      data.people = merged.people;
      data.updatedAt = Date.now();
      scheduleSave();
    },

    /**
     * 转写好、还没总结成功的文本先存下来：DeepSeek 挂了的话 DM 可以点「重试」，
     * 不用把十分钟的讲述再说一遍
     * @param {string} text
     */
    setPendingTranscript(text) {
      data.pendingTranscript = String(text || '');
      scheduleSave();
    }
  };
}

module.exports = { createRecapStore, mergeSummary, normalizePeople };
