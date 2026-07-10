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

**Phase 1** — backend skeleton with mock track data: create/join rooms, set
config, run a full round loop end-to-end over WebSocket. No Spotify yet.

## Running the backend

Requires Node 18+ (not yet installed on this machine — see project notes).

```sh
cd packages/server
npm install
npm run dev      # starts on http://localhost:3000
```

## Roadmap

1. ✅ Backend skeleton + state machine (mock data)
2. Spotify OAuth + library pull + Deezer preview matching
3. Flutter client (lobby, OAuth, host/player round UI, scoreboard)
4. Config polish, reconnection, edge cases
5. Tidal / YouTube Music adapters
