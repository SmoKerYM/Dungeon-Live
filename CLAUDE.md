# CLAUDE.md - Project Context

## Project Overview
DND 多人协作跑团工具 - A real-time collaborative D&D (Dungeons & Dragons) web tool supporting map sharing, token movement, drawing, character cards, and dice rolling between DM and players.

Copyright (c) 2026 Mingwei Yan. All rights reserved. No unauthorized commercial use.

## Tech Stack
- **Backend**: Node.js + Express 5 + Socket.IO 4（+ ws：连 ASR 的 WebSocket 客户端）
- **Frontend**: Vanilla HTML/CSS/JavaScript + Canvas API
- **Data**: JSON files (characters, character notes, chat history) + text files (notes), no database
- **Dev**: nodemon for hot reload

## File Structure
```
coc_app/
├── server.js              # Main server, Socket.IO events
├── package.json           # Dependencies: express, socket.io, ws（ASR WebSocket）, nodemon
├── nodemon.json           # Watch config: watches server.js/lib/public, ignores data/
├── .env.example           # Key 占位（DEEPSEEK_API_KEY / ASR_API_KEY），真实值在 .env
├── lib/
│   └── voice-roll/        # 语音掷骰（服务端）。对 server.js 只暴露 registerVoiceRollHandlers
│       ├── index.js           # 唯一入口：voice:* 事件、pendingIntents 待确认表
│       ├── vocab.js           # 属性/技能/别名/ASR 错字/热词的单一数据源
│       ├── intent.js          # parseRollIntent 规则匹配 + validateIntent 严格校验
│       ├── llm.js             # classifyWithDeepSeek 兜底分类（只输出枚举）
│       ├── asr.js             # ASR adapter：阿里云实时识别 WebSocket 会话
│       ├── system-prompt.txt  # llm.js 的 system prompt 原文（改它也会触发 nodemon 重启）
│       └── dice.js            # 调整值、中文标签、表达式、crypto 掷 d20
│   └── recap/             # 前情提要（服务端）。对 server.js 只暴露 createRecap({io, filePath, deepseek, asr}).register(socket, {getPlayer})
│       ├── index.js           # 唯一入口：recap:* 事件、录音会话（按 5 分钟一段轮换 ASR 连接）、处理阶段广播
│       ├── store.js           # recap.json 读写（500ms 防抖）、DM 手改的清洗、AI 修订稿整份替换、清空
│       ├── summarize.js       # summarizeRecap：调 DeepSeek，在当前内容上修订，输出完整的 {brief, people, changes}
│       ├── context.js         # 读人名对照表 + 世界观背景，拼 ASR 热词串 / DeepSeek 输入
│       ├── checklist.json     # 人名对照表（玩家 + NPC/势力，含别名、一句话身份）
│       ├── world-background.txt # 世界观背景（DM 自行补充）
│       └── system-prompt.txt  # summarize.js 的 system prompt
├── public/
│   ├── index.html         # Login page (~229 lines)
│   ├── game.html          # Main game UI (inline CSS+JS, Konva VTT model)
│   └── voice-roll/        # 语音掷骰（前端）：预览卡片与麦克风按钮
│       ├── voice-roll.js      # VoiceRoll.init({socket, mountEl, isDM, getMyCharacter, getEnabled, escapeHtml})
│       ├── pcm-worklet.js     # AudioWorklet：48kHz Float32 → 16kHz PCM16 单声道
│       └── voice-roll.css
│   └── recap/             # 前情提要（前端）：Recap.init({socket, mountEl, isDM})，渲染 #panel-recap 的内容
│       ├── recap.js           # 录音复用 /voice-roll/pcm-worklet.js
│       └── recap.css
├── scripts/
│   └── test-voice-intent.js   # 离线跑语音掷骰纯函数的用例表（node scripts/test-voice-intent.js）
├── data/
│   ├── characters.json        # Character card data (name-keyed object)
│   ├── characters_notes.json  # Character records table [{name, info}]
│   ├── chat_history.json      # Last 100 chat + dice entries (FIFO); private ones carry `to`
│   ├── map_assets.json        # Map image assets { assetId: { base64, originalWidth, originalHeight } }
│   ├── world.json             # World state (placedMaps, tokens, npcs, freeDrawings, rects, fogRects)
│   ├── ui_prefs.json          # DM pen/rect colors + per-user float panel layouts
│   ├── recap.json             # 前情提要 { brief, people: [{name, note}], updatedAt, pendingTranscript }
│   └── notes.txt              # Shared notes (plain text)
└── images/                # (legacy, no longer used)
```

## Architecture
- Single-room game instance per server (no multi-room)
- Event-driven via Socket.IO with `namespace:action` pattern (e.g., `placedMap:add`, `token:move`)
- Role-based: DM vs Player, DM password is `12138`
- **Konva VTT model**: map canvas is a shared Konva.Stage world; all objects (maps, tokens, NPCs, drawings) use grid coordinates (`gridX/gridY`, 1 grid = 50px at zoom=1)
- Game state lives in memory (`gameState` object in server.js), persisted to files for characters, character notes, shared notes, chat history, map assets, and world state
- All CSS and JS are inline in HTML files — **一个有意的例外**：语音掷骰的前端在 `public/voice-roll/*.{js,css}`（功能较大，且 `game.html` 已 5600 行），由 `game.html` 用 `<link>` / `<script src>` 引入，依赖通过 `VoiceRoll.init(...)` 显式传入
- **Fullscreen-map shell**: there is no sidebar or tab bar. The Konva map fills the viewport (`#viewport` is `position: fixed; inset: 0`) and every other surface is a frosted `.float-panel` summoned from a liquid wall button (`.rail-btn` in `#left-rail` / `#right-rail`, plus `#chat-rail-btn` in `#bottom-bar`). Hovering a wall button for `OPEN_DELAY` (350ms) opens its panel transiently — a passing cursor triggers nothing. Leaving closes it after `HIDE_DELAY` (300ms) — enough to cross the gap from button into the panel, which keeps it open. There is no pin button: a panel becomes **pinned** when the user clicks its wall button, interacts with anything inside it (`mousedown` / `focusin`), or drags it; it is **unpinned** by the panel's ✕ or by clicking the same wall button again. A transiently-opened panel is placed by `findFreeSpot()` so it avoids already-pinned panels; a pinned panel always returns to its exact saved coordinates
- **Independent viewport**: every client controls their own zoom/pan on the Konva stage; transforms are not broadcast
- **World authority**: server holds canonical `world` object; all mutations go through socket events with DM guard; undo/redo stack maintained server-side (20 entries, memory only)

## Key Conventions
- **Language**: UI text and comments in Chinese (简体中文), code identifiers in English
- **Variables**: camelCase for JS, kebab-case for CSS classes/HTML IDs, UPPERCASE for constants
- **Booleans**: `is*` prefix (isDM, isLocked, isPainting)
- **Functions**: named `function` declarations for top-level, arrow functions for callbacks
- **Socket events**: `namespace:action` pattern (e.g., `character:save`, `draw:path`)
- **Permissions**: guard clause pattern `if (player?.role !== 'DM') return;`
- **Error handling**: try/catch with `console.error('中文描述:', err)`
- **Strings**: template literals with Chinese text

## Socket.IO Event Map

### Client -> Server
| Namespace | Events |
|-----------|--------|
| Auth | `join`, `selectColor`, `player:leave` |
| Layout | `layout:save` (per-user float panel x/y/pinned) |
| MapAsset | `mapAsset:upload`, `mapAsset:fetch` |
| PlacedMap | `placedMap:add`, `placedMap:move`, `placedMap:resize`, `placedMap:setLock`, `placedMap:remove` |
| Token | `token:spawn`, `token:move`, `token:clearAll` |
| NPC | `npc:spawn`, `npc:move`, `npc:remove`, `npc:clearAll` |
| Draw | `draw:freeStroke`, `draw:rect`, `draw:liveStroke`, `draw:remove`, `draw:clearAll` |
| History | `history:undo`, `history:redo` |
| Character | `character:list`, `character:load`, `character:save`, `character:delete`（仅 DM）, `character:setHp`, `character:summarize` |
| CharacterNotes | `characterNotes:update` |
| VoiceRoll | `voice:start`, `voice:chunk`（ArrayBuffer，16kHz PCM16 单声道）, `voice:stop`, `voice:cancel`, `voice:confirm`（`{ intentId }`）, `voice:text`（`{ text, via }`：跳过 ASR 直接喂文本，`via='text'` 是聊天框 @ai） |
| Recap | `recap:fetch`（任何人）；DM 专用：`recap:start`, `recap:chunk`（ArrayBuffer，16kHz PCM16 单声道）, `recap:stop`（`{ brief, people }`＝文本框当前内容）, `recap:cancel`, `recap:retry`（同上）, `recap:update`（`{ brief, people }`）, `recap:clear`, `recap:text`（调试：跳过 ASR） |
| Other | `chat:message`（payload `{ message, to }`，`to` 为玩家名时是私聊）, `dice:roll`, `notes:update` |

### Server -> Client
| Event | Description |
|-------|-------------|
| `mapAsset:uploaded` | Confirms asset saved, returns `assetId` |
| `mapAsset:fetched` | Returns base64 asset data on demand |
| `placedMap:added/moved/resized/lockSet/removed` | World map mutation broadcasts |
| `token:spawn/move/clearAll/remove` | Token state broadcasts |
| `npc:spawn/move/remove/clearAll` | NPC state broadcasts |
| `draw:freeStroke/rect/liveStroke/remove/clearAll` | Drawing broadcasts |
| `world:sync` | Full world snapshot after undo/redo |
| `character:deleted` | DM 删卡后广播 `{ name, names }`：各端刷新名单；卡主清空血条与掷骰可用性，正在查看这张卡的面板关掉 |
| `characterNotes:sync` | Broadcasts updated character records |
| `roster:sync` | Broadcasts online roster `[{ name, role, color, online }]` (join / color pick / disconnect / grace expiry) |
| `chat:message` | Chat payload; carries `to` + `toRole` when private (sent only to sender + target) |
| `chat:error` | Private-message failure sent back to sender only (offline target / self-whisper) |
| `chat:notice` | Sender-only hint that the whisper target is mid-grace and will receive it on reconnect |
| `voice:intent` | 语音掷骰的识别结果预览，**只发给说话者**：`{ intentId, transcript, intent, label, expr, modifier, source, confidence, autoConfirm }` |
| `voice:partial` | 录音中的实时转写，只发给说话者 |
| `voice:error` | 语音掷骰的中文错误提示，只发给说话者（没听清是哪项豁免 / 没听懂 / 未找到同名角色卡 / 说太快了） |
| `recap:sync` | 前情提要全文 `{ brief, people: [{name, note, known}], updatedAt }`；`known=false` 表示对照表里没有、AI 新加的名字 |
| `recap:status` | 处理阶段（公开广播）`{ phase: idle/recording/transcribing/summarizing, message, canRetry, asrEnabled, llmEnabled }` |

## Data Models

### gameState (server.js)
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, color, role }>,
  notes: "string",
  characterNotes: [{ name, info }],
  chatHistory: [{ type: 'chat'|'dice', name, role, ..., to?, toRole?, timestamp }],  // max 100, FIFO; `to` marks a private message
  // 语音掷骰的 dice 条目额外带 { kept, advantage, label, source: 'voice' }
  // 命中投还带 { modifierParts: [{name, value, note}], transcript, intentSource: 'rule'|'llm' }
  mapAssets: { "asset_xxx": { base64, originalWidth, originalHeight } },
  uiPrefs: { penColor, rectColor, layouts: { "<userName>": { "<panelId>": { ax, ox, ay, oy, pinned, x, y } } } },
  world: {
    placedMaps: [{ id, assetId, gridX, gridY, gridWidth, isLocked, isBound }],
    tokens:     [{ id, color, gridX, gridY }],
    npcs:       [{ id, gridX, gridY, color }],
    freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
    rects:        [{ id, gridX, gridY, gridW, gridH, color, strokeWidth }],
    fogRects:     [{ id, x, y, w, h }]
  }
}
```

### Character Card (data/characters.json)
```javascript
{
  "CharName": {
    name, hp: { cur, max },
    ac,                 // 护甲等级，默认 12；老卡没有这个字段，前端按 DEFAULT_AC 显示、保存时补上
    proficiencyBonus,
    attributes: { strength, dexterity, constitution, intelligence, wisdom, charisma },
    savingThrows: [],   // max 2
    skills: [],         // max 4
    feats: [{ name, description }],
    aiSummary: { text, fingerprint, at }   // DeepSeek 生成的一句话总结 + 输入指纹（可选字段）
  }
}
```

## Commands
```bash
npm install     # Install dependencies
npm run dev     # Development server (nodemon, http://localhost:3000)
npm start       # Production server
```

## Important Notes
- HTML **and the standalone `.js` / `.css` under `public/voice-roll/`** are served with `Cache-Control: no-cache` (see the `express.static` options): nearly every CSS and JS byte is inline in the HTML, so a cached HTML freezes the entire frontend on an old build — and a cached `voice-roll.js` freezes that module the same way. `no-cache` only forces ETag revalidation — unchanged content still returns 304
- **护甲（AC）**在角色卡顶栏的「血量」和「熟练加值」之间，编辑方式跟熟练加值一样（编辑模式下的 number 输入框）。默认 `DEFAULT_AC = 12`，`characters.json` 里的老卡没有 `ac` 字段，读卡时按默认值显示、保存时补上。它**没有**进 `characterFingerprint()`：AI 总结讲的是「这个人擅长什么」，护甲不改变那个结论，算进去只会让所有卡的缓存白白失效
- **iPad 的双指捏合**被接管成地图缩放（`initStagePinchZoom`）。Safari 默认把捏合当成缩放整个页面（放大顶飞布局、缩小退到标签页总览），要三道一起上才拦得住：`<meta name="viewport">` 的 `user-scalable=no, maximum-scale=1`、`#viewport { touch-action: none }`、以及全局 `preventDefault` 掉 Safari 专有的 `gesturestart/gesturechange/gestureend`。少任何一道都还会漏。接管后双指同时支持缩放和平移（按两指中点换算，和滚轮缩放共用 `MIN_ZOOM/MAX_ZOOM` 夹紧）；第二根手指落下时要 `konvaStage.stopDrag()`，否则 Konva 会继续跟着第一根手指甩画布
- **AI character summary**: `character:summarize` calls DeepSeek server-side (`DEEPSEEK_API_KEY` env var — never exposed to the client) and caches the result in the character's `aiSummary`. The cache key is `characterFingerprint()`, a hash of the fields that actually change the conclusion (attributes / proficiency / saves / skills / feats) — editing HP does not trigger regeneration. Model is `deepseek-flash` with `thinking: { type: 'disabled' }`; the reasoning variant costs 3-4x for no benefit on this task
- **语音掷骰（voice roll）**：玩家复述 DM 让自己做的检定（「带优势的隐匿」「过魅力豁免」「撬个锁」「命中投」），系统判出「哪类检定 × 哪一项 × 优劣势」，服务端掷 d20 并在聊天里发一张带标签的骰子卡片。实现全部在 `lib/voice-roll/`（服务端）和 `public/voice-roll/`（前端），`server.js` / `game.html` 只做接线
- 意图类型：`ability` / `save` / `skill` / `attack`（命中投）/ `initiative` / `deathSave`
- **命中投的意图结构**：规则层和 LLM 都只输出 `weaponClass`（8 类，见 `vocab.js` 的 `WEAPON_CLASSES`）+ `proficiencyOverride`（true=明说加 / false=明说不加 / null=没说）；`key`（`melee`/`ranged`/`finesse`）和「加不加熟练」**一律由服务端查表派生，不信任 LLM 给的值**。这样属性和熟练的来源都可追溯，卡片才写得出理由
- **命中投的熟练**：按武器决定，玩家可口头覆盖——刀类、棍棒类、徒手默认加 PB；其余（未提武器、临时武器、枪弓弩、斧锤撬棍、短剑细剑）默认不加；玩家明说「加熟练 / 不加熟练」优先于武器默认。「熟练」只对命中投生效，其他检定类型里提到一律忽略（它们的熟练由角色卡决定）
- **命中投的属性**：`melee` 用力量，`ranged` 用敏捷，`finesse`（刀匕首）**以及没提武器时**取力量/敏捷中较高的、相等记为敏捷（本桌规则）。`buildAttackPlan(card, intent)` 一次算出属性、是否加熟练**和两者的理由**，调整值 / label / 卡片明细全都从它出，别各算一遍
- **可观测性（用户硬性要求）**：命中投的卡片要让任何人只看这一张卡就能复核——明细行逐项写出数值和理由「15 + 3 敏捷（刀类·力敏取高）+ 2 熟练（刀类·默认熟练）= 20」，没加熟练也要显示「未加熟练（未提武器·默认不加）」；再加一行灰色小字「识别自：「原话」· 规则/AI」。对应字段是 `modifierParts`（每项带 `note`）、`transcript`、`intentSource`，和 `label` 一样必须同时走实时广播与历史回放
- 明细行的排版（各段空一格、全角「）」后不留空格）在 `lib/voice-roll/dice.js` 的 `formatModifierBreakdown` 和 `game.html` 的 `buildDiceCard` 里**各有一份**（前端拿不到 `lib/`），改一边要改另一边；`scripts/test-voice-intent.js` 按方案 §10 的表逐字校验服务端那份
- 伤害骰第一版不支持：文本里出现「伤害 / damage」直接回 `voice:error`「暂不支持伤害骰」。这一步排在攻击判定**之前**，否则「攻击伤害」会被当成命中投投出去
- 意图识别是**规则优先、DeepSeek 兜底**：`parseRollIntent()` 覆盖绝大多数说法（0ms、0 成本、不会幻觉），判不出来才调 LLM。**LLM 只输出意图枚举，不掷骰、不算数、不碰角色卡数值**——它的随机数不可信、算术偶尔出错。LLM 返回的 JSON 一律过 `validateIntent()` 严格校验，任何一项不合法都按「没听懂」处理
- 规则层只认明确的攻击触发词（命中投 / 攻击检定 / attack roll / to hit…）；只描述动作的（「我砍他一刀」「偷袭」）交给 LLM。「偷袭」判成命中投而不是隐匿，「擒抱」判成运动而不是命中投——这些歧义写在 system prompt 里
- 「豁免」是**硬规则**：转写文本里出现「豁免」就走豁免路径，不交给 LLM；说了豁免却没说是哪一项 → 直接报错「没听清是哪项豁免」，不猜也不调 LLM。规则表里**只放无歧义的别名**（「撒谎」这种——自己说谎是欺瞒、看别人说谎是洞悉——必须留给 LLM）
- 数值口径：角色卡 `attributes` 里存的**已经是调整值**，不要再做 `(score-10)/2`；属性检定/比拼用纯属性调整值不加熟练（本桌规则）；不熟练的技能照样加对应属性调整值，只是不加 PB
- 掷骰在**服务端**用 `crypto.randomInt`（现有的 `dice:roll` 事件是直接信任客户端传来的 `result` 的，语音路径借机把掷骰收回服务端）。优势/劣势掷两次，`rolls` 存两颗、`kept` 存实际采用的那颗；`buildDiceCard` 的大成功/大失败按 `kept` 判断，**不能**把两颗骰子相加
- 识别结果先以预览卡片给说话者本人看：高置信度 1.5 秒倒计时自动投（可取消），低置信度必须点一下。听错后投出去的骰子是公开的、收不回来。待确认意图存在 `pendingIntents`（内存、30 秒过期、只认发起的那个 socket、确认后立即删除，一条识别只能投一次）
- **打字掷骰（聊天框 `@ai`）**：`@` 建议框里 `ai` 固定排在最后一项，选它插入 `@ai `，后面写要投什么（「@ai 带优势的隐匿」）。发送时 `sendChat` 分流到 `VoiceRoll.rollFromText()`，走的是**和语音完全同一条链路**（规则 → LLM 兜底 → 预览卡片 → 确认 → 服务端掷骰），只是不经过 ASR，因此**不需要 ASR key**；DM 和没有同名角色卡的人看不到这一项（`VoiceRoll.canRollFromText()`）。只认开头的 `@ai`——句中的 `@ai` 更可能是在跟人聊 AI，仍按普通聊天发送。服务端对文字入口有 1 秒冷却（规则判不出来时会调 LLM）
- 结果条目的 `source` 区分输入方式：`'voice'`（说的）/ `'text'`（打的），卡片来源行据此写「识别自」或「来自输入」
- `voice:text`（Client → Server）同时也是调试入口：浏览器控制台里 `VoiceRoll.debugText('带优势的隐匿')` 可跳过 ASR 直接喂文本。纯函数层另有 `node scripts/test-voice-intent.js` 跑用例表（它同时导出用例表，可以把同一份期望值灌进 `@ai` 通道做端到端比对）
- LLM **调不通**（超时/网络断/接口报错）和「听懂了但判不出来」要分开报：前者回「AI 判定服务暂时不可用」，报成「没听懂」会让玩家以为是自己说得不清楚、白白重说好几遍
- ASR（语音转文字）走阿里云 Model Studio 的实时识别 WebSocket，默认接入地址是国际站通用域名 `wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference`——文档上写的是按 workspace 分的 `wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/…`，但通用地址实测可用且不需要 WorkspaceId；要换地域/账号用 `ASR_WS_URL` / `ASR_WORKSPACE_ID` / `ASR_REGION` 覆盖。模型 `ASR_MODEL`（线上用 `qwen-audio-3.1-asr-flash-streaming`），key 在 `ASR_API_KEY`，和 `DEEPSEEK_API_KEY` 一样**只存在于服务端**，浏览器永远不直连 ASR
- 音频约定 **16kHz / PCM16 LE / 单声道**，前端 `pcm-worklet.js` 负责从设备采样率（通常 48kHz）降下来，每 100ms 一帧。`run-task` 里带 `input.context` 热词串（`ASR_CONTEXT_PROMPT`）——「豁免」「奥秘」「劣势」这些低频词不给上下文很容易写成同音错字，而「豁免」正是判豁免路径的硬规则依据
- 麦克风按钮按住说话、松开发送；DM 隐藏，没有同名角色卡或服务端没配 ASR key（`joinSuccess` 的 `voiceRollEnabled`）时禁用。单次录音上限 8 秒（前端自动松手 + 服务端按字节数兜底），同一 socket 两次开录间隔 2 秒。`getUserMedia` 需要 HTTPS 或 localhost
- **前情提要（recap）**：左侧第五个按钮「前情」。DM 点「开始录制」（点一下开始、再点一下结束，**不用按住**）口述之前的剧情，转写**不回显**给前端；结束后把「转写 + 人名对照表（`lib/recap/checklist.json`）+ 世界观背景（`lib/recap/world-background.txt`）+ 当前前情与人物」交给 DeepSeek，输出修订后的完整 `{ brief, people, changes }`。面板左 70% 正文、右 30% 重要人物表。实现全部在 `lib/recap/` 与 `public/recap/`，`server.js` / `game.html` 只做接线（`game.html` 里只有按钮和空的面板外壳）
- 人名纠错两道：对照表同时作为 ASR 热词（`cfg.contextPrompt`，覆盖 `asr.js` 默认的掷骰黑话）和 DeepSeek 的纠错依据。对照表里没有、AI 认为重要的新名字 `known=false`，DM 视角标黄色「新」提醒核对写法；DM 改过这个名字后标记消失
- 再次录制**不是追加**：DeepSeek 以当前内容为底稿，自己判断这次口述是续写、补细节、纠正还是删除，返回**修订后的完整**正文和人物表，服务端整份替换（不再合并，否则按口述删掉的会被加回来）。口述没涉及的部分要求原样保留 DM 的文字；`changes` 一句话说明改了什么，显示在 DM 的状态栏
- 修订底稿**一律取自 DM 前端的文本框**（DM 会手改）：`recap:stop` / `recap:retry` / `recap:text` 都带着文本框当前内容，服务端先 `setContent` 再总结，所以还在 400ms 防抖里没发出去的手改也不会漏。转写 / 总结期间编辑框只读——结果回来会整份覆盖
- 兜底：模型输出 `{"unchanged": true}`（口述里没剧情）时不改动；原本有内容、修订稿却是空的，视为出错，保留原内容并允许重试——真要清空走「清空」按钮
- 「清空」只有 DM 有，点两下（第一下变红色「确认清空？」，3 秒内再点才生效），走 `recap:clear`：正文、人物和存着的未总结转写（`pendingTranscript`）一起清掉，否则「重试总结」会把旧讲述带回来
- 转写结果**先存盘**（`pendingTranscript`）再总结：DeepSeek 失败时 DM 可点「重试总结」，不用再讲一遍。长录音按 5 分钟一段轮换 ASR 连接，某段出错时用 `err.partialText`（`asr.js` 出错时带出已识别文本）保住已识别的部分并重开一段；连续 3 次失败才收尾。上限 30 分钟；DM 掉线时照常收尾去总结
- 权限：只有 DM 能录制和编辑（服务端 `role === 'DM'` guard），玩家只读；没有内容时玩家看到「等待 DM 进行讲述…」，DM 录制 / 总结中时看到对应状态。调试：DM 控制台 `Recap.debugText('……')` 跳过 ASR
- `data/` is **git-ignored**. Production (`NODE_ENV=production`) reads and writes the Render persistent disk at `/data`; the repo's `data/` is only a local dev snapshot, so untracking it cannot affect deployed data. `map_assets.json` alone runs to tens of MB of Base64
- Map images are Base64-encoded and can be large (50MB max buffer); stored in `data/map_assets.json`
- World state persisted to `data/world.json`; debounced 500ms on every mutation
- Notes, character records, and chat history writes are debounced at 500ms
- Chat history retains last 100 entries total (chat messages + dice rolls), older entries dropped FIFO; system messages (joins/leaves) are NOT persisted
- Private messages (`@` mentions) are visible to **sender + target only** — the DM is NOT an implicit observer of player-to-player whispers; `joinSuccess` filters `chatHistory` per user via `isChatEntryVisibleTo()`
- `@所有人` is a normal public broadcast (highlighted client-side), not a private message
- Client keeps `rosterData` (from `roster:sync`) — it drives the `@` suggestion popup, avatar colors, and `@` highlighting; the chat is re-rendered from `chatLog` whenever the roster changes
- Chat entries carry a `kind` (`chat` / `system` / `dice`) and render through `chatNodesFor(entry, prev)`, which needs the *previous* entry: consecutive messages from the same sender within `GROUP_WINDOW_MS` (5 min) are grouped (`.grouped` hides the repeated avatar and sender row), and a date change between two entries inserts a `.chat-day-divider` — which also breaks the group
- Dice rolls render as a `.dice-card` (roller, expression, breakdown, total), not as a system message. A single d20 showing 20 or 1 gets the `crit` / `fumble` treatment. `dice:result` carries the same `timestamp` as its history entry so a live roll and a replayed one look identical
- `renderMessageHtml()` scans for `@mentions` and `http(s)` URLs in one pass, so the two can't cut each other apart. Only `http`/`https` are linkified; trailing sentence punctuation is pushed back out of the href. `escapeHtml()` is implemented via `textContent`, which does **not** escape quotes — anything going into an attribute must use `escapeAttr()`
- New messages only auto-scroll when the user is already near the bottom (`isChatAtBottom()`); otherwise `#chat-jump-latest` appears instead of yanking them away from the history they were reading. Messages over `FOLD_CHARS` (420) render folded with a 展开/收起 toggle
- A message is a **column**: the header (`.panel-sender`, and `.panel-private-tag` when private) sits above a `.panel-row` holding the avatar and the bubble, so the avatar is always level with the **bubble**, never with the name. Anything that renders above the bubble must live in that header and carry `margin-left: 36px` (avatar 28px + gap 8px) — `margin-right` for `.mine` — or it will both misalign and push the avatar up a line. `.panel-body` is `align-items: flex-start` (not the default `stretch`) so a short bubble hugs its text instead of being stretched to the sender row's width
- 输入法**组字中的回车不发送**：`handleChatKeypress` 开头就用 `e.isComposing || e.keyCode === 229` 挡掉。中文输入法下打英文时不会切回英文输入法，回车是用来把字母上屏的，没有这道守卫就会把没写完的消息发出去（`keyCode === 229` 是部分浏览器在组字期间的同义写法，两个条件都要判）
- The chat input keeps a shell-style history (`chatInputHistory`, in memory, last 50, consecutive duplicates collapsed). ↑/↓ walk it and ↓ past the newest entry restores the draft the user was typing (`chatHistoryDraft`). The `@` popup claims the arrow keys first when it is open, so the two never fight. It is mirrored into `sessionStorage` under `chatInputHistory:<userName>` so a reload keeps it — reloading is routine here, since a new build only arrives that way. Every read and write is wrapped: a disabled or full store degrades to in-memory history rather than breaking the chat, and a corrupt value loads as empty
- Notes panel split into left (shared textarea) and right (登场人物 table with name/info columns)
- Player colors: orange, yellow, green, blue, purple (5 slots)
- **角色卡删除（仅 DM）**：`已创建的角色卡` 每行一个小红 ✕，点第一下变红底的「确认删除？」，3 秒内再点才真的删（和前情提要的清空按钮同一套两步确认）。删的是 `characters.json` 里的整张卡，收不回来
- **受保护的角色卡**：`PROTECTED_CHARACTERS`（默认 `V,艾琳,Forsyth,禾易苇`，可用同名环境变量覆盖）里的卡谁都删不掉。前端把这几行的 ✕ 换成 🔒，但**真正的拦截在服务端**——客户端是可以被绕过的
- DM-only UI elements use `.dm-only` CSS class
- Grid: 1 grid = 50px (`GRID_SIZE`) at zoom=1; all object coords in `gridX/gridY` (float)
- Grid rendered as Konva.Line in `gridLayer` (`strokeWidth = 1/scale`), sharing the stage transform. It was originally a CSS `background-image` overlay, which visibly drifted from the map edges under zoom because an overlay and the Konva canvas are two independent render pipelines — **do not go back to drawing the grid in CSS**. `onStageTransformChanged()` must end with `konvaStage.batchDraw()`, or the canvas keeps stale content after a programmatic transform
- Layers, bottom to top: `gridLayer` / `staticLayer` (settled objects) / `dynamicLayer` (whatever is being dragged or drawn). Konva is loaded from a CDN, not npm — the frontend stays a pure static page
- Snapping: tokens, NPCs, rects and placed maps snap to the grid; **free drawings do not**. Map rotation is not supported
- `placedMaps[].isBound` (on by default) makes a map carry its contents: moving or resizing it moves the tokens, NPCs, drawings, rects and fog rects it encloses. Token/NPC scale anchor is `placed.gridX + (orig + 0.5 - placed.gridX) * scale - 0.5`; free drawings are remapped by pixel anchor; all four rect fields scale. When two `isBound` maps enclose the same object, the first match in `placedMapsData` wins
- Undo/redo stack: 20 entries each, server-side memory only, cleared on restart
- `io.emit` used for all world mutations (no per-player filtering)
- **Disconnect grace period** (`DISCONNECT_GRACE_MS`, default 120s, overridable via env): a dropped socket does NOT mean the player left. Browsers (Safari especially) suspend background tabs, which kills the Socket.IO heartbeat. On `disconnect` the player is only flagged `online: false` — roster entry, token, and color are all retained — and a timer runs `finalizePlayerLeave()` when it expires. Reconnecting with the same name+role inside the window silently takes over the old session (`takeOverPreviousSession()`), with no `playerJoined` system message
- A DM's seat is held for the whole grace window; only the same name may reclaim it
- Float panel positions persist **per user name** in `data/ui_prefs.json` under `layouts[name][panelId]` (there are no accounts, so the name is the identity). `joinSuccess` returns the caller's bucket as `layout`; the client replays pinned panels on load
- A panel's position is stored as an **anchor**, not absolute pixels: `{ ax: 'left'|'right', ox, ay: 'top'|'bottom', oy }` — which edge the panel sits nearer to, and its distance from that edge. Browser zoom changes the viewport's size in CSS pixels, so an absolute `x/y` saved at one zoom level lands off-screen at another, gets pulled back by `clampToViewport`, and the original position is then lost for good (the DOM only holds the clamped value). `resize` / `ResizeObserver` therefore re-derive the position from `savedLayout` via `relayoutPanel()` rather than nudging `offsetLeft/offsetTop`. Legacy entries that only have `x/y` are upgraded to anchors in place the first time `resolveSavedPos()` reads them; `x/y` are still written alongside for readability but are never read once anchors exist
- The HP HUD binds to `myCharacter` (the card whose name equals `userName`), **not** `currentCharacter` (whatever the character panel is showing). A player browsing someone else's sheet must still see their own HP, and the ± buttons must still edit their own card. The DM never sees the bar at all (`isDM` short-circuits `renderHpHud`)
- `character:setHp` ({name, cur, max}) touches only the `hp` field and rebroadcasts `character:hpUpdated`. The HP HUD uses it rather than `character:save` because the full-card save reads the character sheet's DOM inputs, which are empty unless the sheet has been populated — saving from the HUD that way would wipe the card. Players may only set their own (`name === player.name`); the DM may set anyone's
- `player:leave` (the 退出 button) bypasses the grace period entirely — `finalizePlayerLeave()` runs immediately, so a deliberate exit is instant while a suspended tab is not
- `selectColor` compares against colors held by *other* sockets, so a reconnecting player can re-assert their own color
- Whispers to a player mid-grace are accepted and persisted; the filtered history replay delivers them on reconnect
