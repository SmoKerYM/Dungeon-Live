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
- **Asset Library** — Uploaded maps shown as thumbnail list; click to place a new instance; × deletes the asset and all its placed instances
- **Snap-to-Grid** — Dragged map instances snap to the nearest grid intersection
- **Resize Handle** — Bottom-right drag handle resizes width (preserves aspect ratio, snaps to whole tiles)
- **Lock / Delete** — Lock to prevent accidental drags; controls appear on hover
- **Independent Viewports** — Each client controls its own zoom/pan independently

### Roles & Permissions
- **DM/Player Dual Role** — DM has full control; players have restricted permissions
- **Color Selection** — Players choose a unique color (orange/yellow/green/blue/purple)
- **Real-time Player List** — Online players with character info
- **HP Sync** — Sidebar shows character HP; hover over a token to inspect HP and name

### Drawing Tools
- **Free Brush** — Draw freehand in world coordinates, no snapping, broadcasts in real time
- **Rectangle Tool** — Corners snap to grid
- **Eraser** — Drag to erase individual strokes or rectangles
- **Color Picker** — Preset colors + custom color wheel
- **Clear All** — DM clears all drawings and rectangles with one click

### Token System
- **Player Tokens** — Konva circles snap to grid; hover shows HP and player name
- **NPC System** — DM spawns multi-color NPCs (rounded rectangles); double-click to delete
- **Permission Isolation** — Players can only drag their own token; DM can move all
- **Batch Clear** — Separate clear for player tokens and NPCs

### Undo / Redo
- **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+Shift+Z** to redo (DM only)
- Covers all world edits: map placement/move/resize/lock, token moves, strokes/rects
- Up to 20 steps each direction; server-side memory only, cleared on restart

### Character Sheet System
- **D&D 5e Standard Sheet** — Six attributes, saving throws, skills
- **Feats / Traits** — Multiple feats with name + description
- **Proficiency Bonus** — Auto-calculated proficiency bonuses
- **Persistent** — Character sheets saved to JSON files
- **Auto-load** — Players automatically load their matching character sheet on join

### Shared Notes
- **Real-time Collaborative Editing** — All users edit simultaneously
- **Character Records** — Right-side table for tracking character names and info
- **Debounced Sync** — 500ms debounce to reduce network traffic

### Dice System
- **Standard Dice** — D4, D6, D8, D10, D12, D20, D100 (right sidebar with roll animation)
- **Chat Dice Commands** — Type `/d20`, `/2d6+3` etc. to auto-roll with full breakdown
- **Result Broadcast** — All results broadcast to every player

### Chat System
- **Real-time Chat** — Text messages with DM/player color differentiation
- **Chat History** — Server retains last 100 chat/dice entries; replayed on reconnect

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
- **Upload map**: click **＋ 添加地图** in sidebar, or click an asset thumbnail to place a new instance
- **Drag / resize**: move tool to drag a map instance; bottom-right handle to resize
- **Lock / delete**: hover map to reveal lock and delete controls
- **Delete asset**: click thumbnail × → confirm → removes asset and all placed instances
- **Drawing**: switch brush/rect/eraser, draw on empty canvas; move tool to pan
- **NPCs**: click a color block to spawn; double-click NPC to delete
- **Undo / redo**: Ctrl+Z / Ctrl+Shift+Z, or use buttons in top-left corner
- **Viewport**: scroll wheel to zoom (0.2×–5×), drag empty space to pan

#### Player
- **Viewport**: scroll to zoom, drag empty space to pan (independent from others)
- **Move token**: drag your own colored token (auto-snaps to grid)
- **Spawn token**: click your color button in the sidebar
- **Roll dice**: click the right dice panel, or type a command in chat
- **Character sheet**: switch to the Character tab

#### Chat Dice Commands
| Input | Meaning | Example output |
|-------|---------|----------------|
| `/d20` | 1d20 | `rolled d20, result: 15` |
| `/2d6` | 2d6 | `rolled 2d6, result: 3 + 5 = 8` |
| `/2d4+3` | 2d4 + 3 | `rolled 2d4+3, result: 2 + 3 + 3 = 8` |
| `/d8-1` | 1d8 − 1 | `rolled d8-1, result: 6 - 1 = 5` |

### Tab System
- **Map** — Main game view with Konva grid world
- **Notes** — Left: shared notes; Right: character records table
- **Character Sheet** — Create and edit D&D 5e character sheets

## Project Structure

```
coc_app/
├── server.js              # Main server (Express + Socket.IO)
├── package.json           # Dependencies
├── README.md              # Documentation (Chinese)
├── README-en.md           # Documentation (English)
├── public/
│   ├── index.html         # Login page
│   └── game.html          # Main game UI (inline CSS+JS+Konva)
├── data/
│   ├── characters.json        # Character sheet data
│   ├── characters_notes.json  # Character records
│   ├── chat_history.json      # Last 100 chat/dice entries
│   ├── map_assets.json        # Map image assets (Base64)
│   ├── world.json             # World state (maps, tokens, drawings…)
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
  players: Map<socketId, { name, color, role }>,
  notes: "string",
  characterNotes: [{ name, info }],
  chatHistory: [{ type: 'chat'|'dice', name, role, ..., timestamp }],  // max 100
  mapAssets: { "asset_xxx": { base64, originalWidth, originalHeight } },
  world: {
    placedMaps:   [{ id, assetId, gridX, gridY, gridWidth, isLocked }],
    tokens:       [{ id, color, gridX, gridY }],
    npcs:         [{ id, gridX, gridY, color }],
    freeDrawings: [{ id, points: [x,y,...], color, strokeWidth }],
    rects:        [{ id, gridX, gridY, gridW, gridH, color, strokeWidth }]
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
  feats: [{ name: "Feat Name", description: "..." }]
}
```

## Socket.IO Events

### Client → Server
| Namespace | Events |
|-----------|--------|
| Auth | `join`, `selectColor` |
| MapAsset | `mapAsset:upload`, `mapAsset:fetch`, `mapAsset:remove` |
| PlacedMap | `placedMap:add`, `placedMap:move`, `placedMap:resize`, `placedMap:setLock`, `placedMap:remove` |
| Token | `token:spawn`, `token:move`, `token:clearAll` |
| NPC | `npc:spawn`, `npc:move`, `npc:remove`, `npc:clearAll` |
| Draw | `draw:freeStroke`, `draw:rect`, `draw:liveStroke`, `draw:remove`, `draw:clearAll` |
| History | `history:undo`, `history:redo` |
| Character | `character:list`, `character:load`, `character:save` |
| Other | `chat:message`, `dice:roll`, `notes:update`, `characterNotes:update` |

### Server → Client
| Event | Description |
|-------|-------------|
| `joinSuccess` | Join confirmed with full world snapshot |
| `mapAsset:uploaded` | Asset upload confirmed |
| `mapAsset:fetched` | Base64 asset data returned on demand |
| `mapAsset:removed` | Asset deletion broadcast |
| `placedMap:added/moved/resized/lockSet/removed` | Map instance mutation broadcasts |
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
2. **Mount a Persistent Disk** to `/data` — required or data is lost on restart

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
