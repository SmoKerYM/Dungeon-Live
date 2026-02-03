[中文版](README.md)

# DND Multiplayer Collaborative TTRPG Tool

A web-based real-time collaborative D&D (Dungeons & Dragons) tool supporting real-time map sharing, token movement, drawing annotations, character sheet management, and dice rolling between DM and players.

**Copyright (c) 2026 Mingwei Yan. All rights reserved.**

![Status](https://img.shields.io/badge/Status-Production_Ready-green)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8+-blue)
![License](https://img.shields.io/badge/License-Personal_Use-blue)

## Features

### Map System
- **Real-time Map Upload** - DM can upload map images, saved as map archives
- **Zoom & Pan** - Both DM and players can freely zoom/pan maps with independent control
- **Independent Player Map Browsing** - Players can switch between maps via sidebar thumbnails
- **Map Archive Management** - Save multiple map states for quick scene switching
- **Smart Event Filtering** - Token/NPC/drawing events only sync to players viewing the DM's active map

### Roles & Permissions
- **DM/Player Dual Role System** - DM has full control, players have limited permissions
- **Color Selection System** - Players choose a unique color identifier
- **Real-time Player List** - Displays online players and their character info
- **HP Sync Display** - Sidebar shows character HP in real time

### Drawing Tools
- **Multiple Drawing Tools** - Brush, rectangle, eraser
- **Color Picker** - 6 preset colors with circle/square differentiation
- **Real-time Drawing Sync** - All drawing operations sync to all users in real time
- **Clear Canvas** - DM can clear all drawings with one click

### Token System
- **Player Tokens** - Colored triangle tokens; players can only move their own
- **NPC System** - DM can spawn multi-colored NPC tokens
- **Double-click Delete** - DM can double-click to delete individual NPCs
- **Batch Clear** - Separate clearing for player tokens and NPCs

### Character Sheet System
- **D&D 5e Standard Character Sheet** - Six attributes, saving throws, skills
- **Feats/Traits** - Add multiple character feats (name + detailed description)
- **Proficiency Bonus** - Automatic proficiency bonus calculation
- **Data Persistence** - Character sheets saved to JSON files
- **Auto-load** - Players automatically load their matching character sheet

### Shared Notes
- **Real-time Collaborative Editing** - All users can edit notes simultaneously
- **Character Records** - Right-side table for tracking character names and info, supports line breaks, persisted independently
- **Debounced Sync** - 500ms debounce to reduce network traffic
- **Persistent Storage** - Notes and character records saved to separate files

### Dice System
- **Standard Dice Set** - D4, D6, D8, D10, D12, D20, D100
- **Roll Animation** - Rolling animation on dice throw
- **Result Broadcast** - Roll results broadcast to all players in real time

### Chat System
- **Real-time Chat** - Text message communication
- **Role Identification** - DM and player messages displayed in different colors
- **System Messages** - Important actions automatically generate system messages

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

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Access the app**
   - Open browser at `http://localhost:3000`
   - First visit shows the login page

### Production Deployment
```bash
npm start
```

## Usage Guide

### First Use
1. **Choose Role**
   - **DM (Dungeon Master)**: Requires password `12138`, has full control
   - **Player**: No password needed, limited permissions

2. **Player Color Selection**
   - Players must choose a color on first join
   - Already taken colors are unavailable

3. **Map Upload (DM)**
   - Click the `+` icon in the sidebar map area
   - Select a map image file (supports JPG, PNG, etc.)
   - The map loads automatically and saves to the first slot

### Core Operations

#### DM Operations
- **Map Control**: Scroll wheel to zoom, drag to pan
- **Drawing Tools**: Select a tool and draw on the map
- **NPC Management**: Click NPC color blocks to spawn, double-click to delete
- **Save Map**: Click the top-left save button to manually save
- **Lock Map**: Click the lock button to lock/unlock the map

#### Player Operations
- **Browse Maps**: Switch between maps via sidebar thumbnails
- **Zoom/Pan**: Freely zoom and pan maps; each map remembers its own viewport
- **Move Tokens**: Can only drag your own colored token on the DM's active map
- **Spawn Token**: Click your color button in the sidebar
- **Roll Dice**: Click the dice panel on the right
- **Edit Character Sheet**: Switch to the character sheet tab

### Tab System
- **Map**: Main game interface showing the map and tokens
- **Notes**: Left-side shared notes + right-side character records table
- **Character Sheet**: Character sheet creation and editing (with feats)

## Project Structure

```
coc_app/
├── server.js              # Main server file (Express + Socket.IO)
├── package.json           # Project dependencies
├── README.md              # Project documentation (Chinese)
├── README-en.md           # Project documentation (English)
├── PLAN.md                # Detailed implementation plan
├── public/                # Static files directory
│   ├── index.html         # Login page
│   └── game.html          # Main game UI (inline CSS+JS)
├── data/                  # Data storage directory
│   ├── characters.json        # Character sheet data (JSON)
│   ├── characters_notes.json  # Character records (JSON)
│   └── notes.txt              # Shared notes content
└── images/                # Map images directory (gitignored)
```

## Technical Architecture

### Backend Stack
- **Node.js** - JavaScript runtime
- **Express** - Web server framework
- **Socket.IO** - Real-time bidirectional communication
- **File System** - Persistent data storage

### Frontend Stack
- **Vanilla HTML/CSS/JavaScript** - No framework dependencies
- **Canvas API** - Drawing functionality
- **Session Storage** - Client-side state management

### Real-time Communication
- **Event-driven Architecture** - Based on Socket.IO events
- **State Synchronization** - Real-time game state sync
- **Incremental Updates** - Optimized automatic map state saving

## Data Models

### Game State
```javascript
{
  dm: { socketId, name },
  players: Map<socketId, { name, role, color, currentMapId }>,
  mapData: "base64_string",
  mapTransform: { scale, originX, originY },
  isLocked: boolean,
  tokens: { color: { x, y } },
  drawings: Array<DrawingData>,
  npcs: Array<{ id, x, y, color }>,
  notes: "string",
  characterNotes: Array<{ name, info }>,
  savedMaps: Array<MapArchive>,
  activeMapId: "map_xxx"
}
```

### Character Sheet Structure
```javascript
{
  name: "Character Name",
  hp: { cur: 10, max: 10 },
  proficiencyBonus: 2,
  attributes: {
    strength: 0,
    dexterity: 0,
    constitution: 0,
    intelligence: 0,
    wisdom: 0,
    charisma: 0
  },
  savingThrows: ["dexterity", "intelligence"],  // max 2
  skills: ["stealth", "perception"],            // max 4
  feats: [{ name: "Feat Name", description: "Detailed description" }]
}
```

## Socket.IO Events

### Client -> Server
| Event | Data | Description |
|-------|------|-------------|
| `join` | `{ name, role, password }` | Join game |
| `selectColor` | `color` | Select color |
| `map:load` | `base64_data` | Upload map |
| `map:save` | `MapArchive` | Save map |
| `token:move` | `{ color, x, y }` | Move token |
| `draw:path` | `DrawingData` | Drawing operation |
| `character:save` | `CharacterData` | Save character sheet |
| `characterNotes:update` | `[{name, info}]` | Update character records |
| `player:viewMap` | `mapId` | Player switches viewed map |
| `player:loadMap` | `mapId` | Player requests map data |

### Server -> Client
| Event | Data | Description |
|-------|------|-------------|
| `joinSuccess` | `GameState` | Join successful |
| `colorSelected` | `{ name, color }` | Color selection confirmed |
| `map:loadedSaved` | `MapArchive` | Map loaded |
| `token:move` | `{ color, x, y }` | Token move sync |
| `dice:result` | `{ player, sides, result }` | Dice result |
| `character:loaded` | `CharacterData` | Character sheet loaded |
| `characterNotes:sync` | `[{name, info}]` | Character records sync |
| `player:mapData` | `{mapId, mapData, ...}` | Requested map data |
| `dm:mapSwitched` | `{activeMapId}` | DM switched active map |

## Deployment Options

### Local Development
```bash
npm run dev  # Hot reload with nodemon
```

### Production
```bash
npm start    # Run with node
```

### Cloud Deployment

#### Railway (Recommended)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

#### AWS EC2
1. Launch a t2.micro instance (free tier)
2. Install Node.js
3. Use PM2 to keep the process running
4. Configure Nginx reverse proxy

#### Render
1. Create a Web Service
2. Connect your GitHub repository
3. Automatic deployment

## Security

- **DM Password Protection**: DM role requires password `12138`
- **Permission Isolation**: Players cannot perform DM-exclusive operations
- **Input Validation**: Server-side validation of all client input
- **Session Management**: Uses sessionStorage for user state management

## Performance Optimization

- **On-demand Loading**: Player map data loaded on request, avoiding bulk transfer
- **Event Filtering**: Real-time events only sent to players viewing the active map, reducing unnecessary broadcasts
- **Debounced Updates**: Notes and character records use 500ms debounce
- **Thumbnail Generation**: Map archives use compressed thumbnails
- **Client-side Caching**: Player map data and viewport transforms cached locally, no reload needed on map switch

## Troubleshooting

### Common Issues

1. **Cannot connect to server**
   - Check if the server is running: `npm run dev`
   - Check firewall for port 3000

2. **Map upload fails**
   - Ensure image size does not exceed 50MB
   - Check file format (supports JPG, PNG, GIF)

3. **Real-time sync delay**
   - Check network connection
   - Reduce concurrent online users

4. **Cannot save character sheet**
   - Check write permissions for the `data/` directory
   - Ensure character name is not empty

### Viewing Logs
```bash
# View server logs
tail -f server.log

# View real-time connection status
# The server console displays connect/disconnect info
```

## Contributing

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Copyright & License

**Copyright (c) 2026 Mingwei Yan. All rights reserved.**

### Terms of Use
1. **Personal Use**: Permitted for personal, non-commercial use, modification, and distribution
2. **Commercial Use**: **Prohibited** without explicit written consent from the author
3. **Modification & Distribution**: Code may be modified, but original copyright notice must be retained
4. **Limitation of Liability**: The author is not liable for any damages caused by use of this software

### Full Terms
See the [LICENSE](LICENSE) file for full terms and conditions.

## Acknowledgements

- **D&D 5e** - Character sheet system based on 5th Edition rules
- **Roll20** - UI design inspiration
- **Socket.IO** - Real-time communication foundation
- **All playtesters** - Invaluable feedback and suggestions

## Support & Feedback

If you have questions or suggestions:
1. See [PLAN.md](PLAN.md) for the detailed implementation plan
2. Check existing Issues
3. Submit a new Issue or Pull Request

---

**Begin your adventure!**
