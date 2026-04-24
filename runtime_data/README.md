# Runtime Data Contract

`runtime_data/` separates Host-owned runtime artifacts from product source.

## `live/`

Local-only Host runtime data. This directory is gitignored except for `.gitkeep`.

Default live paths:

- `db/cortisol_arcade.sqlite3`
- `uploads/`
- `logs/`
- `exports/`
- `sync_snapshot_staging/`
- `world_state/dirty_state.json`
- `world_state/sync_state.json`
- `world_state/sync_passphrase.txt`
- `pending_restore/`

Do not commit:

- SQLite database copies
- upload blobs
- session tokens
- raw user files
- local Host logs with sensitive account data
- local sync passphrases

## `sync/`

Encrypted/exportable snapshot data that is safe to commit to the main repo.

Allowed examples:

- `snapshots/*.world.enc`
- `snapshots/*.manifest.json`
- `index.json`
- sanitized packaging smoke-test manifests
- small fixture JSON files with no live secrets

Never put raw DB files, raw upload blobs, session tokens, local snapshot keys, or unencrypted restore staging in `sync/`.

Legacy `server/data/` and `server/uploads/` remain ignored only as migration fallback paths. Cortisol Host now defaults to `runtime_data/live/`.
