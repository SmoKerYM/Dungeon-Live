# TODO — 2026-09-26

前端打磨三项，均在 [public/game.html](public/game.html)。**三项已全部完成（2026-09-26）。**

---

## 1. ~~浏览器缩放后浮动窗口的默认生成位置会变~~（2026-09-26 已完成）

**根因**：位置以绝对 CSS 像素存储。缩放改变的是视口的 CSS 像素尺寸，于是旧坐标落到界外被 `clampToViewport` 拉回边界；此后 DOM 里只剩被夹过的值，缩放回去也回不来 —— `resize` 监听拿 `offsetLeft/offsetTop` 顺延，等于把错误固化。

**做法**：改存锚点 `{ ax: 'left'|'right', ox, ay: 'top'|'bottom', oy }`（贴哪条边 + 到该边的距离）。`resize` 与 `ResizeObserver` 统一走 `relayoutPanel()`，从 `savedLayout` 重新推导而不是顺延 DOM 值。旧的纯 `x/y` 记录在 `resolveSavedPos()` 首次读取时就地升级成锚点。

**结论修正**：`defaultPanelPos` 混用 `getBoundingClientRect()` 与 `window.innerWidth/innerHeight` 并不是问题 —— 两者都是按当前视口实时读取的，任何缩放比例下都自洽，实测七个窗口在 1400×900 / 1000×700 / 900×650 下默认位置都正确。

**验证**：拖到右下角后视口 1400×900 → 900×650 → 1400×900 往返，位置精确还原；换视口重新登录后固定窗口按锚点复现；旧格式数据升级后位置不变。

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

## 3. ~~继续优化聊天窗口前端~~（2026-09-26 已完成）

六项全部落地：

| 项 | 做法 |
|---|---|
| 同一人连发合并 | `canGroup()`，同发送者 + 同私聊对象 + 5 分钟内；`.grouped` 隐藏重复的头像和名字行 |
| 时间戳 | 名字行右侧显示 HH:MM，气泡 `title` 给完整时间；跨天插入 `.chat-day-divider`（今天／昨天／M月D日） |
| 链接可点 | `renderMessageHtml()` 把 @提及 与 URL 放进同一次扫描，仅 http(s)，句末标点不算进 href |
| 长消息折叠 | 超过 420 字裁到 150px，底部渐变 + 展开／收起 |
| 骰子结果卡片 | `.dice-card`（投掷者、表达式、过程、大号结果），单颗 d20 的 20／1 标大成功／大失败 |
| 私聊气泡收敛 | 品红 `#6d2450`/`#e91e63` → 低饱和紫 `#4b3b5e` + 侧边细条 |
| 滚动位置保持 | 只有已在底部才自动跟随，否则弹出「↓ 有新消息」 |

**顺带**：补了 `escapeAttr()` —— 原本的 `escapeHtml()` 走 `textContent`，不转义引号，往 `href` 里塞用户输入会有注入面。

---

## 备注

- 本次会话把 remote 改成了 `git@github-personal:SmoKerYM/Dungeon-Live.git`（仓库已改名，且个人账号走 `github-personal` 别名）
- `data/` 结构本次为纯新增（`ui_prefs.json` 的 `layouts`、聊天记录的 `to`/`toRole`），旧文件可直接沿用，首次写入时自动升级
- 第 1 项又给 `layouts[name][panelId]` 加了 `ax/ox/ay/oy` 四个字段，仍是纯新增：旧的 `x/y` 继续写入，客户端首次读到没有锚点的记录时就地升级，线上已有布局不会丢
