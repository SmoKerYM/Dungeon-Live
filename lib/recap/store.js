/**
 * 前情提要的数据：{ brief, people: [{name, note}], updatedAt, pendingTranscript }。
 *
 * 负责：读写 recap.json（500ms 防抖落盘，和笔记/人物记录一致）、
 *       清洗 DM 手改上来的数据、用 AI 的修订稿整份替换、清空。
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

    /**
     * 用 AI 的修订稿整份替换。修订稿本来就是在当前内容上改出来的完整版本，
     * 所以这里不再合并（合并反而会把模型按口述删掉的内容又加回来）
     * @param {{brief: string, people: RecapPerson[]}} revision
     */
    applyRevision(revision) {
      data.brief = String(revision.brief || '').slice(0, MAX_BRIEF_CHARS);
      data.people = normalizePeople(revision.people);
      data.updatedAt = Date.now();
      scheduleSave();
    },

    /** DM 点「清空」：正文、人物、以及还没总结成功的转写全部清掉（否则「重试总结」会把旧讲述带回来） */
    clear() {
      data = { ...emptyRecap(), updatedAt: Date.now() };
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

module.exports = { createRecapStore, normalizePeople };
