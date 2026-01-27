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

## 实施时间线

| 阶段 | 内容 | 建议顺序 |
|------|------|----------|
| 1 | 项目初始化 + 服务器 | 第1步 |
| 2 | 用户认证 | 第2步 |
| 3 | 权限系统 | 第3步 |
| 4 | 实时同步 | 第4步 |
| 5 | UI 改造 | 第5步 |
| 6 | 部署 | 第6步 |

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

