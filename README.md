# DND 多人协作跑团工具

一个基于 Web 的实时协作 DND (龙与地下城) 跑团工具，支持 DM (地下城主) 和玩家之间的实时地图共享、棋子移动、绘图标记、角色卡管理和骰子投掷。

**版权所有 © 2026 Mingwei Yan。保留所有权利。**

![DND 跑团工具界面](https://img.shields.io/badge/状态-生产就绪-green)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8+-blue)
![License](https://img.shields.io/badge/许可证-个人使用-blue)

## ✨ 功能特性

### 🗺️ 地图系统
- **实时地图上传与同步** - DM 可上传地图图片，所有玩家实时查看
- **地图缩放与平移** - DM 可自由缩放/拖动地图，玩家跟随视图
- **地图存档管理** - 支持保存多张地图状态，快速切换场景
- **自动状态保存** - 地图状态变更自动保存，无需手动操作

### 🎭 角色与权限
- **DM/玩家双角色系统** - DM 拥有完整控制权，玩家权限受限
- **颜色选择系统** - 玩家选择专属颜色标识
- **实时玩家列表** - 显示在线玩家及其角色信息
- **HP 同步显示** - 侧边栏实时显示角色血量

### 🖌️ 绘图工具
- **多种绘图工具** - 画笔、矩形、橡皮擦
- **颜色选择器** - 6 种预设颜色，圆形/方形区分
- **实时绘图同步** - 所有绘图操作实时同步给所有用户
- **清空画布** - DM 可一键清空所有笔迹

### 🧩 棋子系统
- **玩家棋子** - 彩色三角形棋子，玩家只能移动自己的棋子
- **NPC 系统** - DM 可生成多种颜色的 NPC 棋子
- **双击删除** - DM 可双击删除单个 NPC
- **批量清除** - 分别清除玩家棋子或 NPC

### 📋 角色卡系统
- **D&D 5e 标准角色卡** - 支持六大属性、豁免检定、技能
- **熟练项加值** - 自动计算熟练项加成
- **数据持久化** - 角色卡保存到 JSON 文件
- **自动加载** - 玩家自动加载同名角色卡

### 📝 共享笔记
- **实时协作编辑** - 所有用户可同时编辑笔记
- **防抖同步** - 500ms 防抖减少网络流量
- **持久化存储** - 笔记保存到文本文件

### 🎲 骰子系统
- **标准骰子集** - D4, D6, D8, D10, D12, D20, D100
- **动画效果** - 投掷时有滚动动画
- **结果广播** - 投掷结果实时广播给所有玩家

### 💬 聊天系统
- **实时聊天** - 支持文本消息交流
- **角色标识** - DM 和玩家消息不同颜色显示
- **系统消息** - 重要操作自动生成系统消息

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

3. **地图上传 (DM)**
   - 点击侧边栏地图区域的 `+` 号
   - 选择地图图片文件 (支持 JPG, PNG 等格式)
   - 地图会自动加载并保存到第一个槽位

### 核心操作

#### DM 操作
- **地图控制**：鼠标滚轮缩放，拖拽平移
- **绘图工具**：选择工具后在地图上绘制
- **NPC 管理**：点击 NPC 颜色块生成，双击删除
- **地图保存**：点击左上角 💾 按钮手动保存
- **地图锁定**：点击 🔓 按钮锁定/解锁地图

#### 玩家操作
- **查看地图**：只能查看，不能缩放/平移
- **移动棋子**：只能拖动自己颜色的棋子
- **生成棋子**：点击侧边栏自己颜色的按钮
- **投掷骰子**：点击右侧骰子栏
- **编辑角色卡**：切换到角色卡标签页

### 标签页系统
- **地图**：主游戏界面，显示地图和棋子
- **笔记**：共享笔记编辑区域
- **角色卡**：角色卡创建和编辑界面

## 🏗️ 项目结构

```
coc_app/
├── server.js              # 主服务器文件 (Express + Socket.IO)
├── package.json           # 项目依赖配置
├── README.md             # 项目说明文档
├── PLAN.md               # 详细实施计划 (12阶段)
├── public/               # 静态文件目录
│   ├── index.html        # 登录/注册页面
│   ├── game.html         # 主游戏界面 (2636行)
│   ├── css/              # 样式文件目录
│   └── js/               # JavaScript 文件目录
├── data/                 # 数据存储目录
│   ├── characters.json   # 角色卡数据 (JSON格式)
│   └── notes.txt         # 共享笔记内容
└── coc_app.html          # 原始单页面版本
```

## 🔧 技术架构

### 后端技术栈
- **Node.js** - JavaScript 运行时
- **Express** - Web 服务器框架
- **Socket.IO** - 实时双向通信
- **文件系统** - 数据持久化存储

### 前端技术栈
- **原生 HTML/CSS/JavaScript** - 无框架依赖
- **Canvas API** - 绘图功能
- **Session Storage** - 客户端状态管理

### 实时通信
- **事件驱动架构** - 基于 Socket.IO 事件
- **状态同步** - 游戏状态实时同步
- **增量更新** - 地图状态自动保存优化

## 📊 数据模型

### 游戏状态
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

### 角色卡结构
```javascript
{
  name: "角色名",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,
  attributes: {
    strength: 0,      // 力量
    dexterity: 0,     // 敏捷
    constitution: 0,  // 体质
    intelligence: 0,  // 智力
    wisdom: 0,        // 感知
    charisma: 0       // 魅力
  },
  savingThrows: ["dexterity", "intelligence"],  // 最多2个
  skills: ["stealth", "perception"]             // 最多4个
}
```

## 🔌 Socket.IO 事件

### 客户端 → 服务端
| 事件 | 数据 | 说明 |
|------|------|------|
| `join` | `{ name, role, password }` | 加入游戏 |
| `selectColor` | `color` | 选择颜色 |
| `map:load` | `base64_data` | 上传地图 |
| `map:save` | `MapArchive` | 保存地图 |
| `token:move` | `{ color, x, y }` | 移动棋子 |
| `draw:path` | `DrawingData` | 绘图操作 |
| `character:save` | `CharacterData` | 保存角色卡 |

### 服务端 → 客户端
| 事件 | 数据 | 说明 |
|------|------|------|
| `joinSuccess` | `GameState` | 加入成功 |
| `colorSelected` | `{ name, color }` | 颜色选择成功 |
| `map:loadedSaved` | `MapArchive` | 地图加载完成 |
| `token:move` | `{ color, x, y }` | 棋子移动同步 |
| `dice:result` | `{ player, sides, result }` | 骰子结果 |
| `character:loaded` | `CharacterData` | 角色卡加载完成 |

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

#### Railway (推荐)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

#### AWS EC2
1. 启动 t2.micro 实例 (免费套餐)
2. 安装 Node.js
3. 使用 PM2 保持进程运行
4. 配置 Nginx 反向代理

#### Render
1. 创建 Web Service
2. 连接 GitHub 仓库
3. 自动部署

## 🔒 安全说明

- **DM 密码保护**：DM 角色需要密码 `12138`
- **权限隔离**：玩家无法执行 DM 专属操作
- **输入验证**：服务端验证所有客户端输入
- **会话管理**：使用 sessionStorage 管理用户状态

## 📈 性能优化

- **增量更新**：地图状态变更时只同步变化部分
- **防抖处理**：笔记编辑使用 500ms 防抖
- **缩略图生成**：地图存档使用压缩缩略图
- **脏标记检测**：避免不必要的状态保存

## 🐛 故障排除

### 常见问题

1. **无法连接服务器**
   - 检查服务器是否运行 `npm run dev`
   - 检查防火墙端口 3000

2. **地图上传失败**
   - 确保图片大小不超过 50MB
   - 检查文件格式 (支持 JPG, PNG, GIF)

3. **实时同步延迟**
   - 检查网络连接
   - 减少同时在线用户数

4. **角色卡无法保存**
   - 检查 `data/` 目录写入权限
   - 确保角色名不为空

### 日志查看
```bash
# 查看服务器日志
tail -f server.log

# 查看实时连接状态
# 服务器控制台会显示连接/断开信息
```

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 版权与许可证

**版权所有 © 2026 Mingwei Yan。保留所有权利。**

### 使用条款
1. **个人使用**：允许个人非商业用途使用、修改和分发
2. **商业使用**：**禁止**未经作者明确书面同意的任何商业用途
3. **修改与分发**：可以修改代码，但必须保留原始版权声明
4. **责任限制**：作者不对使用本软件造成的任何损害负责

### 完整条款
查看 [LICENSE](LICENSE) 文件了解完整条款和条件。

## 🙏 致谢

- **D&D 5e** - 角色卡系统基于第五版规则
- **Roll20** - UI 设计灵感来源
- **Socket.IO** - 实时通信基础
- **所有测试玩家** - 宝贵的反馈和建议

## 📞 支持与反馈

如有问题或建议，请：
1. 查看 [PLAN.md](PLAN.md) 了解详细实施计划
2. 检查现有 Issues
3. 提交新的 Issue 或 Pull Request

---

**开始你的冒险之旅吧！** 🐉⚔️🛡️