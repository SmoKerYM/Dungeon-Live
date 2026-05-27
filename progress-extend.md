# Progress (for plan-extend.md)

## 当前状态
- **当前阶段**：Phase 1 完成，待进入 Phase 2
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

## 已完成的非 plan 内变更
- 2026-05-27: 聊天 + 骰子历史持久化（最多 100 条 FIFO，落 `data/chat_history.json`）
- 2026-05-27: CLAUDE.md 与 plan-extend.md 同步

## 下一步
进入 Phase 2：DM 地图放置 + 拖动吸附 + 锁定（详见 [plan-extend.md](plan-extend.md#L87)）

## 与原计划的偏离 / 已确认的决策变更
（暂无）
