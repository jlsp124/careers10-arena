# Host Control Surface

This is the V1 direction for `Cortisol Host.exe`.

## Purpose

The Host app is a local operator window for the authoritative world runtime. It is not the player Client and does not contain gameplay.

The Host control surface must:

- start and stop the aiohttp Host server
- show local and LAN join URLs
- show world status, runtime paths, dirty state, sync status, users, online users, and active rooms
- create encrypted backups
- stage encrypted restores
- open runtime and sync folders
- show Host logs
- provide basic admin controls for announcements, kick, mute, and ban

## Current Implementation

Development entrypoint:

```powershell
python host\host_app.py
```

The control window starts `server/app.py` as a child process with a one-run `CORTISOL_HOST_CONTROL_TOKEN`. The server exposes token-protected endpoints under `/api/host-control/*` for local Host operations.

The Stop Host button calls `/api/host-control/shutdown`, which lets aiohttp run cleanup and gives the exit-backup path a chance to create a reason `exit` snapshot before SQLite closes.

## Boundaries

- Do not move Client gameplay into this app.
- Do not expose Host-control endpoints without a per-run token.
- Do not make Host-control APIs depend on player login state.
- Do not put raw live data in `runtime_data/sync/`.
- Do not claim this is packaged until a real executable build has been produced and smoke-tested.
