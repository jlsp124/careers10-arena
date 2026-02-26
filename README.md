# Cortisol Arcade

LAN-only browser app for a Careers 10 class:

- real-time arena game
- mini-games (Chess, Pong, Reaction, Typing)
- messages + file uploads
- hub posts
- leaderboard with cortisol ranking
- quick play matchmaking queues

## Run (Windows, no admin install required)

From the project folder:

- `python -m pip install --user -r requirements.txt`
- `python server\app.py --host 0.0.0.0 --port 8080`

Or use:

- `scripts\setup_windows.bat`
- `scripts\run_server.bat`

## Open

- Host PC: `http://localhost:8080/`
- Other PCs on the same LAN: `http://<HOST_IP>:8080/`

Find the host IP with:

- `ipconfig`

If Windows Firewall prompts, allow Python on **Private networks**.

## Quick Play Matchmaking

Quick Play is available from the **Play** screen.

Queues supported:

- Arena Duel
- Arena FFA
- Typing Duel
- Pong
- Reaction
- Chess

When enough players join the same queue, the server:

1. creates a room
2. auto-joins matched players
3. sends `match_found`
4. clients switch to the correct game screen

## Accounts / Admin

- First account created becomes admin
- Admin role is used for moderation (delete/mute/ban) and admin CLI
- Admin is not shown in player names in normal UI

Optional admin bootstrap secret:

- Set `ADMIN_BOOTSTRAP_SECRET` before starting the server
- Enter it during registration

## Messages + Files

- Uploads stream to disk (`server/uploads/`)
- Downloads are permission-checked (uploader + DM participants + admin)
- Expired files are auto-cleaned

## Config (Environment Variables)

- `MAX_UPLOAD_MB` (default `200`)
- `MAX_TOTAL_STORAGE_GB` (default `10`)
- `RETENTION_HOURS` (default `24`)
- `UPLOAD_ALLOWLIST_MIME` (optional comma-separated allowlist)
- `ADMIN_BOOTSTRAP_SECRET` (optional)

Example (PowerShell):

- `$env:MAX_UPLOAD_MB="1024"`
- `$env:RETENTION_HOURS="72"`
- `$env:MAX_TOTAL_STORAGE_GB="30"`
- `python server\app.py --host 0.0.0.0 --port 8080`

## Troubleshooting

- If the page opens but live features fail, check `/ws` connection in browser dev tools
- Confirm all devices are on the same LAN and using the correct host IP
- Confirm firewall access for Python on Private networks

## License Notes

- Project code in this repo is original project code for this class tool
- Uses `aiohttp` (Apache-2.0) plus Python standard library
- If you add assets later, document the license/source

