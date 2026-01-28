# DND 多人协作跑团工具 - 实施计划

## 项目概述
将现有的单页面 DND 地图工具改造为支持多人实时协作的 Web 应用。

---

## 第一阶段：项目初始化与服务器搭建

### 1.1 初始化 Node.js 项目
```bash
npm init -y
npm install express socket.io
npm install -D nodemon
```

### 1.2 项目结构
```
coc_app/
├── server.js           # 主服务器文件
├── package.json
├── public/             # 静态文件目录
│   ├── index.html      # 登录/注册页面
│   ├── game.html       # 主游戏界面（改造自 coc_app.html）
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js     # 登录逻辑
│       └── game.js     # 游戏客户端逻辑
└── PLAN.md
```

### 1.3 基础 Express + Socket.IO 服务器
- Express 提供静态文件服务
- Socket.IO 实现实时双向通信
- 内存存储房间状态（后期可扩展为 Redis）

---

## 第二阶段：用户认证系统

### 2.1 注册页面 (`public/index.html`)
- 输入框：角色名
- 选择框：身份（DM / Player）
- DM 密码验证：输入 `12138` 才能继续
- 验证通过后跳转到游戏页面

### 2.2 服务端验证
```javascript
// 伪代码
socket.on('join', ({ name, role, password }) => {
  if (role === 'DM' && password !== '12138') {
    return socket.emit('error', '管理员密码错误');
  }
  // 加入房间逻辑
});
```

---

## 第三阶段：权限系统实现

### 3.1 DM 权限（完整权限）
- ✅ 上传地图
- ✅ 锁定/解锁地图
- ✅ 缩放/拖动地图
- ✅ 画笔/橡皮擦
- ✅ 修改所有玩家血量
- ✅ 拖动所有棋子
- ✅ 清空笔记/棋子
- ✅ 投掷骰子

### 3.2 Player 权限（受限）
- ❌ 上传地图
- ❌ 锁定/解锁地图
- ❌ 缩放/拖动地图
- ❌ 画笔/橡皮擦
- ❌ 修改血量
- ❌ 拖动他人棋子
- ❌ 清空笔记/棋子
- ✅ 投掷骰子
- ✅ 拖动自己的棋子

### 3.3 客户端实现
```javascript
// 根据角色隐藏/禁用 UI 元素
if (userRole === 'Player') {
  document.getElementById('file-input').style.display = 'none';
  document.getElementById('lock-btn').style.display = 'none';
  // ... 禁用其他功能
}
```

---

## 第四阶段：实时同步功能

### 4.1 需要同步的状态
| 事件 | 数据 | 触发者 |
|------|------|--------|
| 地图加载 | Base64 图片数据 | DM |
| 地图变换 | scale, originX, originY | DM |
| 地图锁定 | isLocked | DM |
| 棋子移动 | color, x, y | 拥有者 |
| 棋子生成/删除 | color, position | DM |
| 血量变化 | color, cur, max | DM |
| 画笔绘制 | 路径点数组, 颜色, 模式 | DM |
| 骰子结果 | sides, result, playerName | 所有人 |

### 4.2 Socket 事件设计
```javascript
// 服务端
io.on('connection', (socket) => {
  socket.on('map:load', (data) => socket.broadcast.emit('map:load', data));
  socket.on('token:move', (data) => socket.broadcast.emit('token:move', data));
  socket.on('draw:path', (data) => socket.broadcast.emit('draw:path', data));
  socket.on('dice:roll', (data) => io.emit('dice:result', data));
  // ...
});
```

---

## 第五阶段：UI 改造

### 5.1 侧边栏更新
- 顶部显示当前 DM 名称
- 角色卡显示玩家选择的名字
- 玩家进入时弹出颜色选择框

### 5.2 聊天系统（可选）
- 侧边栏底部添加聊天框
- 骰子投掷自动播报
- 格式：`[玩家名/DM] 投掷了 D20，结果是 18`

---

## 第六阶段：部署到公网

### 方案 A：AWS EC2（推荐）

#### 6.1 申请 AWS 账户
1. 访问 https://aws.amazon.com/
2. 创建账户（需要信用卡，有免费套餐）

#### 6.2 启动 EC2 实例
```bash
# 选择配置
- AMI: Amazon Linux 2023 或 Ubuntu 22.04
- 实例类型: t2.micro (免费套餐)
- 安全组: 开放 22(SSH), 80(HTTP), 443(HTTPS), 3000(应用端口)
```

#### 6.3 连接并部署
```bash
# SSH 连接
ssh -i your-key.pem ec2-user@your-ec2-ip

# 安装 Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 克隆项目
git clone your-repo-url
cd coc_app
npm install

# 使用 PM2 保持运行
npm install -g pm2
pm2 start server.js
pm2 startup
pm2 save
```

#### 6.4 域名与 HTTPS（可选）
```bash
# 安装 Nginx 反向代理
sudo yum install nginx
# 配置 SSL (Let's Encrypt)
sudo certbot --nginx -d your-domain.com
```

### 方案 B：其他平台（更简单）

| 平台 | 特点 | 免费额度 |
|------|------|----------|
| **Railway** | 一键部署，自动 HTTPS | 500小时/月 |
| **Render** | 免费 Web Service | 750小时/月 |
| **Fly.io** | 全球边缘部署 | 3个小型VM |
| **Vercel** | 前端优秀，需要分离部署 | 100GB带宽 |

#### Railway 部署示例
```bash
# 1. 安装 Railway CLI
npm install -g @railway/cli

# 2. 登录
railway login

# 3. 初始化并部署
railway init
railway up

# 自动获得 https://xxx.railway.app 域名
```

---


## 第七阶段：玩家交互优化

### 7.1 玩家自主控制棋子
- Player 可以点击**自己的**角色卡生成/归中棋子
- 在玩家自己的角色名后显示 `（这是我）` 标签
- DM 仍可控制所有角色的棋子

### 7.2 玩家退出时的状态同步
- 玩家断开连接时，广播 `playerLeft` 事件
- 所有客户端隐藏该玩家的角色卡
- 服务端清除该玩家的颜色占用

### 7.3 颜色选择互斥
- 新玩家加入时，已被占用的颜色显示为不可选（灰色 + 禁用）
- 玩家退出后，其颜色重新可用
- 服务端维护 `takenColors` 集合，广播颜色状态变化

### 7.4 实现细节
```javascript
// 服务端事件
socket.on('disconnect', () => {
  // 释放颜色、广播玩家离开、更新可用颜色列表
});

// 客户端
socket.on('playerLeft', ({ color }) => {
  // 隐藏角色卡、更新颜色选择器
});

socket.on('takenColors', (colors) => {
  // 更新颜色选择弹窗中的可用状态
});
```

---

## 第八阶段：部署前 Bug 修复

### 8.1 玩家退出时清除棋子
- 玩家断开连接时，服务端删除该玩家颜色对应的棋子
- 广播 `token:remove` 事件给所有客户端
- 客户端接收后移除对应颜色的棋子 DOM 元素

### 8.2 新玩家加入时同步绘图数据
- 服务端已在 `gameState.drawings` 中存储所有绘图数据
- 玩家加入时，在 `joinSuccess` 中返回 `drawings` 数组
- 客户端接收后遍历数组，在 canvas 上重绘所有笔迹

### 8.3 实现细节
```javascript
// 服务端 - disconnect 事件增强
socket.on('disconnect', () => {
  const player = gameState.players.get(socket.id);
  if (player && player.color) {
    // 删除该玩家的棋子
    delete gameState.tokens[player.color];
    io.emit('token:remove', player.color);
  }
  // ... 其他断开逻辑
});

// 服务端 - joinSuccess 增加 drawings
socket.emit('joinSuccess', {
  // ... 其他数据
  gameState: {
    // ... 其他状态
    drawings: gameState.drawings
  }
});

// 客户端 - 接收 token:remove
socket.on('token:remove', (color) => {
  const token = document.querySelector(`.token[data-color="${color}"]`);
  if (token) token.remove();
});

// 客户端 - 恢复绘图
if (savedGameState.drawings) {
  savedGameState.drawings.forEach(data => {
    // 重绘每条笔迹
  });
}
```

---

## 第九阶段：UI 精简与 NPC 系统

### 9.1 Player 视图精简
- 隐藏地图缩放滑块 (`#top-controls`)
- 隐藏右下角 Lock Map 按钮 (`#lock-btn`)
- 仅在 DM 视图中保留这些控件

### 9.2 NPC 角色卡（仅 DM）
- 在角色列表中添加灰色 "NPC" 角色卡
- 仅 DM 可见，点击可生成 NPC 棋子
- NPC 棋子样式：灰色方形（区别于玩家的三角形）

### 9.3 NPC 棋子特性
- 可多次生成（地图上可存在多个 NPC）
- 每个 NPC 有唯一 ID 用于区分
- 支持拖拽移动
- 双击删除单个 NPC
- "清除所有 NPC" 按钮清空所有 NPC

### 9.4 实现细节
```javascript
// NPC 棋子 HTML 结构
<div class="token npc" data-npc-id="npc_123" style="left:100px;top:100px;"></div>

// NPC 棋子样式
.token.npc {
  width: 30px; height: 30px;
  background: #7f8c8d;
  border-radius: 4px;
  border: none;
}

// 服务端状态
gameState.npcs = []; // { id, x, y }

// Socket 事件
socket.on('npc:spawn', (data) => { ... });
socket.on('npc:move', (data) => { ... });
socket.on('npc:remove', (id) => { ... });
socket.on('npc:clearAll', () => { ... });
```

### 9.5 NPC 颜色选择
- 在 NPC 角色卡中添加颜色选择色块
- 可选颜色：红色、深蓝色、黑色、灰色、白色
- DM 点击色块选择当前 NPC 颜色，再点击卡片生成对应颜色的 NPC
- NPC 数据结构增加 `color` 字段：`{ id, x, y, color }`
- 其他逻辑保持不变（多次生成、拖拽、双击删除）

```javascript
// NPC 颜色映射
const npcColorMap = {
  red: '#e74c3c',
  darkblue: '#072af1',
  black: '#1a1a1a',
  gray: '#7f8c8d',
  white: '#ecf0f1'
};

// NPC 角色卡 HTML
<div class="npc-color-selector">
  <div class="npc-color" style="background:#e74c3c" onclick="setNpcColor('red')"></div>
  <div class="npc-color" style="background:#2c3e50" onclick="setNpcColor('darkblue')"></div>
  ...
</div>
```

---

## 第十阶段：共享笔记系统

### 10.1 功能概述
- 在页面顶部添加 Tab 栏，包含「地图」和「笔记」两个标签
- 点击「笔记」切换到共享笔记视图
- 所有用户（DM 和 Player）都可以查看和编辑笔记
- 笔记内容实时同步到所有连接的客户端
- 笔记持久化存储（使用 Render Disk）

### 10.2 服务端实现

#### 文件持久化
```javascript
const fs = require('fs');
const NOTES_FILE = '/data/notes.txt';

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
    fs.writeFileSync(NOTES_FILE, content, 'utf8');
  } catch (err) {
    console.error('保存笔记失败:', err);
  }
}
```

#### Socket 事件
```javascript
// 笔记更新（所有人可编辑）
socket.on('notes:update', (content) => {
  const player = gameState.players.get(socket.id);
  if (!player) return;

  gameState.notes = content;
  saveNotes(content);
  socket.broadcast.emit('notes:sync', content);
});
```

### 10.3 客户端实现

#### Tab 栏 HTML
```html
<div id="tab-bar">
  <div class="tab active" data-tab="map">地图</div>
  <div class="tab" data-tab="notes">笔记</div>
</div>
```

#### Tab 栏样式
```css
#tab-bar {
  display: flex;
  background: #1a1a2e;
  border-bottom: 2px solid #3498db;
}
.tab {
  padding: 10px 20px;
  cursor: pointer;
  color: #aaa;
  transition: all 0.3s;
}
.tab:hover { color: white; }
.tab.active {
  color: white;
  background: #3498db;
}
```

#### 笔记视图
```html
<div id="notes-view" style="display:none;">
  <textarea id="notes-textarea" placeholder="在此输入共享笔记..."></textarea>
</div>
```

#### Tab 切换逻辑
```javascript
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const isMap = tab.dataset.tab === 'map';
    document.getElementById('viewport').style.display = isMap ? 'block' : 'none';
    document.getElementById('notes-view').style.display = isMap ? 'none' : 'flex';
  };
});
```

#### 笔记同步（带防抖）
```javascript
let notesTimeout;
const notesTextarea = document.getElementById('notes-textarea');

notesTextarea.oninput = () => {
  clearTimeout(notesTimeout);
  notesTimeout = setTimeout(() => {
    socket.emit('notes:update', notesTextarea.value);
  }, 500); // 500ms 防抖
};

socket.on('notes:sync', (content) => {
  notesTextarea.value = content;
});
```

### 10.4 Render Disk 配置
1. 在 Render Dashboard 中进入服务设置
2. 添加 Disk：
   - Name: `data`
   - Mount Path: `/data`
   - Size: 1 GB（最小）
3. 重新部署服务

---

## 第十一阶段：地图快捷保存与切换系统

### 11.1 功能概述
支持 DM 保存多张地图的完整状态，并在不同地图间快速切换。适用于多楼层、多场景的跑团场景。

**核心特性：**
- DM 侧边栏显示 4 个地图存储槽（正方形缩略图）
- 保存地图时记录完整状态：地图图片、缩放变换、玩家棋子、NPC、笔迹
- 点击缩略图可快速加载对应地图状态
- 支持删除已保存的地图

### 11.2 数据结构

#### 单张地图存档
```javascript
{
  id: 'map_1234567890',        // 唯一标识
  thumbnail: 'data:image/...',  // 缩略图 Base64（压缩后）
  mapData: 'data:image/...',    // 原始地图 Base64
  mapTransform: { scale: 1, originX: 0, originY: 0 },
  tokens: { orange: {x, y}, blue: {x, y}, ... },
  npcs: [{ id, x, y, color }, ...],
  drawings: [{ fromX, fromY, toX, toY, color, tool, lineWidth }, ...]
}
```

#### 服务端状态
```javascript
gameState.savedMaps = [];  // 最多 4 张地图存档
```

### 11.3 UI 设计

#### 侧边栏地图槽（仅 DM 可见）
```html
<div class="section-title">地图存档</div>
<div id="map-slots" class="dm-only">
  <div class="map-slot empty" data-slot="0"></div>
  <div class="map-slot empty" data-slot="1"></div>
  <div class="map-slot empty" data-slot="2"></div>
  <div class="map-slot empty" data-slot="3"></div>
</div>
```

#### 地图槽样式
```css
#map-slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 15px;
}
.map-slot {
  aspect-ratio: 1;
  background: rgba(0,0,0,0.3);
  border: 2px dashed #555;
  border-radius: 8px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.map-slot.empty::after {
  content: '+';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #555;
}
.map-slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.map-slot .delete-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  background: #e74c3c;
  border-radius: 50%;
  color: white;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

#### 保存按钮（地图视图左上角）
```html
<button id="save-map-btn" class="dm-only" style="display:none;">
  💾 保存地图
</button>
```

```css
#save-map-btn {
  position: absolute;
  top: 60px;
  left: 20px;
  z-index: 25;
  padding: 8px 15px;
  background: #27ae60;
  border: none;
  border-radius: 5px;
  color: white;
  font-weight: bold;
  cursor: pointer;
}
#save-map-btn:hover {
  background: #2ecc71;
}
```

### 11.4 服务端实现

#### Socket 事件
```javascript
// 保存地图 (仅 DM)
socket.on('map:save', (data) => {
  const player = gameState.players.get(socket.id);
  if (player?.role !== 'DM') return;

  if (gameState.savedMaps.length >= 4) {
    socket.emit('map:saveError', '地图存档已满（最多4张）');
    return;
  }

  const mapArchive = {
    id: 'map_' + Date.now(),
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
    id: mapArchive.id
  });
});

// 加载地图 (仅 DM)
socket.on('map:loadSaved', (mapId) => {
  const player = gameState.players.get(socket.id);
  if (player?.role !== 'DM') return;

  const archive = gameState.savedMaps.find(m => m.id === mapId);
  if (!archive) return;

  // 更新当前游戏状态
  gameState.mapData = archive.mapData;
  gameState.mapTransform = archive.mapTransform;
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
```

### 11.5 客户端实现

#### 生成缩略图
```javascript
function generateThumbnail(mapData, callback) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const maxSize = 150;
    const ratio = Math.min(maxSize / img.width, maxSize / img.height);
    canvas.width = img.width * ratio;
    canvas.height = img.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL('image/jpeg', 0.6));
  };
  img.src = mapData;
}
```

#### 保存地图
```javascript
function saveCurrentMap() {
  if (!isDM || !mapImg.src) return;

  generateThumbnail(mapImg.src, (thumbnail) => {
    const data = {
      thumbnail,
      mapData: mapImg.src,
      mapTransform: { scale, originX, originY },
      tokens: getCurrentTokens(),
      npcs: getCurrentNPCs(),
      drawings: [...gameState.drawings] // 需要客户端维护 drawings 副本
    };
    socket.emit('map:save', data);
  });
}

function getCurrentTokens() {
  const tokens = {};
  mapContainer.querySelectorAll('.token:not(.npc)').forEach(t => {
    const color = t.getAttribute('data-color');
    tokens[color] = {
      x: parseFloat(t.style.left),
      y: parseFloat(t.style.top)
    };
  });
  return tokens;
}

function getCurrentNPCs() {
  const npcs = [];
  mapContainer.querySelectorAll('.token.npc').forEach(t => {
    npcs.push({
      id: t.getAttribute('data-npc-id'),
      x: parseFloat(t.style.left),
      y: parseFloat(t.style.top),
      color: t.getAttribute('data-npc-color')
    });
  });
  return npcs;
}
```

#### 加载已保存的地图
```javascript
function loadSavedMap(mapId) {
  if (!isDM) return;
  socket.emit('map:loadSaved', mapId);
}

socket.on('map:loadedSaved', (archive) => {
  // 清空当前棋子和 NPC
  mapContainer.querySelectorAll('.token').forEach(t => t.remove());

  // 加载地图
  loadMapFromData(archive.mapData, () => {
    // 恢复笔迹
    if (archive.drawings) restoreDrawings(archive.drawings);
  });

  // 恢复变换
  scale = archive.mapTransform.scale;
  originX = archive.mapTransform.originX;
  originY = archive.mapTransform.originY;
  updateTransform();

  // 恢复棋子
  Object.keys(archive.tokens).forEach(color => {
    createTokenElement(color, archive.tokens[color].x, archive.tokens[color].y);
  });

  // 恢复 NPC
  archive.npcs.forEach(npc => {
    createNPCElement(npc.id, npc.x, npc.y, npc.color);
  });

  addSystemMessage('DM 读取了一张地图');
});
```

#### 渲染地图槽
```javascript
function renderMapSlots(savedMaps) {
  const slots = document.querySelectorAll('.map-slot');
  slots.forEach((slot, i) => {
    slot.innerHTML = '';
    slot.classList.add('empty');

    if (savedMaps[i]) {
      slot.classList.remove('empty');
      const img = document.createElement('img');
      img.src = savedMaps[i].thumbnail;
      slot.appendChild(img);

      const deleteBtn = document.createElement('div');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = '×';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        socket.emit('map:deleteSaved', savedMaps[i].id);
      };
      slot.appendChild(deleteBtn);

      slot.onclick = () => loadSavedMap(savedMaps[i].id);
    }
  });
}
```

### 11.6 重新上传地图时清空状态
```javascript
fileInput.onchange = (e) => {
  if (!isDM) return;
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target.result;
      loadMapFromData(data);
      resetMap();

      // 清空当前所有棋子、NPC、笔迹
      mapContainer.querySelectorAll('.token').forEach(t => t.remove());
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      socket.emit('map:load', data);
      socket.emit('token:clearAll');
      socket.emit('npc:clearAll');
      socket.emit('draw:clear');
    };
    reader.readAsDataURL(file);
  }
};
```

### 11.7 Edge Cases 处理

| 场景 | 处理方式 |
|------|----------|
| 保存成功 | 聊天区显示「DM 保存了一张地图」 |
| 读取地图 | 聊天区显示「DM 读取了一张地图」 |
| 存档已满（4张） | 弹窗提示「地图存档已满」，阻止保存 |
| 删除地图 | 聊天区显示「DM 删除了一张地图」 |
| 无地图时点击保存 | 按钮隐藏，无法触发 |

### 11.8 Socket 事件汇总

| 事件名 | 方向 | 数据 | 说明 |
|--------|------|------|------|
| `map:save` | C→S | { thumbnail, mapData, mapTransform, tokens, npcs, drawings } | DM 保存地图 |
| `map:saved` | S→C | { slotIndex, thumbnail, id, isUpdate } | 保存成功，更新槽位 |
| `map:saveError` | S→C | string | 保存失败（已满） |
| `map:loadSaved` | C→S | mapId | DM 请求加载存档 |
| `map:loadedSaved` | S→C | archive | 广播加载的完整数据 |
| `map:deleteSaved` | C→S | mapId | DM 删除存档 |
| `map:deletedSaved` | S→C | mapId | 广播删除结果 |

### 11.9 保存或更新逻辑（Save-or-Update）

#### 需求背景
游戏过程中，地图图片本身不会改变，变化的只是：
- 地图缩放/位置（mapTransform）
- 玩家棋子位置（tokens）
- NPC 位置（npcs）
- 笔迹（drawings）

因此，保存时应检测当前地图是否已存在于存档列表中：
- **已存在**：更新该存档的状态（不占用新槽位）
- **不存在**：创建新存档（占用新槽位，受 4 张上限限制）

#### 判断逻辑
由于 mapData 是完整的 Base64 字符串（可能很大），直接比较效率低。采用以下方案：

1. 计算 mapData 的简单哈希值（取前 1000 字符 + 长度）
2. 保存时在 archive 中存储此哈希值
3. 保存新地图时，计算当前地图的哈希值并与已有存档比较

```javascript
// 简单哈希函数
function getMapHash(mapData) {
  return mapData.substring(0, 1000) + '_' + mapData.length;
}
```

#### 服务端实现
```javascript
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
    saveSavedMapsToFile();

    io.emit('map:saved', {
      slotIndex: existingIndex,
      thumbnail: data.thumbnail,
      id: archive.id,
      isUpdate: true
    });
  } else {
    // 创建新存档
    if (gameState.savedMaps.length >= 4) {
      socket.emit('map:saveError', '地图存档已满（最多4张）');
      return;
    }

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
    saveSavedMapsToFile();

    io.emit('map:saved', {
      slotIndex: gameState.savedMaps.length - 1,
      thumbnail: data.thumbnail,
      id: mapArchive.id,
      isUpdate: false
    });
  }
});
```

#### 客户端提示
```javascript
socket.on('map:saved', (data) => {
  if (data.isUpdate) {
    // 更新现有槽位的缩略图
    localSavedMaps[data.slotIndex].thumbnail = data.thumbnail;
    addSystemMessage('DM 更新了地图存档');
  } else {
    // 添加新槽位
    localSavedMaps.push({ id: data.id, thumbnail: data.thumbnail });
    addSystemMessage('DM 保存了一张新地图');
  }
  renderMapSlots();
});
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 保存已存在的地图 | 更新该存档，提示「DM 更新了地图存档」 |
| 保存新地图 | 创建新存档，提示「DM 保存了一张新地图」 |
| 存档已满且保存新地图 | 弹窗提示「地图存档已满」 |
| 存档已满但更新已有地图 | 正常更新，不受上限限制 |

### 11.10 DM 通知徽章系统（Toast Notification）

#### 需求背景
DM 执行地图操作后，需要即时反馈操作结果。使用非阻塞的 Toast 通知替代传统 alert 弹窗，提升用户体验。

**特性：**
- 仅 DM 可见，Player 不显示
- 出现在屏幕顶部中央
- 自动消失（1.5 秒后）
- 不阻塞用户操作

#### 通知消息类型

| 操作 | 消息内容 |
|------|----------|
| 保存新地图成功 | ✓ 地图保存成功 |
| 更新地图成功 | ✓ 地图更新成功 |
| 删除地图成功 | ✓ 地图删除成功 |
| 存档已满 | ✗ 地图存档已满（最多4张） |

#### HTML 结构
```html
<!-- 放在 body 末尾，仅 DM 可见 -->
<div id="dm-toast" class="dm-only"></div>
```

#### CSS 样式
```css
#dm-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(-100px);
  padding: 12px 24px;
  background: rgba(46, 204, 113, 0.95);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  z-index: 9999;
  opacity: 0;
  transition: transform 0.3s ease, opacity 0.3s ease;
  pointer-events: none;
}

#dm-toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

#dm-toast.error {
  background: rgba(231, 76, 60, 0.95);
}
```

#### JavaScript 实现
```javascript
function showDmToast(message, isError = false) {
  if (!isDM) return;  // 仅 DM 可见

  const toast = document.getElementById('dm-toast');
  toast.textContent = message;
  toast.className = 'dm-only show' + (isError ? ' error' : '');

  // 1.5 秒后自动消失
  setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

// 使用示例
socket.on('map:saved', (data) => {
  if (data.isUpdate) {
    showDmToast('✓ 地图更新成功');
  } else {
    showDmToast('✓ 地图保存成功');
  }
  // ... 其他逻辑
});

socket.on('map:saveError', (message) => {
  showDmToast('✗ ' + message, true);
});

socket.on('map:deletedSaved', (mapId) => {
  showDmToast('✓ 地图删除成功');
  // ... 其他逻辑
});
```

### 11.11 地图槽位交互优化

#### 需求背景
简化 DM 的地图上传和保存流程，将两步操作合并为一步。

**原流程：**
1. 点击「选择文件」上传地图
2. 地图显示在视图中
3. 点击「保存地图」保存到槽位

**新流程：**
1. 点击空白槽位 → 自动弹出文件选择
2. 选择图片后 → 自动加载并保存到该槽位
3. 自动显示下一个空白槽位

#### 改动点

1. **删除原上传按钮**：移除 `<input type="file">` 的可见 UI
2. **取消存档上限**：移除服务端的 4 张限制
3. **动态槽位渲染**：始终显示「已保存地图 + 1个空槽位」
4. **空槽位点击**：触发隐藏的文件选择器
5. **上传后自动保存**：文件加载完成后立即触发 `map:save`

#### 服务端改动
```javascript
// 移除 4 张上限检查
socket.on('map:save', (data) => {
  // 删除这段代码：
  // if (gameState.savedMaps.length >= 4) {
  //   socket.emit('map:saveError', '地图存档已满');
  //   return;
  // }

  // 其他逻辑保持不变...
});
```

#### 客户端改动

##### HTML
```html
<!-- 删除可见的文件上传按钮 -->
<!-- 保留隐藏的 input 用于触发 -->
<input type="file" id="file-input" accept="image/*" style="display: none;">

<!-- 地图槽位区域 -->
<div id="map-slots">
  <!-- 动态渲染，不再固定 4 个 -->
</div>
```

##### 动态渲染逻辑
```javascript
function renderMapSlots() {
  const container = document.getElementById('map-slots');
  container.innerHTML = '';

  // 渲染已保存的地图
  localSavedMaps.forEach((map, i) => {
    const slot = createFilledSlot(map, i);
    container.appendChild(slot);
  });

  // 始终添加一个空槽位
  const emptySlot = createEmptySlot();
  container.appendChild(emptySlot);
}

function createEmptySlot() {
  const slot = document.createElement('div');
  slot.className = 'map-slot empty';
  slot.onclick = () => fileInput.click();  // 点击触发文件选择
  return slot;
}

function createFilledSlot(map, index) {
  const slot = document.createElement('div');
  slot.className = 'map-slot';

  const img = document.createElement('img');
  img.src = map.thumbnail;
  slot.appendChild(img);

  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'delete-btn';
  deleteBtn.innerHTML = '×';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    socket.emit('map:deleteSaved', map.id);
  };
  slot.appendChild(deleteBtn);

  slot.onclick = () => loadSavedMap(map.id);
  return slot;
}
```

##### 文件上传后自动保存
```javascript
fileInput.onchange = (e) => {
  if (!isDM) return;
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const data = event.target.result;

    // 加载地图到视图
    loadMapFromData(data, () => {
      // 加载完成后自动保存
      saveCurrentMap();
    });

    resetMap();

    // 清空当前棋子、NPC、笔迹
    mapContainer.querySelectorAll('.token').forEach(t => t.remove());
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localDrawings = [];

    socket.emit('map:load', data);
    socket.emit('token:clearAll');
    socket.emit('npc:clearAll');
    socket.emit('draw:clear');
  };
  reader.readAsDataURL(file);

  // 重置 input 以便重复选择同一文件
  fileInput.value = '';
};
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 首次进入，无地图 | 显示 1 个空槽位 |
| 有 N 张地图 | 显示 N 个已保存槽位 + 1 个空槽位 |
| 点击空槽位 | 触发文件选择器 |
| 上传完成 | 自动保存，Toast 提示，新增空槽位 |
| 上传已存在的地图 | 更新现有槽位，不新增空槽位 |

### 11.12 绘图工具 UI 重构与矩形绘制功能

#### 需求背景
优化绘图工具的 UI 布局，并新增矩形绘制功能。

#### UI 改动

**原布局：**
```
[移动] [画笔] [橡皮]
（选择画笔后展开颜色选择器）
```

**新布局：**
```
第一行：颜色选择（始终显示）
○ ○ ○ ○ ○  （圆形按钮，与 NPC 方形选择器区分）

第二行：工具按钮
[移动] [画笔] [矩形] [橡皮]
```

#### 颜色选择器样式
```css
.draw-color-selector {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.draw-color {
  width: 28px;
  height: 28px;
  border-radius: 50%;  /* 圆形 */
  cursor: pointer;
  border: 2px solid transparent;
}
.draw-color.selected {
  border-color: #f1c40f;
  transform: scale(1.1);
}
```

#### 矩形绘制功能

##### 交互方式
1. 选择「矩形」工具
2. 在地图上按下鼠标 → 记录起始点
3. 拖动鼠标 → 实时预览矩形（可选）
4. 释放鼠标 → 绘制空心矩形

##### 数据结构扩展
```javascript
// 原笔迹数据（线段）
{
  type: 'path',  // 新增 type 字段
  fromX, fromY, toX, toY,
  color, tool, lineWidth
}

// 新增矩形数据
{
  type: 'rect',
  x, y, width, height,
  color, lineWidth
}
```

##### 绘制逻辑
```javascript
let rectStartPoint = null;

// 鼠标按下
if (currentTool === 'rect') {
  rectStartPoint = { x, y };
}

// 鼠标释放
if (currentTool === 'rect' && rectStartPoint) {
  const rectData = {
    type: 'rect',
    x: Math.min(rectStartPoint.x, x),
    y: Math.min(rectStartPoint.y, y),
    width: Math.abs(x - rectStartPoint.x),
    height: Math.abs(y - rectStartPoint.y),
    color: penColor,
    lineWidth: 5 / scale
  };

  // 绘制矩形
  ctx.strokeStyle = penColor;
  ctx.lineWidth = rectData.lineWidth;
  ctx.strokeRect(rectData.x, rectData.y, rectData.width, rectData.height);

  // 保存并同步
  localDrawings.push(rectData);
  socket.emit('draw:path', rectData);

  rectStartPoint = null;
}
```

##### 恢复绘图时支持矩形
```javascript
function restoreDrawings(drawings) {
  drawings.forEach(data => {
    if (data.type === 'rect') {
      // 绘制矩形
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.lineWidth;
      ctx.strokeRect(data.x, data.y, data.width, data.height);
    } else {
      // 绘制线段（原有逻辑）
      ctx.beginPath();
      ctx.moveTo(data.fromX, data.fromY);
      // ...
    }
  });
}
```

##### 橡皮擦与矩形交互
橡皮擦使用 `destination-out` 合成模式，可以正常擦除矩形的笔画。

#### Socket 事件
复用现有 `draw:path` 事件，通过 `type` 字段区分线段和矩形。

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 绘制极小矩形 | 正常绘制（可能只是一个点） |
| 从右下往左上拖动 | 使用 Math.min/abs 计算正确的 x, y, width, height |
| 切换工具时未释放鼠标 | 重置 rectStartPoint |
| 加载存档包含矩形 | restoreDrawings 支持 type 判断 |

### 11.13 地图状态自动保存（增量更新）

#### 需求背景
DM 在讲解地图时，经常需要移动棋子、添加标记、调整视角。希望这些变更能自动保存，无需手动点击保存按钮，以便快速切换到其他地图后再切回来时保留状态。

#### 性能考量

**问题：** 如果每秒发送完整 `mapData`（1-50MB），会造成网络和服务器压力。

**解决方案：** 增量更新 + 变更检测
- 仅在状态变更时触发保存（dirty flag）
- 更新时不重传 `mapData`（地图图片本身没变）
- 使用防抖机制（最后一次操作后 1 秒才保存）

| 方案 | 每次传输量 |
|------|-----------|
| 原方案（完整保存） | 1-50 MB |
| 优化方案（状态更新） | ~10-50 KB |

#### 实现方案

##### 1. 客户端状态追踪

```javascript
let isDirty = false;           // 是否有未保存的变更
let currentMapId = null;       // 当前加载的地图 ID
let autoSaveInterval = null;   // 自动保存定时器

// 标记为脏的操作
function markDirty() {
    if (isDM && currentMapId) {
        isDirty = true;
    }
}
```

##### 2. 触发 dirty 的操作

| 操作 | 触发位置 |
|------|----------|
| 棋子移动 | `token:move` 发送后 |
| NPC 移动/生成/删除 | `npc:move/spawn/remove` 发送后 |
| 绘图（画笔/矩形） | `draw:path` 发送后 |
| 清空笔迹 | `draw:clear` 发送后 |
| 地图变换（缩放/平移） | `map:transform` 发送后 |

##### 3. 自动保存逻辑

```javascript
// 启动自动保存（每秒检查）
function startAutoSave() {
    if (autoSaveInterval) return;
    autoSaveInterval = setInterval(() => {
        if (isDirty && currentMapId) {
            saveMapState(true);  // silent = true
            isDirty = false;
        }
    }, 1000);
}

// 保存地图状态（轻量级，不含 mapData）
function saveMapState(silent = false) {
    if (!isDM || !currentMapId) return;

    socket.emit('map:updateState', {
        mapId: currentMapId,
        mapTransform: { scale, originX, originY },
        tokens: getCurrentTokens(),
        npcs: getCurrentNPCs(),
        drawings: [...localDrawings],
        silent: silent  // 传给服务端，控制是否广播系统消息
    });
}
```

##### 4. 服务端事件处理

```javascript
// 更新地图状态（轻量级）
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

    // 仅在非静默模式下广播
    if (!data.silent) {
        io.emit('map:stateUpdated', { mapId: data.mapId });
    }
});
```

##### 5. 手动保存 vs 自动保存

| 场景 | 调用方式 | Toast | 系统消息 |
|------|----------|-------|----------|
| 自动保存（1秒检测） | `saveMapState(true)` | 无 | 无 |
| 手动点击保存按钮 | `saveMapState(false)` | ✓ 地图更新成功 | DM 更新了地图存档 |

##### 6. 当前地图 ID 追踪

```javascript
// 上传新地图后，从 map:saved 回调获取 ID
socket.on('map:saved', (data) => {
    currentMapId = data.id;  // 记录当前地图 ID
    // ...
});

// 加载已保存地图后，记录 ID
socket.on('map:loadedSaved', (archive) => {
    currentMapId = archive.id;  // 记录当前地图 ID
    // ...
});
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 未加载任何地图 | `currentMapId` 为 null，不触发自动保存 |
| 上传新地图 | 触发 `map:save`，获取 ID 后开始自动保存 |
| 切换到另一张地图 | 立即保存当前状态，更新 `currentMapId` |
| DM 断开连接 | 最后一次 dirty 状态可能丢失（可接受） |
| 玩家操作 | 玩家移动自己棋子也会触发 DM 端的自动保存 |

---

## 第十二阶段：角色卡实现

### 12.1 功能概述

新增「角色卡」Tab，提供类似 Roll20 的角色卡 UI，支持 DM 和 Player 创建、编辑、保存角色卡。角色卡数据持久化存储到服务器端 JSON 文件。

### 12.2 Tab 结构

```
[地图] [笔记] [角色卡]  ← 新增第三个 Tab
```

- **可见性**：DM 和 Player 都可见
- **切换逻辑**：复用现有 `switchTab()` 函数

### 12.3 UI 布局（参考 Roll20 风格）

```
┌─────────────────────────────────────────────────────────────┐
│  [新建角色卡]  [读取角色卡 ▼]                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ 角色姓名：       │    │ 当前血量/最大血量：│                │
│  │      V          │    │     10/10       │                │
│  └─────────────────┘    └─────────────────┘                │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │    基础属性      │    │     豁免检定     │                │
│  │  ┌───────────┐  │    │  ○ -1  力量     │                │
│  │  │ 力量：-1  │  │    │  ● 5   敏捷     │                │
│  │  └───────────┘  │    │  ○ 2   体质     │                │
│  │  ┌───────────┐  │    │  ● 3   智力     │                │
│  │  │ 敏捷：3   │  │    │  ○ 3   感知     │                │
│  │  └───────────┘  │    │  ○ -1  魅力     │                │
│  │  ┌───────────┐  │    └─────────────────┘                │
│  │  │ 体质：2   │  │                                       │
│  │  └───────────┘  │    ┌─────────────────┐                │
│  │  ┌───────────┐  │    │      技能       │                │
│  │  │ 智力：1   │  │    │  ○ 3  体操(敏捷) │                │
│  │  └───────────┘  │    │  ○ 3  驯兽(感知) │                │
│  │  ┌───────────┐  │    │  ○ 1  奥秘(智力) │                │
│  │  │ 感知：3   │  │    │  ...            │                │
│  │  └───────────┘  │    │  ● 5  巧手(敏捷) │                │
│  │  ┌───────────┐  │    │  ● 5  隐匿(敏捷) │                │
│  │  │ 魅力：-1  │  │    │  ○ 3  求生(感知) │                │
│  │  └───────────┘  │    └─────────────────┘                │
│  └─────────────────┘                                       │
│                                                             │
│                                    [编辑]  [保存]           │
└─────────────────────────────────────────────────────────────┘
```

### 12.4 数据结构

#### 角色卡 JSON 结构
```javascript
{
  name: "V",                    // 角色名（唯一标识）
  hp: { cur: 10, max: 10 },     // 血量
  attributes: {                 // 六大基础属性
    strength: -1,     // 力量
    dexterity: 3,     // 敏捷
    constitution: 2,  // 体质
    intelligence: 1,  // 智力
    wisdom: 3,        // 感知
    charisma: -1      // 魅力
  },
  savingThrows: ["dexterity", "intelligence"],  // 已选豁免（最多2个）
  skills: ["sleightOfHand", "stealth", "medicine", "perception"]  // 已选技能（最多4个）
}
```

#### 技能与属性映射
```javascript
const skillAttributeMap = {
  // 力量 (Strength)
  athletics: 'strength',        // 运动

  // 敏捷 (Dexterity)
  acrobatics: 'dexterity',      // 体操
  sleightOfHand: 'dexterity',   // 巧手
  stealth: 'dexterity',         // 隐匿

  // 智力 (Intelligence)
  arcana: 'intelligence',       // 奥秘
  history: 'intelligence',      // 历史
  investigation: 'intelligence', // 调查
  nature: 'intelligence',       // 自然
  religion: 'intelligence',     // 宗教

  // 感知 (Wisdom)
  animalHandling: 'wisdom',     // 驯兽
  insight: 'wisdom',            // 洞悉
  medicine: 'wisdom',           // 医药
  perception: 'wisdom',         // 察觉
  survival: 'wisdom',           // 求生

  // 魅力 (Charisma)
  deception: 'charisma',        // 欺瞒
  intimidation: 'charisma',     // 威吓
  performance: 'charisma',      // 表演
  persuasion: 'charisma'        // 游说
};
```

### 12.5 数值计算逻辑

#### 豁免检定数值
```javascript
function getSavingThrowValue(attribute, characterData) {
  const baseValue = characterData.attributes[attribute];
  const isProficient = characterData.savingThrows.includes(attribute);
  return isProficient ? baseValue + 2 : baseValue;
}
```

#### 技能数值
```javascript
function getSkillValue(skillName, characterData) {
  const attribute = skillAttributeMap[skillName];
  const baseValue = characterData.attributes[attribute];
  const isProficient = characterData.skills.includes(skillName);
  return isProficient ? baseValue + 2 : baseValue;
}
```

### 12.6 Checkbox 限制逻辑

#### 豁免检定（最多选2个）
```javascript
function onSavingThrowChange(attribute, checked) {
  if (checked && currentCharacter.savingThrows.length >= 2) {
    // 阻止选中，显示提示
    showToast('豁免检定最多选择2个', true);
    return false;
  }
  // 更新选中状态
  if (checked) {
    currentCharacter.savingThrows.push(attribute);
  } else {
    currentCharacter.savingThrows = currentCharacter.savingThrows.filter(a => a !== attribute);
  }
  updateSavingThrowDisplay();
}
```

#### 技能（最多选4个）
```javascript
function onSkillChange(skillName, checked) {
  if (checked && currentCharacter.skills.length >= 4) {
    showToast('技能最多选择4个', true);
    return false;
  }
  if (checked) {
    currentCharacter.skills.push(skillName);
  } else {
    currentCharacter.skills = currentCharacter.skills.filter(s => s !== skillName);
  }
  updateSkillDisplay();
}
```

### 12.7 编辑模式

#### 状态切换
```javascript
let isEditMode = false;

function toggleEditMode() {
  isEditMode = !isEditMode;

  // 切换输入框的 disabled 状态
  document.querySelectorAll('.char-input').forEach(input => {
    input.disabled = !isEditMode;
  });

  // 切换 checkbox 的 disabled 状态
  document.querySelectorAll('.char-checkbox').forEach(cb => {
    cb.disabled = !isEditMode;
  });

  // 更新按钮文字
  document.getElementById('edit-btn').textContent = isEditMode ? '取消' : '编辑';
}
```

### 12.8 数据持久化

#### 服务端存储路径
```javascript
const CHARACTERS_FILE = process.env.NODE_ENV === 'production'
  ? '/data/characters.json'
  : './data/characters.json';
```

#### 文件格式
```json
{
  "V": { "name": "V", "hp": {...}, "attributes": {...}, ... },
  "Alice": { "name": "Alice", "hp": {...}, "attributes": {...}, ... }
}
```

#### 读取角色卡列表
```javascript
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
```

#### 保存角色卡
```javascript
function saveCharacter(characterData) {
  const characters = loadCharacters();
  characters[characterData.name] = characterData;

  const dir = path.dirname(CHARACTERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CHARACTERS_FILE, JSON.stringify(characters, null, 2), 'utf8');
}
```

### 12.9 Socket 事件

#### 客户端 → 服务端

| 事件 | 数据 | 说明 |
|------|------|------|
| `character:save` | `{ characterData }` | 保存角色卡 |
| `character:load` | `{ name }` | 加载指定角色卡 |
| `character:list` | - | 请求角色卡列表 |
| `character:delete` | `{ name }` | 删除角色卡（仅 DM） |

#### 服务端 → 客户端

| 事件 | 数据 | 说明 |
|------|------|------|
| `character:saved` | `{ name }` | 保存成功 |
| `character:loaded` | `{ characterData }` | 返回角色卡数据 |
| `character:listResult` | `{ names: [...] }` | 返回角色卡名称列表 |
| `character:error` | `{ message }` | 操作失败 |

### 12.10 DM 特殊视图

DM 进入角色卡 Tab 时，默认显示角色卡列表：

```
┌─────────────────────────────────────┐
│         已创建的角色卡              │
├─────────────────────────────────────┤
│  📋 V                    [查看]     │
│  📋 Alice                [查看]     │
│  📋 Bob                  [查看]     │
├─────────────────────────────────────┤
│  [+ 新建角色卡]                     │
└─────────────────────────────────────┘
```

### 12.11 HTML 结构

```html
<!-- 角色卡视图 -->
<div id="character-view" style="display: none;">
  <!-- 顶部操作栏 -->
  <div class="char-toolbar">
    <button id="new-char-btn" onclick="newCharacter()">新建角色卡</button>
    <select id="char-select" onchange="loadSelectedCharacter()">
      <option value="">-- 读取角色卡 --</option>
    </select>
  </div>

  <!-- DM 角色列表（仅 DM 可见） -->
  <div id="char-list" class="dm-only"></div>

  <!-- 角色卡内容 -->
  <div id="char-sheet">
    <!-- 角色名和血量 -->
    <div class="char-header">
      <div class="char-field">
        <label>角色姓名：</label>
        <input type="text" id="char-name" class="char-input" disabled>
      </div>
      <div class="char-field">
        <label>当前血量/最大血量：</label>
        <input type="number" id="char-hp-cur" class="char-input" disabled>
        <span>/</span>
        <input type="number" id="char-hp-max" class="char-input" disabled>
      </div>
    </div>

    <!-- 基础属性 -->
    <div class="char-section">
      <div class="section-title">基础属性</div>
      <div class="attr-grid">
        <div class="attr-box"><label>力量</label><input type="number" id="attr-str" class="char-input" disabled></div>
        <div class="attr-box"><label>敏捷</label><input type="number" id="attr-dex" class="char-input" disabled></div>
        <div class="attr-box"><label>体质</label><input type="number" id="attr-con" class="char-input" disabled></div>
        <div class="attr-box"><label>智力</label><input type="number" id="attr-int" class="char-input" disabled></div>
        <div class="attr-box"><label>感知</label><input type="number" id="attr-wis" class="char-input" disabled></div>
        <div class="attr-box"><label>魅力</label><input type="number" id="attr-cha" class="char-input" disabled></div>
      </div>
    </div>

    <!-- 豁免检定 -->
    <div class="char-section">
      <div class="section-title">豁免检定</div>
      <div id="saving-throws"></div>
    </div>

    <!-- 技能 -->
    <div class="char-section">
      <div class="section-title">技能</div>
      <div id="skills-list"></div>
    </div>
  </div>

  <!-- 底部按钮 -->
  <div class="char-actions">
    <button id="edit-btn" onclick="toggleEditMode()">编辑</button>
    <button id="save-char-btn" onclick="saveCharacter()">保存</button>
  </div>
</div>
```

### 12.12 CSS 样式

```css
#character-view {
  padding: 20px;
  color: white;
  height: 100%;
  overflow-y: auto;
}

.char-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.char-header {
  display: flex;
  gap: 30px;
  margin-bottom: 20px;
}

.char-field {
  background: rgba(255,255,255,0.1);
  padding: 15px;
  border-radius: 8px;
}

.char-field label {
  display: block;
  font-size: 12px;
  color: #aaa;
  margin-bottom: 5px;
}

.char-field input {
  background: transparent;
  border: none;
  color: white;
  font-size: 24px;
  width: 100%;
  text-align: center;
}

.char-section {
  background: rgba(255,255,255,0.1);
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
}

.attr-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.attr-box {
  background: rgba(255,255,255,0.1);
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.attr-box label {
  display: block;
  font-size: 14px;
  margin-bottom: 5px;
}

.attr-box input {
  background: transparent;
  border: none;
  color: white;
  font-size: 28px;
  width: 60px;
  text-align: center;
}

.save-row, .skill-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.save-row input[type="checkbox"],
.skill-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
}

.save-value, .skill-value {
  font-weight: bold;
  min-width: 30px;
  text-align: center;
}

.char-actions {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
}

.char-actions button {
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
}

#edit-btn {
  background: #f39c12;
  color: white;
}

#save-char-btn {
  background: #27ae60;
  color: white;
}
```

### 12.13 Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 角色名为空 | 保存时提示「请输入角色名」 |
| 角色名已存在 | 覆盖原有数据，提示「角色卡已更新」 |
| 角色名为新名称 | 创建新记录，提示「角色卡已保存」 |
| 选择超过2个豁免 | 阻止选中，提示「豁免检定最多选择2个」 |
| 选择超过4个技能 | 阻止选中，提示「技能最多选择4个」 |
| DM 删除角色卡 | 二次确认后删除，同步更新列表 |
| 未保存就切换角色 | 可选：弹窗提示是否保存 |
| 服务器文件不存在 | 自动创建空的 characters.json |

### 12.14 实现步骤

1. **HTML/CSS**：添加角色卡 Tab 和视图结构
2. **客户端 JS**：实现编辑模式、数值计算、checkbox 限制
3. **服务端**：添加 Socket 事件处理和文件读写
4. **测试**：验证数据持久化、多用户同步、边界情况

### 12.15 UI 优化：统一标题样式与熟练加值

#### 需求背景
1. 角色姓名和血量的标题应使用与「基础属性」相同的蓝色样式，保持视觉一致性
2. 新增「熟练项加值」字段，影响豁免检定和技能的加成计算

#### 改动点

##### 1. 标题样式统一
将角色姓名和血量的 `<label>` 改用 `.section-title` 样式：
```html
<div class="char-field">
    <div class="section-title">角色姓名</div>
    <input type="text" id="char-name" ...>
</div>
```

##### 2. 熟练项加值字段
在「基础属性」section 下方添加新字段：
```html
<div class="char-section proficiency-section">
    <div class="section-title">熟练项加值</div>
    <input type="number" id="proficiency-bonus" class="char-input" disabled value="2">
</div>
```

##### 3. 数据结构扩展
```javascript
{
  name: "V",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,  // 新增字段，默认值为 2
  attributes: { ... },
  savingThrows: [...],
  skills: [...]
}
```

##### 4. 计算逻辑更新
```javascript
// 豁免检定数值（使用熟练加值）
function getSavingThrowValue(attribute) {
  const baseValue = currentCharacter.attributes[attribute];
  const isProficient = currentCharacter.savingThrows.includes(attribute);
  const bonus = currentCharacter.proficiencyBonus || 2;
  return isProficient ? baseValue + bonus : baseValue;
}

// 技能数值（使用熟练加值）
function getSkillValue(skillName) {
  const attr = skillAttributeMap[skillName];
  const baseValue = currentCharacter.attributes[attr];
  const isProficient = currentCharacter.skills.includes(skillName);
  const bonus = currentCharacter.proficiencyBonus || 2;
  return isProficient ? baseValue + bonus : baseValue;
}
```

##### 5. CSS 样式
```css
.proficiency-section {
  text-align: center;
}
.proficiency-section input {
  font-size: 28px;
  width: 60px;
}
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 旧角色卡无 proficiencyBonus 字段 | 默认使用 2 |
| 熟练加值修改后 | 实时更新所有豁免和技能显示 |

### 12.16 Player 自动加载同名角色卡

#### 需求背景
当 Player 点击「角色卡」Tab 时，自动搜索是否有与当前玩家名字相同的角色卡数据。如果有，自动加载并显示；如果没有，显示提示信息。

#### 交互流程
1. Player 点击「角色卡」Tab
2. 客户端发送 `character:load` 请求，参数为当前玩家名 `userName`
3. 服务端查找是否存在同名角色卡
4. 如果找到：返回角色卡数据，自动填充表单
5. 如果未找到：显示提示「未找到角色数据，请点击新建角色卡」

#### 客户端改动

##### switchTab 函数
```javascript
function switchTab(tabName) {
    // ... 原有逻辑 ...

    if (tabName === 'character') {
        socket.emit('character:list');

        // Player 自动加载同名角色卡
        if (!isDM) {
            socket.emit('character:load', { name: userName });
        }
    }
}
```

##### 处理未找到的情况
```javascript
socket.on('character:notFound', () => {
    // 显示提示信息
    showCharToast('未找到角色数据，请点击新建角色卡', true);
    // 隐藏角色卡表单
    document.getElementById('char-sheet').classList.remove('visible');
});
```

#### 服务端改动
```javascript
socket.on('character:load', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const character = getCharacter(data.name);
    if (character) {
        socket.emit('character:loaded', character);
    } else {
        // 区分错误类型：角色卡不存在 vs 自动加载未找到
        socket.emit('character:notFound', { name: data.name });
    }
});
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| Player 名字与角色卡名字相同 | 自动加载该角色卡 |
| Player 名字无对应角色卡 | 显示提示，隐藏表单 |
| Player 手动从下拉框选择其他角色 | 正常加载所选角色 |
| DM 进入角色卡 Tab | 不触发自动加载，仅显示列表 |

### 12.17 侧边栏 HP 显示同步角色卡

#### 需求背景
侧边栏角色列表中的血量显示应从角色卡 JSON 文件读取，而非使用固定默认值。当角色卡更新时，侧边栏 HP 显示也应同步更新。

#### 显示逻辑
1. 当玩家选择颜色后显示角色卡时，查询是否有同名角色卡
2. 如果有：显示角色卡中的 `当前HP/最大HP`
3. 如果没有：显示 `_/_`
4. 当任何角色卡保存/更新时，广播 HP 数据，所有客户端更新对应玩家的 HP 显示

#### 服务端改动

##### 新增函数
```javascript
// 根据玩家名获取角色卡 HP
function getCharacterHP(playerName) {
    const character = getCharacter(playerName);
    if (character && character.hp) {
        return { cur: character.hp.cur, max: character.hp.max };
    }
    return null;
}
```

##### 修改 colorSelected 事件
当玩家选择颜色时，查询并返回其角色卡 HP：
```javascript
socket.on('selectColor', (color) => {
    // ... 原有逻辑 ...

    // 广播时附带角色卡 HP
    const characterHP = getCharacterHP(player.name);
    io.emit('colorSelected', {
        socketId: socket.id,
        name: player.name,
        color,
        characterHP  // 新增：{ cur, max } 或 null
    });
});
```

##### 修改 character:save 事件
角色卡保存后，广播 HP 更新给所有客户端：
```javascript
socket.on('character:save', (data) => {
    // ... 原有保存逻辑 ...

    if (result.success) {
        // 广播 HP 更新（所有客户端检查是否有该玩家在线）
        io.emit('character:hpUpdated', {
            name: data.name,
            hp: data.hp
        });
    }
});
```

##### 修改 joinSuccess
在玩家列表中附带每个已选颜色玩家的角色卡 HP：
```javascript
// 获取玩家列表时附带 HP
const playersWithHP = Array.from(gameState.players.values()).map(p => ({
    ...p,
    characterHP: p.color ? getCharacterHP(p.name) : null
}));

socket.emit('joinSuccess', {
    // ... 其他字段 ...
    gameState: {
        // ...
        players: playersWithHP
    }
});
```

#### 客户端改动

##### 修改 showPlayerCard 函数
```javascript
function showPlayerCard(color, playerName, isMe = false, characterHP = null) {
    const row = document.getElementById(`row-${color}`);
    if (row) {
        row.style.display = 'flex';
        const nameEl = document.getElementById(`name-${color}`);
        nameEl.textContent = isMe ? `${playerName}（这是我）` : playerName;

        // 更新 HP 显示
        const curEl = document.getElementById(`hp-cur-${color}`);
        const maxEl = document.getElementById(`hp-max-${color}`);
        if (characterHP) {
            curEl.textContent = characterHP.cur;
            maxEl.textContent = characterHP.max;
        } else {
            curEl.textContent = '_';
            maxEl.textContent = '_';
        }
    }
}
```

##### 监听 character:hpUpdated
```javascript
socket.on('character:hpUpdated', (data) => {
    // 遍历所有玩家，找到名字匹配的玩家并更新其 HP 显示
    gameState.players.forEach((p, socketId) => {
        if (p.name === data.name && p.color) {
            const curEl = document.getElementById(`hp-cur-${p.color}`);
            const maxEl = document.getElementById(`hp-max-${p.color}`);
            curEl.textContent = data.hp.cur;
            maxEl.textContent = data.hp.max;
        }
    });
});
```

#### Edge Cases

| 场景 | 处理方式 |
|------|----------|
| 玩家无角色卡 | 显示 `_/_` |
| 玩家有角色卡 | 显示角色卡 HP |
| 角色卡保存后 | 实时更新同名玩家的侧边栏 HP |
| 玩家名与角色卡名不一致 | 显示 `_/_`（无法匹配） |
| 多个玩家同名 | 都会更新（极端情况，一般不会发生） |

---

## 第十三阶段：玩家独立地图探索功能

### 13.1 功能概述

允许玩家独立控制地图的缩放和平移，同时能切换查看 DM 保存的不同地图存档。

**背景分析：**
- 当前所有元素（Token、NPC、Drawing）的坐标都是**地图坐标系**（相对于地图图片）
- `mapTransform`（scale, originX, originY）是纯 CSS 显示变换，不影响坐标值
- 因此玩家可以独立控制视角，而棋子位置仍然正确同步

### 13.2 需求详解

| 功能 | 当前状态 | 目标状态 |
|------|----------|----------|
| 玩家查看地图 | 只能看DM当前选择的地图 | 可在侧边栏选择DM保存的任意地图 |
| 玩家缩放地图 | 禁止，跟随DM视角 | 允许独立缩放（滚轮/滑块） |
| 玩家平移地图 | 禁止，跟随DM视角 | 允许独立拖动平移 |
| 棋子/NPC同步 | 正常同步 | 保持正常同步（地图坐标系不变） |
| 绘图同步 | 正常同步 | 保持正常同步（地图坐标系不变） |

### 13.3 实现方案

#### 13.3.1 玩家侧边栏添加地图缩略图列表

**HTML 结构（game.html）：**
```html
<!-- 玩家侧边栏新增区域 -->
<div id="player-map-list" class="player-only">
    <h3>地图存档</h3>
    <div id="player-map-thumbnails"></div>
</div>
```

**CSS 样式：**
```css
#player-map-list {
    padding: 10px;
    border-top: 1px solid rgba(255,255,255,0.1);
}
#player-map-thumbnails {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 200px;
    overflow-y: auto;
}
.player-map-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
    border-radius: 4px;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.2s;
}
.player-map-thumb:hover {
    border-color: #3498db;
}
.player-map-thumb.active {
    border-color: #2ecc71;
}
```

#### 13.3.2 玩家本地 mapTransform 管理

**客户端变量：**
```javascript
// 玩家专用的本地 mapTransform
let playerMapTransforms = {};  // { mapIndex: { scale, originX, originY } }
let currentPlayerMapIndex = -1;  // -1 表示跟随DM当前地图

// 是否使用玩家独立视角（Player only）
let usePlayerView = false;
```

**玩家切换地图：**
```javascript
function playerSelectMap(index) {
    if (userRole !== 'Player') return;

    currentPlayerMapIndex = index;
    const savedMap = savedMaps[index];
    if (!savedMap) return;

    // 加载地图图片
    loadMapFromData(savedMap.mapData, () => {
        // 恢复绘图
        restoreDrawings(savedMap.drawings);
    });

    // 使用或初始化该地图的本地 transform
    if (!playerMapTransforms[index]) {
        playerMapTransforms[index] = { scale: 1, originX: 0, originY: 0 };
    }
    scale = playerMapTransforms[index].scale;
    originX = playerMapTransforms[index].originX;
    originY = playerMapTransforms[index].originY;
    updateTransform();

    usePlayerView = true;
    updatePlayerMapThumbnails();
}
```

#### 13.3.3 玩家地图控制权限修改

**启用玩家缩放/平移：**
```javascript
// 修改 applyPermissions() 函数
function applyPermissions() {
    if (userRole === 'DM') {
        // DM 完整权限...
    } else {
        // Player 权限
        // 移除禁用缩放和平移的代码
        // 保留其他限制（上传地图、锁定、绘图等）
    }
}

// 修改鼠标滚轮事件（允许玩家缩放）
mapFrame.onwheel = (e) => {
    if (userRole === 'Player' && !usePlayerView) return;  // 未启用独立视角时禁止
    // ... 原有缩放逻辑

    // 玩家：保存到本地
    if (userRole === 'Player') {
        savePlayerTransform();
    } else {
        // DM：广播给所有人
        socket.emit('map:transform', { scale, originX, originY });
    }
};

// 修改拖动平移逻辑（允许玩家平移）
// 类似处理...
```

#### 13.3.4 服务端同步逻辑

**新增事件：**
```javascript
// 当 DM 保存地图时，广播给所有玩家更新地图列表
socket.on('map:save', (data) => {
    // ... 原有保存逻辑

    // 广播地图列表更新给所有玩家
    io.emit('map:listUpdated', {
        savedMaps: gameState.savedMaps.map((m, i) => ({
            index: i,
            name: m.name || `地图 ${i + 1}`,
            thumbnail: m.thumbnail  // 可选：缩略图数据
        }))
    });
});
```

**玩家加入时同步地图列表：**
```javascript
// joinSuccess 事件增加 savedMaps 列表
socket.emit('joinSuccess', {
    // ... 原有数据
    savedMaps: gameState.savedMaps.map((m, i) => ({
        index: i,
        name: m.name,
        mapData: m.mapData,  // 完整数据，用于切换
        drawings: m.drawings
    }))
});
```

#### 13.3.5 DM 地图变化时的玩家同步

**场景处理：**

| DM 操作 | 玩家响应 |
|---------|----------|
| DM 切换/加载地图 | 如果玩家 `currentPlayerMapIndex === -1`（跟随模式），同步切换 |
| DM 缩放/平移 | 如果玩家在跟随模式，同步 transform；否则忽略 |
| DM 保存地图 | 更新玩家的地图列表，刷新缩略图 |
| DM 移动棋子 | 所有玩家同步（地图坐标不变） |

**客户端处理：**
```javascript
// 玩家接收 DM 的 transform 广播
socket.on('map:transform', (data) => {
    if (userRole === 'Player' && usePlayerView) {
        // 玩家在独立视角模式，忽略 DM 的 transform
        return;
    }
    scale = data.scale;
    originX = data.originX;
    originY = data.originY;
    updateTransform();
});

// 玩家接收地图列表更新
socket.on('map:listUpdated', (data) => {
    if (userRole !== 'Player') return;
    updatePlayerMapThumbnails(data.savedMaps);
});
```

### 13.4 UI 交互设计

#### 玩家侧边栏布局
```
┌─────────────────────┐
│ 🗺️ 地图存档         │
├─────────────────────┤
│ ┌─────────────────┐ │
│ │ [缩略图1]       │ │  ← 点击切换到该地图
│ │ 地图名称        │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ [缩略图2] ✓     │ │  ← 当前选中（绿色边框）
│ │ 地图名称        │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ [跟随DM]        │ │  ← 特殊选项：跟随DM当前视角
│ └─────────────────┘ │
└─────────────────────┘
```

### 13.5 实现步骤

1. **HTML/CSS**：在玩家侧边栏添加地图列表区域和样式
2. **客户端变量**：添加 `playerMapTransforms`、`currentPlayerMapIndex`、`usePlayerView`
3. **权限修改**：允许玩家在独立视角模式下缩放和平移
4. **地图切换**：实现 `playerSelectMap()` 函数
5. **Transform 保存**：玩家操作时保存到 `playerMapTransforms`
6. **服务端**：`map:save` 时广播 `map:listUpdated`
7. **同步逻辑**：修改 `map:transform` 接收逻辑，支持跟随/独立模式
8. **缩略图**：实现地图缩略图生成和显示

### 13.6 注意事项

- **坐标系统**：所有坐标保持地图坐标系，无需修改
- **棋子同步**：棋子移动广播不受影响，所有玩家都能正确显示
- **绘图同步**：绘图使用地图坐标，在不同 transform 下显示正确
- **性能**：缩略图可使用降采样或懒加载优化
- **存储**：`playerMapTransforms` 只在客户端内存，刷新后重置
