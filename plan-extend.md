# Plan: 重构地图系统为 Konva 网格世界

## 背景与决策

本计划将地图子系统从 "全屏 `<img>` + DOM 棋子 + 原生 Canvas 笔迹" 重构为 Konva 驱动的网格世界（VTT 范式）。

**已确定的核心决策：**
- **方案 A（共享世界）**：所有人看同一个 "世界"，DM 可以增删地图实例，玩家无法操作画布上的地图。每个观察者的视口（缩放/平移）独立，不广播。
- **网格尺寸**：1 格 = 50px（zoom=1.0 时）。所有对象坐标用 `gridX/gridY`（浮点），渲染时乘以 `gridSizePx * zoom`。
- **网格渲染**：CSS `background-image` 覆盖在 Konva Stage 之上的透明 `<div>`，`pointer-events: none`，跟随 Konva viewport 同步 `background-size` / `background-position`。
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
  - 客户端数据结构：`localPlacedMaps = [{ id, assetId, gridX, gridY, gridWidth, isLocked }]`，`localMapAssets = { assetId: { base64, ratio } }`
  - 拖动结束时调用 `snapToGrid` 调整 `gridX/Y`
  - 每张已放置地图右上角浮一个锁定 icon（DOM 元素，根据 Konva.Image 的屏幕坐标定位，缩放/平移时跟随更新）
  - 锁定状态下：`konvaImage.draggable(false)`、icon 切换为已锁图标
  - 选中地图（点击）时显示 "删除" 按钮（DM 用），点击后从 localPlacedMaps 移除并销毁 Konva 节点
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
    - `placedMap:add` / `placedMap:move` / `placedMap:setLock` / `placedMap:remove`：修改 `world.placedMaps`，广播给所有人，debounce 500ms 落盘 world
  - `joinSuccess` payload 新增 `mapAssets` 和 `world` 字段（mapAssets 体积可能大，考虑只发 assetIds 列表 + 按需 fetch）
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
| — | `draw:rect`（新增） | Phase 5 |
| — | `history:undo` / `history:redo`（新增） | Phase 6 |
