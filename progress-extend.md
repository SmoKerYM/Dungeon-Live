# Progress (for plan-extend.md)

## 当前状态
- **当前阶段**：Phase 4 完成（已人工验收），待进入 Phase 5
- **最后更新**：2026-05-27

## 已完成的 Phase
- **Phase 0** (2026-05-27)：
  - [public/game.html](public/game.html) `<head>` 引入 Konva 9 CDN
  - 新增隐藏占位 DOM `#world-container > #konva-stage + #grid-overlay`，置于 `#viewport` 内 `#map-frame` 之后
  - 配套 CSS：grid-overlay 用 background-image 画 50px 网格、pointer-events: none、绝对覆盖 stage
  - 事件协议对照表已在 [plan-extend.md](plan-extend.md#L276-L292) 存在，无需追加
- **Phase 1** (2026-05-27)：
  - 临时切换按钮 `#world-toggle-btn`（DM + Player 均可见，Phase 7 删除）
  - 常量：`GRID_SIZE=50`、`MIN_ZOOM=0.2`、`MAX_ZOOM=5`、`ZOOM_STEP=1.05`
  - `Konva.Stage` 懒初始化（首次进入新视图时创建，避免 `display:none` 下尺寸为 0），`draggable: true` 启用空白处拖拽平移
  - 新建 `staticLayer` 与 `dynamicLayer` 加入 stage
  - `wheel` 以光标为锚点缩放并 clamp 到 [0.2, 5]
  - `ResizeObserver` 观察 `#world-container` 尺寸变化，同步 stage 与网格
  - `syncGridOverlay()`：`background-size = 50 * zoom`、`background-position = (stage.x mod size, stage.y mod size)`（用正模避免负数跳变）
  - 工具函数：`worldToGrid` / `gridToWorld` / `snapToGrid`（Math.round）/ `getMousePosInWorld`
  - 旧地图视图在切换为新视图时 `display: none`，切回时恢复
- **Phase 2** (2026-05-27)：
  - 侧边栏新增 `#section-world-map`（`.dm-only`）内含 "＋ 添加地图" 按钮和隐藏的 `#world-file-input`
  - 本地状态：`localMapAssets = { assetId: { base64, originalWidth, originalHeight } }`（已对齐 Phase 3 字段）、`localPlacedMaps = [{ id, assetId, gridX, gridY, gridWidth, isLocked }]`，外加 `placedMapNodes` / `placedMapOverlays` Map
  - 文件选 → `FileReader` 转 Base64 → `Image` 读原始宽高 → 入资产库 → 在视口中央放置（默认 `gridWidth=20`，高按 `originalHeight/originalWidth` 比例计算）
  - 放置位置 `snapToGrid` 对齐到最近格子；拖动 `dragend` 同样吸附
  - 每张地图自带 DOM 浮层：左上角 🔓/🔒 锁定按钮、右上角 🗑 删除按钮（仅选中时显示），通过 `updatePlacedMapOverlay` 把 Konva 节点的世界坐标映射到 stage 屏幕坐标
  - 新增 `#placed-map-overlays` 容器（`pointer-events: none`，子按钮单独 `auto`）放在 `#world-container` 内
  - 统一入口 `onStageTransformChanged()` 同步 grid + 所有 overlays（替换 syncGridOverlay 的多处直接调用）
  - 锁定时 `node.draggable(false)` 且 icon 切换为已锁样式；解锁恢复
  - 点击空白 stage（`e.target === stage`）取消选中；点击地图节点 `mousedown` 上 `cancelBubble=true` 防止 stage 抢拖拽
  - 玩家路径：Konva.Image `listening: false` + `draggable: false`，且不创建任何 DOM 浮层（`createOverlayForPlacedMap` 仅 DM 调用）
  - "＋ 添加地图" 按钮在旧视图下点击时会先自动切换到新世界视图
  - plan-extend.md L98 锁定 icon 位置矛盾已修正为左上角并补充右上角删除按钮描述；L96 `ratio` 字段已与 Phase 3 模型对齐为 `originalWidth/originalHeight`

## 已完成的非 plan 内变更
- 2026-05-27: 聊天 + 骰子历史持久化（最多 100 条 FIFO，落 `data/chat_history.json`）
- 2026-05-27: CLAUDE.md 与 plan-extend.md 同步

- **Phase 3** (2026-05-27)：
  - [server.js](server.js)：新增 `MAP_ASSETS_FILE`/`WORLD_FILE` 常量；`loadMapAssets/saveMapAssets/loadWorld/saveWorld` 函数；`gameState` 加入 `mapAssets`（启动时从文件加载）和 `world`（启动时从文件加载）；`scheduleWorldSave`（500ms debounce）
  - [server.js](server.js)：新事件 handler（均有 DM guard）：`mapAsset:upload`（保存资产 + 落盘 + 回复 `mapAsset:uploaded`）、`mapAsset:fetch`（按需返回 Base64 给任意客户端）、`placedMap:add/move/resize/setLock/remove`（修改 `world.placedMaps` + `io.emit` 广播 + debounce 落盘）
  - [server.js](server.js)：`joinSuccess` payload 加入 `world`（完整世界状态，不含 Base64）
  - [public/game.html](public/game.html)：`localMapAssets` → `mapAssetCache`，`localPlacedMaps` → `placedMapsData`；新增 `pendingAssetUpload` Map
  - [public/game.html](public/game.html)：文件上传改为 emit `mapAsset:upload`，等 `mapAsset:uploaded` 回调后再调 `placeMapAtViewportCenter`；`placeMapAtViewportCenter` 改为 emit `placedMap:add`（不再本地 push/render）
  - [public/game.html](public/game.html)：`dragend` 加 emit `placedMap:move`；`onResizeEnd` 加 emit `placedMap:resize`；`togglePlacedMapLock` 改为 emit `placedMap:setLock`；`removePlacedMap` 改为 emit `placedMap:remove`
  - [public/game.html](public/game.html)：新增 `renderPendingPlacedMaps()`，在 `toggleWorldView` 开启世界视图时调用（覆盖加入时资产已缓存但 stage 未初始化的情况）
  - [public/game.html](public/game.html)：新增 socket 监听：`mapAsset:uploaded/fetched`、`placedMap:added/moved/resized/lockSet/removed`；`joinSuccess` 末尾处理 `gs.world`（填充 `placedMapsData` + 批量 emit `mapAsset:fetch`）

- **Phase 4** (2026-05-27)：
  - [server.js](server.js)：`loadWorld()` 默认值加入 `tokens: [], npcs: []`；`gameState` 移除顶级 `tokens/npcs` 字段，迁入 `world`；`token:spawn/move/clearAll` + `npc:spawn/move/remove/clearAll` 全部改用 `world.tokens/npcs` + `io.emit` + `scheduleWorldSave()`；`disconnect` 改从 `world.tokens` 删除断线棋子；`map:loadSaved/updateState/player:loadMap` 移除对旧 `tokens/npcs` 字段的读写
  - [public/game.html](public/game.html)：移除旧 DOM token/NPC 函数（`createTokenElement`、`createNPCElement` 等）；新增 `renderWorldToken`（`Konva.Circle`，半径 `0.4*GRID_SIZE`）/`renderWorldNpc`（`Konva.Group` = 圆角矩形 `Konva.Rect` + 居中 "NPC" `Konva.Text`，宽高同玩家棋子直径）；两者均 `dynamicLayer`，`dragend` 吸附到格子中心并 emit；新增 `initHpTooltip`/`showTokenTooltip`/`hideTokenTooltip`（`Konva.Label`，悬停显示 `❤️ cur/max`，拖动时 `dragmove` 跟随、`dragstart` 重新激活、`mouseleave` 检查 `isDragging()` 防止拖动中误隐藏）；新增 `renderPendingWorldObjects()`（开启世界视图时一次性渲染待渲染的 tokens/npcs/placedMaps）；`toggleWorldView` 改调 `renderPendingWorldObjects`；`joinSuccess` 末尾新增 `gs.world.tokens/npcs` 初始化到 `worldTokensData/worldNpcsData`；旧 token/NPC socket handler 替换为 Konva 版本；NPC 颜色 onclick 改用十六进制，新增 `<input type="color">` 自定义颜色输入

## 下一步
进入 Phase 5：笔迹（自由）+ 矩形工具（吸附）（详见 [plan-extend.md](plan-extend.md#L179)）。

## Phase 7 清理时需注意（Phase 4 产生的变化）
- `getCurrentTokens()`/`getCurrentNPCs()` 现已是返回空值的 stub，Phase 7 连同调用方一起删除
- 旧地图系统 `map:save` payload 中 `tokens/npcs` 字段已为空，Phase 7 删除这些字段
- `fileInput.onchange` 中不再 emit `token:clearAll`/`npc:clearAll`（Phase 7 清理整个旧地图上传流程）
- `getCurrentTokens`/`getCurrentNPCs` stubs 在 `saveMapState`/`saveCurrentMap` 中仍被调用，Phase 7 一并移除

## 与原计划的偏离 / 已确认的决策变更
- **2026-05-27 网格渲染从 CSS overlay 改为 Konva 原生 `gridLayer`**：原 Phase 0/1 用 `#grid-overlay` 的 CSS `background-image` 画网格，缩放后地图边缘与网格线出现肉眼可见错位（两套渲染管线 + canvas 程序化 scale 不同步）。改为最底层 `gridLayer` 用 `Konva.Line` 按可视世界范围绘制（`strokeWidth = 1/scale`），与地图共享 stage 变换，彻底消除错位。已删除 `#grid-overlay` DOM、其 CSS 及 `syncGridOverlay`；新增 `drawGrid()`；`onStageTransformChanged()` 末尾加 `konvaStage.batchDraw()` 防止程序化变换后 canvas 滞留。plan-extend.md 决策章节已同步标注。
- **2026-05-27 新增地图缩放功能（Phase 2 增量，原计划未列）**：选中地图后右下角出现拖拽手柄（`.placed-map-resize`），拖动按原图宽高比缩放，松手 `Math.round` 吸附到整数格宽（最小 1 格），仅未锁定时可用；拖动时地图中心浮 `.placed-map-size-label` 实时显示"宽 N.N 格 × 高 N.N 格"。锚点为左上角（gridX/gridY 不变），故缩放后仍保持网格对齐。`localPlacedMaps[].gridWidth` 随之更新，Phase 3 直接同步即可。
