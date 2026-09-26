# CLAUDE.md - Project Context

## Project Overview
DND 多人协作跑团工具 - A real-time collaborative D&D (Dungeons & Dragons) web tool supporting map sharing, token movement, drawing, character cards, and dice rolling between DM and players.

Copyright (c) 2026 Mingwei Yan. All rights reserved. No unauthorized commercial use.

> **Planned refactor in progress**: see [plan-extend.md](plan-extend.md) for the multi-phase migration of the map subsystem from `<img>` + DOM tokens to a Konva-based grid world (VTT model). Before extending the current map / token / drawing system, check whether the change should instead be folded into that plan.

## Tech Stack
- **Backend**: Node.js + Express 5 + Socket.IO 4
- **Frontend**: Vanilla HTML/CSS/JavaScript + Canvas API
- **Data**: JSON files (characters, character notes, chat history) + text files (notes), no database
- **Dev**: nodemon for hot reload

## File Structure
```
coc_app/
├── server.js              # Main server, Socket.IO events
├── package.json           # Dependencies: express, socket.io, nodemon
├── nodemon.json           # Watch config: ignores data/
├── plan-extend.md         # Konva grid-world refactor plan (Phase 0-9 complete, Phase 10 pending)
├── public/
│   ├── index.html         # Login page (~229 lines)
│   └── game.html          # Main game UI (inline CSS+JS, Konva VTT model)
├── data/
│   ├── characters.json        # Character card data (name-keyed object)
│   ├── characters_notes.json  # Character records table [{name, info}]
│   ├── chat_history.json      # Last 100 chat + dice entries (FIFO); private ones carry `to`
│   ├── map_assets.json        # Map image assets { assetId: { base64, originalWidth, originalHeight } }
│   ├── world.json             # World state (placedMaps, tokens, npcs, freeDrawings, rects, fogRects)
│   ├── ui_prefs.json          # DM pen/rect colors + per-user float panel layouts
│   └── notes.txt              # Shared notes (plain text)
└── images/                # (legacy, no longer used)
```

## Architecture
- Single-room game instance per server (no multi-room)
- Event-driven via Socket.IO with `namespace:action` pattern (e.g., `placedMap:add`, `token:move`)
- Role-based: DM vs Player, DM password is `12138`
- **Konva VTT model**: map canvas is a shared Konva.Stage world; all objects (maps, tokens, NPCs, drawings) use grid coordinates (`gridX/gridY`, 1 grid = 50px at zoom=1)
- Game state lives in memory (`gameState` object in server.js), persisted to files for characters, character notes, shared notes, chat history, map assets, and world state
- All CSS and JS are inline in HTML files (no separate css/js files)
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
| Character | `character:list`, `character:load`, `character:save`, `character:setHp`, `character:summarize` |
| CharacterNotes | `characterNotes:update` |
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
| `characterNotes:sync` | Broadcasts updated character records |
| `roster:sync` | Broadcasts online roster `[{ name, role, color, online }]` (join / color pick / disconnect / grace expiry) |
| `chat:message` | Chat payload; carries `to` + `toRole` when private (sent only to sender + target) |
| `chat:error` | Private-message failure sent back to sender only (offline target / self-whisper) |
| `chat:notice` | Sender-only hint that the whisper target is mid-grace and will receive it on reconnect |

## Data Models

### gameState (server.js)
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, color, role }>,
  notes: "string",
  characterNotes: [{ name, info }],
  chatHistory: [{ type: 'chat'|'dice', name, role, ..., to?, toRole?, timestamp }],  // max 100, FIFO; `to` marks a private message
  mapAssets: { "asset_xxx": { base64, originalWidth, originalHeight } },
  uiPrefs: { penColor, rectColor, layouts: { "<userName>": { "<panelId>": { ax, ox, ay, oy, pinned, x, y } } } },
  world: {
    placedMaps: [{ id, assetId, gridX, gridY, gridWidth, isLocked }],
    tokens:     [{ id, color, gridX, gridY }],
    npcs:       [{ id, gridX, gridY, color }],
    freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
    rects:        [{ id, gridX, gridY, gridW, gridH, color, strokeWidth }]
  }
}
```

### Character Card (data/characters.json)
```javascript
{
  "CharName": {
    name, hp: { cur, max },
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
- HTML is served with `Cache-Control: no-cache` (see the `express.static` options): every CSS and JS byte is inline in the HTML, so a cached HTML freezes the entire frontend on an old build. `no-cache` only forces ETag revalidation — unchanged content still returns 304
- **AI character summary**: `character:summarize` calls DeepSeek server-side (`DEEPSEEK_API_KEY` env var — never exposed to the client) and caches the result in the character's `aiSummary`. The cache key is `characterFingerprint()`, a hash of the fields that actually change the conclusion (attributes / proficiency / saves / skills / feats) — editing HP does not trigger regeneration. Model is `deepseek-flash` with `thinking: { type: 'disabled' }`; the reasoning variant costs 3-4x for no benefit on this task
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
- Notes panel split into left (shared textarea) and right (登场人物 table with name/info columns)
- Player colors: orange, yellow, green, blue, purple (5 slots)
- DM-only UI elements use `.dm-only` CSS class
- Grid: 1 grid = 50px (`GRID_SIZE`) at zoom=1; all object coords in `gridX/gridY` (float)
- Grid rendered as Konva.Line in `gridLayer`; shared stage transform — never misaligns
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
