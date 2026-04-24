# Cortisol Arcade Product Vision

Cortisol Arcade is a polished LAN-first minigame center wrapped around a simulated arcade economy. The product fantasy is not "crypto app" and not "generic web dashboard." It is a shared local arcade world where players launch games, earn and spend simulated Cortisol Coin, inspect the world through Explorer, trade in Market, and communicate through DMs and room/group chat.

## Product Names

- Cortisol Arcade: the product and world.
- Cortisol Host: the machine/process that owns the server, websocket rooms, SQLite database, uploads, market cycle, and LAN join URL.
- Cortisol Client: the player-facing desktop client connected to a Host.

The target packaged binaries are `Cortisol Host.exe` and `Cortisol Client.exe`. The current repo is still a Python aiohttp host plus browser-served SPA while packaging is built out.

## V1 Pillars

- Arcade first: Arena and Pong are the flagship games.
- Shared world: wallet, market, explorer, and leaderboard state all feel connected to play.
- Simulated economy only: no real money, real wallets, external tokens, or blockchain integrations.
- LAN-friendly operation: one Host can serve multiple Clients on the same network.
- Communication stays in V1: DMs and room/group chat are part of the product, not future community fluff.

## V1 Non-Goals

- No engine rewrite in this pass.
- No production installer claims until packaging gates are met.
- No Hub/community feed in the V1 product surface.
- No boss mode surface or controls.
- No coming-soon pages or placeholder nav entries.
- No unregistered minigames promoted as V1 flagship content.

## Current Foundation

The current stack remains valid for V1 stabilization:

- `server/`: aiohttp Host, HTTP API, websocket hub, runtime config, SQLite persistence, market loop, uploads, game rooms.
- `runtime_data/`: Host-owned live data plus encrypted sync snapshots.
- `web/`: vanilla ES module Client UI.
- `server/game/arena_sim.py`: server-authoritative Arena.
- `server/game/minigames/pong.py`: server-backed Pong.
- `content/games/_registry.json`: V1 game registry source of truth.
