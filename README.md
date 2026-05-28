[English Version](README-en.md)

# DND 多人协作跑团工具

一个基于 Web 的实时协作 DND (龙与地下城) 跑团工具，支持 DM (地下城主) 和玩家之间的实时地图共享、棋子移动、绘图标记、角色卡管理和骰子投掷。

**版权所有 © 2026 Mingwei Yan。保留所有权利。**

![DND 跑团工具界面](https://img.shields.io/badge/状态-生产就绪-green)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8+-blue)
![License](https://img.shields.io/badge/许可证-个人使用-blue)

## ✨ 功能特性

### 🗺️ 地图系统（Konva 网格世界）
- **共享网格世界** - 所有人看同一个世界，DM 负责管理地图实例，玩家仅可观看
- **地图资产上传** - DM 上传图片自动存入资产库并放置到世界中央（默认 20 格宽）
- **地图资产库** - DM 侧已上传地图以缩略图列表展示，点击缩略图聚焦视口到对应地图实例（无实例时自动放置并提示）；× 删除资产时联动移除所有网格上的对应实例；玩家也有只读地图缩略图库，点击同样聚焦视口
- **地图绑定联动** - 每张地图实例默认开启绑定（左下角 📌 按钮控制），移动/缩放地图时内部的棋子、NPC、笔迹、矩形、迷雾同步联动；关闭后地图独立移动
- **拖动吸附** - 地图实例拖动后自动对齐网格交点
- **缩放调整** - 右下角拖拽手柄调整地图宽度（保持宽高比，吸附到整数格）
- **锁定/删除** - 支持锁定防误操作，悬停显示控件
- **独立视口** - 每个客户端独立控制自己的缩放/平移，不广播给他人

### 🎭 角色与权限
- **DM/玩家双角色系统** - DM 拥有完整控制权，玩家权限受限
- **颜色选择系统** - 玩家选择专属颜色标识（橙/黄/绿/蓝/紫）
- **实时玩家列表** - 显示在线玩家及其角色信息
- **HP 同步显示** - 侧边栏实时显示角色血量，悬停棋子也可查看

### 🖌️ 绘图工具
- **DM 悬浮工具条** - Canvas 左上角竖向工具条（仅 DM 可见）：移动 / 画笔 / 矩形 / 橡皮 / 迷雾 / 撤销 / 重做
- **颜色选择器** - 画笔和矩形工具激活时右侧展开颜色面板（黑/白/红/绿 + 自定义）；末次颜色持久化到服务端 `data/ui_prefs.json`
- **自由笔迹** - 画笔工具在世界坐标上自由绘画，不吸附，实时广播
- **矩形工具** - 四顶点吸附到网格的方框绘制
- **橡皮擦** - 点击删除单条笔迹或矩形；右侧弹出菜单含"清除所有笔迹"/"清除所有玩家"/"清除所有NPC"三个批量按钮

### 🧩 棋子系统
- **玩家棋子** - Konva 圆形棋子，拖动吸附网格，悬停显示 HP 和玩家名
- **NPC 系统** - DM 可生成多种颜色的 NPC（圆角矩形），双击删除
- **权限隔离** - 玩家只能拖动自己颜色的棋子，DM 可操作全部
- **批量清除** - 分别清除玩家棋子或 NPC

### 🌫️ 战争迷雾
- **迷雾工具** - DM 在工具条激活迷雾工具，拖拽绘制矩形遮罩覆盖地图区域
- **视觉分层** - DM 看到浅灰半透明矩形（可透视地图内容）；玩家看到深色马赛克，完全遮挡下方内容
- **交互** - DM 双击迷雾矩形即可删除（揭示下方地图）；玩家无法操作迷雾
- **绑定联动** - 迷雾随所在地图移动/缩放同步位移（基于 8-C 强制联动，无需 isBound 开关）
- **持久化** - 服务器重启后保留（`world.fogRects` 随世界状态落盘）
- **撤销支持** - Ctrl+Z 可撤销添加/删除迷雾操作

### ↩️ 撤销/重做
- **Ctrl/Cmd+Z** 撤销，**Ctrl/Cmd+Shift+Z** 重做（仅 DM）
- 覆盖所有世界编辑：地图放置/移动/缩放/锁定、棋子移动、笔迹/矩形
- 最多 20 步，服务端内存维护，重启后清空

### 📋 角色卡系统
- **D&D 5e 标准角色卡** - 支持六大属性、豁免检定、技能
- **特质记录** - 支持添加多条角色特质（名称+详细描述）
- **熟练项加值** - 自动计算熟练项加成
- **数据持久化** - 角色卡保存到 JSON 文件
- **自动加载** - 玩家自动加载同名角色卡

### 📝 共享笔记
- **实时协作编辑** - 所有用户可同时编辑笔记
- **登场人物记录** - 右侧表格记录人物名字和信息，独立持久化
- **防抖同步** - 500ms 防抖减少网络流量

### 🎲 骰子系统
- **标准骰子集** - D4, D6, D8, D10, D12, D20, D100（右侧骰子栏，含滚动动画）
- **聊天框掷骰** - 输入 `/d20`、`/2d6+3` 等指令自动掷骰，显示完整拆解式
- **结果广播** - 投掷结果实时广播给所有玩家

### 💬 聊天系统
- **实时聊天** - 支持文本消息交流
- **角色标识** - DM 和玩家消息不同颜色显示
- **聊天历史** - 服务端保留最近 100 条聊天/骰子记录，重连后自动回放

## 🚀 快速开始

### 环境要求
- Node.js 18 或更高版本
- npm 或 yarn

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd coc_app
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

4. **访问应用**
   - 打开浏览器访问 `http://localhost:3000`
   - 首次访问会显示登录页面

### 生产部署
```bash
npm start
```

## 🎮 使用指南

### 首次使用
1. **选择身份**
   - **DM (地下城主)**：需要密码 `12138`，拥有完整控制权
   - **Player (玩家)**：无需密码，权限受限

2. **玩家颜色选择**
   - 玩家首次加入需要选择颜色标识
   - 已占用的颜色不可选

### 核心操作

#### DM 操作
- **上传地图**：左侧边栏点 **＋ 添加地图**
- **聚焦地图**：点击资产库缩略图，视口聚焦到该地图实例（无实例时自动放置并提示）
- **拖动/缩放地图**：移动工具下拖动地图实例，右下角手柄调整尺寸
- **锁定/删除**：悬停地图出现控件，锁定后无法拖动
- **删除资产**：点缩略图 × → 确认 → 同步删除网格上所有对应实例
- **绑定联动**：地图左下角 📌 按钮控制绑定状态；开启时移动/缩放地图内部对象跟随
- **绘图工具**：切换画笔/矩形/橡皮（工具条或工具栏），在空白处绘制；移动工具时拖动空白处平移
- **战争迷雾**：激活迷雾工具，拖拽绘制遮罩矩形；双击迷雾矩形删除
- **NPC 管理**：点击 NPC 颜色块生成，双击 NPC 删除
- **撤销/重做**：Ctrl+Z / Ctrl+Shift+Z，或点击工具条中的撤销/重做按钮
- **视口控制**：滚轮缩放（0.2x~5x），移动工具下拖动空白处平移

#### 玩家操作
- **视口控制**：滚轮缩放，拖动空白处平移（独立，不影响他人）
- **移动棋子**：拖动自己颜色的棋子（松手自动对齐网格）
- **生成棋子**：点击侧边栏自己颜色的按钮
- **投掷骰子**：点击右侧骰子栏，或在聊天框输入掷骰指令
- **编辑角色卡**：切换到角色卡标签页

#### 聊天框掷骰语法
| 输入 | 含义 | 示例输出 |
|------|------|---------|
| `/d20` | 1 个 20 面骰 | `投掷了 d20，结果是 15` |
| `/2d6` | 2 个 6 面骰 | `投掷了 2d6，结果是 3 + 5 = 8` |
| `/2d4+3` | 2d4 加 3 | `投掷了 2d4+3，结果是 2 + 3 + 3 = 8` |
| `/d8-1` | 1d8 减 1 | `投掷了 d8-1，结果是 6 - 1 = 5` |

### 标签页系统
- **地图**：主游戏界面，显示 Konva 网格世界
- **笔记**：左侧共享笔记 + 右侧登场人物记录表
- **角色卡**：角色卡创建和编辑界面（含特质记录）

## 🏗️ 项目结构

```
coc_app/
├── server.js              # 主服务器文件 (Express + Socket.IO)
├── package.json           # 项目依赖配置
├── README.md              # 项目说明文档（中文）
├── README-en.md           # 项目说明文档（英文）
├── public/                # 静态文件目录
│   ├── index.html         # 登录页面
│   └── game.html          # 主游戏界面 (CSS+JS+Konva 内联)
├── data/                  # 数据存储目录
│   ├── characters.json        # 角色卡数据
│   ├── characters_notes.json  # 登场人物记录
│   ├── chat_history.json      # 聊天/骰子历史（最近 100 条）
│   ├── map_assets.json        # 地图图片资产（Base64）
│   ├── world.json             # 世界状态（地图实例、棋子、笔迹、迷雾等）
│   ├── ui_prefs.json          # DM 绘图颜色偏好（penColor/rectColor）
│   └── notes.txt              # 共享笔记
└── images/                # （已废弃）
```

## 🔧 技术架构

### 后端技术栈
- **Node.js** - JavaScript 运行时
- **Express 5** - Web 服务器框架
- **Socket.IO 4** - 实时双向通信
- **文件系统** - JSON/文本文件持久化

### 前端技术栈
- **原生 HTML/CSS/JavaScript** - 无框架依赖
- **Konva.js 9** - 网格世界渲染（地图实例、棋子、NPC、笔迹、矩形）
- **Session Storage** - 客户端状态管理

### 架构特点
- **服务端世界权威**：`gameState.world` 为唯一数据源，所有 mutation 经由 Socket 事件，DM Guard 保护
- **独立视口**：缩放/平移仅本地生效，不广播
- **服务端 undo/redo**：操作历史在服务端维护，撤销/重做结果广播给所有人

## 📊 数据模型

### 游戏状态（server.js gameState）
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, color, role }>,
  notes: "string",
  characterNotes: [{ name, info }],
  chatHistory: [{ type: 'chat'|'dice', name, role, ..., timestamp }],  // 最多 100 条
  mapAssets: { "asset_xxx": { base64, originalWidth, originalHeight } },
  uiPrefs: { penColor: "#cc0000", rectColor: "#cc0000" },
  world: {
    placedMaps:   [{ id, assetId, gridX, gridY, gridWidth, isLocked, isBound }],
    tokens:       [{ id, color, gridX, gridY }],
    npcs:         [{ id, gridX, gridY, color }],
    freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
    rects:        [{ id, gridX, gridY, gridW, gridH, color, strokeWidth }],
    fogRects:     [{ id, x, y, w, h }]
  }
}
```

> **坐标系**：1 格 = 50px（zoom=1），所有对象使用 `gridX/gridY` 浮点坐标。

### 角色卡结构
```javascript
{
  name: "角色名",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,
  attributes: { strength, dexterity, constitution, intelligence, wisdom, charisma },
  savingThrows: ["dexterity"],  // 最多 2 个
  skills: ["stealth"],          // 最多 4 个
  feats: [{ name: "特质名", description: "详细描述" }]
}
```

## 🔌 Socket.IO 事件

### 客户端 → 服务端
| 命名空间 | 事件 |
|----------|------|
| Auth | `join`, `selectColor` |
| MapAsset | `mapAsset:upload`, `mapAsset:fetch`, `mapAsset:remove` |
| PlacedMap | `placedMap:add`, `placedMap:move`, `placedMap:resize`, `placedMap:setLock`, `placedMap:setBound`, `placedMap:remove` |
| Token | `token:spawn`, `token:move`, `token:clearAll` |
| NPC | `npc:spawn`, `npc:move`, `npc:remove`, `npc:clearAll` |
| Draw | `draw:freeStroke`, `draw:rect`, `draw:liveStroke`, `draw:remove`, `draw:clearAll` |
| Fog | `fog:add`, `fog:remove` |
| History | `history:undo`, `history:redo` |
| Character | `character:list`, `character:load`, `character:save` |
| Other | `chat:message`, `dice:roll`, `notes:update`, `characterNotes:update`, `uiPrefs:save` |

### 服务端 → 客户端
| 事件 | 说明 |
|------|------|
| `joinSuccess` | 加入成功，含完整世界状态快照 |
| `mapAsset:uploaded` | 资产上传确认 |
| `mapAsset:fetched` | 返回 Base64 资产数据 |
| `mapAsset:removed` | 资产删除广播 |
| `placedMap:added/moved/resized/lockSet/boundSet/removed` | 地图实例变更广播 |
| `fog:added/removed` | 迷雾矩形变更广播 |
| `token:spawn/move/clearAll/remove` | 棋子状态广播 |
| `npc:spawn/move/remove/clearAll` | NPC 状态广播 |
| `draw:freeStroke/rect/liveStroke/remove/clearAll` | 绘图广播 |
| `world:sync` | undo/redo 后完整世界快照广播 |
| `dice:result` | 骰子结果广播 |

## 🚢 部署选项

### 本地开发
```bash
npm run dev  # 使用 nodemon 热重载
```

### 生产环境
```bash
npm start    # 使用 node 运行
```

### 云平台部署

#### Render（推荐）
1. 创建 Web Service，连接 GitHub 仓库
2. **必须**挂载 Persistent Disk 到 `/data`，否则重启后数据丢失

#### Railway
```bash
npm install -g @railway/cli && railway login && railway init && railway up
```

#### AWS EC2
1. 启动 t2.micro 实例，安装 Node.js
2. 使用 PM2 保持进程运行，配置 Nginx 反向代理

## 🔒 安全说明

- **DM 密码保护**：DM 角色需要密码 `12138`
- **权限隔离**：服务端所有 DM 操作均有 Guard 保护，玩家无法触发
- **会话管理**：使用 sessionStorage 管理用户状态

## 🐛 故障排除

1. **无法连接服务器** — 检查 `npm run dev` 是否运行，检查防火墙端口 3000
2. **地图上传失败** — 确保图片不超过 50MB，格式支持 JPG/PNG
3. **实时同步延迟** — 检查网络连接
4. **角色卡无法保存** — 检查 `data/` 目录写入权限，角色名不能为空
5. **生产环境重启后世界状态丢失** — 确认 `/data` 挂载了 Persistent Disk

## 📄 版权与许可证

**版权所有 © 2026 Mingwei Yan。保留所有权利。**

1. **个人使用**：允许个人非商业用途使用、修改和分发
2. **商业使用**：**禁止**未经作者明确书面同意的任何商业用途
3. **修改与分发**：可以修改代码，但必须保留原始版权声明

查看 [LICENSE](LICENSE) 文件了解完整条款。

## 🙏 致谢

- **D&D 5e** - 角色卡系统基于第五版规则
- **Konva.js** - 网格世界渲染引擎
- **Roll20** - UI 设计灵感来源
- **Socket.IO** - 实时通信基础
- **所有测试玩家** - 宝贵的反馈和建议

---

**开始你的冒险之旅吧！** 🐉⚔️🛡️
