const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

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
  return { penColor: '#cc0000', rectColor: '#cc0000' };
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

const app = express();
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB - 支持大尺寸地图图片
  pingTimeout: 60000,
  transports: ['websocket'] // 强制 WebSocket，避免 HTTP polling 被浏览器后台节流断线
});

const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 游戏状态存储
const gameState = {
  dm: null,           // 当前 DM 信息
  players: new Map(), // socketId -> { name, color, role }
  notes: loadNotes(), // 共享笔记（从文件加载）
  characterNotes: loadCharacterNotes(), // 登场人物记录 [{name, info}]
  chatHistory: loadChatHistory(), // 聊天 + 骰子历史（最多 100 条，从文件加载）
  mapAssets: loadMapAssets(), // 地图图片资产 { assetId: { base64, originalWidth, originalHeight } }
  world: loadWorld(),         // 世界状态 { placedMaps, tokens, npcs, freeDrawings, rects }
  uiPrefs: loadUiPrefs(),     // DM UI 偏好 { penColor, rectColor }
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
      // 检查是否已有 DM
      if (gameState.dm && gameState.dm.socketId !== socket.id) {
        socket.emit('joinError', '已有 DM 在房间中');
        return;
      }
      gameState.dm = { socketId: socket.id, name };
    }

    // 保存玩家信息
    gameState.players.set(socket.id, { name, role, color: null });

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
      gameState: {
        players: playersWithHP,
        notes: gameState.notes,
        characterNotes: gameState.characterNotes,
        chatHistory: gameState.chatHistory,
        world: gameState.world
      }
    });

    // 广播给其他人
    socket.broadcast.emit('playerJoined', {
      name,
      role,
      dmName: gameState.dm?.name || null
    });

    console.log(`${role} "${name}" 加入游戏`);
  });

  // 获取已被占用的颜色列表
  function getTakenColors() {
    const taken = [];
    gameState.players.forEach(p => {
      if (p.color) taken.push(p.color);
    });
    return taken;
  }

  // 玩家选择颜色
  socket.on('selectColor', (color) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // 检查颜色是否已被占用
    const takenColors = getTakenColors();
    if (takenColors.includes(color)) {
      socket.emit('colorError', '该颜色已被其他玩家选择');
      return;
    }

    player.color = color;
    // 广播时附带角色卡 HP
    const characterHP = getCharacterHP(player.name);
    io.emit('colorSelected', { socketId: socket.id, name: player.name, color, characterHP });
    // 广播更新已占用颜色
    io.emit('takenColors', getTakenColors());
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

  // 聊天消息 (所有人)
  socket.on('chat:message', (message) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const payload = {
      name: player.name,
      role: player.role,
      message,
      timestamp: Date.now()
    };
    appendChatHistory({ type: 'chat', ...payload });
    io.emit('chat:message', payload);
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
  socket.on('placedMap:add', ({ id, assetId, gridX, gridY, gridWidth, isLocked }) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (!gameState.mapAssets[assetId]) return;
    pushWorldUndo();
    gameState.world.placedMaps.push({ id, assetId, gridX, gridY, gridWidth, isLocked: !!isLocked });
    io.emit('placedMap:added', { id, assetId, gridX, gridY, gridWidth, isLocked: !!isLocked });
    scheduleWorldSave();
  });

  // 移动地图 (仅 DM)，可选附带联动迷雾坐标
  socket.on('placedMap:move', ({ id, gridX, gridY, movedFogRects }) => {
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
    io.emit('placedMap:moved', { id, gridX, gridY, movedFogRects: movedFogRects || [] });
    scheduleWorldSave();
  });

  // 缩放地图 (仅 DM)，可选附带联动迷雾新坐标/尺寸
  socket.on('placedMap:resize', ({ id, gridWidth, scaledFogRects }) => {
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
    io.emit('placedMap:resized', { id, gridWidth, scaledFogRects: scaledFogRects || [] });
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
  socket.on('uiPrefs:save', (prefs) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;
    if (typeof prefs.penColor === 'string') gameState.uiPrefs.penColor = prefs.penColor;
    if (typeof prefs.rectColor === 'string') gameState.uiPrefs.rectColor = prefs.rectColor;
    saveUiPrefs(gameState.uiPrefs);
  });

  // 断开连接
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      console.log(`${player.role} "${player.name}" 离开游戏`);

      // 如果是 DM 离开，清空 DM
      if (gameState.dm?.socketId === socket.id) {
        gameState.dm = null;
        io.emit('dmLeft');
      }

      const leftColor = player.color;

      // 删除该玩家的棋子并广播
      if (leftColor) {
        const tokenIdx = gameState.world.tokens.findIndex(t => t.color === leftColor);
        if (tokenIdx !== -1) {
          gameState.world.tokens.splice(tokenIdx, 1);
          scheduleWorldSave();
          io.emit('token:remove', leftColor);
        }
      }

      gameState.players.delete(socket.id);

      // 广播玩家离开（包含颜色信息）
      io.emit('playerLeft', { name: player.name, role: player.role, color: leftColor });

      // 广播更新已占用颜色（释放该颜色）
      const takenColors = [];
      gameState.players.forEach(p => {
        if (p.color) takenColors.push(p.color);
      });
      io.emit('takenColors', takenColors);
    }
  });
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
