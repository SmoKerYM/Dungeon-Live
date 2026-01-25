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

