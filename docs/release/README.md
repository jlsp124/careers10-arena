# Cortisol Arcade Windows Release

This folder contains:

- `Cortisol Host.exe`
- `Cortisol Client.exe`
- `build-metadata.json`
- `runtime_data/`

## Run

1. Open `Cortisol Host.exe`.
2. In the Host window, set a backup passphrase before using backup/restore.
3. Click `Start Host`.
4. Open `Cortisol Client.exe`.
5. Choose `Play Local`, `Join Host`, or `URL / Tunnel`.

Users do not need to type `localhost` manually.

## Runtime Data

- `runtime_data/live/` is local raw Host data. Do not commit or publish it.
- `runtime_data/sync/` is for encrypted `.world.enc` snapshots and commit-safe manifests.
- Host owns backup, restore, dirty-threshold autosave, and exit backup.
- Client stores connection preferences only.

## Restore

Restore is staged by Host and applied on next Host startup. Use the same passphrase that created the snapshot.

## Build Source

The release was built by:

```powershell
.\scripts\build_release.ps1 -Version <version> -Clean
```
