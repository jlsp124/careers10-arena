# Release Checklist

Run this before publishing a Windows release zip.

## Build

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-build.txt
.\scripts\build_release.ps1 -Version 0.1.0 -Clean
```

Expected artifacts:

- `dist/windows/Cortisol Host.exe`
- `dist/windows/Cortisol Client.exe`
- `dist/release/Cortisol Arcade-0.1.0-windows.zip`

## Host

- `Cortisol Host.exe` opens the Host control window.
- `Start Host` starts the server without a terminal or stdin.
- Host status shows local URL, join URL, runtime paths, dirty state, sync state, and encryption state.
- `Open Runtime Folder` opens the packaged `runtime_data/` folder beside the executable.
- Saving a local sync passphrase writes under `runtime_data/live/`, not `runtime_data/sync/`.
- `Backup Now` creates `.world.enc` and `.manifest.json` under `runtime_data/sync/snapshots/`.
- Staging a restore with the correct passphrase returns restart required.
- Wrong or missing passphrase shows a clear error.
- `Stop Host` performs graceful shutdown and runs exit backup when dirty state exists.

## Client

- `Cortisol Client.exe` opens the Client launcher.
- `Play Local` starts a sibling `Cortisol Host.exe` in server mode and opens the Client URL.
- `Join Host` works with a LAN IP/name and port.
- `URL / Tunnel` works with a full Host URL.
- Unreachable Host shows an error before auth.
- Client does not create files under `runtime_data/sync/`.

## V1 Surface

- Lobby / Minigame Center loads.
- Arena loads and can enter a practice or room flow.
- Pong loads and reaches an entry/results loop.
- Wallets, Market, token creation, Explorer, DMs, group chat, Leaderboard, and Settings are reachable.
- Hub/community, boss mode, coming-soon routes, and online queue matchmaking are not visible V1 surfaces.

## GitHub Release

- Trigger `.github/workflows/build-windows-release.yml` manually for a test artifact.
- Push a tag like `v0.1.0` to build and attach the release zip to a GitHub Release.
