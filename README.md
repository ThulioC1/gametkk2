# TikTok Live Games 🎮

An open-source platform that creates interactive game overlays for TikTok Live streams. Viewers send gifts to power games in real-time — designed for 24/7 streaming with OBS.

<img width="2938" height="1654" alt="image" src="https://github.com/user-attachments/assets/7fe6231f-8a9b-450b-8490-b38d775a0645" />

## Features

- **Multi-tenant Architecture** — Multiple streamers use the platform simultaneously, fully isolated
- **TikTok Bridge SDK** — Lightweight client-side library to connect any HTML5 game to TikTok Live
- **Gift Integration** — Automatic gift categorization (small/medium/large) with `giftId` tracking
- **Event Normalizer** — Consistent event payloads across all TikTok event types
- **Auto-Reconnect** — Exponential backoff with jitter (up to 5 retries)
- **OBS Ready** — Transparent overlays designed for streaming software
- **Event Debugger** — Real-time event monitor for discovering gift names and testing

## Available Games

### Horse Racing 🏇

Gift-powered horse race with 5 country lanes. Viewers send gifts to move their country's horse forward.

- **5 Lanes**: 🇻🇳 Vietnam, 🇹🇭 Thailand, 🇮🇩 Indonesia, 🇲🇾 Malaysia, 🇨🇳 China
- **Gift → Lane Mapping**: Each gift name maps to a specific lane (configurable in `config.js`)
- **4 Gift Tiers**: 1-coin, 5-coin, 10-coin, 99-coin — each tier has 5 gifts (one per lane)
- **Auto-Reset**: Races cycle automatically (Waiting → Countdown → Racing → Finished → Cooldown)
- **Supporter Tracking**: Top 3 contributors shown on winner overlay
- **Canvas 2D + DOM HUD**: Progress bars, event feed, phase banners, winner celebration

### Corrida na Live 🏎️

Chat-powered race where viewers comment to enter the track. Likes boost every car, and gifts turn into power-ups — richer gifts hit harder.

- **Comment to Race**: First comment creates your car, extra comments tug it forward
- **Likes = Turbo**: Hearts fill a persistent turbo bar (with decay) that keeps cars fast
- **Gift Tiers**: small (<10💎) → Nitro, medium (10-99💎) → Turbo, large (100+💎) → Overtake
- **Special Gifts**: Named gifts can trigger oil slicks (spin out) or custom effects
- **Countdown Head Start**: Gifts during countdown build a launch boost on green light
- **Race Flow**: Waiting → Countdown → Racing (max 150s) → Finished → Cooldown, auto-reset
- **Live HUD**: Leaderboard, km/h speedometer bars, event feed, winner overlay

### Pipa Arena 🪁

Every comment launches a kite into the night sky. Likes pull your line to climb higher, and gifts cut rivals' kites down.

- **Comment to Fly**: First comment launches your kite, extra comments tug it up (+10)
- **Likes Lift**: Hearts raise your own kite (up to a cap)
- **Gifts Cut Lines**: Highest rivals get cut — small gift 1 line, medium 2, large 3 (combo hits harder)
- **Scoring**: +10 points per cut, +5 for surviving until your kite lands
- **Round End**: 90s timer or last kite standing — highest score wins
- **Live HUD**: Kite count, leaderboard, event feed, falling-pieces canvas effects

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/vamnguyen/tiktok-live-games.git
cd tiktok-live-games
npm install
npm start
```

### Usage

1. Open the dashboard: http://localhost:3000
2. Enter the TikTok username of someone currently LIVE
3. Select **Horse Racing**
4. Click **Generate Game Link**
5. Copy the overlay URL
6. Add as **Browser Source** in OBS/TikTok Studio
7. Viewers send gifts to race!

> **Note**: The TikTok username must be currently LIVE for the connection to work.

### Event Debugger

Visit http://localhost:3000/debug.html to monitor all TikTok events in real-time. Useful for discovering exact gift names to configure lane mappings.

## Project Structure

```
tiktok-live-games/
├── src/
│   ├── server.js                        # Express + Socket.io server (port 3000)
│   ├── services/
│   │   └── TikTokService.js             # Singleton: TikTok connections, rooms, auto-reconnect
│   └── lib/
│       ├── tiktokEventNormalizer.js      # Pure normalization for TikTok events
│       └── tiktokReconnectPolicy.js      # Exponential backoff reconnect helpers
├── public/
│   ├── index.html                        # Dashboard: username → overlay URL generator
│   ├── debug.html                        # Event debugger: live event monitoring
│   ├── css/styles.css                    # Dark theme, glass-morphism
│   ├── js/dashboard.js                   # Game selection & URL generation
│   ├── lib/tiktok-bridge.js              # Client SDK: Socket.io → game event bridge
│   └── games/
│       ├── horse-racing/                 # Canvas + DOM horse race game
│       │   ├── index.html                # Overlay entry point
│       │   ├── game.js                   # Canvas renderer + bridge wiring
│       │   ├── race-engine.js            # Pure race state machine
│       │   ├── config.js                 # Lanes, gift tiers, gift→lane mapping
│       │   └── style.css                 # OBS overlay styles
│       ├── corrida/                      # Car race game (likes = turbo, gifts = power-ups)
│       │   ├── index.html                # Overlay entry point
│       │   ├── game.js                   # Canvas renderer + bridge wiring
│       │   ├── race-engine.js            # Pure race state machine
│       │   ├── config.js                 # Gift tiers → nitro/turbo/overtake, phases
│       │   └── style.css                 # OBS overlay styles
│       └── pipa/                         # Kite battle game (gifts cut rival lines)
│           ├── index.html                # Overlay entry point
│           ├── game.js                   # Canvas renderer + bridge wiring
│           ├── kite-engine.js            # Pure kite state machine
│           ├── config.js                 # Cut tiers, phases, world size
│           └── style.css                 # OBS overlay styles
└── package.json
```

## Architecture

### Data Flow

```
TikTok Live → tiktok-live-connector → TikTokService → Socket.io rooms → tiktok-bridge.js → Game
```

### Multi-tenant Isolation

Each streamer gets their own Socket.io room (Room ID = TikTok username). Events are routed only to the relevant room — no data leakage between streamers.

```
TikTokService (Singleton)
  ├── connections: Map<username, WebcastConnection>
  └── rooms: Map<username, clientCount>
        │
        ├── io.to("streamer_a").emit() → [Horse Racing Overlay A]
        ├── io.to("streamer_b").emit() → [Horse Racing Overlay B]
        └── io.to("streamer_c").emit() → [Horse Racing Overlay C]
```

### Connection Management

- **Singleton Pattern**: Single `TikTokService` instance manages all connections
- **Connection Reuse**: Existing connections are reused, not recreated
- **Auto-disconnect**: Connections close after 5 minutes with 0 clients
- **Auto-reconnect**: Exponential backoff (2s → 4s → 8s → 16s → 32s) with ±30% jitter, max 5 attempts

## API Reference

### REST Endpoints

| Endpoint      | Method | Description           |
| ------------- | ------ | --------------------- |
| `/api/health` | GET    | Server health + stats |
| `/api/stats`  | GET    | Connection statistics |

### Socket.io Events

**Client → Server:**

| Event        | Payload            | Description            |
| ------------ | ------------------ | ---------------------- |
| `join-room`  | `username: string` | Join a streamer's room |
| `leave-room` | `username: string` | Leave a room           |

**Server → Client (TikTok Events):**

| Event                 | Key Payload Fields                                             | Description              |
| --------------------- | -------------------------------------------------------------- | ------------------------ |
| `tiktok_connected`    | `{ roomId }`                                                   | Connected to TikTok Live |
| `tiktok_chat`         | `{ user, comment }`                                            | Chat message             |
| `tiktok_gift`         | `{ user, giftId, giftName, giftValue, repeatCount, giftType }` | Gift received            |
| `tiktok_like`         | `{ user, likeCount, totalLikeCount }`                          | Like/heart               |
| `tiktok_share`        | `{ user }`                                                     | Share event              |
| `tiktok_reconnecting` | `{ attempt, delayMs }`                                         | Auto-reconnect attempt   |
| `tiktok_disconnected` | `{}`                                                           | Disconnected             |
| `tiktok_error`        | `{ message }`                                                  | Error occurred           |

All events include `timestamp`. The `user` object contains `{ uniqueId, nickname, profilePictureUrl }`.

Gift types: `"small"` (<10 diamonds), `"medium"` (10-99), `"large"` (100+).

## TikTok Bridge SDK

Client-side SDK that handles Socket.io connection and event dispatch for games.

### Auto-Connect

The bridge auto-connects if the URL has `?id=username` or `?username=username` params.

### API

```javascript
// Manual connect (auto-connect also works via URL params)
TikTokBridge.connect(username, serverUrl);

// Listen to events
TikTokBridge.on("gift", (data) => {
  console.log(data.giftName, data.giftValue, data.giftType);
});

TikTokBridge.on("chat", (data) => {
  console.log(data.user.uniqueId, data.comment);
});

// Available events: chat, gift, like, share, connected, disconnected, reconnecting, error
```

## Adding a New Game

1. Create `public/games/{name}/` with an entry HTML file
2. Include the SDK:
   ```html
   <script src="/socket.io/socket.io.js"></script>
   <script src="/lib/tiktok-bridge.js"></script>
   ```
3. Listen to events:
   ```javascript
   TikTokBridge.on("gift", (data) => {
     /* move piece, deal damage, etc. */
   });
   TikTokBridge.on("chat", (data) => {
     /* parse commands */
   });
   ```
4. Add a game card in `public/index.html`:
   ```html
   <div class="game-card" data-game="your-game" data-entry="index.html" data-param="id">
     <!-- card content -->
   </div>
   ```

## Horse Racing Configuration

### Lane Setup (`config.js`)

```javascript
lanes: [
  { id: 0, name: "Vietnam", flag: "🇻🇳", color: "#FF4444" },
  { id: 1, name: "Thailand", flag: "🇹🇭", color: "#4488FF" },
  { id: 2, name: "Indonesia", flag: "🇮🇩", color: "#44DD44" },
  { id: 3, name: "Malaysia", flag: "🇲🇾", color: "#FFCC00" },
  { id: 4, name: "China", flag: "🇨🇳", color: "#CC44FF" },
];
```

### Gift Tiers

Each tier has 5 gifts — one per lane (array index = lane index):

| Tier    | Gifts (VN, TH, ID, MY, CN)                                    |
| ------- | ------------------------------------------------------------- |
| 1 coin  | Rose, GG, Ice Cream Cone, Finger Heart, TikTok                |
| 5 coin  | Hand Heart, Little Crown, Butterfly, Love You, Wishing Bottle |
| 10 coin | Perfume, Doughnut, Cap, Paper Crane, Sunglasses               |
| 99 coin | Garland, Singing Mic, Star, Concert, Lock and Key             |

### Gift → Distance Formula

```
distance = 5 + 3 × √(diamondValue)
```

| Diamonds | Distance |
| -------- | -------- |
| 1        | 8 units  |
| 10       | 14 units |
| 99       | 35 units |

### Race Phases

```
WAITING → COUNTDOWN (10s) → RACING (max 120s) → FINISHED (8s) → COOLDOWN (5s) → WAITING
```

## Corrida na Live Configuration

### Gift → Power-Up (`public/games/corrida/config.js`)

| Tier           | Diamonds | Effect                                              |
| -------------- | -------- | --------------------------------------------------- |
| small          | < 10     | **Nitro** — short speed burst                       |
| medium         | 10-99    | **Turbo** — longer boost + fills the turbo bar      |
| large          | 100+     | **Overtake** — creates a slipstream on rivals ahead |

Named gifts can override the tier effect via `gifts.byName` (e.g. oil slick spins out followers). Likes fill a persistent turbo bar with decay.

### Race Phases

```
WAITING → COUNTDOWN (10s) → RACING (max 150s) → FINISHED (8s) → COOLDOWN (5s) → WAITING
```

The first car to cross the finish line (1000 units) wins; if nobody finishes, the leader at the 150s failsafe wins.

## Pipa Arena Configuration

### Gift → Cuts (`public/games/pipa/config.js`)

| Tier  | Diamonds | Lines Cut                   |
| ----- | -------- | --------------------------- |
| small | < 10     | 1 (highest rival kite)      |
| mid   | 10-99    | 2                           |
| large | 100+     | 3                           |
| combo | repeat   | +1 per extra send (max +2)  |

Cutters earn 10 points per line; kites that survive until they land earn 5 points. Rounds end after 90s or when only one kite remains.

## Development

```bash
npm run dev    # Development mode with auto-reload
npm start      # Production
```

### Tech Stack

| Component | Technology                             |
| --------- | -------------------------------------- |
| Runtime   | Node.js >= 18 (ES Modules)             |
| Server    | Express 4.18 + Socket.io 4.7           |
| TikTok    | tiktok-live-connector 1.1.9            |
| Games     | Vanilla Canvas 2D + DOM                |
| Styling   | Custom CSS (dark theme, glassmorphism) |

No `.env` required for local development. Server runs on port 3000 by default (`PORT` env var supported).

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-game`
3. Commit your changes: `git commit -m 'Add amazing game'`
4. Push to branch: `git push origin feature/amazing-game`
5. Open a Pull Request

### Code Style

- ES Modules (`import`/`export`)
- Comments in English
- JSDoc for function documentation

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector) — TikTok Live API wrapper
- [Socket.io](https://socket.io/) — Real-time communication
- Vietnamese Streamer Community

---

**Made with ❤️ for the Global Streamer Community**
