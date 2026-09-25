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
| Character | `character:list`, `character:load`, `character:save`, `character:setHp` |
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
  uiPrefs: { penColor, rectColor, layouts: { "<userName>": { "<panelId>": { x, y, pinned } } } },
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
    feats: [{ name, description }]
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
- Map images are Base64-encoded and can be large (50MB max buffer); stored in `data/map_assets.json`
- World state persisted to `data/world.json`; debounced 500ms on every mutation
- Notes, character records, and chat history writes are debounced at 500ms
- Chat history retains last 100 entries total (chat messages + dice rolls), older entries dropped FIFO; system messages (joins/leaves) are NOT persisted
- Private messages (`@` mentions) are visible to **sender + target only** — the DM is NOT an implicit observer of player-to-player whispers; `joinSuccess` filters `chatHistory` per user via `isChatEntryVisibleTo()`
- `@所有人` is a normal public broadcast (highlighted client-side), not a private message
- Client keeps `rosterData` (from `roster:sync`) — it drives the `@` suggestion popup, avatar colors, and `@` highlighting; the chat is re-rendered from `chatLog` whenever the roster changes
- Notes panel split into left (shared textarea) and right (登场人物 table with name/info columns)
- Player colors: orange, yellow, green, blue, purple (5 slots)
- DM-only UI elements use `.dm-only` CSS class
- Grid: 1 grid = 50px (`GRID_SIZE`) at zoom=1; all object coords in `gridX/gridY` (float)
- Grid rendered as Konva.Line in `gridLayer`; shared stage transform — never misaligns
- Undo/redo stack: 20 entries each, server-side memory only, cleared on restart
- `io.emit` used for all world mutations (no per-player filtering)
- **Disconnect grace period** (`DISCONNECT_GRACE_MS`, default 120s, overridable via env): a dropped socket does NOT mean the player left. Browsers (Safari especially) suspend background tabs, which kills the Socket.IO heartbeat. On `disconnect` the player is only flagged `online: false` — roster entry, token, and color are all retained — and a timer runs `finalizePlayerLeave()` when it expires. Reconnecting with the same name+role inside the window silently takes over the old session (`takeOverPreviousSession()`), with no `playerJoined` system message
- A DM's seat is held for the whole grace window; only the same name may reclaim it
- Float panel positions persist **per user name** in `data/ui_prefs.json` under `layouts[name][panelId] = { x, y, pinned }` (there are no accounts, so the name is the identity). `joinSuccess` returns the caller's bucket as `layout`; the client replays pinned panels on load
- `character:setHp` ({name, cur, max}) touches only the `hp` field and rebroadcasts `character:hpUpdated`. The HP HUD uses it rather than `character:save` because the full-card save reads the character sheet's DOM inputs, which are empty unless the sheet has been populated — saving from the HUD that way would wipe the card. Players may only set their own (`name === player.name`); the DM may set anyone's
- `player:leave` (the 退出 button) bypasses the grace period entirely — `finalizePlayerLeave()` runs immediately, so a deliberate exit is instant while a suspended tab is not
- `selectColor` compares against colors held by *other* sockets, so a reconnecting player can re-assert their own color
- Whispers to a player mid-grace are accepted and persisted; the filtered history replay delivers them on reconnect
