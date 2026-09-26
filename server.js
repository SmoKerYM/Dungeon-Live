const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 笔记文件路径（Render Disk 挂载点）
const NOTES_FILE = process.env.NODE_ENV === 'production' ? '/data/notes.txt' : './data/notes.txt';
// 角色卡文件路径
const CHARACTERS_FILE = process.env.NODE_ENV === 'production' ? '/data/characters.json' : './data/characters.json';
// 人物记录文件路径
const CHARACTERS_NOTES_FILE = process.env.NODE_ENV === 'production'
  ? '/data/characters_notes.json' : './data/characters_notes.json';
// 聊天历史文件路径
const CHAT_HISTORY_FILE = process.env.NODE_ENV === 'production'
  ? '/data/chat_history.json' : './data/chat_history.json';
// 聊天历史最大保留条数
const MAX_CHAT_HISTORY = 100;
// 撤销/重做栈最大长度
const MAX_UNDO_STACK = 20;
// 掉线宽限期：浏览器挂起后台标签页会中断心跳，此期间不判定玩家离开
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 120000;
// 地图资产文件路径
const MAP_ASSETS_FILE = process.env.NODE_ENV === 'production' ? '/data/map_assets.json' : './data/map_assets.json';
// 世界状态文件路径
const WORLD_FILE = process.env.NODE_ENV === 'production' ? '/data/world.json' : './data/world.json';
// UI 偏好文件路径（DM 画笔/矩形颜色持久化）
const UI_PREFS_FILE = process.env.NODE_ENV === 'production' ? '/data/ui_prefs.json' : './data/ui_prefs.json';

// 读取笔记
function loadNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      return fs.readFileSync(NOTES_FILE, 'utf8');
    }
  } catch (err) {
    console.error('读取笔记失败:', err);
  }
  return '';
}

// 保存笔记
function saveNotes(content) {
  try {
    // 确保目录存在
    const dir = path.dirname(NOTES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(NOTES_FILE, content, 'utf8');
  } catch (err) {
    console.error('保存笔记失败:', err);
  }
}

// 读取人物记录
function loadCharacterNotes() {
  try {
    if (fs.existsSync(CHARACTERS_NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(CHARACTERS_NOTES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('读取人物记录失败:', err);
  }
  return [];
}

// 保存人物记录
function saveCharacterNotes(data) {
  try {
    const dir = path.dirname(CHARACTERS_NOTES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHARACTERS_NOTES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('保存人物记录失败:', err);
  }
}

// 读取聊天历史
function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('读取聊天历史失败:', err);
  }
  return [];
}

// 保存聊天历史
function saveChatHistory(data) {
  try {
    const dir = path.dirname(CHAT_HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('保存聊天历史失败:', err);
  }
}

// 追加一条聊天/骰子记录到历史（自动截断 + debounce 落盘）
let chatSaveTimer = null;
function appendChatHistory(entry) {
  gameState.chatHistory.push(entry);
  if (gameState.chatHistory.length > MAX_CHAT_HISTORY) {
    gameState.chatHistory.splice(0, gameState.chatHistory.length - MAX_CHAT_HISTORY);
  }
  clearTimeout(chatSaveTimer);
  chatSaveTimer = setTimeout(() => {
    saveChatHistory(gameState.chatHistory);
  }, 500);
}

// 读取所有角色卡
function loadCharacters() {
  try {
    if (fs.existsSync(CHARACTERS_FILE)) {
      return JSON.parse(fs.readFileSync(CHARACTERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('读取角色卡失败:', err);
  }
  return {};
}

// 保存角色卡
function saveCharacter(characterData) {
  try {
    const characters = loadCharacters();
    const isNew = !characters[characterData.name];
    characters[characterData.name] = characterData;

    const dir = path.dirname(CHARACTERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHARACTERS_FILE, JSON.stringify(characters, null, 2), 'utf8');
    return { success: true, isNew };
  } catch (err) {
    console.error('保存角色卡失败:', err);
    return { success: false, error: err.message };
  }
}

// 获取角色卡名称列表
function getCharacterNames() {
  const characters = loadCharacters();
  return Object.keys(characters);
}

// 获取指定角色卡
function getCharacter(name) {
  const characters = loadCharacters();
  return characters[name] || null;
}

// 根据玩家名获取角色卡 HP
function getCharacterHP(playerName) {
  const character = getCharacter(playerName);
  if (character && character.hp) {
    return { cur: character.hp.cur, max: character.hp.max };
  }
  return null;
}

// 读取地图资产
function loadMapAssets() {
  try {
    if (fs.existsSync(MAP_ASSETS_FILE)) {
      return JSON.parse(fs.readFileSync(MAP_ASSETS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('读取地图资产失败:', err);
  }
  return {};
}

// 保存地图资产
function saveMapAssets(data) {
  try {
    const dir = path.dirname(MAP_ASSETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MAP_ASSETS_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('保存地图资产失败:', err);
  }
}

// 读取世界状态
function loadWorld() {
  try {
    if (fs.existsSync(WORLD_FILE)) {
      const data = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
      if (!Array.isArray(data.tokens)) data.tokens = [];
      if (!Array.isArray(data.npcs)) data.npcs = [];
      if (!Array.isArray(data.freeDrawings)) data.freeDrawings = [];
      if (!Array.isArray(data.rects)) data.rects = [];
      if (!Array.isArray(data.fogRects)) data.fogRects = [];
      // 兼容旧存档：补全 isBound 字段（默认 true）
      if (Array.isArray(data.placedMaps)) {
        data.placedMaps = data.placedMaps.map(m => ({ ...m, isBound: m.isBound ?? true }));
      }
      return data;
    }
  } catch (err) {
    console.error('读取世界状态失败:', err);
  }
  return { placedMaps: [], tokens: [], npcs: [], freeDrawings: [], rects: [], fogRects: [] };
}

// 保存世界状态
function saveWorld(data) {
  try {
    const dir = path.dirname(WORLD_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WORLD_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('保存世界状态失败:', err);
  }
}

// 延迟保存世界状态（500ms debounce）
let worldSaveTimer = null;
function scheduleWorldSave() {
  clearTimeout(worldSaveTimer);
  worldSaveTimer = setTimeout(() => saveWorld(gameState.world), 500);
}

// 读取 UI 偏好（DM 专属颜色设置）
function loadUiPrefs() {
  try {
    if (fs.existsSync(UI_PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(UI_PREFS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('读取 UI 偏好失败:', err);
  }
  return { penColor: '#cc0000', rectColor: '#cc0000', layouts: {} };
}

// 保存 UI 偏好
function saveUiPrefs(data) {
  try {
    const dir = path.dirname(UI_PREFS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(UI_PREFS_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('保存 UI 偏好失败:', err);
  }
}

// 撤销/重做栈（仅 DM，内存，重启后清空）
let undoStack = [];
let redoStack = [];

// 在 world mutation 前调用：保存快照 + 清空 redoStack
function pushWorldUndo() {
  undoStack.push(JSON.parse(JSON.stringify(gameState.world)));
  if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
  redoStack = [];
}

// 构建当前在线名单（供客户端 @ 私聊建议框和头像使用）
function buildRoster() {
  return Array.from(gameState.players.values()).map(p => ({
    name: p.name,
    role: p.role,
    color: p.color,
    online: p.online !== false
  }));
}

// 按玩家名查找 socketId（同名多连接时全部返回）
function findSocketIdsByName(name) {
  const ids = [];
  gameState.players.forEach((p, socketId) => {
    if (p.name === name) ids.push(socketId);
  });
  return ids;
}

// ===== 角色卡 AI 一句话总结（DeepSeek）=====
// API Key 只存在于服务端环境变量，客户端永远拿不到
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
// deepseek-flash 关掉 thinking：这个任务只是读几个数字写一句话，
// 用 v4-pro 的话输入贵 4 倍、输出贵 3 倍，没有必要
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

const ATTR_CN = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力'
};
const SKILL_CN = {
  athletics: '运动', acrobatics: '体操', sleightOfHand: '巧手', stealth: '隐匿',
  arcana: '奥秘', history: '历史', investigation: '调查', nature: '自然',
  religion: '宗教', animalHandling: '驯兽', insight: '洞悉', medicine: '医药',
  perception: '察觉', survival: '求生', deception: '欺瞒', intimidation: '威吓',
  performance: '表演', persuasion: '游说'
};

// 只把影响结论的字段纳入指纹，改血量不该触发重新生成
function characterFingerprint(c) {
  const src = JSON.stringify({
    name: c.name,
    attributes: c.attributes,
    proficiencyBonus: c.proficiencyBonus,
    savingThrows: [...(c.savingThrows || [])].sort(),
    skills: [...(c.skills || [])].sort(),
    feats: (c.feats || []).map(f => `${f.name}|${f.description}`)
  });
  return crypto.createHash('sha1').update(src).digest('hex').slice(0, 16);
}

function buildSummaryPrompt(c) {
  const bonus = c.proficiencyBonus || 0;
  const attrs = Object.entries(c.attributes || {})
    .map(([k, v]) => `${ATTR_CN[k] || k} ${v >= 0 ? '+' : ''}${v}`).join('，');
  const saves = (c.savingThrows || []).map(a => ATTR_CN[a] || a).join('、') || '无';
  const skills = (c.skills || []).map(k => SKILL_CN[k] || k).join('、') || '无';
  const feats = (c.feats || []).length
    ? (c.feats || []).map(f => `「${f.name}」：${f.description || '（无描述）'}`).join('；')
    : '无';

  return `角色名：${c.name}
六项属性调整值：${attrs}
熟练加值：+${bonus}
擅长的豁免检定：${saves}
熟练的技能：${skills}
专长：${feats}`;
}

const SUMMARY_SYSTEM_PROMPT = `你在为一个跑团游戏的角色卡生成一句话speaking总结。

【世界观】故事发生在 2000 年前后的现代社会。玩家扮演的是**没有超能力、不会魔法的普通人**，他们在现实世界里探索、调查，并与恶魔战斗。所以请用现代人的语境描述能力，不要提到法术、魔力、异能这类东西。

【数值含义】属性是调整值，大致范围 -1 到 +5，越高越强：
- 力量：搬抬、攀爬、近身角力
- 敏捷：闪避、平衡、手上的精细活
- 体质：耐力、扛伤、熬夜和中毒
- 智力：知识、推理、从线索里拼出真相
- 感知：观察力、直觉、察言观色
- 魅力：说服、唬人、临场表现

"熟练的技能"是这个人真正擅长的具体行动，含义按现代语境理解，例如：
运动=攀爬追逐翻越，体操=翻窗跳跃闪身脱身，巧手=开锁与手上小动作，隐匿=潜行不被发现，
调查=搜查现场找线索，察觉=注意到异常，洞悉=看穿谎言，医药=急救处理伤口，
求生=野外生存与追踪，欺瞒=撒谎伪装，威吓=施压恐吓，游说=谈判说服，
历史/自然/宗教/奥秘=对应领域的知识储备，驯兽=与动物打交道，表演=吸引注意力。

【输出要求】只输出一句中文，不要解释、不要换行、不要 Markdown。严格用这个句式：
{角色名}是一个……的人，ta十分擅长……，并且……。
第一段用性格或身手概括这个人；第二段点出他最拿手的两三件具体事情（要落到"能做什么"，比如"从窗户翻进去""在人群里跟着目标不被发现"）；第三段写专长带来的独特本事，如果没有专长就写他凭数值撑起的另一个长处。整句控制在 80 字以内。`;

async function generateCharacterSummary(character) {
  if (!DEEPSEEK_API_KEY) {
    const err = new Error('服务端未配置 DEEPSEEK_API_KEY');
    err.code = 'NO_KEY';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: buildSummaryPrompt(character) }
        ],
        temperature: 0.7,
        max_tokens: 200,
        thinking: { type: 'disabled' }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek 返回 ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek 返回内容为空');
    return text.replace(/\s*\n\s*/g, ' ');
  } finally {
    clearTimeout(timer);
  }
}

// 判断一条聊天历史对指定用户是否可见（私聊仅收发双方可见）
function isChatEntryVisibleTo(entry, name) {
  if (!entry.to) return true;
  return entry.name === name || entry.to === name;
}

// socketId -> 宽限期计时器
const leaveTimers = new Map();

// 浮动窗口布局按用户名持久化（项目没有账号系统，名字就是身份）
let uiPrefsSaveTimer = null;
function scheduleUiPrefsSave() {
  clearTimeout(uiPrefsSaveTimer);
  uiPrefsSaveTimer = setTimeout(() => saveUiPrefs(gameState.uiPrefs), 500);
}

function getLayoutFor(name) {
  return (gameState.uiPrefs.layouts && gameState.uiPrefs.layouts[name]) || {};
}

// 已被占用的颜色（含宽限期内掉线的玩家，避免颜色被顶掉）
function getTakenColors() {
  const taken = [];
  gameState.players.forEach(p => {
    if (p.color) taken.push(p.color);
  });
  return taken;
}

// 宽限期内同名同角色重连：接管旧会话（保留颜色和棋子），返回旧记录
function takeOverPreviousSession(socketId, name, role) {
  for (const [oldId, p] of gameState.players) {
    if (oldId === socketId) continue;
    if (p.online === false && p.name === name && p.role === role) {
      clearTimeout(leaveTimers.get(oldId));
      leaveTimers.delete(oldId);
      gameState.players.delete(oldId);
      return p;
    }
  }
  return null;
}

// 真正把玩家移出房间：宽限期到期，或玩家主动退出
function finalizePlayerLeave(socketId, reason) {
  const player = gameState.players.get(socketId);
  if (!player) return;

  clearTimeout(leaveTimers.get(socketId));
  leaveTimers.delete(socketId);
  console.log(`${player.role} "${player.name}" ${reason}`);

  if (gameState.dm?.socketId === socketId) {
    gameState.dm = null;
    io.emit('dmLeft');
  }

  // 删除该玩家的棋子并广播
  const leftColor = player.color;
  if (leftColor) {
    const tokenIdx = gameState.world.tokens.findIndex(t => t.color === leftColor);
    if (tokenIdx !== -1) {
      gameState.world.tokens.splice(tokenIdx, 1);
      scheduleWorldSave();
      io.emit('token:remove', leftColor);
    }
  }

  gameState.players.delete(socketId);

  io.emit('playerLeft', { name: player.name, role: player.role, color: leftColor });
  io.emit('takenColors', getTakenColors());
  io.emit('roster:sync', buildRoster());
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB - 支持大尺寸地图图片
  pingTimeout: 60000,
  transports: ['websocket'] // 强制 WebSocket，避免 HTTP polling 被浏览器后台节流断线
});

const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // 所有 CSS/JS 都内联在 HTML 里，HTML 一旦被缓存，等于整个前端被冻在旧版本。
    // no-cache 只是要求每次带 ETag 回源校验，内容没变仍走 304，开销很小。
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// 游戏状态存储
const gameState = {
  dm: null,           // 当前 DM 信息
  players: new Map(), // socketId -> { name, color, role }
  notes: loadNotes(), // 共享笔记（从文件加载）
  characterNotes: loadCharacterNotes(), // 登场人物记录 [{name, info}]
  chatHistory: loadChatHistory(), // 聊天 + 骰子历史（最多 100 条，从文件加载）
  mapAssets: loadMapAssets(), // 地图图片资产 { assetId: { base64, originalWidth, originalHeight } }
  world: loadWorld(),         // 世界状态 { placedMaps, tokens, npcs, freeDrawings, rects }
  uiPrefs: loadUiPrefs(),     // UI 偏好 { penColor, rectColor, layouts: { 用户名: { 面板id: {x,y,pinned} } } }
};

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log(`用户连接: ${socket.id}`);

  // 用户加入游戏
  socket.on('join', ({ name, role, password }) => {
    // DM 密码验证
    if (role === 'DM') {
      if (password !== '12138') {
        socket.emit('joinError', '管理员密码错误');
        return;
      }
      // 检查是否已有 DM（宽限期内掉线的 DM 允许自己重连回来）
      const dmSocketId = gameState.dm?.socketId;
      const existingDm = dmSocketId ? gameState.players.get(dmSocketId) : null;
      if (existingDm && dmSocketId !== socket.id && existingDm.name !== name) {
        socket.emit('joinError', '已有 DM 在房间中');
        return;
      }
      gameState.dm = { socketId: socket.id, name };
    }

    // 宽限期内重连则接管旧会话，保留颜色（棋子本就没被删）
    const previous = takeOverPreviousSession(socket.id, name, role);

    // 保存玩家信息
    gameState.players.set(socket.id, {
      name,
      role,
      color: previous ? previous.color : null,
      online: true
    });

    // 获取已被占用的颜色
    const takenColors = [];
    gameState.players.forEach(p => {
      if (p.color) takenColors.push(p.color);
    });

    // 获取玩家列表时附带角色卡 HP
    const playersWithHP = Array.from(gameState.players.values()).map(p => ({
      ...p,
      characterHP: p.color ? getCharacterHP(p.name) : null
    }));

    // 发送加入成功和当前游戏状态
    socket.emit('joinSuccess', {
      role,
      name,
      dmName: gameState.dm?.name || null,
      takenColors,
      uiPrefs: role === 'DM' ? gameState.uiPrefs : undefined,
      layout: getLayoutFor(name),
      gameState: {
        players: playersWithHP,
        notes: gameState.notes,
        characterNotes: gameState.characterNotes,
        chatHistory: gameState.chatHistory.filter(e => isChatEntryVisibleTo(e, name)),
        world: gameState.world
      }
    });

    // 广播给其他人（宽限期内的重连是静默的，不刷系统消息）
    if (!previous) {
      socket.broadcast.emit('playerJoined', {
        name,
        role,
        dmName: gameState.dm?.name || null
      });
    }

    // 广播最新在线名单（供 @ 私聊建议框使用）
    io.emit('roster:sync', buildRoster());

    console.log(`${role} "${name}" 加入游戏`);
  });

  // 玩家选择颜色
  socket.on('selectColor', (color) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // 检查颜色是否被「别人」占用（自己重连补发同一颜色时应放行）
    const takenByOthers = [];
    gameState.players.forEach((p, socketId) => {
      if (p.color && socketId !== socket.id) takenByOthers.push(p.color);
    });
    if (takenByOthers.includes(color)) {
      socket.emit('colorError', '该颜色已被其他玩家选择');
      return;
    }

    player.color = color;
    // 广播时附带角色卡 HP
    const characterHP = getCharacterHP(player.name);
    io.emit('colorSelected', { socketId: socket.id, name: player.name, color, characterHP });
    // 广播更新已占用颜色
    io.emit('takenColors', getTakenColors());
    // 头像颜色随之变化，同步名单
    io.emit('roster:sync', buildRoster());
  });

  // 棋子生成 (DM 可生成所有，玩家只能生成自己的)
  socket.on('token:spawn', ({ color, gridX, gridY }) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    if (player.role === 'Player' && player.color !== color) return;

    pushWorldUndo();
    // 同颜色只保留一个棋子
    const idx = gameState.world.tokens.findIndex(t => t.color === color);
    if (idx !== -1) gameState.world.tokens.splice(idx, 1);
    gameState.world.tokens.push({ id: color, color, gridX, gridY });
    io.emit('token:spawn', { color, gridX, gridY });
    scheduleWorldSave();
  });

  // 棋子移动 (DM 可移动所有，玩家只能移动自己的)
  socket.on('token:move', ({ color, gridX, gridY }) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    if (player.role === 'Player' && player.color !== color) return;

    pushWorldUndo();
    const token = gameState.world.tokens.find(t => t.color === color);
    if (token) { token.gridX = gridX; token.gridY = gridY; }
    io.emit('token:move', { color, gridX, gridY });
    scheduleWorldSave();
  });

  // 清除所有棋子 (仅 DM)
  socket.on('token:clearAll', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    pushWorldUndo();
    gameState.world.tokens = [];
    io.emit('token:clearAll');
    scheduleWorldSave();
  });

  // NPC 生成 (仅 DM)
  socket.on('npc:spawn', ({ id, gridX, gridY, color }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    pushWorldUndo();
    const npcColor = color || '#7f8c8d';
    gameState.world.npcs.push({ id, gridX, gridY, color: npcColor });
    io.emit('npc:spawn', { id, gridX, gridY, color: npcColor });
    scheduleWorldSave();
  });

  // NPC 移动 (仅 DM)
  socket.on('npc:move', ({ id, gridX, gridY }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    pushWorldUndo();
    const npc = gameState.world.npcs.find(n => n.id === id);
    if (npc) { npc.gridX = gridX; npc.gridY = gridY; }
    io.emit('npc:move', { id, gridX, gridY });
    scheduleWorldSave();
  });

  // NPC 删除 (仅 DM)
  socket.on('npc:remove', (id) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    pushWorldUndo();
    const idx = gameState.world.npcs.findIndex(n => n.id === id);
    if (idx !== -1) gameState.world.npcs.splice(idx, 1);
    io.emit('npc:remove', id);
    scheduleWorldSave();
  });

  // 清除所有 NPC (仅 DM)
  socket.on('npc:clearAll', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    pushWorldUndo();
    gameState.world.npcs = [];
    io.emit('npc:clearAll');
    scheduleWorldSave();
  });

  // 骰子投掷 (所有人)
  socket.on('dice:roll', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const historyEntry = {
      type: 'dice',
      name: player.name,
      role: player.role,
      sides: data.sides,
      result: data.result,
      timestamp: Date.now()
    };
    // regex 掷骰额外字段透传（点击骰子按钮时无此字段）
    if (data.expr) {
      historyEntry.expr = data.expr;
      historyEntry.rolls = data.rolls;
      historyEntry.modifier = data.modifier || 0;
      historyEntry.count = data.count || 1;
    }
    appendChatHistory(historyEntry);

    const broadcast = { playerName: player.name, role: player.role, sides: data.sides, result: data.result };
    if (data.expr) {
      broadcast.expr = data.expr;
      broadcast.rolls = data.rolls;
      broadcast.modifier = data.modifier || 0;
      broadcast.count = data.count || 1;
    }
    io.emit('dice:result', broadcast);
  });

  // 聊天消息 (所有人)。payload 为 { message, to }，to 为 null 时是公开消息，
  // 否则是发给该玩家名的私聊（仅发送者与接收者可见）
  socket.on('chat:message', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // 兼容旧客户端的纯字符串格式（视为公开消息）
    const message = typeof data === 'string' ? data : data?.message;
    const to = typeof data === 'string' ? null : (data?.to || null);
    if (typeof message !== 'string' || !message.trim()) return;

    const payload = {
      name: player.name,
      role: player.role,
      message,
      timestamp: Date.now()
    };

    // 公开消息：原样广播
    if (!to) {
      appendChatHistory({ type: 'chat', ...payload });
      io.emit('chat:message', payload);
      return;
    }

    // 私聊：不能私聊自己，且目标必须在线
    if (to === player.name) {
      socket.emit('chat:error', '不能私聊自己');
      return;
    }
    const targetIds = findSocketIdsByName(to);
    if (targetIds.length === 0) {
      socket.emit('chat:error', `私聊失败：${to} 不在线`);
      return;
    }

    const target = gameState.players.get(targetIds[0]);
    const privatePayload = { ...payload, to, toRole: target.role };
    appendChatHistory({ type: 'chat', ...privatePayload });

    // 仅发送者与接收者可见
    socket.emit('chat:message', privatePayload);
    let delivered = false;
    targetIds.forEach(socketId => {
      if (socketId === socket.id) return;
      const t = gameState.players.get(socketId);
      if (t && t.online !== false) {
        io.to(socketId).emit('chat:message', privatePayload);
        delivered = true;
      }
    });
    // 对方在宽限期内掉线：消息已落盘，重连时经历史回放送达
    if (!delivered) {
      socket.emit('chat:notice', `${to} 当前掉线，消息会在其重新连接后送达`);
    }
  });

  // 笔记更新 (所有人可编辑)
  socket.on('notes:update', (content) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    gameState.notes = content;
    saveNotes(content);
    socket.broadcast.emit('notes:sync', content);
  });

  // 人物记录更新 (所有人可编辑)
  socket.on('characterNotes:update', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    gameState.characterNotes = data;
    saveCharacterNotes(data);
    socket.broadcast.emit('characterNotes:sync', data);
  });

  // 角色卡列表 (所有人)
  socket.on('character:list', () => {
    const names = getCharacterNames();
    socket.emit('character:listResult', { names });
  });

  // 加载角色卡 (所有人)
  socket.on('character:load', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const character = getCharacter(data.name);
    if (character) {
      socket.emit('character:loaded', character);
    } else {
      // 使用 notFound 事件，区分于其他错误
      socket.emit('character:notFound', { name: data.name });
    }
  });

  // 保存角色卡 (所有人)
  // 只改血量，不动角色卡其它字段
  // （血条 UI 在角色卡没载入 DOM 时也能用，走整卡保存会把其它字段冲掉）
  socket.on('character:setHp', ({ name, cur, max }) => {
    const player = gameState.players.get(socket.id);
    if (!player || typeof name !== 'string') return;
    // 玩家只能改自己的角色卡，DM 可以改任何人的
    if (player.role !== 'DM' && name !== player.name) return;

    const characters = loadCharacters();
    const character = characters[name];
    if (!character) { socket.emit('character:error', { message: `没有找到角色卡：${name}` }); return; }

    if (!character.hp) character.hp = { cur: 0, max: 0 };
    if (Number.isFinite(max)) character.hp.max = Math.max(0, Math.round(max));
    if (Number.isFinite(cur)) character.hp.cur = Math.round(cur);
    // 当前血量夹在 0 与上限之间
    character.hp.cur = Math.max(0, Math.min(character.hp.cur, character.hp.max));

    const result = saveCharacter(character);
    if (!result.success) {
      socket.emit('character:error', { message: '保存失败: ' + result.error });
      return;
    }
    io.emit('character:hpUpdated', { name, hp: character.hp });
  });

  // 角色卡 AI 总结：命中指纹就直接返回缓存，不调 API
  socket.on('character:summarize', async ({ name, force }) => {
    const player = gameState.players.get(socket.id);
    if (!player || typeof name !== 'string') return;

    const characters = loadCharacters();
    const character = characters[name];
    if (!character) {
      socket.emit('character:summary', { name, error: `没有找到角色卡：${name}` });
      return;
    }

    const fingerprint = characterFingerprint(character);
    const cached = character.aiSummary;
    if (!force && cached && cached.fingerprint === fingerprint && cached.text) {
      socket.emit('character:summary', { name, summary: cached.text, cached: true });
      return;
    }

    socket.emit('character:summaryPending', { name });
    try {
      const text = await generateCharacterSummary(character);
      character.aiSummary = { text, fingerprint, at: Date.now() };
      saveCharacter(character);
      console.log(`为角色卡「${name}」生成了 AI 总结`);
      socket.emit('character:summary', { name, summary: text, cached: false });
    } catch (err) {
      console.error('生成角色卡总结失败:', err.message);
      socket.emit('character:summary', {
        name,
        error: err.code === 'NO_KEY' ? '服务端未配置 DEEPSEEK_API_KEY' : 'AI 总结生成失败，请稍后重试'
      });
    }
  });

  socket.on('character:save', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    if (!data.name || !data.name.trim()) {
      socket.emit('character:error', { message: '角色名不能为空' });
      return;
    }

    const result = saveCharacter(data);
    if (result.success) {
      socket.emit('character:saved', { name: data.name, isNew: result.isNew });
      console.log(`${player.name} 保存了角色卡: ${data.name}`);
      // 广播 HP 更新给所有客户端（用于更新侧边栏 HP 显示）
      io.emit('character:hpUpdated', { name: data.name, hp: data.hp });
    } else {
      socket.emit('character:error', { message: '保存失败: ' + result.error });
    }
  });

  // 上传地图资产 (仅 DM)
  socket.on('mapAsset:upload', ({ assetId, base64, originalWidth, originalHeight }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    gameState.mapAssets[assetId] = { base64, originalWidth, originalHeight };
    saveMapAssets(gameState.mapAssets);
    socket.emit('mapAsset:uploaded', { assetId });
  });

  // 按需获取地图资产 (所有人)
  socket.on('mapAsset:fetch', (assetId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    const asset = gameState.mapAssets[assetId];
    if (!asset) { socket.emit('mapAsset:notFound', { assetId }); return; }
    socket.emit('mapAsset:fetched', { assetId, ...asset });
  });

  // 删除地图资产（仅 DM）：移除资产 + 删除所有对应放置实例，不纳入 undo 栈
  socket.on('mapAsset:remove', (assetId) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (!gameState.mapAssets[assetId]) return;
    delete gameState.mapAssets[assetId];
    gameState.world.placedMaps = gameState.world.placedMaps.filter(m => m.assetId !== assetId);
    saveMapAssets(gameState.mapAssets);
    scheduleWorldSave();
    io.emit('mapAsset:removed', { assetId });
  });

  // 放置地图 (仅 DM)
  socket.on('placedMap:add', ({ id, assetId, gridX, gridY, gridWidth, isLocked, isBound }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (!gameState.mapAssets[assetId]) return;
    pushWorldUndo();
    const mapEntry = { id, assetId, gridX, gridY, gridWidth, isLocked: !!isLocked, isBound: isBound !== false };
    gameState.world.placedMaps.push(mapEntry);
    io.emit('placedMap:added', mapEntry);
    scheduleWorldSave();
  });

  // 移动地图 (仅 DM)，可选附带联动迷雾和四类对象坐标
  socket.on('placedMap:move', ({ id, gridX, gridY, movedFogRects, movedTokens, movedNpcs, movedFreeDrawings, movedRects }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const map = gameState.world.placedMaps.find(m => m.id === id);
    if (!map) return;
    pushWorldUndo();
    map.gridX = gridX;
    map.gridY = gridY;
    if (Array.isArray(movedFogRects)) {
      movedFogRects.forEach(({ id: fid, x, y }) => {
        const fog = gameState.world.fogRects.find(f => f.id === fid);
        if (fog) { fog.x = x; fog.y = y; }
      });
    }
    if (Array.isArray(movedTokens)) {
      movedTokens.forEach(({ id: tid, gridX: gx, gridY: gy }) => {
        const t = gameState.world.tokens.find(t => t.id === tid);
        if (t) { t.gridX = gx; t.gridY = gy; }
      });
    }
    if (Array.isArray(movedNpcs)) {
      movedNpcs.forEach(({ id: nid, gridX: gx, gridY: gy }) => {
        const n = gameState.world.npcs.find(n => n.id === nid);
        if (n) { n.gridX = gx; n.gridY = gy; }
      });
    }
    if (Array.isArray(movedFreeDrawings)) {
      movedFreeDrawings.forEach(({ id: did, points }) => {
        const d = gameState.world.freeDrawings.find(d => d.id === did);
        if (d && Array.isArray(points)) d.points = points;
      });
    }
    if (Array.isArray(movedRects)) {
      movedRects.forEach(({ id: rid, gridX: gx, gridY: gy }) => {
        const r = gameState.world.rects.find(r => r.id === rid);
        if (r) { r.gridX = gx; r.gridY = gy; }
      });
    }
    io.emit('placedMap:moved', {
      id, gridX, gridY,
      movedFogRects: movedFogRects || [],
      movedTokens: movedTokens || [],
      movedNpcs: movedNpcs || [],
      movedFreeDrawings: movedFreeDrawings || [],
      movedRects: movedRects || [],
    });
    scheduleWorldSave();
  });

  // 缩放地图 (仅 DM)，可选附带联动迷雾和四类对象新坐标/尺寸
  socket.on('placedMap:resize', ({ id, gridWidth, scaledFogRects, scaledTokens, scaledNpcs, scaledFreeDrawings, scaledRects }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const map = gameState.world.placedMaps.find(m => m.id === id);
    if (!map) return;
    pushWorldUndo();
    map.gridWidth = gridWidth;
    if (Array.isArray(scaledFogRects)) {
      scaledFogRects.forEach(({ id: fid, x, y, w, h }) => {
        const fog = gameState.world.fogRects.find(f => f.id === fid);
        if (fog) { fog.x = x; fog.y = y; fog.w = w; fog.h = h; }
      });
    }
    if (Array.isArray(scaledTokens)) {
      scaledTokens.forEach(({ id: tid, gridX: gx, gridY: gy }) => {
        const t = gameState.world.tokens.find(t => t.id === tid);
        if (t) { t.gridX = gx; t.gridY = gy; }
      });
    }
    if (Array.isArray(scaledNpcs)) {
      scaledNpcs.forEach(({ id: nid, gridX: gx, gridY: gy }) => {
        const n = gameState.world.npcs.find(n => n.id === nid);
        if (n) { n.gridX = gx; n.gridY = gy; }
      });
    }
    if (Array.isArray(scaledFreeDrawings)) {
      scaledFreeDrawings.forEach(({ id: did, points }) => {
        const d = gameState.world.freeDrawings.find(d => d.id === did);
        if (d && Array.isArray(points)) d.points = points;
      });
    }
    if (Array.isArray(scaledRects)) {
      scaledRects.forEach(({ id: rid, gridX: gx, gridY: gy, gridW, gridH }) => {
        const r = gameState.world.rects.find(r => r.id === rid);
        if (r) { r.gridX = gx; r.gridY = gy; r.gridW = gridW; r.gridH = gridH; }
      });
    }
    io.emit('placedMap:resized', {
      id, gridWidth,
      scaledFogRects: scaledFogRects || [],
      scaledTokens: scaledTokens || [],
      scaledNpcs: scaledNpcs || [],
      scaledFreeDrawings: scaledFreeDrawings || [],
      scaledRects: scaledRects || [],
    });
    scheduleWorldSave();
  });

  // 切换地图内对象绑定联动 (仅 DM)，不纳入 undo 栈
  socket.on('placedMap:setBound', ({ id, isBound }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const map = gameState.world.placedMaps.find(m => m.id === id);
    if (!map) return;
    map.isBound = !!isBound;
    io.emit('placedMap:boundSet', { id, isBound: !!isBound });
    scheduleWorldSave();
  });

  // 锁定/解锁地图 (仅 DM)
  socket.on('placedMap:setLock', ({ id, isLocked }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const map = gameState.world.placedMaps.find(m => m.id === id);
    if (!map) return;
    pushWorldUndo();
    map.isLocked = isLocked;
    io.emit('placedMap:lockSet', { id, isLocked });
    scheduleWorldSave();
  });

  // 删除地图 (仅 DM)
  socket.on('placedMap:remove', (id) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const idx = gameState.world.placedMaps.findIndex(m => m.id === id);
    if (idx === -1) return;
    pushWorldUndo();
    gameState.world.placedMaps.splice(idx, 1);
    io.emit('placedMap:removed', id);
    scheduleWorldSave();
  });

  // 实时笔画广播（不存档，仅转发给其他人用于实时预览）
  socket.on('draw:liveStroke', ({ id, points, color, strokeWidth }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    socket.broadcast.emit('draw:liveStroke', { id, points, color, strokeWidth });
  });

  // 添加自由笔画 (仅 DM，乐观渲染：只广播给其他人)
  socket.on('draw:freeStroke', ({ id, points, color, strokeWidth }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    pushWorldUndo();
    gameState.world.freeDrawings.push({ id, points, color, strokeWidth });
    socket.broadcast.emit('draw:freeStroke', { id, points, color, strokeWidth });
    scheduleWorldSave();
  });

  // 添加矩形 (仅 DM，乐观渲染：只广播给其他人)
  socket.on('draw:rect', ({ id, gridX, gridY, gridW, gridH, color, strokeWidth }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    pushWorldUndo();
    gameState.world.rects.push({ id, gridX, gridY, gridW, gridH, color, strokeWidth });
    socket.broadcast.emit('draw:rect', { id, gridX, gridY, gridW, gridH, color, strokeWidth });
    scheduleWorldSave();
  });

  // 删除单个绘图对象 (仅 DM)
  socket.on('draw:remove', (id) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    pushWorldUndo();
    const di = gameState.world.freeDrawings.findIndex(d => d.id === id);
    if (di !== -1) gameState.world.freeDrawings.splice(di, 1);
    const ri = gameState.world.rects.findIndex(r => r.id === id);
    if (ri !== -1) gameState.world.rects.splice(ri, 1);
    io.emit('draw:remove', id);
    scheduleWorldSave();
  });

  // 清空世界所有笔画和矩形 (仅 DM)
  socket.on('draw:clearAll', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    pushWorldUndo();
    gameState.world.freeDrawings = [];
    gameState.world.rects = [];
    io.emit('draw:clearAll');
    scheduleWorldSave();
  });

  // 添加迷雾遮罩 (仅 DM)
  socket.on('fog:add', ({ x, y, w, h }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (!(w > 0 && h > 0)) return;
    pushWorldUndo();
    const id = `fog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fogRect = { id, x, y, w, h };
    gameState.world.fogRects.push(fogRect);
    io.emit('fog:added', fogRect);
    scheduleWorldSave();
  });

  // 删除迷雾遮罩 (仅 DM)
  socket.on('fog:remove', (id) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    const idx = gameState.world.fogRects.findIndex(f => f.id === id);
    if (idx === -1) return;
    pushWorldUndo();
    gameState.world.fogRects.splice(idx, 1);
    io.emit('fog:removed', { id });
    scheduleWorldSave();
  });

  // 撤销世界操作 (仅 DM)
  socket.on('history:undo', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (undoStack.length === 0) return;
    redoStack.push(JSON.parse(JSON.stringify(gameState.world)));
    if (redoStack.length > MAX_UNDO_STACK) redoStack.shift();
    gameState.world = undoStack.pop();
    scheduleWorldSave();
    io.emit('world:sync', gameState.world);
  });

  // 重做世界操作 (仅 DM)
  socket.on('history:redo', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (redoStack.length === 0) return;
    undoStack.push(JSON.parse(JSON.stringify(gameState.world)));
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    gameState.world = redoStack.pop();
    scheduleWorldSave();
    io.emit('world:sync', gameState.world);
  });

  // 保存 DM UI 偏好（画笔/矩形颜色，仅 DM）
  // 浮动窗口位置 / 固定状态（所有人都可存，按自己的名字分桶）
  socket.on('layout:save', ({ panelId, x, y, pinned }) => {
    const player = gameState.players.get(socket.id);
    if (!player || typeof panelId !== 'string') return;

    if (!gameState.uiPrefs.layouts) gameState.uiPrefs.layouts = {};
    const bucket = gameState.uiPrefs.layouts[player.name] || (gameState.uiPrefs.layouts[player.name] = {});
    const entry = bucket[panelId] || (bucket[panelId] = {});

    if (Number.isFinite(x)) entry.x = Math.round(x);
    if (Number.isFinite(y)) entry.y = Math.round(y);
    if (typeof pinned === 'boolean') entry.pinned = pinned;

    scheduleUiPrefsSave();
  });

  socket.on('uiPrefs:save', (prefs) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (typeof prefs.penColor === 'string') gameState.uiPrefs.penColor = prefs.penColor;
    if (typeof prefs.rectColor === 'string') gameState.uiPrefs.rectColor = prefs.rectColor;
    scheduleUiPrefsSave();
  });

  // 主动退出：不走宽限期，立刻清理（与「被浏览器挂起」是两回事）
  socket.on('player:leave', () => {
    finalizePlayerLeave(socket.id, '主动退出游戏');
  });

  // 断开连接：先进入宽限期，不立刻判定离开
  // （Safari 等浏览器会挂起后台标签页的 JS，心跳中断并不代表人走了）
  socket.on('disconnect', (reason) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    console.log(`${player.role} "${player.name}" 连接断开 (${reason})，` +
                `进入 ${DISCONNECT_GRACE_MS / 1000}s 宽限期`);

    player.online = false;
    player.disconnectedAt = Date.now();

    // 名单标灰，但仍可被 @ ；棋子和颜色都保留
    io.emit('roster:sync', buildRoster());

    leaveTimers.set(socket.id, setTimeout(() => {
      finalizePlayerLeave(socket.id, '宽限期结束，离开游戏');
    }, DISCONNECT_GRACE_MS));
  });
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
