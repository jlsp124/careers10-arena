# Sync And Restore

This is the repo-backed encrypted sync contract for Cortisol Host.

## Model

- `runtime_data/live/`: local working files. Gitignored. Contains raw SQLite, raw uploads, local logs, local passphrase files, staging, and pending restores.
- `runtime_data/sync/`: commit-safe encrypted artifacts. This is the only repo folder intended to carry world data.
- Cortisol Host owns all backup, restore, and dirty-threshold logic.
- Cortisol Client never writes world snapshots and never owns world persistence.

## Encryption

Snapshots are encrypted with Fernet using a key derived from the user passphrase by PBKDF2-HMAC-SHA256.

Passphrase lookup order:

1. `CORTISOL_SYNC_PASSPHRASE`
2. `CORTISOL_WORLD_SNAPSHOT_KEY` legacy compatibility
3. `CORTISOL_SYNC_PASSPHRASE_FILE`
4. `runtime_data/live/world_state/sync_passphrase.txt`
5. `runtime_data/live/world_state/snapshot.key` legacy compatibility

No default passphrase is generated. If no secret is configured, backup and restore return `sync_secret_missing`. If the wrong secret is configured, restore returns `snapshot_decrypt_failed`.

Admin API can write a local ignored passphrase file:

```text
POST /api/runtime/sync-secret
```

Body:

```json
{"passphrase":"your local backup passphrase"}
```

## Snapshot Files

Each backup creates:

- `runtime_data/sync/snapshots/<snapshot_id>.world.enc`
- `runtime_data/sync/snapshots/<snapshot_id>.manifest.json`
- `runtime_data/sync/index.json`

The `.world.enc` file is the encrypted bundle. It contains:

- SQLite backup at `db/cortisol_arcade.sqlite3`
- upload files under `uploads/`
- encrypted payload manifest

The `.manifest.json` sidecar is commit-safe metadata:

- `snapshot_id`
- `created_at`
- `reason`: `manual`, `exit`, or `dirty-threshold`
- `app_version`
- `schema_version`
- encrypted bundle path, size, and hash
- payload hash and high-level counts
- KDF salt and iteration metadata

The sidecar must not include raw user messages, raw uploads, raw DB pages, session tokens, or the passphrase.

## Backup Triggers

Manual:

```text
POST /api/runtime/backup
POST /api/runtime/snapshot
```

Dirty threshold:

- Controlled by `CORTISOL_DIRTY_BACKUP_THRESHOLD`.
- Default is `25`.
- Counts meaningful dirty changes only.
- On success, dirty state is cleared.
- On missing secret, Host records a clear sync error and leaves dirty state uncleared.

Graceful exit:

- Controlled by `CORTISOL_BACKUP_ON_EXIT`.
- Enabled by default.
- Runs during aiohttp cleanup before SQLite closes.
- Skips when there is no dirty state.
- Logs a clear error if backup cannot run.

## Restore

Restore is staged, not hot-swapped.

```text
POST /api/runtime/restore
```

Body:

```json
{"snapshot_id":"20260424T000000Z-example"}
```

Host decrypts the encrypted bundle, validates hashes, copies decrypted files into `runtime_data/live/pending_restore/`, and returns `restart_required: true`.

On next Host startup, before SQLite opens, Host:

1. Backs up current live DB/uploads to `runtime_data/live/exports/restore-backups/`.
2. Replaces live DB/uploads from the pending restore.
3. Clears pending restore staging.
4. Clears dirty state for the restored snapshot.

## What Must Not Happen

- Do not commit `runtime_data/live/`.
- Do not put raw `.sqlite3`, uploads, logs, local passphrase files, or decrypted staging into `runtime_data/sync/`.
- Do not make Client responsible for backup or restore.
- Do not claim snapshots are recoverable without the same passphrase.
