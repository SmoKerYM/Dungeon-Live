const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

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
  npcs: []            // NPC 数据 { id, x, y }
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
        npcs: gameState.npcs
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
