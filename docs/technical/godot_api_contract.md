# Godot API Contract

## Purpose

This document freezes the server-facing contract that the Godot player client should depend on.

Current reality:

- the server already exposes a large `/api/*` surface and `/ws`
- the legacy web UI consumes those contracts directly
- several contracts are useful as-is
- several others are ad hoc, web-shaped, or incomplete for a long-lived Godot client

## Transport and Auth Assumptions

### HTTP

Current auth behavior:

- token may be supplied by:
  - `Authorization: Bearer <token>`
  - `X-Session-Token: <token>`
  - `?token=<token>`
  - `session_token` cookie

Godot rule:

- use `Authorization: Bearer <token>` or `X-Session-Token`
- do not rely on cookies
- store the token locally in `user://session.json`

### WebSocket

Current behavior on `/ws`:

1. server sends `{"type":"hello_required"}`
2. client sends `{"type":"hello","token":"..."}`
3. server replies with:
   - `hello_ok`
   - `presence`
   - `lobby_state`

Godot rule:

- keep the `hello` handshake
- do not assume the socket is authenticated until `hello_ok`
- treat reconnect as non-authoritative until a fresh snapshot arrives

## Existing HTTP Endpoints Usable Today

### Connect and Auth

| Endpoint | Auth | Current Use | Godot Status |
| --- | --- | --- | --- |
| `GET /api/client/status` | no | host probe, host metadata, launcher modes | usable as-is for Connect |
| `POST /api/register` | no | create account, returns token and `me` | usable as-is |
| `POST /api/login` | no | login, returns token and `me` | usable as-is |
| `POST /api/logout` | yes | invalidate current session | usable as-is |
| `GET /api/me` | yes | current player identity and stats | usable as-is |
| `GET /api/config` | no | upload/storage caps | usable as-is for Settings |

### Menu / Crypto / Leaderboard

| Endpoint | Auth | Current Payload | Godot Status |
| --- | --- | --- | --- |
| `GET /api/dashboard` | yes | wallet-first home summary | usable as bootstrap/home read model |
| `GET /api/wallets` | yes | wallets, transactions, summary, market activity | usable, but Godot should treat only the default wallet as player-facing V1 |
| `GET /api/market` | yes | token list, selected token, views, wallet context | usable for read-only phase; mutation buttons can come later |
| `POST /api/trade` | yes | execute buy/sell | usable later |
| `POST /api/liquidity` | yes | add/remove LP | usable later |
| `POST /api/exchange` | yes | cortisol <-> CC exchange | usable later |
| `POST /api/token/create` | yes | token launch | usable later |
| `GET /api/leaderboard` | yes | leaderboard rows | usable as-is |

### Explorer

| Endpoint | Auth | Current Payload | Godot Status |
| --- | --- | --- | --- |
| `GET /api/explorer/overview` | yes | counts, latest blocks/txs, top tokens/wallets | usable |
| `GET /api/explorer/blocks` | yes | block list | usable |
| `GET /api/explorer/block/{height}` | yes | block detail + tx list | usable |
| `GET /api/explorer/transactions` | yes | transaction list with filters | usable |
| `GET /api/explorer/transaction/{tx_id}` | yes | transaction detail | usable |
| `GET /api/explorer/wallets` | yes | wallet list | usable |
| `GET /api/explorer/wallet/{wallet_ref}` | yes | wallet detail | usable |
| `GET /api/explorer/tokens` | yes | token list | usable |
| `GET /api/explorer/token/{token_ref}` | yes | token detail | usable |
| `GET /api/explorer/search` | yes | cross-entity search | usable |

### Files and Message Attachments

| Endpoint | Auth | Current Payload | Godot Status |
| --- | --- | --- | --- |
| `POST /api/upload` | yes | upload file record | usable |
| `GET /api/file/{file_id}` | yes/access-checked | download or inline image | usable |
| `POST /api/file/{file_id}/delete` | yes/access-checked | soft-delete attachment | usable |

### Admin / Host-only Surfaces

These are not player-client surfaces:

- `GET /api/runtime/status`
- `POST /api/runtime/snapshot`
- `POST /api/runtime/backup`
- `POST /api/runtime/sync-secret`
- `POST /api/runtime/restore`
- `/api/host-control/*`

Godot must never call them.

### Explicit Legacy / Removed Surface

These are not part of the Godot contract:

- `GET /api/hub_feed` -> returns `410 hub_removed_from_v1`
- `POST /api/hub_post` -> returns `410 hub_removed_from_v1`

## Existing WebSocket Events Usable Today

### Session and Presence

| Event | Current Meaning | Godot Status |
| --- | --- | --- |
| `hello_required` | socket requires auth hello | usable |
| `hello_ok` | auth accepted, returns `me` and server surface info | usable |
| `presence` | online user list | usable |
| `lobby_state` | room list + online users + queue snapshot | usable |
| `match_found` | auto-created room assignment | usable, though current Godot plan favors direct room flows first |
| `announcement` | host broadcast | usable |
| `error` | generic socket error payload | usable but too ad hoc |
| `kicked` | session ended | usable |
| `market_cycle` | latest bot actions, engine events, mood, block | usable as a lightweight invalidation signal |
| `file_deleted` | attachment deleted | usable |

### Arena

Current Arena events already emitted by the server:

- `room_joined`
- `arena_roster`
- `arena_state`
- `arena_state_change`
- `arena_loading`
- `arena_round_start`
- `arena_start`
- `arena_round_end`
- `arena_end`
- `room_chat`

Godot can consume these in early phases, but they are not yet a clean frozen player DTO set.

### Pong

Current Pong events:

- `room_joined`
- `pong_roster`
- `pong_state`
- `pong_point`
- `pong_paddle_hit`
- `pong_wall_hit`
- `pong_end`

These are usable for a prototype client.

### Direct Messages

Current DM events:

- `user_search_result`
- `dm_threads`
- `dm_history`
- `dm_new`
- `dm_deleted`
- `moderation`

These support direct-message flow only. There is no current group-messaging contract.

### Legacy Minigame / Debug-only Events

These exist on the server but should remain legacy/debug-only unless later promoted:

- `reaction_*`
- `typing_*`
- `chess_*`

The locked Godot flow only includes Pong and Arena.

## Current Contract Weaknesses

### What is solid enough already

- host probing with `/api/client/status`
- token-based auth
- wallet / market / explorer read models
- leaderboard
- DM attachments
- arena and pong room events for a prototype

### What is too ad hoc for a long-lived Godot client

- websocket event shapes vary by game and have no explicit schema version
- `room_joined` is generic but there is no stable `room_left` or `join_denied`
- message thread/history are websocket-only and not paginated
- unread state is currently client-local, not server-backed
- arena content catalog is currently loaded from legacy web asset JSON, not a player-facing content contract
- player-facing crypto still exposes multi-wallet backend details that the Godot client should not normalize into UX truth

## Missing Endpoints / Events Needed By Godot

### Required Before or During Phase C

1. `GET /api/player/v1/bootstrap`

Purpose:

- one round-trip after login
- returns `me`, capabilities, current menu counters, and primary wallet id

2. `GET /api/player/v1/content/arena`

Purpose:

- return character and stage catalog
- remove Godot dependency on legacy `web/assets/characters.json` and `web/assets/maps.json`

3. capability flags in `GET /api/client/status` or bootstrap

Minimum flags:

- `groups_enabled`
- `market_write_enabled`
- `arena_enabled`
- `pong_enabled`
- `legacy_web_available`

### Required Before Full Messages Mode

1. `GET /api/player/v1/messages/threads`
2. `GET /api/player/v1/messages/thread/{thread_id}?cursor=...`
3. `POST /api/player/v1/messages/dm`
4. `POST /api/player/v1/messages/groups`
5. `GET /api/player/v1/messages/groups`
6. `GET /api/player/v1/messages/group/{group_id}`
7. `POST /api/player/v1/messages/group/{group_id}/message`
8. server-backed unread/read-state endpoints or fields

If these are not added, Godot Phase F must ship DMs only and show Group Creation as unavailable.

### Strongly Recommended Before Arena / Pong Productionization

1. `/ws/player` additive socket path with stable event envelopes
2. `room_left` confirmation event
3. `join_denied` event with code and detail
4. `room_closed` event if a host room is destroyed while the player is present
5. `room_chat_history` if room chat survives into Godot

### Optional but Useful

1. `PATCH /api/player/v1/profile`
2. `GET /api/player/v1/profile/{user_id}`
3. `GET /api/player/v1/leaderboard/me`

## Recommended Error Format

Current server errors are mostly:

```json
{ "error": "code", "...": "extra fields" }
```

Recommended frozen player shape for new Godot-facing endpoints:

```json
{
  "ok": false,
  "error": {
    "code": "wallet_transfer_failed",
    "message": "Transfer could not be completed.",
    "detail": "",
    "retryable": false
  }
}
```

Rules:

- keep `error.code` machine-stable
- keep `message` user-displayable
- keep `detail` optional and log-oriented
- include `retryable` for reconnect and retry UX

Compatibility rule:

- legacy `/api/*` may continue returning the current flat `{error:"..."}` shape
- new `/api/player/v1/*` should use the structured error envelope

## Stable DTO Shapes For Godot

## Core DTOs

### `ClientStatusDTO`

```json
{
  "schema_version": 1,
  "product": "Cortisol Arcade",
  "host": {
    "role": "Cortisol Host",
    "origin": "http://127.0.0.1:8080/",
    "local_url": "http://localhost:8080/",
    "lan_urls": ["http://192.168.1.10:8080/"],
    "port": 8080
  },
  "capabilities": {
    "arena_enabled": true,
    "pong_enabled": true,
    "market_write_enabled": true,
    "groups_enabled": false
  }
}
```

### `PlayerProfileDTO`

```json
{
  "id": 12,
  "username": "player1",
  "display_name": "Player One",
  "is_admin": false,
  "stats": {
    "wins": 0,
    "losses": 0,
    "kos": 0,
    "deaths": 0,
    "streak": 0,
    "cortisol": 1000,
    "tier": "Stable"
  }
}
```

### `PrimaryWalletDTO`

Player-facing V1 contract:

- exactly one wallet is primary in Godot
- if the server still returns multiple wallets, use `default_wallet_id` and ignore wallet management UX in Godot

```json
{
  "id": 3,
  "address": "ca_xxxxx",
  "name": "Main Wallet",
  "wallet_kind": "user",
  "tokens": [],
  "total_value_cc": 0.0,
  "activity": []
}
```

### `TokenSummaryDTO`

```json
{
  "id": 4,
  "name": "Frenzy Fruit",
  "symbol": "FRNZ",
  "category": "meme",
  "price": 1.2345,
  "change_pct": 2.1,
  "change_1h": 1.3,
  "change_24h": -4.8,
  "volume_cc": 122.4,
  "liquidity_cc": 81.0,
  "liquidity_tokens": 65.6,
  "liquidity_value_cc": 162.0,
  "wallet_amount": 10.0,
  "wallet_liquidity_share_pct": 4.2,
  "risk_profile": "medium",
  "risk_flags": []
}
```

### `ExplorerTransactionDTO`

```json
{
  "id": 55,
  "tx_hash": "abc123",
  "tx_kind": "trade",
  "status": "confirmed",
  "created_at": 1710000000,
  "wallet": { "id": 3, "address": "ca_x", "name": "Main Wallet" },
  "counterparty_wallet": null,
  "token": { "id": 4, "symbol": "FRNZ", "name": "Frenzy Fruit" },
  "side": "buy",
  "amount": 12.0,
  "price": 1.24,
  "value_cc": 14.88,
  "summary": "BUY 12.0000 FRNZ @ 1.2400 CC"
}
```

## Match DTOs

### `RoomRefDTO`

```json
{
  "kind": "arena",
  "room_id": "duel-123",
  "room_key": "arena:duel-123"
}
```

### `ArenaRosterDTO`

Must include:

- room ref
- state
- player ids
- ready ids
- stage ref
- fighter metadata

### `ArenaStateDTO`

Must include:

- room ref
- authoritative match state
- round/timer fields
- fighters public state
- event list
- stage ref
- scoreboard summary on end

### `PongStateDTO`

Must include:

- room ref
- state
- left/right players
- spectators
- score
- ball
- paddles
- time left

## Compatibility Layer Recommendation

The safest path is additive, not replacement.

### Keep untouched for legacy web debug UI

- current `/api/*` routes
- current `/ws` event names
- current hash-route-driven SPA expectations

### Add for Godot

- `server/player_api.py`
- `server/player_ws.py` or an additive `/ws/player` adapter
- `/api/player/v1/*` routes with frozen DTOs
- `schema_version` in every player-facing DTO

### Why this is the right split

- it avoids rewriting `server/db.py`, gameplay modules, or legacy web screens
- it gives Godot a stable typed contract
- it lets the old SPA remain a debug and parity reference surface

## Contract Rules For Implementation

- do not break `/api/client/status`
- do not rename existing websocket event `type` values used by the legacy web UI
- do not move admin/runtime endpoints into the player client contract
- do not make Godot parse legacy `web/assets/*.json` as its permanent content source
- do not fake unsupported group messaging with local-only state
