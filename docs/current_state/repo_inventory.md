# Repo Inventory

## Top-Level Folders

- `assets/`: generated and public art assets; contains legacy duplicates and the new staging areas for future organization.
- `client/`: current Python client launcher shell.
- `content/`: game registry and content references.
- `docs/`: blueprint docs plus current-state and next-build notes.
- `host/`: current Python Host control app.
- `packaging/`: PyInstaller packaging specs for the Python Host and Client.
- `runtime_data/`: live local state and sync snapshot storage.
- `scripts/`: Windows run and build helpers.
- `server/`: current Python aiohttp backend and websocket/game state owner.
- `web/`: current browser SPA, still runnable and feature-rich, but now legacy/debug reference.

## Purpose By Area

- Current: `server/`, `host/`, `client/`, `content/`, `scripts/`, `packaging/`.
- Legacy/debug: `web/` as the browser SPA reference surface.
- Future: new Godot player client workspace, not present yet on this branch.
- Shared assets: `assets/`.
- Local runtime state: `runtime_data/`.

## What Is Legacy

- The browser SPA under `web/` is no longer the intended player client.
- The Python client launcher under `client/` is a bridge artifact, not the final player experience.
- Any browser-wrapper or pywebview direction is legacy.
- Duplicated art in `assets/generated/` and `assets/public/` is transitional and should not be treated as a finished asset system.

## What Is Current

- Python Host/server owns state, sessions, websocket routing, market simulation, uploads, and runtime persistence.
- The Host control app is the current admin/operator surface.
- The Python client launcher is the current launcher bridge for local/connect flows.
- The old SPA is still current as a debug and reference UI.

## What Is Future

- A Godot player client that becomes the real game-facing app.
- A cleaner asset pipeline for player-facing art and UI references.
- A smaller, explicit boundary between player client and Host/admin controls.

## What Should Not Be Touched Yet

- `runtime_data/live/`
- gameplay logic
- market logic
- messages logic
- arena logic
- host logic
- client logic
- packaging logic, except for documentation notes
- the old web app as a codebase, unless a later task explicitly says otherwise

## What Likely Needs Migration

- Player-facing navigation and shell behavior from `web/` into Godot.
- Asset organization from the duplicated generated/public layout into a clearer source-of-truth structure.
- Launcher flow from the Python client into a future Godot entry flow.
- Any browser-only debug affordances that should remain available as reference tooling only.
