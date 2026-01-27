const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// 笔记文件路径（Render Disk 挂载点）
const NOTES_FILE = process.env.NODE_ENV === 'production' ? '/data/notes.txt' : './data/notes.txt';
// 角色卡文件路径
const CHARACTERS_FILE = process.env.NODE_ENV === 'production' ? '/data/characters.json' : './data/characters.json';

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

// 地图哈希函数（用于判断是否为同一张地图）
function getMapHash(mapData) {
  return mapData.substring(0, 1000) + '_' + mapData.length;
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB - 支持大尺寸地图图片
  pingTimeout: 60000
});

const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 游戏状态存储
const gameState = {
  dm: null,           // 当前 DM 信息
  players: new Map(), // socketId -> { name, color, role }
  mapData: null,      // Base64 地图数据
  mapTransform: { scale: 1, originX: 0, originY: 0 },
  isLocked: false,
  tokens: {},         // color -> { x, y }
  hp: {               // 各颜色血量
    orange: { cur: 10, max: 10 },
    yellow: { cur: 10, max: 10 },
    green: { cur: 10, max: 10 },
    blue: { cur: 10, max: 10 },
    purple: { cur: 10, max: 10 },
    black: { cur: 10, max: 10 }
  },
  drawings: [],       // 绘图数据
  npcs: [],           // NPC 数据 { id, x, y }
  notes: loadNotes(), // 共享笔记（从文件加载）
  savedMaps: []       // 地图存档（最多4张）
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

    // 发送加入成功和当前游戏状态
    socket.emit('joinSuccess', {
      role,
      name,
      dmName: gameState.dm?.name || null,
      takenColors,
      gameState: {
        mapData: gameState.mapData,
        mapTransform: gameState.mapTransform,
        isLocked: gameState.isLocked,
        tokens: gameState.tokens,
        hp: gameState.hp,
        players: Array.from(gameState.players.values()),
        drawings: gameState.drawings,
        npcs: gameState.npcs,
        notes: gameState.notes,
        savedMaps: gameState.savedMaps.map(m => ({ id: m.id, thumbnail: m.thumbnail }))
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
    io.emit('colorSelected', { socketId: socket.id, name: player.name, color });
    // 广播更新已占用颜色
    io.emit('takenColors', getTakenColors());
  });

  // 地图上传 (仅 DM)
  socket.on('map:load', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.mapData = data;
    socket.broadcast.emit('map:load', data);
  });

  // 地图变换 (仅 DM)
  socket.on('map:transform', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.mapTransform = data;
    socket.broadcast.emit('map:transform', data);
  });

  // 地图锁定 (仅 DM)
  socket.on('map:lock', (isLocked) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.isLocked = isLocked;
    socket.broadcast.emit('map:lock', isLocked);
  });

  // 棋子生成 (DM 可生成所有，玩家只能生成自己的)
  socket.on('token:spawn', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // 玩家只能生成自己颜色的棋子
    if (player.role === 'Player' && player.color !== data.color) return;

    gameState.tokens[data.color] = { x: data.x, y: data.y };
    socket.broadcast.emit('token:spawn', data);
  });

  // 棋子移动 (DM 可移动所有，玩家只能移动自己的)
  socket.on('token:move', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // 玩家只能移动自己颜色的棋子
    if (player.role === 'Player' && player.color !== data.color) return;

    gameState.tokens[data.color] = { x: data.x, y: data.y };
    socket.broadcast.emit('token:move', data);
  });

  // 清除所有棋子 (仅 DM)
  socket.on('token:clearAll', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.tokens = {};
    socket.broadcast.emit('token:clearAll');
  });

  // 血量变化 (仅 DM)
  socket.on('hp:update', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.hp[data.color] = { cur: data.cur, max: data.max };
    socket.broadcast.emit('hp:update', data);
  });

  // 绘图 (仅 DM)
  socket.on('draw:path', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.drawings.push(data);
    socket.broadcast.emit('draw:path', data);
  });

  // 清空画布 (仅 DM)
  socket.on('draw:clear', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.drawings = [];
    socket.broadcast.emit('draw:clear');
  });

  // NPC 生成 (仅 DM)
  socket.on('npc:spawn', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.npcs.push({ id: data.id, x: data.x, y: data.y, color: data.color || 'gray' });
    socket.broadcast.emit('npc:spawn', data);
  });

  // NPC 移动 (仅 DM)
  socket.on('npc:move', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    const npc = gameState.npcs.find(n => n.id === data.id);
    if (npc) {
      npc.x = data.x;
      npc.y = data.y;
    }
    socket.broadcast.emit('npc:move', data);
  });

  // NPC 删除 (仅 DM)
  socket.on('npc:remove', (id) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.npcs = gameState.npcs.filter(n => n.id !== id);
    socket.broadcast.emit('npc:remove', id);
  });

  // 清除所有 NPC (仅 DM)
  socket.on('npc:clearAll', () => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    gameState.npcs = [];
    socket.broadcast.emit('npc:clearAll');
  });

  // 骰子投掷 (所有人)
  socket.on('dice:roll', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const result = {
      playerName: player.name,
      role: player.role,
      sides: data.sides,
      result: data.result
    };
    io.emit('dice:result', result);
  });

  // 聊天消息 (所有人)
  socket.on('chat:message', (message) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    io.emit('chat:message', {
      name: player.name,
      role: player.role,
      message,
      timestamp: Date.now()
    });
  });

  // 笔记更新 (所有人可编辑)
  socket.on('notes:update', (content) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    gameState.notes = content;
    saveNotes(content);
    socket.broadcast.emit('notes:sync', content);
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
    } else {
      socket.emit('character:error', { message: '保存失败: ' + result.error });
    }
  });

  // 保存地图 (仅 DM)
  socket.on('map:save', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    const mapHash = getMapHash(data.mapData);

    // 查找是否已存在相同地图
    const existingIndex = gameState.savedMaps.findIndex(m => m.mapHash === mapHash);

    if (existingIndex !== -1) {
      // 更新现有存档
      const archive = gameState.savedMaps[existingIndex];
      archive.thumbnail = data.thumbnail;
      archive.mapTransform = data.mapTransform;
      archive.tokens = data.tokens;
      archive.npcs = data.npcs;
      archive.drawings = data.drawings;

      io.emit('map:saved', {
        slotIndex: existingIndex,
        thumbnail: data.thumbnail,
        id: archive.id,
        isUpdate: true
      });
    } else {
      // 创建新存档（无数量上限）
      const mapArchive = {
        id: 'map_' + Date.now(),
        mapHash,
        thumbnail: data.thumbnail,
        mapData: data.mapData,
        mapTransform: data.mapTransform,
        tokens: data.tokens,
        npcs: data.npcs,
        drawings: data.drawings
      };

      gameState.savedMaps.push(mapArchive);
      io.emit('map:saved', {
        slotIndex: gameState.savedMaps.length - 1,
        thumbnail: data.thumbnail,
        id: mapArchive.id,
        isUpdate: false
      });
    }
  });

  // 加载已保存的地图 (仅 DM)
  socket.on('map:loadSaved', (mapId) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    const archive = gameState.savedMaps.find(m => m.id === mapId);
    if (!archive) return;

    // 更新当前游戏状态
    gameState.mapData = archive.mapData;
    gameState.mapTransform = { ...archive.mapTransform };
    gameState.tokens = { ...archive.tokens };
    gameState.npcs = [...archive.npcs];
    gameState.drawings = [...archive.drawings];

    // 广播给所有人
    io.emit('map:loadedSaved', archive);
  });

  // 删除地图存档 (仅 DM)
  socket.on('map:deleteSaved', (mapId) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    const index = gameState.savedMaps.findIndex(m => m.id === mapId);
    if (index === -1) return;

    gameState.savedMaps.splice(index, 1);
    io.emit('map:deletedSaved', mapId);
  });

  // 更新地图状态 (仅 DM，轻量级，不含 mapData)
  socket.on('map:updateState', (data) => {
    const player = gameState.players.get(socket.id);
    if (player?.role !== 'DM') return;

    const archive = gameState.savedMaps.find(m => m.id === data.mapId);
    if (!archive) return;

    // 仅更新状态字段，不更新 mapData
    archive.mapTransform = data.mapTransform;
    archive.tokens = data.tokens;
    archive.npcs = data.npcs;
    archive.drawings = data.drawings;

    // 同时更新当前游戏状态
    gameState.mapTransform = { ...data.mapTransform };
    gameState.tokens = { ...data.tokens };
    gameState.npcs = [...data.npcs];
    gameState.drawings = [...data.drawings];

    // 仅在非静默模式下广播系统消息
    if (!data.silent) {
      io.emit('map:stateUpdated', { mapId: data.mapId });
    }
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
      if (leftColor && gameState.tokens[leftColor]) {
        delete gameState.tokens[leftColor];
        io.emit('token:remove', leftColor);
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
