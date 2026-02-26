# careers10-arena

LAN-only real-time multiplayer browser game + class collaboration hub for a high school Careers10 class.

Theme: "Careers10 Collaboration Tool" with a hidden/funny "Engagement Simulator" (the arena game) as a light school-safe joke.

## Features

- Browser-only clients (no installs on student PCs)
- Host runs Python + `aiohttp` server
- SQLite accounts + stats + sessions + hub posts + DMs + file metadata
- Real-time top-down stick-figure arena (server authoritative)
- Mini-games over same WebSocket/account system:
  - Chess (server-side move validation)
  - Pong
  - Reaction Duel
  - Typing Duel
- Careers Hub posting board (brainstorm/help-understand emphasis)
- DMs with streaming file uploads to disk and temporary retention
- Admin CLI moderation + in-app delete/mute tools

## Tech Stack

- Python 3.10+ (recommended)
- `aiohttp` for HTTP + WebSockets
- SQLite (`sqlite3`, built-in)
- HTML/CSS/JS (no client installs, no internet dependency required for gameplay)

## Project Layout

See the requested folder structure in the assignment prompt. Main entrypoint is `server/app.py`.

## School Hosting (No Admin Install)

1. Open PowerShell or Command Prompt in the project folder.
2. Install dependency (user scope):
   - `python -m pip install --user -r requirements.txt`
3. Run server:
   - `python server/app.py --host 0.0.0.0 --port 8080`
4. Students connect from a browser using the host PC's LAN IP.

The included scripts do the same:

- `scripts\setup_windows.bat`
- `scripts\run_server.bat`

## Finding Your IP (Windows)

Run:

- `ipconfig`

Look for your active adapter's IPv4 address (for example `192.168.1.42`).

Students join:

- `http://192.168.1.42:8080/`

## Windows Firewall Prompt Advice

The first time you run Python as a server, Windows may show a firewall prompt.

- Allow access on **Private networks** (school/home LAN)
- You usually do **not** need to allow Public networks

If clients cannot connect, firewall rules are a common cause.

## WebSocket Troubleshooting

If the site loads but live features do not update:

1. Confirm clients are using the correct host IP and port (same LAN)
2. Check host firewall permission for Python
3. Verify the server terminal shows no traceback errors
4. Open browser dev tools and look for `/ws` connection failures
5. Make sure the page is served from the same host as the server (do not open local files directly)

## Accounts, Admin, and First Login

- Real names are allowed (`display_name`)
- Minimal password rules (classroom convenience)
- First account created becomes admin automatically
- Optional admin bootstrap:
  - Set `ADMIN_BOOTSTRAP_SECRET` before server start
  - Enter that secret in the Register form to grant admin

## Arena + Mini-Games Flow

1. Open `Login` and create or sign into an account
2. Go to `Lobby`
3. Create/join an Arena room or Mini-Game room
4. In Arena:
   - Pick a character
   - Ready up
   - Start (or auto-start once everyone is ready and minimum players are present)
5. In Mini-Games:
   - Choose a mode and room, then join
   - Chess uses `chess.html`

## Cortisol Ranking / Stats

Tracked in SQLite per user:

- `wins`, `losses`, `kos`, `deaths`, `streak`, `cortisol`

Starting cortisol: `1000`

After each match:

- Win: `cortisol -= (25 + 5*streak)`, then `streak += 1`
- Loss: `cortisol += 20`, then `streak = 0`
- Clamped to `0..5000`

Lower cortisol = better rank.

Tier labels:

- `0–300` Zen
- `301–700` Calm
- `701–1200` Stable
- `1201+` Cooked

## DMs + File Uploads (Retention / Limits)

Uploads are streamed to disk (not buffered fully in memory) in `server/uploads/`.

Metadata stored in SQLite includes:

- original filename
- randomized storage filename
- size, mime, uploader, timestamps
- expiry, hash, download count

Default behavior:

- `MAX_UPLOAD_MB=200`
- `MAX_TOTAL_STORAGE_GB=10`
- `RETENTION_HOURS=24`

Expired files are auto-cleaned by the server.

Permissions:

- Only uploader + DM participants linked to that file can download
- Admin can delete files / purge uploads

### Increase Upload Limit at Home

Example (PowerShell):

- `$env:MAX_UPLOAD_MB = "1024"`
- `$env:RETENTION_HOURS = "72"`
- `$env:MAX_TOTAL_STORAGE_GB = "30"`
- `python server/app.py --host 0.0.0.0 --port 8080`

## Environment Variables

- `MAX_UPLOAD_MB` (default `200`)
- `MAX_TOTAL_STORAGE_GB` (default `10`)
- `RETENTION_HOURS` (default `24`)
- `UPLOAD_ALLOWLIST_MIME` (optional comma-separated MIME allowlist; blank = allow all)
- `ADMIN_BOOTSTRAP_SECRET` (optional)
- `TEACHER_SAFE_MODE_DEFAULT` (`true`/`false`, default `true`)

## Admin CLI (Terminal)

The server starts an in-process admin REPL in the same terminal.

Commands:

- `rooms`
- `users`
- `kick <name>`
- `mute <name> <minutes>`
- `ban <name> <minutes>`
- `announce <text>`
- `start <room_key>`
- `end <room_key>`
- `setwins <name> <n>`
- `setcortisol <name> <n>`
- `deletepost <id>`
- `deletefile <file_id>`
- `purgeuploads`
- `boss on|off`

## Class-Appropriate Use Note

This tool is intended for school-appropriate collaboration and light gameplay.

- Use the Hub for brainstorming/help understanding concepts
- Do not use DMs or posts for harassment
- Do not post finished assignment answers
- Keep usernames/display names respectful

## Licensing Notes

- This project code was implemented as original code for this assignment (no large copied blocks from other repos).
- It uses Python standard library components (`sqlite3`, `hashlib`, etc.) and `aiohttp` (Apache 2.0).
- If you add sounds/assets later, confirm they are permissively licensed (or original) and document them here.

## Development Notes / Limitations

- Arena networking uses a simple server-authoritative model with lightweight client prediction/reconciliation
- Chess UI is intentionally minimal (click-to-move) but server validates legality
- If you expect heavy concurrent file transfer usage, test LAN throughput and storage settings before class

