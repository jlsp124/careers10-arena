# Cortisol Arcade

A LAN-first desktop arcade and simulated economy with multiplayer rooms, messaging, virtual wallets, markets, and Windows builds.

<!-- Add after taking a screenshot:
![Cortisol Arcade home screen](docs/images/cortisol-home.png)
-->

Cortisol Arcade uses a local host-and-client architecture.

One computer runs the world and server state, while other devices can connect over the local network.

Everything in the economy is simulated. The project does not use real cryptocurrency, real wallets, or external trading APIs.

> **Status:** Playable local prototype. Signed installers and automatic updates are not complete.

## Highlights

- LAN host and client applications
- WebSocket multiplayer rooms
- SQLite-backed world state
- Matchmaking
- Direct messages and group chat
- File uploads and downloads
- Simulated wallets
- Simulated tokens and markets
- Transaction and block explorer
- Leaderboards
- Windows executable builds
- Encrypted world snapshots

## Applications

### Cortisol Host

The host process owns:

- The local `aiohttp` server
- WebSocket rooms
- SQLite state
- File uploads
- Market simulation
- Matchmaking
- World persistence
- LAN connection information

### Cortisol Client

The client connects to a Cortisol Host and displays:

- Home dashboard
- Arcade games
- Multiplayer rooms
- Wallets
- Simulated markets
- Explorer
- Messages
- Leaderboards
- Settings

## Product Areas

### Home

- Portfolio overview
- Quick actions
- Recent activity
- Market movers
- Bot activity feed

### Play

- Arena launcher
- Matchmaking
- Practice mode
- Live room access

### Mini-Games

The initial registered mini-game is Pong.

### Wallets

- Multiple simulated wallets
- Transfers
- Currency conversion
- Holdings
- Activity history

### Market

- Token discovery
- Token pages
- Simulated trading
- Token launches

### Explorer

- Simulated blocks
- Transactions
- Wallet pages
- Token pages

### Messages

- Direct messages
- Group conversations
- File uploads
- File downloads
- Attachment handling

### Leaderboard

- Player rankings
- Arena performance
- Activity-based scoring

## Technology

### Frontend

- Vanilla JavaScript
- ES modules
- HTML
- CSS

### Backend

- Python
- `aiohttp`
- WebSockets

### Storage

- SQLite
- Local filesystem storage
- Encrypted snapshots

### Packaging

- PyInstaller
- PowerShell build scripts
- GitHub Actions

## Run Locally

Install dependencies:

```bash
python -m pip install --user -r requirements.txt
```

Start the server:

```bash
python server/app.py --host 0.0.0.0 --port 8080
```

Open:

```text
http://localhost:8080/
```

To connect from another device on the same network:

```text
http://HOST_IP:8080/
```

## Host Control Application

Run:

```bash
python host/host_app.py
```

The host control application is the development entry point for the future:

```text
Cortisol Host.exe
```

## Client Launcher

Run:

```bash
python client/client_app.py
```

The launcher supports:

- Play locally
- Join a host using an IP address and port
- Connect through a URL or tunnel

## Build Windows Executables

Install build dependencies:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-build.txt
```

Build the host:

```powershell
.\scripts\build_host.ps1 -Clean
```

Build the client:

```powershell
.\scripts\build_client.ps1 -Clean
```

Build a release ZIP:

```powershell
.\scripts\build_release.ps1 -Version 0.1.0 -Clean
```

Outputs:

```text
dist/windows/Cortisol Host.exe
dist/windows/Cortisol Client.exe
dist/release/Cortisol Arcade-0.1.0-windows.zip
```

## Local Data

Live runtime data is stored under:

```text
runtime_data/live/
```

This data is local-only and ignored by Git.

Encrypted snapshots are stored under:

```text
runtime_data/sync/snapshots/
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `MAX_UPLOAD_MB` | Maximum individual upload size |
| `MAX_TOTAL_STORAGE_GB` | Maximum total local upload storage |
| `RETENTION_HOURS` | Upload retention period |
| `UPLOAD_ALLOWLIST_MIME` | Optional allowed MIME types |
| `CORTISOL_RUNTIME_ROOT` | Runtime-data directory |
| `CORTISOL_DB_PATH` | Optional database-path override |
| `CORTISOL_UPLOADS_DIR` | Optional upload-directory override |
| `CORTISOL_SYNC_PASSPHRASE` | Snapshot encryption passphrase |
| `CORTISOL_SYNC_PASSPHRASE_FILE` | Optional passphrase-file path |
| `CORTISOL_BACKUP_ON_EXIT` | Enable or disable shutdown backups |

Example:

```powershell
$env:MAX_UPLOAD_MB="1024"
$env:RETENTION_HOURS="72"
$env:MAX_TOTAL_STORAGE_GB="30"

python server\app.py --host 0.0.0.0 --port 8080
```

## Safety Note

The wallets, assets, markets, transactions, and blockchain explorer are entirely simulated.

No real money, cryptocurrency, wallet keys, or blockchain transactions are used.

## Planned Visuals

Add these files under:

```text
docs/images/
```

Recommended visuals:

- `cortisol-home.png`
- `cortisol-market.png`
- `cortisol-wallets.png`
- `cortisol-messages.png`
- `cortisol-game.png`
- `cortisol-lan-flow.png`
