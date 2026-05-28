# Plan: 重构地图系统为 Konva 网格世界

## 背景与决策

本计划将地图子系统从 "全屏 `<img>` + DOM 棋子 + 原生 Canvas 笔迹" 重构为 Konva 驱动的网格世界（VTT 范式）。

**已确定的核心决策：**
- **方案 A（共享世界）**：所有人看同一个 "世界"，DM 可以增删地图实例，玩家无法操作画布上的地图。每个观察者的视口（缩放/平移）独立，不广播。
- **网格尺寸**：1 格 = 50px（zoom=1.0 时）。所有对象坐标用 `gridX/gridY`（浮点），渲染时乘以 `gridSizePx * zoom`。
- **网格渲染**：~~CSS `background-image` 覆盖层~~ → **改为 Konva 原生 `gridLayer`**（Phase 2 期间变更）。CSS overlay 与 Konva canvas 是两套独立渲染管线，缩放时会出现地图边缘与网格线肉眼可见的错位；改为在最底层 `gridLayer` 用 `Konva.Line` 按可视范围绘制网格（`strokeWidth = 1/scale`），与地图共享同一 stage 变换，缩放/平移永不错位。
- **不支持地图旋转**。
- **包含撤销/重做**。
- **吸附规则**：棋子、NPC、矩形吸附；自由笔迹不吸附；地图实例放置/拖动吸附。

**Konva 引入方式**：CDN（不引 npm），保持纯静态前端结构。

**Layer 结构（2 层）**：
- `staticLayer`：放置的地图实例 + 已确定的笔迹/矩形/棋子位置
- `dynamicLayer`：正在拖动/绘制的对象

**新增数据模型（最终形态，Phase 3 引入）：**

```javascript
mapAssets: {        // 图片资产库（落盘）
  "asset_xxx": { base64, originalWidth, originalHeight }
}
world: {            // 世界状态（落盘）
  placedMaps: [{ id, assetId, gridX, gridY, gridWidth, isLocked }],
  tokens:     [{ id, color, gridX, gridY }],
  npcs:       [{ id, gridX, gridY, color }],
  freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
  rects:        [{ id, gridX, gridY, gridW, gridH, color }]
}
```

---

## Phase 0: 准备工作 & 协议设计

**目标 / Goal**：在 game.html 中引入 Konva CDN，准备好新世界容器的占位 DOM 和 CSS，确定服务端事件协议命名，但不改变任何现有功能。

**前置条件 / Prerequisites**：当前 `main` 分支干净状态（[server.js](server.js)、[public/game.html](public/game.html)）。

**交付物 / Deliverables**：
- [public/game.html](public/game.html)：
  - `<head>` 中加入 `<script src="https://unpkg.com/konva@9/konva.min.js"></script>`
  - 新增一个 `<div id="world-container">`，内含 `<div id="konva-stage">` 和 `<div id="grid-overlay">`，默认 `display: none`
  - 对应的 CSS：grid-overlay 用 background-image 画网格、pointer-events: none、绝对定位覆盖 stage
- [plan-extend.md](plan-extend.md)：在文档底部追加 "事件协议对照表" 章节，列出新旧事件名映射

**验收标准 / Acceptance criteria**：
- 浏览器加载 game.html，DevTools Console 中 `typeof Konva === 'function'` 为 true
- 现有所有功能（地图上传、棋子、笔迹、聊天、骰子、笔记、角色卡）行为**完全不变**
- 新增 DOM 元素隐藏，不影响视觉

**本阶段不做 / Out of scope**：任何服务端改动；任何 Konva Stage 实例化；任何旧代码删除。

---

## Phase 1: Konva 世界基础设施（纯前端，无服务端改动）

**目标 / Goal**：建立一个空白的 Konva 世界，支持鼠标滚轮以光标为中心缩放、空白处拖动平移，网格随之缩放/平移；通过一个临时按钮在新旧地图视图之间切换，便于并行验证。

**前置条件 / Prerequisites**：Phase 0 完成（Konva CDN 已加载，[public/game.html](public/game.html) 内 world-container 占位已就绪）。

**交付物 / Deliverables**：
- [public/game.html](public/game.html)：
  - 实例化 `Konva.Stage`，初始尺寸跟随 world-container
  - 创建 `staticLayer` 和 `dynamicLayer`，加入 stage
  - 实现 `wheel` 事件处理：以光标位置为锚点缩放（修改 stage.scaleX/Y 和 stage.x/y）
  - 实现空白处按住左键拖动平移（DM 和 Player 都可以）
  - 监听 stage transform 变化，同步更新 `#grid-overlay` 的 `background-size`（= `50 * zoom`）和 `background-position`（= `stage.x % size, stage.y % size`）
  - 临时切换按钮（仅开发用）：切换显示旧地图视图 / 新世界视图
  - 工具函数：`worldToGrid(x, y)`、`gridToWorld(gx, gy)`、`snapToGrid(gx, gy)`、`getMousePosInWorld()`

**验收标准 / Acceptance criteria**：
- 点击临时按钮切换到新视图后，能看到网格背景
- 鼠标滚轮缩放时，光标下的网格交点位置在屏幕上保持不动（以鼠标为中心缩放正确）
- 缩放范围限制在 0.2x ~ 5x 之间
- 鼠标拖拽空白处平移，网格背景跟随移动且无跳变
- 切回旧视图，旧地图功能仍正常

**本阶段不做 / Out of scope**：任何地图/棋子/笔迹的 Konva 渲染；服务端任何改动；旧地图代码删除。

---

## Phase 2: DM 地图放置 + 拖动吸附 + 锁定（仍纯前端）

**目标 / Goal**：DM 可以从侧边栏点击 "添加地图" 上传图片，图片以 Konva.Image 形式放在世界中（默认 20 格宽），可拖动且吸附到网格，左上角有锁定 icon，锁定后无法拖动；DM 可以删除放置的地图。**所有数据本地存储**，刷新会丢失，下一阶段才接服务端。

**前置条件 / Prerequisites**：Phase 1 完成（[public/game.html](public/game.html) 中 Konva Stage + 网格 + 缩放平移可用）。

**交付物 / Deliverables**：
- [public/game.html](public/game.html)：
  - 侧边栏新增 "添加地图" 按钮（仅 `.dm-only` 显示），文件选择器读取图片 → 转 Base64 → 在世界中央创建 Konva.Image
  - 客户端数据结构：`localPlacedMaps = [{ id, assetId, gridX, gridY, gridWidth, isLocked }]`，`localMapAssets = { assetId: { base64, originalWidth, originalHeight } }`（与 Phase 3 服务端模型对齐）
  - 拖动结束时调用 `snapToGrid` 调整 `gridX/Y`
  - 每张已放置地图**左上角**浮一个锁定 icon（DOM 元素，根据 Konva.Image 的屏幕坐标定位，缩放/平移时跟随更新）
  - 锁定状态下：`konvaImage.draggable(false)`、icon 切换为已锁图标
  - 选中地图（点击）时**右上角**显示 "删除" 按钮（DM 用 DOM 浮层，与锁定 icon 同步跟随），点击后从 localPlacedMaps 移除并销毁 Konva 节点
  - 玩家视角：所有 Konva.Image 设置 `listening: false`，玩家无法选中、拖动、删除

**验收标准 / Acceptance criteria**：
- DM 上传一张图片后，图片出现在世界中央，宽度恰好 20 格（高度按原图宽高比）
- 拖动地图后，松手时左上角对齐到最近的格子交点
- 点击锁定 icon 后，拖动地图无效果；再次点击解锁
- 切换为玩家身份（开两个浏览器窗口测试），点击地图无任何反应
- 缩放/平移时，锁定 icon 始终贴在每张地图的左上角

**本阶段不做 / Out of scope**：服务端持久化或广播；多个地图实例的层级排序（z-index）UI；棋子/笔迹/矩形；旧地图代码删除。

---

## Phase 3: 服务端协议改造 + 资产/世界落盘

**目标 / Goal**：把 Phase 2 的本地 `localPlacedMaps` / `localMapAssets` 升级为服务端权威状态，地图资产和世界状态分别落盘，所有客户端通过 Socket.IO 同步；玩家加入时拉取完整世界数据并渲染。

**前置条件 / Prerequisites**：Phase 2 完成（[public/game.html](public/game.html) 中本地地图放置/拖动/锁定/删除可用）。

**交付物 / Deliverables**：
- [server.js](server.js)：
  - 新增文件路径常量：`MAP_ASSETS_FILE`（`/data/map_assets.json`）、`WORLD_FILE`（`/data/world.json`）
  - 新增 `loadMapAssets/saveMapAssets/loadWorld/saveWorld` 函数（参照现有 `loadNotes` 模式）
  - `gameState` 加入 `mapAssets` 和 `world`，启动时从文件加载
  - 新事件 handler（仅 DM 可调用）：
    - `mapAsset:upload`：保存 Base64 到 `mapAssets`，回复 `mapAsset:uploaded`，落盘 mapAssets
    - `placedMap:add` / `placedMap:move` / `placedMap:resize` / `placedMap:setLock` / `placedMap:remove`：修改 `world.placedMaps`，广播给所有人，debounce 500ms 落盘 world（`placedMap:resize` payload: `{ id, gridWidth }`，高由客户端按原图比例重算）
  - `joinSuccess` payload 新增 `world`（完整）和 `mapAssetIds`（仅 id 列表，不含 Base64）；客户端收到后对 `world.placedMaps` 中每个 assetId 发 `mapAsset:fetch`，服务端返回 Base64
- [public/game.html](public/game.html)：
  - 移除 Phase 2 的本地存储，所有地图操作改为 `socket.emit`
  - 监听 `mapAsset:uploaded` / `placedMap:added` 等事件做对应渲染
  - 玩家加入时，根据 `world.placedMaps` 中的 assetId 拉取/缓存图片资产再渲染
  - 实现 assetId 按需加载机制：`mapAsset:fetch` 事件，服务端返回 Base64

**验收标准 / Acceptance criteria**：
- DM 上传一张地图，其他在线玩家**立即**看到这张地图出现在相同位置
- DM 拖动地图，玩家看到地图实时移动（拖动过程中可以做节流，但 dragend 必须广播最终位置）
- DM 锁定/删除地图，玩家同步看到状态变化
- 重启服务器后，重新加入仍能看到所有放置的地图（验证 `/data/world.json` 和 `/data/map_assets.json` 被写入）
- 玩家无法触发任何 `placedMap:*` 事件（服务端有 DM guard）

**本阶段不做 / Out of scope**：棋子/笔迹/矩形协议改造；旧 `map:load` / `map:save` / `savedMaps` 事件删除（保留并行运行）；撤销/重做。

---

## Phase 4: 棋子 & NPC 迁移到 Konva（网格坐标）

**目标 / Goal**：玩家棋子和 NPC 从 DOM `<div>` 迁移到 Konva 圆形节点，坐标改为 `gridX/gridY`，吸附到网格；玩家可拖动自己颜色的棋子，DM 可拖动所有棋子和 NPC。

**前置条件 / Prerequisites**：Phase 3 完成（[server.js](server.js) 有 `world` 状态和落盘逻辑）。

**交付物 / Deliverables**：
- [server.js](server.js)：
  - 在 `world` 中加入 `tokens` 和 `npcs` 数组（结构见文档顶部数据模型）
  - 修改 `token:spawn` / `token:move` / `token:clearAll`：payload 使用 `gridX/gridY`，权限规则不变（玩家只能动自己颜色的）
  - 修改 `npc:spawn` / `npc:move` / `npc:remove` / `npc:clearAll`：同上
  - 旧的 `gameState.tokens` 和 `gameState.npcs` 移除（与 `gameState.world.tokens/npcs` 合并）
  - 落盘随 world 一起 debounce 保存
- [public/game.html](public/game.html)：
  - 移除旧的 DOM token / NPC 元素创建逻辑（[createTokenElement](public/game.html) 等）
  - 在 dynamicLayer 创建 Konva.Circle（半径 = `0.4 * gridSize`，使棋子略小于格子）
  - 拖动时实时计算光标的 grid 坐标，松手时吸附 + emit `token:move`
  - 玩家身份下，非自己颜色的棋子 `listening: false` 且 `draggable: false`
  - NPC 配色保持灰色（或允许 DM 选择）
  - 玩家头像/HP 显示考虑跟随 token 渲染（可用 Konva.Text 或 Konva.Group 叠加）

**验收标准 / Acceptance criteria**：
- 玩家选择橙色后点击 "生成棋子"，世界中央出现橙色圆形，并对齐到网格
- 拖动棋子，松手时吸附到最近格子，其他人实时同步看到
- 玩家无法拖动其他颜色的棋子（拖拽无反应）
- DM 可以拖动任意棋子和 NPC
- 不同分辨率的地图上，棋子视觉大小**相同**（因为都是 0.4 格）
- 刷新页面后所有棋子位置保留

**本阶段不做 / Out of scope**：笔迹/矩形迁移；撤销/重做；删除旧 `tokens` 客户端 DOM 代码（如已存在）—— Phase 7 统一清理。

---

## Phase 5: 笔迹（自由）+ 矩形工具（吸附）

**目标 / Goal**：DM 可用画笔工具在世界中自由绘画（不吸附），用矩形工具画方框（顶点吸附到网格）；所有人实时同步并持久化。

**前置条件 / Prerequisites**：Phase 4 完成（dynamicLayer 工作良好，事件协议已建立）。

**交付物 / Deliverables**：
- [server.js](server.js)：
  - `world.freeDrawings` 和 `world.rects` 数组
  - 新事件：`draw:freeStroke`（一次完整笔画的点列）、`draw:rect`（一个矩形的网格坐标和尺寸）、`draw:remove`（按 id 删除单条）、`draw:clearAll`
  - 仅 DM 可调用
- [public/game.html](public/game.html)：
  - 工具栏：现有的画笔按钮 + 新增 "矩形" 按钮
  - 笔画工具：mousedown → 在 dynamicLayer 创建临时 Konva.Line；mousemove → push 世界坐标点 + `batchDraw`；mouseup → emit `draw:freeStroke`，服务端确认后从 dynamic 移到 staticLayer
  - 矩形工具：mousedown 记录起点（吸附），mousemove 显示临时矩形（终点吸附），mouseup emit `draw:rect`
  - 接收事件时在 staticLayer 渲染对应 Konva.Line / Konva.Rect
  - 移除旧的 HTML5 Canvas 绘图层（`<canvas id="drawing-canvas">`）

**验收标准 / Acceptance criteria**：
- DM 用画笔在世界上画一条曲线，其他人实时看到（拖拽中可节流，松手必到位）
- DM 用矩形工具画框，四个顶点都对齐到网格
- 缩放世界时，笔迹和矩形随之缩放（因为存的是世界坐标）
- 刷新页面后笔迹和矩形保留
- 玩家身份下，画笔/矩形工具按钮不可见或不可用

**本阶段不做 / Out of scope**：笔迹颜色/粗细的 UI 完整实现（可暂时硬编码 1 种）；按对象删除的 UI（先做全清空）；撤销/重做（Phase 6）。

---

## Phase 6: 撤销 / 重做

**目标 / Goal**：DM 可以用 Ctrl/Cmd+Z 撤销最近的世界编辑（地图放置/移动/删除、棋子移动、笔迹/矩形添加），Ctrl/Cmd+Shift+Z 重做；玩家不参与撤销历史。

**前置条件 / Prerequisites**：Phase 3-5 完成（所有世界编辑都通过明确的 socket 事件触发）。

**交付物 / Deliverables**：
- [server.js](server.js)：
  - 维护 DM 专属的 `undoStack` 和 `redoStack`（仅内存，不落盘 —— 重启后清空可接受）
  - 每个修改 `world` 的 handler，在执行前 push "逆操作" 到 undoStack
  - 新事件：`history:undo` / `history:redo`（仅 DM）
  - 执行 undo 时：pop undoStack → 应用逆操作 → push 正向操作到 redoStack → 广播变化
  - 任何 *新* 编辑发生时清空 redoStack
  - 栈大小上限 50 条
- [public/game.html](public/game.html)：
  - 全局键盘监听 Ctrl/Cmd+Z 和 Ctrl+Shift+Z（仅 DM 生效）
  - 工具栏可选加 "撤销" / "重做" 按钮

**验收标准 / Acceptance criteria**：
- DM 放置地图 → 按 Cmd+Z → 地图消失，所有玩家同步看到消失
- DM 移动棋子 → Cmd+Z → 棋子回到原位
- 撤销 3 次后做新操作，redoStack 应清空（再按 Cmd+Shift+Z 无效果）
- 服务器重启后 undo/redo 栈清空（这是预期行为）
- 玩家按 Cmd+Z 无任何效果

**本阶段不做 / Out of scope**：玩家的撤销/重做；持久化历史栈；撤销聊天/骰子/笔记等非世界操作。

---

## Phase 7: 清理旧代码 & 更新文档

**目标 / Goal**：删除所有被新世界系统取代的旧代码路径，让代码库回到单一真相源；更新 CLAUDE.md 反映新架构。

**前置条件 / Prerequisites**：Phase 1-6 完成且经过实际跑团测试至少一次（用户验收）。

**交付物 / Deliverables**：
- [server.js](server.js)：删除以下事件及关联函数 / `gameState` 字段：
  - `map:load`、`map:transform`、`map:lock`、`map:save`、`map:loadSaved`、`map:deleteSaved`、`map:updateState`
  - `player:viewMap`、`player:loadMap`、`dm:mapSwitched`、`player:mapData`
  - `gameState.mapData`、`gameState.mapTransform`、`gameState.isLocked`、`gameState.savedMaps`、`gameState.activeMapId`
  - `broadcastToMapViewers` 函数 → 改为标准 `io.emit` 或 `socket.broadcast.emit`
  - `players` Map 中的 `currentMapId` 字段
- [public/game.html](public/game.html)：
  - 删除 `<img id="map-img">`、`#map-container`、`#map-frame`、`<canvas id="drawing-canvas">` 等旧 DOM
  - 删除所有旧的拖拽、缩放、地图缩略图侧栏存档相关 JS
  - 删除 Phase 1 引入的临时切换按钮
  - 侧边栏 "地图存档" UI 改为 "地图资产库"（列出 mapAssets 中的图片，DM 点击 = 在世界中央放置一份新实例）
- [CLAUDE.md](CLAUDE.md)：更新 "Architecture"、"Data Models"、"Socket.IO Event Map" 章节反映新结构

**验收标准 / Acceptance criteria**：
- `grep -E "map:transform|map:lock|player:viewMap|broadcastToMapViewers" server.js` 无任何匹配
- game.html 中 `<canvas id="drawing-canvas">` 不存在
- 全部跑团流程（DM 上传 3 张地图、玩家 4 人各持一色棋子、画笔/矩形/骰子/聊天/角色卡）端到端无报错
- 服务器冷启动后所有状态正确恢复（地图、棋子、笔迹、矩形、聊天历史、笔记、角色卡）
- CLAUDE.md 中不再提及 "Player independent map viewing" 等已废弃概念

**本阶段不做 / Out of scope**：性能优化（如 Konva Layer 缓存、批量渲染）；新功能（如战斗追踪器、视野/迷雾）。

---

## Phase 8: 小功能 & 小 bug 修复

**目标 / Goal**：在稳定的 Konva 世界基础上补充用户体验改进和已知缺失功能，每条作为独立子任务实现，互不依赖。

**前置条件 / Prerequisites**：Phase 7 完成（旧代码已全部清理，Konva 世界为唯一渲染路径）。

**功能列表（按优先级排列，可按需增减）：**

### 8-A: 地图资产库点击放置
- 侧边栏 "地图" 区块展示已上传的地图缩略图列表（从 `mapAssetCache` 渲染）
- DM 点击缩略图 → emit `placedMap:add`，在视口中央放置一份新实例（与上传后自动放置逻辑相同）
- 新上传资产后自动刷新列表
- 玩家不可见该列表（`.dm-only`）

### 8-B: 其他待定小功能
- （根据实际跑团反馈在此追加）

**验收标准 / Acceptance criteria**（针对 8-A）：
- DM 上传一张地图后，侧边栏出现该图缩略图
- 点击缩略图后，世界中央出现该地图的新实例（id 不同，位置独立）
- 侧边栏缩略图在 `placedMap:removed` 不消失（资产库与放置实例分离）
- 玩家端不显示资产库列表

**本阶段不做 / Out of scope**：资产删除（资产库条目一旦上传不可删除）；地图实例层级排序 UI；战斗追踪器、视野/迷雾等大型功能。

---

## Phase 9: 吸附开关 + 地图绑定联动 + 选框批量操作

**目标 / Goal**：在稳定的 Konva 世界上增加三组交互增强，每组作为独立子任务：(9-A) 为地图/矩形/棋子分别增加"吸附网格"开关，关闭后可自由放置于非格子位置；(9-B) 为地图实例增加"固定对象"开关，移动/缩放地图时被该地图包裹的笔迹、矩形、棋子跟随联动；(9-C) 增加"选框"工具，框选多类对象后批量平移或删除。

**前置条件 / Prerequisites**：Phase 8 完成（Konva 世界为唯一渲染路径，所有对象通过 socket 事件管理）。

---

### 9-A: 吸附开关

**功能说明**

工具栏新增三个独立开关（DM 可见，全局生效）：

| 开关 | 默认 | 控制范围 |
|------|------|----------|
| 地图吸附 | 开 | 地图 `dragend` 是否 `snapToGrid` |
| 矩形吸附 | 开 | 矩形工具起/终点是否 `snapToGrid` |
| 棋子吸附 | 开 | 棋子/NPC `dragend` 是否 `snapToGrid` |

开关状态为客户端局部变量，不同步服务端、不持久化（刷新恢复默认）。关闭吸附后对象的 `gridX/gridY` 以鼠标释放位置换算的浮点值传输（数据模型本已定义为 float，兼容）。

**交付物 / Deliverables**：

- [public/game.html](public/game.html) CSS：三个 toggle 按钮的激活/非激活样式（激活时高亮边框，非激活时灰色）
- [public/game.html](public/game.html) HTML：工具栏 `.dm-only` 区域新增三个按钮（建议文字"格/图"、"格/矩"、"格/棋"，`title` 属性为完整提示文字）
- [public/game.html](public/game.html) JS：
  - 全局变量 `snapMap = true`、`snapRect = true`、`snapToken = true`
  - 点击按钮时 toggle 对应变量并同步按钮视觉状态
  - 地图 `dragend` handler：将 `if (snapMap) pos = snapToGrid(pos)` 包裹原有吸附逻辑
  - 矩形工具 `mousedown`（起点）和 `mouseup`（终点）：分别按 `snapRect` 决定是否 `snapToGrid`
  - 棋子/NPC `dragend` handler：按 `snapToken` 决定是否 `snapToGrid`

**验收标准 / Acceptance criteria**：

- 关闭地图吸附后，拖动地图松手时停在鼠标释放位置，不跳格；其他客户端看到相同的非整数格位置
- 关闭矩形吸附后，矩形四角不对齐格子交点
- 关闭棋子吸附后，棋子可停在格子中间位置
- 三个开关独立，互不影响
- 刷新页面后三个开关恢复默认开启

**本阶段不做 / Out of scope**：持久化开关状态；玩家侧的独立棋子吸附开关（可后续追加至玩家工具栏）；自由笔迹（本就不吸附，不需要开关）。

---

### 9-B: 地图固定对象联动

**功能说明**

每个放置的地图实例新增 `isBound` 布尔字段（默认 `false`）。开启后，DM 对该地图实例的移动和缩放会触发被"包裹"对象的联动更新。

**包裹判断规则**（以操作**前**地图的世界坐标边界为准）：

- 边界换算：地图 `gridX/gridY` 为网格单位，世界坐标 = `grid * GRID_SIZE`；`gridHeight = gridWidth * (asset.originalHeight / asset.originalWidth)`
- `freeDrawing`：`points` 数组中**至少有一个** (x, y)（世界坐标）在地图边界内，即视为包裹
- `rect`：四个顶点中**至少有一个**（换算为世界坐标后）在地图边界内，即视为包裹
- `token` / `npc`：渲染圆心（`(gridX + 0.5) * GRID_SIZE`，取 `renderWorldToken` 相同计算方式）在地图边界内

**移动联动**（`dragend`）：

- 计算 delta：`dgx = newGridX - oldGridX`，`dgy = newGridY - oldGridY`
- 所有被包裹的 `freeDrawing` 的每个点 `+= (dgx * GRID_SIZE, dgy * GRID_SIZE)`
- 所有被包裹的 `rect` 的 `gridX += dgx`，`gridY += dgy`
- 所有被包裹的 `token/npc` 的 `gridX += dgx`，`gridY += dgy`

**缩放联动**（resize 结束）：

- 旧地图网格尺寸：`oldW = gridWidth`，`oldH = oldW * aspectRatio`
- 新地图网格尺寸：`newW = newGridWidth`，`newH = newW * aspectRatio`（gridX/gridY 不变，锚点为左上角）
- `freeDrawing` 每个点（世界坐标）：
  `newX = mapX1 + (x - mapX1) / (oldW * G) * (newW * G)`，Y 同理（`mapX1 = gridX * G`）
- `rect`（网格坐标）：
  `newRx = gridX + (rx - gridX) / oldW * newW`，`newRy/newRw/newRh` 类似等比缩放
- `token/npc`（网格坐标）：
  `newTx = gridX + (tx + 0.5 - gridX) / oldW * newW - 0.5`（保持圆心在地图内相对比例不变，结果按 `snapToken` 决定是否 `Math.round`）

**数据模型变更**：

```javascript
// world.placedMaps 条目新增字段
{ id, assetId, gridX, gridY, gridWidth, isLocked, isBound }
```

**交付物 / Deliverables**：

- [server.js](server.js)：
  - `loadWorld()` 默认值中 `placedMaps` 条目读取时补 `isBound: map.isBound ?? false`（兼容旧存档）
  - 新事件 `placedMap:setBound`（DM guard）：更新 `world.placedMaps` 中对应条目的 `isBound`，`io.emit('placedMap:boundSet', { id, isBound })`，`scheduleWorldSave()`，**不**纳入 undoStack（与 `placedMap:setLock` 一致）
  - 新事件 `world:boundedMove`（DM guard）：payload `{ mapId, mapGridX, mapGridY, movedTokens: [{id, gridX, gridY}], movedNpcs: [{id, gridX, gridY}], movedFreeDrawings: [{id, points}], movedRects: [{id, gridX, gridY, gridW, gridH}] }`；handler：`pushWorldUndo()` → 更新 `world.placedMaps` 中 mapId 的坐标 → 批量更新四类对象 → `io.emit('world:boundedMoved', payload)` → `scheduleWorldSave()`
  - 新事件 `world:boundedResize`（DM guard）：payload `{ mapId, newGridWidth, scaledFreeDrawings: [{id, points}], scaledRects: [{id, gridX, gridY, gridW, gridH}], movedTokens: [{id, gridX, gridY}], movedNpcs: [{id, gridX, gridY}] }`；handler：`pushWorldUndo()` → 更新地图 `gridWidth` → 批量更新四类对象 → `io.emit('world:boundedResized', payload)` → `scheduleWorldSave()`

- [public/game.html](public/game.html) CSS：`.bind-btn` 绑定/解绑视觉样式（激活时用与锁定按钮同色系但不同图标区分）
- [public/game.html](public/game.html) JS：
  - `createOverlayForPlacedMap()`：新增 bind 按钮（DM only），图标建议 📌（已绑）/ 📍（未绑），`click` 调 `togglePlacedMapBound(id)`
  - `togglePlacedMapBound(id)`：emit `placedMap:setBound`，传 `{ id, isBound: !current }`
  - `socket.on('placedMap:boundSet', { id, isBound })`：更新 `placedMapsData[id].isBound`，刷新 overlay 按钮图标与样式
  - 新增 `getWrappedObjects(placedData)`：返回 `{ tokens, npcs, freeDrawings, rects }`，基于 `worldTokensData / worldNpcsData / worldDrawingsData / worldRectsData` 按包裹规则过滤（使用操作前的旧坐标）
  - 地图 `dragend` handler：若 `isBound`，先调 `getWrappedObjects`，计算新坐标，emit `world:boundedMove`；否则 emit 原 `placedMap:move`
  - 地图 resize 结束 handler：若 `isBound`，调 `getWrappedObjects`，按缩放公式算新坐标，emit `world:boundedResize`；否则 emit 原 `placedMap:resize`
  - `socket.on('world:boundedMoved', payload)`：用 payload 更新 `placedMapsData`、`worldTokensData`、`worldNpcsData`、`worldDrawingsData`、`worldRectsData`，对应 Konva 节点调用 `.position()` / `.points()` 更新，`batchDraw`
  - `socket.on('world:boundedResized', payload)`：同上（freeDrawing 节点需 `.points(newPoints)` 重绘，rect 节点需更新 `.x()/.y()/.width()/.height()`）
  - `world:sync`（undo/redo）已有的全量销毁重渲逻辑自动覆盖，无需额外修改

**验收标准 / Acceptance criteria**：

- 默认 `isBound=false`；DM toggle 后服务器持久化，刷新后保留
- 地图开启绑定，地图内放置棋子，以及一条完整在地图内的笔迹 → 拖动地图 → 两者平移相同 delta，其他客户端同步
- 笔迹有至少一点在地图内（哪怕只有一端在地图内）→ 跟随移动（"部分交叉 = 包裹"）
- 缩放已绑定地图 → 地图内的矩形顶点等比重映射；地图内棋子维持相对比例位置
- Ctrl+Z 一次性还原地图 + 所有联动对象的位置（单个 undo 槽）
- 地图处于锁定状态时无法拖动，`isBound` 不触发联动

**本阶段不做 / Out of scope**：一个对象同时被两张绑定地图包裹时的仲裁（实现时取 `placedMapsData` 中第一个匹配项即可）；NPC 缩放（仅平移位置，不改变圆形大小）；`isBound` toggle 纳入 undoStack。

---

### 9-C: 选框批量操作

**功能说明**

工具栏新增"选框"工具（DM only，图标建议 ⬚）。激活后：

1. DM 在世界空白处按住拖拽，绘制半透明矩形选框（`fill: rgba(99,179,237,0.15)`，`stroke: #63b3ed`，`dash: [6,3]`，`strokeWidth: 1.5/scale`）
2. 松手时，计算被选框包裹的对象（规则见下），高亮已选对象，选框右上角出现 DOM "🗑 删除" 按钮
3. 拖动**任意**已选对象（或选框矩形本身），全部已选对象跟随平移相同 delta，松手后 emit 批量移动事件
4. 点击选框外空白处或切换工具：清除选框与高亮

**包裹判断规则**（选框作为边界）：

- `placedMap`：地图四顶点均在选框内（**全包含**）；已锁定地图不可被选中
- `freeDrawing`：`points` 中**至少有一个**点在选框内，即视为包裹
- `rect`：四顶点中**至少有一个**在选框内，即视为包裹
- `token` / `npc`：渲染圆心在选框内

**交付物 / Deliverables**：

- [server.js](server.js)：
  - 新事件 `world:selectionMove`（DM guard）：payload `{ movedPlacedMaps: [{id, gridX, gridY}], movedTokens: [{id, gridX, gridY}], movedNpcs: [{id, gridX, gridY}], movedFreeDrawings: [{id, points}], movedRects: [{id, gridX, gridY, gridW, gridH}] }`；handler：`pushWorldUndo()` → 批量更新五类对象 → `io.emit('world:selectionMoved', payload)` → `scheduleWorldSave()`
  - 删除操作复用现有单条 remove 事件（客户端循环 emit），不新增批量删除事件

- [public/game.html](public/game.html) CSS：
  - `#selection-overlay`：绝对定位于 `#world-container` 内，`pointer-events: none`，子按钮单独 `pointer-events: auto`
  - `.selection-delete-btn`：右上角红色删除按钮样式（参照 `.placed-map-remove`）
- [public/game.html](public/game.html) HTML：`#world-container` 内新增 `<div id="selection-overlay"></div>`
- [public/game.html](public/game.html) JS：
  - `setTool('select-box')` 分支：`konvaStage.draggable(false)`，container 鼠标样式 `crosshair`；切离时调 `clearSelection()`
  - 选框绘制：`onStageDrawMouseDown` 在工具为 'select-box' 且 `e.target === konvaStage` 时，于 `dynamicLayer` 创建临时 `Konva.Rect`（上述样式）；`mousemove` 更新宽高（处理负向拖拽，统一换算为 `x=min, y=min, w=|Δ|, h=|Δ|`）；`mouseup` 调 `finalizeSelection()`
  - `finalizeSelection()`：
    1. 将选框换算为世界坐标范围 `selBox { x1, y1, x2, y2 }`（grid 单位）
    2. 遍历五类数据数组，按包裹规则填入 `selectedIds: { placedMaps[], tokens[], npcs[], freeDrawings[], rects[] }`
    3. 若全为空：销毁临时选框 Konva 节点，不进入选中态
    4. 否则：在 `dynamicLayer` 保留选框 Rect（设 `listening: true` 以支持拖拽）；对各 Konva 节点加高亮描边（`node.shadowEnabled(true)` 或 `stroke` 覆盖）；调 `updateSelectionOverlay()` 定位 DOM 删除按钮到选框右上角（Konva 世界坐标 → stage 屏幕坐标）
  - 选中态拖动：选框 Rect 和各已选 Konva 节点均 `draggable(true)`；任一节点 `dragmove` 时计算 dx/dy 并同步移动其余所有已选节点（`node.x(node.x() + dx)`）；`dragend` 调 `finalizeSelectionMove()` emit `world:selectionMove`；每次 `dragmove` 末尾调 `updateSelectionOverlay()` 保持删除按钮跟随
  - `finalizeSelectionMove()`：将各已选节点当前屏幕坐标逆变换回世界网格坐标，组装 payload，emit `world:selectionMove`，重算高亮
  - `socket.on('world:selectionMoved', payload)`：批量更新五类本地数据数组 + Konva 节点位置，`batchDraw`
  - `clearSelection()`：销毁选框 Konva 节点，移除已选节点高亮，清空 `selectedIds`，隐藏 `#selection-overlay`；幂等（重复调用无副作用）
  - 工具切换时调 `clearSelection()`；`world:sync`（undo/redo）后调 `clearSelection()`
  - 删除按钮 `onclick`：`confirm` 弹窗 → 按 `selectedIds` 循环 emit 各类型 remove 事件（`token:remove`、`npc:remove`、`draw:remove`、`placedMap:remove`）→ `clearSelection()`
  - `onStageTransformChanged` 末尾：若存在活跃选框，调 `updateSelectionOverlay()` 重算删除按钮屏幕坐标

**验收标准 / Acceptance criteria**：

- 激活选框工具，拖出矩形，松手后包裹规则命中的对象显示高亮
- 已锁定地图不被选框选中；笔迹/矩形只要有一端在选框内即被选中
- 拖动任一已选对象，全部已选对象平移相同 delta，松手后其他客户端同步看到新位置
- 缩放/平移 stage 时，删除按钮始终贴在选框右上角
- 点击删除按钮，已选对象全部消失，其他客户端同步
- 点击选框外空白处或切换工具，选框与高亮立即消失
- Ctrl+Z 还原批量移动（单个 undo 槽）
- 选框为纯本地交互，其他客户端不可见选框本身

**本阶段不做 / Out of scope**：Shift+点击追加单个对象到选中集；选框内对象的统一缩放/旋转；批量删除纳入单一 undo 槽（循环 emit remove 会产生多个 undo 条目，可在后续修复）；选框广播给其他客户端。

---

### 9-D: 战争迷雾（马赛克遮罩）

**功能说明**

DM 可在地图上绘制矩形马赛克遮罩，视觉上遮蔽地图对应区域（对所有人可见）；双击某个马赛克即可删除，揭示下方地图。马赛克不吸附网格，坐标使用**世界像素单位**（与 `freeDrawing.points` 相同坐标系，`worldPx = gridUnit * GRID_SIZE`）。

**Layer 位置**：新增 `fogLayer`，插入在 `gridLayer` 与 `dynamicLayer` 之间。

```
staticLayer（地图）→ gridLayer（网格）→ fogLayer（马赛克）→ dynamicLayer（棋子）→ drawingLayer（笔迹）
```

**马赛克视觉效果**：

- 预生成一张 64×64 像素的可平铺 canvas（`createFogPattern()`），在其上绘制 8×8 的彩色小方块网格（色调参考：深灰/黑色系方块，营造"遮挡"感）
- `Konva.Rect` 使用 `fillPatternImage` 加载该 canvas，`fillPatternRepeat: 'repeat'`，不需要随缩放更新（马赛克格子随世界缩放放大/缩小，符合直觉）
- 无边框（`strokeEnabled: false`）；透明度可设 `opacity: 0.92`

**被地图"包裹"判断规则**（以地图操作前边界为准）：

- 马赛克四个顶点 `(x, y)、(x+w, y)、(x, y+h)、(x+w, y+h)`（世界像素坐标）中，**至少有一个**在地图边界内，即视为被包裹
- 地图边界（世界像素）：`x1 = gridX * G, y1 = gridY * G, x2 = (gridX + gridWidth) * G, y2 = (gridY + gridHeight) * G`

**联动计算**（配合 9-B 地图绑定，若两者同时实现）：

- 移动联动：`newX = x + dgx * GRID_SIZE`，`newY = y + dgy * GRID_SIZE`；`w/h` 不变
- 缩放联动：`newX = mapX1 + (x - mapX1) / (oldW * G) * (newW * G)`，`newY` 同理；`newW = w / (oldW * G) * (newW * G)`，`newH` 同理

**数据模型变更**：

```javascript
// world 新增字段
world.fogRects: [{ id, x, y, w, h }]  // 世界像素单位（非网格单位）
```

**交付物 / Deliverables**：

- [server.js](server.js)：
  - `loadWorld()` 默认值加入 `fogRects: []`，读取旧数据时补全
  - 新事件 `fog:add`（DM guard）：校验 `w > 0 && h > 0` → push 到 `world.fogRects` → `io.emit('fog:added', fogRect)` → `pushWorldUndo()` → `scheduleWorldSave()`
  - 新事件 `fog:remove`（DM guard）：按 id 从 `world.fogRects` 删除 → `io.emit('fog:removed', { id })` → `pushWorldUndo()` → `scheduleWorldSave()`
  - 9-B 扩展（若实现）：`world:boundedMove` payload 加入 `movedFogRects: [{id, x, y, w, h}]`，handler 同步更新 `world.fogRects`；`world:boundedResize` 同理加入 `scaledFogRects`
  - `joinSuccess` 中 `world` 整体下发，`fogRects` 随之同步，无需单独处理

- [public/game.html](public/game.html) CSS：无需新增（按钮复用已有工具栏样式）
- [public/game.html](public/game.html) HTML：工具栏 `.dm-only` 区域新增"迷雾"工具按钮（图标建议 🌫 或文字"雾"）
- [public/game.html](public/game.html) JS：
  - `initKonvaWorld()` 中在 `gridLayer` 与 `dynamicLayer` 之间插入 `fogLayer = new Konva.Layer()`：
    ```
    konvaStage.add(staticLayer);
    konvaStage.add(gridLayer);
    konvaStage.add(fogLayer);   // ← 新增
    konvaStage.add(dynamicLayer);
    konvaStage.add(drawingLayer);
    ```
  - `createFogPattern()`：创建 64×64 的 `HTMLCanvasElement`，在上面绘制 8×8 的彩色小方块（建议 `#1a1a2e` 深蓝色系混入少量灰度方块以形成马赛克感），返回该 canvas
  - 全局变量 `fogLayer = null`，`worldFogData = []`（数据数组），`worldFogNodes = new Map()`（id → Konva.Rect）
  - `renderWorldFog(fogData)`：在 `fogLayer` 创建 `Konva.Rect`（`x, y, width: w, height: h`，`fillPatternImage: fogPatternCanvas`，`listening: isDM`，`opacity: 0.92`）；DM 端绑定 `dblclick` → emit `fog:remove`；存入 `worldFogNodes`；`fogLayer.batchDraw()`
  - `setTool('fog')` 分支：`konvaStage.draggable(false)`，container 鼠标样式 `crosshair`
  - 绘制流程（复用 `onStageDrawMouseDown/Move/finalizeWorldDraw` 框架）：工具为 'fog' 且 `e.target === konvaStage` 时，在 `fogLayer` 创建临时 `Konva.Rect`（`fill: rgba(30,30,50,0.5)` 预览色，无 pattern）；`mousemove` 更新尺寸（处理负向拖拽）；`mouseup` 时若 `w < 5 || h < 5` 则丢弃，否则 emit `fog:add { x, y, w, h }`（世界坐标，通过 `getMousePosInWorld` 换算）
  - `socket.on('fog:added', fogRect)`：push 到 `worldFogData`（去重）→ `renderWorldFog(fogRect)`
  - `socket.on('fog:removed', { id })`：销毁 `worldFogNodes.get(id)`，`worldFogNodes.delete(id)`，从 `worldFogData` 过滤，`fogLayer.batchDraw()`
  - `renderPendingWorldObjects()` 加入 `worldFogData` 的延迟渲染（stage 初始化前加入的迷雾）
  - `joinSuccess` handler 加入 `gs.world.fogRects` 初始化到 `worldFogData`
  - `world:sync`（undo/redo）已有全量销毁重渲逻辑：补充销毁 `worldFogNodes` 所有节点，清空 `worldFogData`，`fogLayer` 在 `renderPendingWorldObjects` 中重渲
  - 9-B 扩展（若实现）：`getWrappedObjects` 加入 fog 顶点检查；`world:boundedMoved/boundedResized` handler 加入对 `worldFogData/worldFogNodes` 的更新

**验收标准 / Acceptance criteria**：

- 激活迷雾工具，拖拽绘制一个矩形，松手后出现马赛克遮罩，DM 和玩家均可见，遮盖下方地图内容
- 马赛克的 z 轴：地图图片在其下方，网格线在其下方，棋子/NPC 在其上方（棋子走到马赛克区域时显示在马赛克上面）
- DM 双击某个马赛克 → 消失，其他客户端同步看到消失；玩家双击无效果
- 缩放 stage 时马赛克随世界缩放，视觉上马赛克格子变大/变小（无跳变）
- 服务器重启后马赛克保留（`world.fogRects` 已落盘）
- Ctrl+Z 撤销"添加马赛克"或"删除马赛克"操作
- 若已实现 9-B：将地图设为"固定对象"后拖动地图，与之包裹的马赛克跟随平移；缩放地图时马赛克等比重映射

**本阶段不做 / Out of scope**：玩家视角完全不可见迷雾下方内容（当前方案是视觉遮挡，非渲染隔离）；圆形/多边形迷雾形状；迷雾透明度/颜色 UI 调整；迷雾作为 9-C 选框的选中目标（可后续追加）。

---

## 风险与回滚策略

- **Phase 1-2 风险最低**：纯前端，旧系统并行运行，随时可弃
- **Phase 3 是分水岭**：服务端协议变更后，回滚意味着丢失新世界中的数据。建议在 Phase 3 部署前对 `/data/` 做一次完整备份（手动 SSH 到 Render 或导出）
- **Phase 7 不可逆**：执行前确保 Phase 1-6 已经稳定运行一周以上的真实跑团

---

## 事件协议对照表

| 旧事件 | 新事件 | 引入 Phase |
|--------|--------|-----------|
| `map:load` | `mapAsset:upload` + `placedMap:add` | Phase 3 |
| `map:transform` | （删除，视口本地化） | Phase 7 |
| `map:lock` | `placedMap:setLock` | Phase 3 |
| `map:save` / `map:loadSaved` / `map:deleteSaved` | （删除，被资产库 + world 自动持久化取代） | Phase 7 |
| `map:updateState` | （删除） | Phase 7 |
| `player:viewMap` / `player:loadMap` | （删除，共享世界） | Phase 7 |
| `dm:mapSwitched` | （删除） | Phase 7 |
| `token:spawn` / `token:move` (像素) | 同名，payload 改为 `gridX/gridY` | Phase 4 |
| `npc:spawn` / `npc:move` 等 | 同名，payload 改为 `gridX/gridY` | Phase 4 |
| `draw:path` (像素点列) | `draw:freeStroke` (世界坐标点列) | Phase 5 |
| — | `placedMap:resize`（新增，`{ id, gridWidth }`） | Phase 3 |
| — | `draw:rect`（新增） | Phase 5 |
| — | `history:undo` / `history:redo`（新增） | Phase 6 |
| — | `world:sync`（服务端 → 全员，undo/redo 后广播完整 world 快照） | Phase 6 |
| — | `placedMap:setBound` / `placedMap:boundSet`（新增，固定对象开关） | Phase 9-B |
| — | `world:boundedMove` / `world:boundedMoved`（新增，地图移动联动批量更新） | Phase 9-B |
| — | `world:boundedResize` / `world:boundedResized`（新增，地图缩放联动批量更新） | Phase 9-B |
| — | `world:selectionMove` / `world:selectionMoved`（新增，选框批量平移） | Phase 9-C |
| — | `fog:add` / `fog:added`（新增，添加马赛克遮罩） | Phase 9-D |
| — | `fog:remove` / `fog:removed`（新增，删除马赛克遮罩） | Phase 9-D |
