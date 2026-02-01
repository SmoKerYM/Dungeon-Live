# CLAUDE.md - Project Context

## Project Overview
DND 多人协作跑团工具 - A real-time collaborative D&D (Dungeons & Dragons) web tool supporting map sharing, token movement, drawing, character cards, and dice rolling between DM and players.

Copyright (c) 2026 Mingwei Yan. All rights reserved. No unauthorized commercial use.

## Tech Stack
- **Backend**: Node.js + Express 5 + Socket.IO 4
- **Frontend**: Vanilla HTML/CSS/JavaScript + Canvas API
- **Data**: JSON files (characters) + text files (notes), no database
- **Dev**: nodemon for hot reload

## File Structure
```
coc_app/
├── server.js              # Main server, Socket.IO events (~611 lines)
├── package.json           # Dependencies: express, socket.io, nodemon
├── nodemon.json           # Watch config: ignores data/
├── public/
│   ├── index.html         # Login page (~229 lines)
│   └── game.html          # Main game UI (~3035 lines, inline CSS+JS)
├── data/
│   ├── characters.json    # Character card data (name-keyed object)
│   └── notes.txt          # Shared notes (plain text)
└── images/                # Map images (gitignored)
```

## Architecture
- Single-room game instance per server (no multi-room)
- Event-driven via Socket.IO with `namespace:action` pattern (e.g., `map:load`, `token:move`)
- Role-based: DM vs Player, DM password is `12138`
- Game state lives in memory (`gameState` object in server.js), persisted to files for characters/notes
- All CSS and JS are inline in HTML files (no separate css/js files)
- **Player independent map viewing**: Players browse maps independently, server tracks each player's `currentMapId` and filters real-time events (token/npc/draw) to only reach players viewing the DM's active map
- **Player independent zoom/pan**: Players control their own map transform (scale/origin), stored client-side per map in `playerTransforms`

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
| Auth | `join`, `selectColor` |
| Map | `map:load`, `map:transform`, `map:lock`, `map:save`, `map:loadSaved`, `map:deleteSaved`, `map:updateState` |
| Token | `token:spawn`, `token:move`, `token:clearAll` |
| Draw | `draw:path`, `draw:clear` |
| NPC | `npc:spawn`, `npc:move`, `npc:remove`, `npc:clearAll` |
| Player | `player:viewMap`, `player:loadMap` |
| Character | `character:list`, `character:load`, `character:save` |
| Other | `chat:message`, `dice:roll`, `notes:update` |

### Server -> Client (new events)
| Event | Description |
|-------|-------------|
| `player:mapData` | Full map data sent to a single player on request |
| `dm:mapSwitched` | Notifies all players that DM switched active map |

## Data Models

### gameState (server.js)
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, color, role, currentMapId }>,
  mapData: "base64",
  mapTransform: { scale, originX, originY },
  isLocked: boolean,
  tokens: { color: { x, y } },
  drawings: [],
  npcs: [{ id, x, y, color }],
  notes: "string",
  savedMaps: [],
  activeMapId: "map_xxx"
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
- Map images are Base64-encoded and can be large (50MB max buffer)
- Map deduplication uses hash: `substring(0, 1000) + '_' + length`
- Notes updates are debounced at 500ms
- Player colors: orange, yellow, green, blue, purple (5 slots)
- DM-only UI elements use `.dm-only` CSS class, player-only use `.player-only`
- game.html has ~780 lines of inline CSS in `<head>`, JS starts around line 1090
- Real-time events (token/npc/draw) use `broadcastToMapViewers()` — only sent to players viewing DM's active map
- `map:transform` and `map:load` no longer broadcast to players (independent control)
- Player map data loaded on demand via `player:loadMap`, cached in client `mapDataCache`
- Player transforms stored client-side in `playerTransforms` object (per mapId)
