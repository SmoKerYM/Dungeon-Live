# Progress (for plan-extend.md)

## 当前状态
- **当前阶段**：Phase 2 完成（待浏览器手动验收），待进入 Phase 3
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

## 下一步
进入 Phase 3：服务端协议改造 + 资产/世界落盘（详见 [plan-extend.md](plan-extend.md#L114)）。Phase 2 的本地 `localMapAssets`/`localPlacedMaps` 已与 Phase 3 服务端模型对齐字段名，迁移时直接替换为 socket 事件即可。

## 待用户验收（Phase 2）
本地与协议层均已实现，但需要用户在浏览器中跑下面这套人工验收：
1. DM 上传一张图片 → 出现在世界中央且宽 20 格（数格子）
2. 拖动后松手 → 左上角对齐到最近格点
3. 点击左上角 🔓 → 变 🔒，再拖动地图无反应；再次点击解锁恢复
4. 点击地图 → 右上角出现 🗑；点空白 stage → 🗑 消失
5. 点 🗑 → 地图消失
6. 缩放/平移过程中，锁定 icon 与删除按钮始终贴每张地图左上/右上角
7. 玩家身份开第二窗口：侧边栏无 "添加地图" 按钮，切到新视图只见网格（Phase 2 无服务端，看不到 DM 放的地图属预期）

## 与原计划的偏离 / 已确认的决策变更
- **2026-05-27 网格渲染从 CSS overlay 改为 Konva 原生 `gridLayer`**：原 Phase 0/1 用 `#grid-overlay` 的 CSS `background-image` 画网格，缩放后地图边缘与网格线出现肉眼可见错位（两套渲染管线 + canvas 程序化 scale 不同步）。改为最底层 `gridLayer` 用 `Konva.Line` 按可视世界范围绘制（`strokeWidth = 1/scale`），与地图共享 stage 变换，彻底消除错位。已删除 `#grid-overlay` DOM、其 CSS 及 `syncGridOverlay`；新增 `drawGrid()`；`onStageTransformChanged()` 末尾加 `konvaStage.batchDraw()` 防止程序化变换后 canvas 滞留。plan-extend.md 决策章节已同步标注。
- **2026-05-27 新增地图缩放功能（Phase 2 增量，原计划未列）**：选中地图后右下角出现拖拽手柄（`.placed-map-resize`），拖动按原图宽高比缩放，松手 `Math.round` 吸附到整数格宽（最小 1 格），仅未锁定时可用；拖动时地图中心浮 `.placed-map-size-label` 实时显示"宽 N.N 格 × 高 N.N 格"。锚点为左上角（gridX/gridY 不变），故缩放后仍保持网格对齐。`localPlacedMaps[].gridWidth` 随之更新，Phase 3 直接同步即可。
