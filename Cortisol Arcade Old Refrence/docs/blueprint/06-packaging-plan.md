# Packaging Plan

Cortisol Arcade now has a real Windows packaging path for the current Python/Tk/aiohttp stack.

## Target Artifacts

Local build output:

- `dist/windows/Cortisol Host.exe`
- `dist/windows/Cortisol Client.exe`

Release output:

- `dist/release/Cortisol Arcade-<version>-windows/`
- `dist/release/Cortisol Arcade-<version>-windows.zip`

The release folder keeps both executables side by side so Client local mode can find and launch `Cortisol Host.exe` without asking the user to type `localhost`.

## Version And Metadata

- Source version lives in root `VERSION`.
- Build scripts set `CORTISOL_APP_VERSION` for runtime snapshot manifests.
- Release builds write `build-metadata.json` with product, version, UTC build time, git commit, branch, artifact names, and runtime data policy.

## Local Build Commands

From the repo root on Windows:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-build.txt
.\scripts\build_host.ps1 -Clean
.\scripts\build_client.ps1 -Clean
```

Or build both executables:

```powershell
.\scripts\build_release.ps1 -Clean
```

## Release Build Commands

Set an explicit version:

```powershell
.\scripts\build_release.ps1 -Version 0.1.0 -Clean
```

The release script:

1. Builds Host and Client through PyInstaller.
2. Copies both executables into a release folder.
3. Creates an empty `runtime_data/live/` local-only folder.
4. Creates `runtime_data/sync/snapshots/` for encrypted sync bundles.
5. Writes `build-metadata.json`.
6. Compresses the release folder into a `.zip`.

## GitHub Release Path

Workflow:

```text
.github/workflows/build-windows-release.yml
```

Supported paths:

- Manual `workflow_dispatch` build with optional version input.
- Tag push build for tags matching `v*`.
- Tagged builds upload the release zip to a GitHub Release.

## Packaged Host Runtime

`Cortisol Host.exe` starts the Tk Host control window by default.

When the control window starts the server, it launches the same executable with:

```text
Cortisol Host.exe --server --host <bind> --port <port>
```

The server child owns:

- aiohttp static client serving
- websocket rooms
- SQLite live data
- uploads
- market loop
- dirty-state tracking
- encrypted backup/restore
- admin control APIs

The packaged Host uses embedded resources for `web/`, `content/`, and public assets, but writes runtime data beside the executable:

- `runtime_data/live/`: raw local mutable Host data
- `runtime_data/sync/`: encrypted commit-safe snapshots and manifests

## Packaged Client Runtime

`Cortisol Client.exe` starts the Tk player launcher by default.

The launcher supports:

- Play Local
- Join Host
- Connect via URL / tunnel URL
- local connection profiles

In packaged local mode, Client launches a sibling `Cortisol Host.exe` in server mode and then opens the selected Host URL. If the Host executable is not beside Client, `CORTISOL_HOST_EXE` can point to it.

Client stores local connection preferences only. It does not write sync snapshots and does not own world persistence.

## PyInstaller Config

- `packaging/pyinstaller/host.spec`
- `packaging/pyinstaller/client.spec`

Host bundles the server code, web shell, content registry, and public assets.

Client bundles the launcher and the logo asset. It expects a Host executable for local server startup in packaged mode.

## Release Gates

Packaging is structurally implemented, but polished release quality still requires:

- a clean Windows-machine smoke test
- antivirus/smart-screen friction review
- signed executable or installer decision
- icon/version-resource polish
- upgrade/uninstall story
- automated smoke tests for HTTP, websocket, backup, restore, Arena, Pong, wallets, market, explorer, DMs, and uploads
