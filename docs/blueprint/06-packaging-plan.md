# Packaging Plan

Packaging is not complete. The repo now has product names and target architecture, but still runs through the Python Host and browser-served Client in development.

## Target Binaries

- `Cortisol Host.exe`
- `Cortisol Client.exe`

## Host Package Responsibilities

- Bundle Python runtime or compile a standalone host.
- Start the Host control window from `host/host_app.py` without requiring manual Python setup.
- Let the Host control window start and stop the `server/app.py` runtime cleanly.
- Own a writable runtime root equivalent to `runtime_data/live/` for SQLite, uploads, logs, exports, dirty-state, local keys, and pending restores.
- Write only encrypted/exportable snapshots to a sync root equivalent to `runtime_data/sync/`.
- Print or expose LAN join URL.
- Preserve upload and retention env/config controls.
- Preserve runtime env/config controls for DB, uploads, logs, exports, snapshot staging, and sync snapshots.
- Run without stdin. The legacy operator console is dev-only behind `CORTISOL_ADMIN_CONSOLE=1`.
- Provide clear logs for websocket, DB, upload, and market-loop failures.

## Client Package Responsibilities

- Open a desktop shell connected to a Host URL.
- Store only local client preferences and session token.
- Expose Host URL entry or discovery.
- Render the same V1 product surface as `web/index.html`.
- Avoid claiming offline authority over wallets, market, explorer, or game results.

## Suggested Packaging Sequence

1. Add smoke tests for HTTP routes, websocket hello, Arena practice, Pong room join, wallet load, market load, explorer load, DM thread load, snapshot export, and staged restore.
2. Choose packaging tools for Host and Client.
3. Build Host executable with writable runtime paths outside the install directory.
4. Build Client executable with Host URL selection.
5. Add signed release artifact structure.
6. Add update/uninstall story.

## Release Gates

Do not call packaging ready until:

- both executables launch on a clean Windows machine
- Host data survives restart
- Host can create an encrypted snapshot and stage a restore without raw live data entering source control
- Host can start without stdin attached
- Host control window can start, stop, show status, run backup/restore, and open runtime folders
- Client can connect to local Host and LAN Host
- Arena and Pong can be opened from packaged Client
- DMs and file upload work through packaged Host
- no Hub/community, boss mode, or coming-soon surface is visible
