# V1 Scope

This document defines what Cortisol Arcade V1 presents to users and what is intentionally hidden or removed.

## In Scope

- Home: wallet-first overview, recent activity, market pulse, local notifications.
- Play: Arena launcher, practice, direct rooms, stage selection, live rooms.
- Mini-Games: registered V1 game library, currently Arena link plus Pong direct room entry.
- Wallets: simulated wallets, transfers, internal transfer, CC/cortisol conversion.
- Market: simulated token discovery, detail, trade, liquidity, create-token entry.
- Explorer: internal ledger, blocks, transactions, wallets, tokens, search.
- Messages: DMs, file upload/download/delete, unread state.
- Room/group chat: websocket `room_chat` remains part of the runtime contract. Dedicated polished UI is not complete yet.
- Leaderboard: player ranking and game stats.
- Settings: local preferences, sound, debug, websocket and server config diagnostics.

## Registered V1 Games

- Arena: flagship platform fighter surfaced through Play and backed by `server/game/arena_sim.py`.
- Pong: flagship minigame surfaced through Mini-Games and backed by `server/game/minigames/pong.py`.

The registry is `content/games/_registry.json`. A game is not a V1 surface just because server code exists.

## Hidden, Removed, Or Dormant

- Hub/community feed: removed from nav and route config. The old frontend screen was deleted. The HTTP endpoints now return `410 hub_removed_from_v1` so old clients fail clearly.
- Boss mode: operator command, websocket server flag, queue alias, and unused boss AI file were removed.
- Coming-soon legacy route: no longer registered as a legacy page redirect.
- Online queue matchmaking: not exposed in V1. Direct rooms and LAN/tunnel join flow are the intended multiplayer path.
- Reaction, Typing, and Chess: backend code remains dormant for later review, but the routes and visible library entries are not part of the V1 product surface.

## Removal Path Still Needed

The following pieces remain because deleting them in this architecture pass would mix migration work with surface cleanup:

- `hub_posts` schema and DB helper methods in `server/db.py`
- legacy hub CSS selectors
- dormant minigame backend classes for Reaction, Typing, and Chess
- old upload/message moderation cleanup commands that may still need to handle historical data

A later migration pass should either archive or delete those after DB compatibility is explicitly decided.
