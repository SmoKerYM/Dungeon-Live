# TODO — 2026-09-26

前端打磨三项，均在 [public/game.html](public/game.html)。

---

## 1. 浏览器缩放后浮动窗口的默认生成位置会变

**现象**：改变浏览器缩放比例后，浮动窗口不再出现在预期位置。

**排查方向**：不完全是 relative position 的问题，更可能是**位置以绝对像素存储**。

- `savedLayout[panelId] = { x, y }` 存的是 CSS 像素绝对值（[game.html:2476](public/game.html:2476) 拖拽结束时写入）。缩放会改变视口的 CSS 像素尺寸，于是同一组 x/y 在新比例下落点就偏了，甚至被 `clampToViewport`（[:2343](public/game.html:2343)）拉回边界，看起来就是"位置变了"。
- `defaultPanelPos`（[:2317](public/game.html:2317)）混用了两类基准：贴按钮的那几个读 `getBoundingClientRect()`，地图/骰子/角色卡的特判读 `window.innerWidth/innerHeight` 和常量 `EDGE_MARGIN`。缩放下这两类的相对关系不一致。
- `window.addEventListener('resize')`（[:2548](public/game.html:2548)）只做了 re-clamp，没有按新视口重新推导位置。注意浏览器缩放**会**触发 resize。

**可选做法**：把保存的位置改为相对量（比例，或"贴哪条边 + 偏移"），在 `showPanel` 时按当前视口换算回像素；服务端 `layouts` 的数据形状要同步调整，并兼容已存的旧绝对值。

**验证**：在 67% / 100% / 150% 三档缩放下，分别检查各窗口的默认位置和拖拽后重新展开的位置。

---

## 2. ~~角色卡界面重做：更小的面积承载更多信息~~（2026-09-26 已完成）

**现状**：`#character-view`（[:1322](public/game.html:1322)）是从整页视图直接塞进浮动窗口的，`#panel-character` 目前 680px 宽、最高 82vh（[:536](public/game.html:536)），信息密度低，纵向很长要滚动。

**方向**：

- 六大属性目前一行一个字段，占了大半高度 → 改成紧凑网格（属性值 + 调整值同格显示）
- 豁免检定/技能的勾选列表可以折叠或分栏
- 血量、熟练加值这类高频字段上提到顶部一行
- 专长列表改为可折叠
- 目标：宽度不超过现在，高度砍掉三分之一以上，且不牺牲可读性

**注意**：编辑模式（`isCharEditMode` / `updateCharEditUI`）下所有输入框的 enable/disable 逻辑要跟着新布局走；`loadCharacterToUI`（[:3272](public/game.html:3272)）按 id 逐个赋值，改 DOM 结构时 id 要保持或同步更新。

---

## 3. 继续优化聊天窗口前端

**现状**：`buildBubbleMessage`（[:2090](public/game.html:2090)）已有头像 + 气泡 + 左右分栏 + 私聊标记。

**可做的**：

- 同一人连续发言时合并（省掉重复的头像和名字，只留第一条）
- 消息时间戳（目前 `timestamp` 有存但没显示）
- 长消息折叠 / 链接可点
- 骰子结果目前混在系统消息里用等宽字体，考虑做成独立的结果卡片
- 私聊气泡的视觉再收敛一点，现在的品红偏跳
- 滚动位置保持：新消息到达时若用户正在往上翻历史，不应强制拉到底部

---

## 备注

- 本次会话把 remote 改成了 `git@github-personal:SmoKerYM/Dungeon-Live.git`（仓库已改名，且个人账号走 `github-personal` 别名）
- `data/` 结构本次为纯新增（`ui_prefs.json` 的 `layouts`、聊天记录的 `to`/`toRole`），旧文件可直接沿用，首次写入时自动升级
