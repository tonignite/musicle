# Musicle

A party music-guessing game. 3+ friends sync their Spotify libraries, the game
shuffles songs from everyone into rounds, and players race to guess **which song**
is playing *and* **whose library it came from**. Points for each.

## Repo layout

```
musicle/
├── packages/
│   └── server/        REST + WebSocket game backend (Node + TypeScript)
└── apps/
    └── mobile/        Flutter client (host + player, one app)
```

## Architecture

- **Backend:** Fastify (REST: lobby/config/CRUD) + Socket.IO (live rounds: buzz,
  timers, scoreboard). Room-based session manager with a per-room state machine.
  Postgres + Redis planned for persistence and multi-process scaling.
- **Frontend:** Flutter, one app, host/player role chosen at runtime.
- **Audio:** libraries pulled from Spotify (per-user OAuth); 30s preview clips
  sourced from Deezer/iTunes (no auth, no Premium needed), matched by ISRC.

## Game flow

```
LOBBY ──▶ COLLECTING ──▶ ROUND(n) ──▶ REVEAL ──▶ SCOREBOARD ──▶ (next / END)
 join code + auth        pull libs,   play clip,  track +
 host sets CONFIG        build pool   guess       owner
```

Config (songs-per-user, or fully random) is set in the **lobby**, before
collection.

## Status

**Phase 2** — Spotify OAuth + real libraries:

- Per-player Spotify login (`GET /auth/spotify/login`), server-side token
  exchange, background library pull (saved songs + playlists).
- Deezer preview matching (ISRC first, artist+title fallback) makes tracks
  playable without Spotify Premium; unmatched tracks are dropped.
- `LibraryProvider` seam: mock provider for tests, Spotify-backed store in prod,
  Tidal/YT Music slot in later.
- Full round loop verified end-to-end over REST + WebSocket.

The Flutter client (phase 3) is not built yet.

## Running the backend

Requires Node 18+.

```sh
cd packages/server
npm install
cp .env.example .env      # fill in Spotify credentials for real linking
npm run dev               # starts on http://localhost:3000

npm test                  # unit tests
npm run smoke             # boots the server and plays a full mock game
```

Without Spotify credentials the server still runs; use `POST /rooms/:code/link`
to seed a mock library and play a full game (this is what `npm run smoke`
exercises).

## Roadmap

1. ✅ Backend skeleton + state machine (mock data)
2. Spotify OAuth + library pull + Deezer preview matching
3. Flutter client (lobby, OAuth, host/player round UI, scoreboard)
4. Config polish, reconnection, edge cases
5. Tidal / YouTube Music adapters
