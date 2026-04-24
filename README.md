# Cortisol Arcade

Cortisol Arcade is a LAN-first desktop arcade and simulated economy. The repo now names the product around the V1 runtime we are building:

- `Cortisol Host.exe`: the local host process that owns the aiohttp server, websocket rooms, SQLite state, uploads, market simulation, and LAN join URL.
- `Cortisol Client.exe`: the desktop client shell that connects to a Cortisol Host instance and renders the arcade, wallets, market, explorer, messages, and settings.
- `Cortisol Arcade`: the product world shared by Arena, Pong, wallets, market activity, explorer state, DMs, and room/group chat.

The current development runner is still Python plus the browser SPA. The executable names above are the packaging target, not a completed installer.

Everything in the market layer is simulated. There are no real wallets, blockchains, tokens, or external crypto APIs involved.

## V1 Product Surface

- `Home`: portfolio overview, quick actions, recent activity, movers, bot feed
- `Play`: Arena launcher, matchmaking, practice, and live room access
- `Mini-Games`: V1 minigame center with Pong as the registered arcade minigame
- `Wallets`: multi-wallet management, transfers, CC conversion, holdings/activity views
- `Market`: token discovery, detail views, trading, launch flow access
- `Explorer`: simulated blocks, transactions, wallets, and token pages
- `Messages`: direct threads, uploads, downloads, attachment handling
- `Leaderboard`: cortisol ranking and arena performance
- `Settings`: local preferences and connection diagnostics

Hidden or removed from the V1 product surface: Hub/community feed, boss mode controls, coming-soon pages, and legacy non-core game routes. The old backend/data pieces are left only where removing them would be risky before a migration pass.

## Tech Stack

- Frontend: vanilla ES modules served from `web/`
- Backend: `aiohttp` app in `server/`
- Storage: Host-owned SQLite in `runtime_data/live/db/cortisol_arcade.sqlite3`
- Uploads: Host-owned local disk storage in `runtime_data/live/uploads/`
- Sync snapshots: encrypted world exports in `runtime_data/sync/snapshots/`

## Run (Windows)

From the project folder:

- `python -m pip install --user -r requirements.txt`
- `python server\\app.py --host 0.0.0.0 --port 8080`

Optional helper scripts:

- `scripts\\setup_windows.bat`
- `scripts\\run_host_control.bat`
- `scripts\\run_server.bat`

The Host control window is the preferred development entry for the future `Cortisol Host.exe`:

- `python host\\host_app.py`

## Open

- Local: [http://localhost:8080/](http://localhost:8080/)
- If you want another device on the same network to open it: `http://<HOST_IP>:8080/`

## Core Notes

- The first account created gets local moderation access when the database is empty.
- Raw live data under `runtime_data/live/` is local-only and gitignored.
- Encrypted Host snapshots under `runtime_data/sync/` are the only repo-safe world sync artifacts.
- Upload retention and size limits are controlled by environment variables.
- The websocket endpoint is `/ws`; arena rooms, mini-games, DMs, notifications, and matchmaking all depend on it.
- The market layer stays simulated even when user activity is low.
- Core legacy `.html` links redirect into the SPA shell; removed V1 surfaces no longer receive legacy route support.
- Product architecture and V1 scope live in `docs/blueprint/`.
- Registered V1 games live in `content/games/_registry.json`.

## Environment Variables

- `MAX_UPLOAD_MB` default `200`
- `MAX_TOTAL_STORAGE_GB` default `10`
- `RETENTION_HOURS` default `24`
- `UPLOAD_ALLOWLIST_MIME` optional comma-separated allowlist
- `CORTISOL_RUNTIME_ROOT` default `runtime_data`
- `CORTISOL_DB_PATH` optional override for the live SQLite path
- `CORTISOL_UPLOADS_DIR` optional override for live uploads
- `CORTISOL_ADMIN_CONSOLE=1` enables the legacy stdin operator console for dev only
- `CORTISOL_SYNC_PASSPHRASE` backup/restore passphrase for encrypted sync snapshots
- `CORTISOL_SYNC_PASSPHRASE_FILE` optional local ignored passphrase file path
- `CORTISOL_DIRTY_BACKUP_THRESHOLD` default `25`
- `CORTISOL_BACKUP_ON_EXIT` default `true`
- `CORTISOL_WORLD_SNAPSHOT_KEY` legacy export/import key fallback

Example PowerShell session:

```powershell
$env:MAX_UPLOAD_MB="1024"
$env:RETENTION_HOURS="72"
$env:MAX_TOTAL_STORAGE_GB="30"
python server\app.py --host 0.0.0.0 --port 8080
```

## Troubleshooting

- If the page loads but live features fail, inspect the `/ws` connection in browser dev tools.
- If uploads fail, check the configured file-size and retention caps.
- If another device cannot connect, verify firewall/network reachability to the host machine.
