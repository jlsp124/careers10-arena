# System Map

## Python Server

- Entry: `server/app.py`.
- Owns aiohttp HTTP routes, websocket connections, runtime state, uploads, snapshots, session cleanup, and market ticking.
- Reads and writes the live SQLite database under `runtime_data/live/`.
- Publishes the SPA and the browser-facing `/api/*` surface.

## Current Web SPA

- Entry: `web/js/app.js`.
- Route handling lives in `web/js/routes.js`.
- The SPA still implements the full browser shell, screen registry, launcher overlay, debug overlay, auth flow, and gameplay views.
- This surface should stop being treated as the future player client. It is the legacy/debug/reference UI.

## Host App

- Entry: `host/host_app.py`.
- It is the operator/admin desktop surface.
- It starts/stops the Python server, manages backups/restores, shows runtime status, and exposes admin controls.
- Admin controls belong here, not in the future player client.

## Client Launcher

- Entry: `client/client_app.py`.
- It is a launcher bridge for local play, LAN join, and URL-based connection setup.
- It can start a local Host process in dev mode.
- It is not the final player app; its role is transitional until Godot exists.

## Current Assets

- Usable image assets are currently split between `assets/generated/` and `assets/public/`.
- The `assets/game/` subfolders exist as organization targets, but they are mostly empty right now.
- The duplicated art files should be treated as transitional evidence, not as a finalized asset pipeline.

## Current Packaging

- PyInstaller specs live in `packaging/pyinstaller/`.
- `host.spec` packages the Host plus the browser app and content bundle.
- `client.spec` packages the Client launcher and the shared web logo asset.
- Packaging exists, but it is still Python-centric and not the future player-client architecture.

## Runtime Data

- `runtime_data/live/` is the live local working state. It must stay local-only and must not be committed.
- `runtime_data/sync/` is the repo-safe snapshot area for encrypted sync artifacts and restore data.
- `runtime_data/live/` is the active world state; `runtime_data/sync/` is the export/snapshot sidecar.

## Where The Old Browser Direction Stops

- The browser SPA remains valid for debug, reference, and transition support.
- It should not be extended as the long-term player client.
- New player-facing work should move to Godot, while the Python Host/server continues to own world state.
