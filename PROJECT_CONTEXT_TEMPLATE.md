# DND 多人协作跑团工具 - 项目上下文模板

## 🎯 项目概述
**DND 多人协作跑团工具** - 一个基于 Web 的实时协作 DND (龙与地下城) 跑团工具，支持 DM 和玩家之间的实时地图共享、棋子移动、绘图标记、角色卡管理和骰子投掷。

**版权信息**: 版权所有 © 2026 Mingwei Yan。保留所有权利。禁止未经同意的商业使用。

## 🏗️ 核心架构

### 技术栈
- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML/CSS/JavaScript + Canvas API
- **数据存储**: JSON 文件 (角色卡) + 文本文件 (笔记)
- **实时通信**: Socket.IO 双向事件驱动

### 关键文件结构
```
coc_app/
├── server.js              # 主服务器 (553行，完整Socket.IO实现)
├── package.json           # 依赖: express, socket.io, nodemon
├── PLAN.md               # 12阶段实施计划 (2218行)
├── README.md             # 完整项目文档
├── LICENSE               # 版权许可证 (禁止商业使用)
├── public/
│   ├── index.html        # 登录/注册页面 (229行)
│   ├── game.html         # 主游戏界面 (2636行，完整功能)
│   ├── css/              # 空目录
│   └── js/               # 空目录
└── data/
    ├── characters.json   # 角色卡数据 (3个示例角色)
    └── notes.txt         # 共享笔记内容
```

## ✨ 已实现功能

### 1. 用户系统
- DM/玩家双角色，DM密码: `12138`
- 颜色选择系统 (橙、黄、绿、蓝、紫)
- 实时玩家列表与HP同步

### 2. 地图系统
- 实时地图上传/同步 (Base64)
- 地图缩放/平移 (仅DM)
- 地图存档管理 (4槽位，save-or-update逻辑)
- 自动状态保存 (增量更新)

### 3. 绘图工具
- 画笔、矩形、橡皮擦
- 6种颜色选择
- 实时绘图同步

### 4. 棋子系统
- 玩家棋子 (彩色三角形)
- NPC系统 (5种颜色，双击删除)
- 权限控制: DM控制所有，玩家仅控制自己

### 5. 角色卡系统
- D&D 5e标准角色卡
- 六大属性、豁免检定(最多2个)、技能(最多4个)
- 熟练项加值计算
- 自动加载同名角色卡

### 6. 其他功能
- 共享笔记 (实时协作编辑)
- 骰子系统 (D4-D100)
- 实时聊天
- DM Toast通知

## 🔌 Socket.IO 关键事件

### 客户端 → 服务端
- `join` - 加入游戏
- `selectColor` - 选择颜色
- `map:load` - 上传地图
- `map:save` - 保存地图
- `token:move` - 移动棋子
- `draw:path` - 绘图操作
- `character:save` - 保存角色卡

### 服务端 → 客户端
- `joinSuccess` - 加入成功 + 游戏状态
- `colorSelected` - 颜色选择成功
- `map:loadedSaved` - 地图加载完成
- `token:move` - 棋子移动同步
- `dice:result` - 骰子结果
- `character:loaded` - 角色卡加载完成

## 📊 数据模型摘要

### 游戏状态 (server.js:108-119)
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, role, color }>,
  mapData: "base64_string",
  mapTransform: { scale, originX, originY },
  isLocked: boolean,
  tokens: { color: { x, y } },
  drawings: Array<DrawingData>,
  npcs: Array<{ id, x, y, color }>,
  notes: "string",
  savedMaps: Array<MapArchive>
}
```

### 角色卡结构 (data/characters.json)
```javascript
{
  name: "角色名",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,
  attributes: { strength, dexterity, constitution, intelligence, wisdom, charisma },
  savingThrows: ["dexterity", "intelligence"],  // 最多2个
  skills: ["stealth", "perception"]             // 最多4个
}
```

## 🎨 UI 结构 (game.html)

### 主要区域
1. **侧边栏** (左侧): DM工具、玩家列表、聊天
2. **主视图区**: 地图标签页、笔记标签页、角色卡标签页
3. **右侧栏**: 骰子系统

### 权限控制
- `.dm-only` CSS类: 仅DM可见
- 玩家限制: 不能缩放/平移地图，只能移动自己棋子

## 🚀 开发状态
- ✅ 所有12阶段计划功能已实现
- ✅ 生产就绪，有完整错误处理
- ✅ 实时同步工作正常
- ✅ 数据持久化工作正常

## 📝 使用说明

### 启动开发
```bash
npm install
npm run dev  # 访问 http://localhost:3000
```

### 生产部署
```bash
npm start
```

## 🔧 最近修改
1. 创建了完整的 README.md 文档
2. 更新了 LICENSE 文件，明确版权归属和商业使用限制
3. 修正了版权年份为2026年

---

## 📋 新任务模板使用说明

当开启新任务时，复制以下内容作为初始消息：

```
【项目上下文】DND 多人协作跑团工具

这是一个完整的实时协作DND跑团Web应用，已实现所有核心功能。项目使用Node.js + Express + Socket.IO架构。

关键文件：
- server.js (553行): 完整的Socket.IO服务器实现
- public/game.html (2636行): 主游戏界面
- public/index.html: 登录页面
- data/characters.json: 角色卡数据
- data/notes.txt: 共享笔记

当前任务需求：[在此描述你的具体需求]

请基于现有代码结构进行开发/修改，保持代码风格一致。
```

**注意**: 对于复杂任务，建议先使用 `read_file` 工具查看相关文件的具体实现。