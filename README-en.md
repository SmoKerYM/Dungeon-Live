[中文版](README.md)

# DND Multiplayer Collaborative TTRPG Tool

A web-based real-time collaborative D&D (Dungeons & Dragons) tool supporting map sharing, token movement, drawing annotations, character sheet management, and dice rolling between DM and players.

**Copyright (c) 2026 Mingwei Yan. All rights reserved.**

![Status](https://img.shields.io/badge/Status-Production_Ready-green)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8+-blue)
![License](https://img.shields.io/badge/License-Personal_Use-blue)

## Features

### Map System (Konva Grid World)
- **Shared Grid World** — Everyone sees the same world; DM manages map instances, players can only observe
- **Map Asset Upload** — DM uploads images saved to the asset library and placed at the world center (default 20 tiles wide)
- **Asset Library** — DM side shows uploaded maps as thumbnails; click to focus the viewport on the placed instance (auto-places a new one if none exists); × deletes the asset and all its placed instances; players also have a read-only thumbnail library with the same focus-on-click behavior
- **Map Binding** — Each placed map defaults to binding mode (📌 button at bottom-left); when enabled, tokens/NPCs/strokes/rects/fog inside the map move and scale together with it
- **Snap-to-Grid** — Dragged map instances snap to the nearest grid intersection
- **Resize Handle** — Bottom-right drag handle resizes width (preserves aspect ratio, snaps to whole tiles)
- **Lock / Delete** — Lock to prevent accidental drags; controls appear on hover
- **Independent Viewports** — Each client controls its own zoom/pan independently

### Fullscreen Map + Floating UI
- **Map fills the screen** — No sidebar, no top tab bar; the Konva grid world covers the whole viewport
- **Liquid wall buttons** — Down the left edge: Maps / Players / NPCs (DM only) / Notes; the right edge holds Character Sheet and Dice. Hovering stretches the button like a liquid drop (the button itself never disappears) and reveals a frosted, rounded floating window
- **Hover delay** — A button must be hovered for 350ms before it opens; a cursor merely passing by triggers nothing; leaving closes it after 300ms, which is enough to move from the button into the window (arriving there keeps it open)
- **Pinned buttons collapse** — Once a window is pinned its button shrinks back to icon-only (keeping the yellow ring), since the window carries its own title; hovering still expands it to icon + label
- **Pinning** — There is no separate pin button: **clicking the wall button**, **interacting with the window's contents** (a click, focusing an input) or **dragging the window** pins it; the window's ✕ or a second click on that wall button unpins and closes it. Pinned windows get a yellow-tinted border
- **Automatic avoidance** — A window opened by hover positions itself to avoid the windows already pinned on screen
- **Drag freely, position remembered** — Drag the header to move a window; on release the position is saved server-side **per user name**, so next time it opens exactly where you left it, pinned state included
- **Zoom-proof** — Positions are stored as an edge anchor (which edge the window sits nearer to, and its distance from it) rather than absolute pixels, so changing the browser zoom level still puts the window back in the same visual place
- **Identity badge** — A translucent pill at top left shows DM/Player, your colour dot and your name
- **HP bar** — A flat capsule health bar sits right beside the identity badge at matching height, **locked to the player's own character sheet**: browsing someone else's sheet still shows your own HP, and the ± buttons still edit your own card. **The DM never sees the bar at all**, whoever they are looking at. Green above 50%, amber 25–50%, red below 25%. Click the bar to edit current/max HP inline; players also get ± buttons for 1 point of healing or damage (max HP still requires clicking the bar). Changes broadcast live to the player list and token tooltips
- **DM in the player list** — The DM appears as the first row of the Players panel
- **Dice** — The dice button sits low on the right edge and opens a tight 2×3 tray (D4/D6/D8/D10/D20/D100) anchored to the bottom-right corner; D12 was dropped as a button but `/d12` and the like still work in chat
- **Horizontal bottom controls** — The DM toolbar runs along the bottom of the screen, with its colour picker opening upward
- **Chat** — A rectangular "chat" button at bottom centre expands on hover and pins on click, draggable like the rest; a red dot appears on it when you are whispered or @-mentioned while it is closed

### Leaving the Game
- **Exit button** — Top-right of the tab bar; after confirming, returns to the name-entry login page and clears the local identity
- **Immediate** — A deliberate exit skips the grace period: the colour is released and the token removed at once, and everyone sees "xxx left the game" straight away

### Disconnect Grace Period
- **Problem** — Browsers (Safari especially) suspend background tabs' JS; the Socket.IO heartbeat dies, the connection is declared dead, and the player vanishes from the roster with their token removed from the map
- **Grace window** — A dropped player is retained for 120s by default (`DISCONNECT_GRACE_MS` env var): dimmed in the roster but still mentionable, token left in place, colour not released
- **Silent reconnect** — Reconnecting with the same name+role inside the window takes over the old session with no "joined the game" message; only a timeout counts as actually leaving
- **DM seat held** — The DM's seat is reserved for the whole window; nobody else can claim it
- **Offline whispers** — Private messages to a dropped player are accepted and delivered via history replay when they return; the sender is told
- **Reconnect on focus** — Returning to the foreground reconnects immediately rather than waiting for backoff

### Roles & Permissions
- **DM/Player Dual Role** — DM has full control; players have restricted permissions
- **Color Selection** — Players choose a unique color (orange/yellow/green/blue/purple)
- **Real-time Player List** — Online players with character info
- **HP Sync** — Sidebar shows character HP; hover over a token to inspect HP and name

### Drawing Tools
- **DM Floating Toolbar** — Vertical toolbar at the top-left of the canvas (DM only): Move / Brush / Rect / Eraser / Fog / Undo / Redo
- **Color Picker** — Activating brush or rect expands a color panel (black/white/red/green + custom); last-used color is persisted to `data/ui_prefs.json`
- **Free Brush** — Draw freehand in world coordinates, no snapping, broadcasts in real time
- **Rectangle Tool** — Corners snap to grid
- **Eraser** — Click to delete a single stroke or rectangle; pop-out menu has three batch buttons: Clear All Strokes / Clear All Players / Clear All NPCs

### Token System
- **Player Tokens** — Konva circles snap to grid; hover shows HP and player name
- **NPC System** — DM spawns multi-color NPCs (rounded rectangles); double-click to delete
- **Permission Isolation** — Players can only drag their own token; DM can move all
- **Batch Clear** — Separate clear for player tokens and NPCs

### War Fog
- **Fog Tool** — DM activates the fog tool from the toolbar and drags to draw rectangular fog masks
- **Visual Layers** — DM sees a light-gray semi-transparent rect (map remains visible); players see a dark mosaic that fully obscures the map
- **Interaction** — DM double-clicks a fog rect to remove it; players cannot interact with fog
- **Binding** — Fog moves and scales with its underlying map (always linked, no isBound switch needed)
- **Persistence** — Saved in `world.fogRects`; survives server restarts
- **Undo** — Ctrl+Z undoes fog add/remove operations

### Undo / Redo
- **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+Shift+Z** to redo (DM only)
- Covers all world edits: map placement/move/resize/lock, token moves, strokes/rects
- Up to 20 steps each direction; server-side memory only, cleared on restart

### Character Sheet System
- **D&D 5e Standard Sheet** — Six attributes, saving throws, skills
- **Dense layout** — Attributes in a 3×2 grid (score and modifier share a cell), HP and proficiency lifted into a top row, saves and skills in two columns; over a third shorter than the original full-page version
- **Feats / Traits** — Multiple feats with name + description
- **Proficiency Bonus** — Auto-calculated proficiency bonuses
- **AI one-line summary** — Beside the character's name, DeepSeek reads that sheet's attributes, proficiency, saves, skills and feats and writes a single sentence reminding the player what this character is actually good at. The result is cached on the sheet behind a fingerprint of the fields that change the conclusion, so editing HP never triggers a regeneration. Requires `DEEPSEEK_API_KEY` server-side; the key is never sent to the browser
- **Persistent** — Character sheets saved to JSON files
- **Auto-load** — Players automatically load their matching character sheet on join

### Shared Notes
- **Real-time Collaborative Editing** — All users edit simultaneously
- **Character Records** — Right-side table for tracking character names and info
- **Debounced Sync** — 500ms debounce to reduce network traffic

### Dice System
- **Standard Dice** — D4, D6, D8, D10, D20, D100 (2×3 tray in the dice panel, with roll animation)
- **Chat Dice Commands** — Type `/d20`, `/2d6+3` etc. to auto-roll with full breakdown
- **Result Broadcast** — All results broadcast to every player
- **Result cards** — Rolls render in chat as their own card (roller, expression, breakdown, large total) instead of blending into system messages; a single d20 showing 20 or 1 is flagged **critical** (green) or **fumble** (red)

### Chat System
- **Real-time Chat** — Text messages with four distinct styles: system / DM / others / self (system messages use a monospace face)
- **Chat History** — Server retains last 100 chat/dice entries; replayed on reconnect
- **@ Private Messages** — Typing `@` opens a Teams-style suggestion popup listing online players, the DM, and `@所有人` (everyone); navigate with arrow keys, confirm with Enter/Tab, dismiss with Esc
- **Private Visibility** — A message containing `@someone` is visible to the **sender and that person only** (the DM does not observe player-to-player whispers); history replay is filtered per user, so others never see it after reconnecting either
- **@Everyone** — Treated as a normal public message, merely highlighted inline
- **Bubble Chat Room** — The chat button at the bottom centre expands on hover and pins on click: circular avatars in each player's chosen colour, own messages right-aligned, others left-aligned, system messages centred, ✕ to close
- **Grouped runs** — Consecutive messages from the same sender within 5 minutes are grouped; only the first carries an avatar and name
- **Timestamps** — HH:MM beside the sender's name, full time on hover; a date change inserts a 今天 / 昨天 / M月D日 divider
- **Clickable links** — http(s) URLs in a message become links (opened in a new tab); trailing sentence punctuation is kept out of the href
- **Long message folding** — Messages over 420 characters fold behind a 展开 (expand) toggle with a gradient hint
- **Scroll is never hijacked** — While you are scrolled up reading history, new messages do not yank you to the bottom; a "↓ 有新消息" pill appears instead
- **Input history** — ↑/↓ recall what you sent before, shell-style — re-rolling is just ↑ then Enter. Kept in `sessionStorage`, so a reload does not lose it

## Getting Started

### Requirements
- Node.js 18 or higher
- npm or yarn

### Installation

1. **Clone the project**
   ```bash
   git clone <repository-url>
   cd coc_app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start dev server**
   ```bash
   npm run dev
   ```

4. **Open the app**
   - Navigate to `http://localhost:3000`

### Production
```bash
npm start
```

## Usage Guide

### First Login
- **DM**: enter password `12138` for full control
- **Player**: no password, limited permissions; choose a color on first join

### Core Operations

#### DM
- **Upload map**: open the Maps panel on the left, then click **＋ 添加地图**
- **Focus map**: click an asset thumbnail to focus the viewport on that instance (auto-places if none exists)
- **Drag / resize**: move tool to drag a map instance; bottom-right handle to resize
- **Lock / delete**: hover map to reveal lock and delete controls
- **Delete asset**: click thumbnail × → confirm → removes asset and all placed instances
- **Binding toggle**: 📌 button at map bottom-left; when on, objects inside move/scale with the map
- **Drawing**: switch brush/rect/eraser via toolbar; draw on empty canvas; move tool pans
- **War Fog**: activate fog tool, drag to draw a fog mask; double-click fog to remove it
- **NPCs**: click a color block to spawn; double-click NPC to delete
- **Undo / redo**: Ctrl+Z / Ctrl+Shift+Z, or click Undo/Redo in the DM toolbar
- **Viewport**: scroll wheel to zoom (0.2×–5×), drag empty space to pan

#### Player
- **Viewport**: scroll to zoom, drag empty space to pan (independent from others)
- **Move token**: drag your own colored token (auto-snaps to grid)
- **Spawn token**: open the Players panel on the left and click your own colour row
- **Roll dice**: click the right dice panel, or type a command in chat
- **Character sheet**: switch to the Character tab

#### Chat Dice Commands
| Input | Meaning | Example output |
|-------|---------|----------------|
| `/d20` | 1d20 | `rolled d20, result: 15` |
| `/2d6` | 2d6 | `rolled 2d6` / `3 + 5 = 8` → **8** |
| `/2d4+3` | 2d4 + 3 | `rolled 2d4+3` / `2 + 3 + 3 = 8` → **8** |
| `/d8-1` | 1d8 − 1 | `rolled d8-1` / `6 − 1 = 5` → **5** |

> After rolling once, press ↑ in the input and hit Enter to roll it again — no retyping.

## Project Structure

```
coc_app/
├── server.js              # Main server (Express + Socket.IO)
├── package.json           # Dependencies
├── nodemon.json           # Hot-reload watch config (ignores data/)
├── .env.example           # Env var template (DEEPSEEK_API_KEY …); .env itself is git-ignored
├── CLAUDE.md              # Project conventions and implementation notes for AI assistants
├── README.md              # Documentation (Chinese)
├── README-en.md           # Documentation (English)
├── public/
│   ├── index.html         # Login page
│   └── game.html          # Main game UI (inline CSS+JS+Konva)
├── data/                      # git-ignored; a local dev snapshot only
│   ├── characters.json        # Character sheet data
│   ├── characters_notes.json  # Character records
│   ├── chat_history.json      # Last 100 chat/dice entries
│   ├── map_assets.json        # Map image assets (Base64)
│   ├── world.json             # World state (maps, tokens, drawings, fog…)
│   ├── ui_prefs.json          # DM drawing colours + per-user float panel layouts (edge anchors)
│   └── notes.txt              # Shared notes
└── images/                # (legacy, unused)
```

## Technical Architecture

### Backend
- **Node.js** runtime
- **Express 5** web server
- **Socket.IO 4** real-time bidirectional communication
- **File system** — JSON / text file persistence

### Frontend
- **Vanilla HTML/CSS/JavaScript** — no framework
- **Konva.js 9** — grid world rendering (maps, tokens, NPCs, strokes, rects)
- **Session Storage** — client-side state

### Architecture Highlights
- **Server-authoritative world**: `gameState.world` is the single source of truth; all mutations go through Socket events with DM guard
- **Independent viewports**: zoom/pan is purely local, never broadcast
- **Server-side undo/redo**: history stack lives on the server; undo/redo results are broadcast to all clients

## Data Models

### Game State (server.js)
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, color, role, online }>,   // online=false means inside the disconnect grace window
  notes: "string",
  characterNotes: [{ name, info }],
  chatHistory: [{ type: 'chat'|'dice', name, role, ..., timestamp }],  // max 100
  mapAssets: { "asset_xxx": { base64, originalWidth, originalHeight } },
  uiPrefs: {
    penColor: "#cc0000",
    rectColor: "#cc0000",
    // Float panel positions, bucketed per user name. ax/ox and ay/oy are
    // "which edge, how far from it", so browser zoom cannot shift them.
    // x/y are written alongside but only for readability.
    layouts: { "<userName>": { "<panelId>": { ax, ox, ay, oy, pinned, x, y } } }
  },
  world: {
    placedMaps:   [{ id, assetId, gridX, gridY, gridWidth, isLocked, isBound }],
    tokens:       [{ id, color, gridX, gridY }],
    npcs:         [{ id, gridX, gridY, color }],
    freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
    rects:        [{ id, gridX, gridY, gridW, gridH, color, strokeWidth }],
    fogRects:     [{ id, x, y, w, h }]
  }
}
```

> **Coordinate system**: 1 tile = 50 px at zoom=1. All objects use `gridX/gridY` (float).

### Character Sheet
```javascript
{
  name: "Character Name",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,
  attributes: { strength, dexterity, constitution, intelligence, wisdom, charisma },
  savingThrows: ["dexterity"],  // max 2
  skills: ["stealth"],          // max 4
  feats: [{ name: "Feat Name", description: "..." }],
  // DeepSeek one-liner; fingerprint hashes only the fields that change the
  // conclusion, so editing HP never triggers a regeneration
  aiSummary: { text: "…", fingerprint: "…", at: 1758800000000 }   // optional
}
```

## Socket.IO Events

### Client → Server
| Namespace | Events |
|-----------|--------|
| Auth | `join`, `selectColor`, `player:leave` |
| Layout | `layout:save` (per-user float panel anchor/pinned) |
| MapAsset | `mapAsset:upload`, `mapAsset:fetch`, `mapAsset:remove` |
| PlacedMap | `placedMap:add`, `placedMap:move`, `placedMap:resize`, `placedMap:setLock`, `placedMap:setBound`, `placedMap:remove` |
| Token | `token:spawn`, `token:move`, `token:clearAll` |
| NPC | `npc:spawn`, `npc:move`, `npc:remove`, `npc:clearAll` |
| Draw | `draw:freeStroke`, `draw:rect`, `draw:liveStroke`, `draw:remove`, `draw:clearAll` |
| Fog | `fog:add`, `fog:remove` |
| History | `history:undo`, `history:redo` |
| Character | `character:list`, `character:load`, `character:save`, `character:setHp`, `character:summarize` |
| Other | `chat:message` (payload `{ message, to }`; `to` makes it a whisper), `dice:roll`, `notes:update`, `characterNotes:update`, `uiPrefs:save` |

### Server → Client
| Event | Description |
|-------|-------------|
| `joinSuccess` | Join confirmed with full world snapshot |
| `mapAsset:uploaded` | Asset upload confirmed |
| `mapAsset:fetched` | Base64 asset data returned on demand |
| `mapAsset:removed` | Asset deletion broadcast |
| `placedMap:added/moved/resized/lockSet/boundSet/removed` | Map instance mutation broadcasts |
| `fog:added/removed` | Fog rect mutation broadcasts |
| `token:spawn/move/clearAll/remove` | Token state broadcasts |
| `npc:spawn/move/remove/clearAll` | NPC state broadcasts |
| `draw:freeStroke/rect/liveStroke/remove/clearAll` | Drawing broadcasts |
| `world:sync` | Full world snapshot after undo/redo |
| `dice:result` | Dice result broadcast |

## Deployment

### Local Development
```bash
npm run dev  # nodemon hot reload
```

### Production
```bash
npm start
```

### Cloud

#### Render (recommended)
1. Create a Web Service, connect GitHub repo
2. **Mount a Persistent Disk** to `/data` and set `NODE_ENV=production` — required or data is lost on restart
   - In production every read and write goes to the persistent disk at `/data`, unrelated to the repo's `data/`, which is git-ignored and only a local dev snapshot
3. For the AI character summary, add `DEEPSEEK_API_KEY` under Environment Variables

#### Railway
```bash
npm install -g @railway/cli && railway login && railway init && railway up
```

#### AWS EC2
1. Launch a t2.micro instance, install Node.js
2. Use PM2 to keep the process alive, set up Nginx reverse proxy

## Security

- **DM password**: role `DM` requires password `12138`
- **Permission isolation**: all DM-only socket handlers have server-side guard clauses
- **Session management**: `sessionStorage` for client-side user state

## Troubleshooting

1. **Cannot connect** — check `npm run dev` is running; check firewall port 3000
2. **Map upload fails** — image must be under 50 MB; JPG/PNG supported
3. **Sync lag** — check network; reduce concurrent users
4. **Character sheet won't save** — check `data/` write permission; name must not be empty
5. **World state lost after restart (production)** — ensure Persistent Disk is mounted at `/data`
6. **AI summary says `DEEPSEEK_API_KEY` is not configured** — put the key in `.env` locally (see `.env.example`), or in Render's Environment Variables in production
7. **Code changed but the page did not** — every byte of CSS and JS is inline in the HTML, so a cached HTML freezes the whole frontend; the server sends `Cache-Control: no-cache` for `.html`, but force-reload if it persists

## Copyright & License

**Copyright (c) 2026 Mingwei Yan. All rights reserved.**

1. **Personal use**: permitted for personal, non-commercial use, modification, and distribution
2. **Commercial use**: **prohibited** without explicit written consent from the author
3. **Modification**: code may be modified, but original copyright notice must be retained

See the [LICENSE](LICENSE) file for full terms.

## Acknowledgements

- **D&D 5e** — character sheet system based on 5th Edition rules
- **Konva.js** — grid world rendering engine
- **Roll20** — UI design inspiration
- **Socket.IO** — real-time communication foundation
- **All playtesters** — invaluable feedback and suggestions

---

**Begin your adventure!** 🐉⚔️🛡️
