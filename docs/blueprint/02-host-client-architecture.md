# Host And Client Architecture

Cortisol Arcade V1 is a Host/Client product, even before the executable packaging exists.

## Cortisol Host

The Host is the authority for runtime state.

- Runs the aiohttp app from `server/app.py`.
- Owns SQLite data in `runtime_data/live/db/cortisol_arcade.sqlite3` by default.
- Owns uploads in `runtime_data/live/uploads/` by default.
- Owns logs, local exports, dirty-state metadata, snapshot staging, and pending restores under `runtime_data/live/`.
- Owns encrypted world snapshots under `runtime_data/sync/snapshots/`.
- Serves the web client from `web/`.
- Hosts `/ws` for room state, matchmaking, DMs, notifications, room chat, and game snapshots.
- Runs the market loop, session cleanup loop, upload cleanup loop, runtime snapshot manager, and dirty-state tracker.
- Prints the LAN join URL at startup.
- Does not require stdin in production. The old operator console is available only when `CORTISOL_ADMIN_CONSOLE=1`.

Current dev command:

```powershell
python server\app.py --host 0.0.0.0 --port 8080
```

Packaging target:

```text
Cortisol Host.exe
```

## Cortisol Client

The Client is the player-facing shell.

- Connects to a running Cortisol Host.
- Renders the SPA from `web/index.html`.
- Stores only local preferences and session token in browser storage.
- Never owns the source of truth for wallets, market, explorer, room state, or game outcomes.

Packaging target:

```text
Cortisol Client.exe
```

## Runtime Authority

- Host owns game outcomes and applies rewards.
- Host owns wallet balances, market state, explorer records, uploads, sessions, and moderation.
- Client sends inputs and commands, then renders server snapshots.
- Client can cache display preferences, but not authoritative game or economy state.

## Networking Shape

1. Host starts.
2. Host builds explicit runtime paths from env/defaults.
3. Host applies any staged pending restore before SQLite opens.
4. Host initializes SQLite, uploads, websocket hub, market loop, dirty tracker, snapshot manager, and static serving.
5. Client opens the Host URL.
6. User signs in or registers.
7. Client connects to `/ws` with the session token.
8. Host sends `hello_ok`, lobby state, presence, and live room updates.

## Runtime Control API

The Host exposes admin-only runtime endpoints:

- `GET /api/runtime/status`: runtime paths, dirty-state summary, recent snapshots.
- `POST /api/runtime/snapshot`: creates an encrypted world snapshot from live DB/uploads.
- `POST /api/runtime/backup`: manual backup alias for snapshot creation.
- `POST /api/runtime/sync-secret`: writes a local ignored sync passphrase file.
- `POST /api/runtime/restore`: stages an encrypted snapshot for restore on next Host start.

Hot restore while the DB is open is intentionally not part of V1. Restore is staged, then applied at next startup before the database connection is created.

## What Codex Must Not Infer

- Do not add real-money, blockchain, wallet-provider, or crypto exchange integrations.
- Do not make Client authoritative for game results or wallet balances.
- Do not write raw live DB/uploads into `runtime_data/sync/`.
- Do not claim executable packaging exists until a packaging pipeline is added and verified.
- Do not reintroduce Hub/community, boss mode, or coming-soon routes as V1 surfaces.
