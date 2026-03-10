# Cortisol Arcade

Cortisol Arcade is a browser-based simulation app that fuses:

- a wallet-first portfolio shell
- a meme-token trading terminal
- an arena game launcher
- mini-games, messages, file sharing, and a community hub

Everything in the market layer is simulated. There are no real wallets, blockchains, tokens, or external crypto APIs involved.

## Product Surfaces

- `Home`: portfolio overview, quick actions, recent activity, movers, bot feed
- `Play`: arena launcher and live room access
- `Wallets`: multi-wallet management, transfers, CC conversion, holdings/activity views
- `Market`: token discovery, detail views, trading, launch flow access
- `Explorer`: simulated blocks, transactions, wallets, and token pages
- `Mini-Games`: Pong, Reaction, Typing, Chess, plus queue/private room flows
- `Messages`: direct threads, uploads, downloads, attachment handling
- `Hub`: community/discovery feed
- `Leaderboard`: cortisol ranking and arena performance
- `Settings`: local preferences and connection diagnostics

## Tech Stack

- Frontend: vanilla ES modules served from `web/`
- Backend: `aiohttp` app in `server/`
- Storage: SQLite in `server/data/`
- Uploads: local disk storage in `server/uploads/`

## Run (Windows)

From the project folder:

- `python -m pip install --user -r requirements.txt`
- `python server\\app.py --host 0.0.0.0 --port 8080`

Optional helper scripts:

- `scripts\\setup_windows.bat`
- `scripts\\run_server.bat`

## Open

- Local: [http://localhost:8080/](http://localhost:8080/)
- If you want another device on the same network to open it: `http://<HOST_IP>:8080/`

## Core Notes

- The first account created becomes admin unless `ADMIN_BOOTSTRAP_SECRET` grants admin separately.
- Upload retention and size limits are controlled by environment variables.
- The websocket endpoint is `/ws`; arena rooms, mini-games, DMs, notifications, and matchmaking all depend on it.
- The market layer stays simulated even when user activity is low.

## Environment Variables

- `MAX_UPLOAD_MB` default `200`
- `MAX_TOTAL_STORAGE_GB` default `10`
- `RETENTION_HOURS` default `24`
- `UPLOAD_ALLOWLIST_MIME` optional comma-separated allowlist
- `ADMIN_BOOTSTRAP_SECRET` optional

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
