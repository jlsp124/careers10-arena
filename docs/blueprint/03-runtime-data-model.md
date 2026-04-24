# Runtime Data Model

This document separates source-controlled content from live Host data.

## Source-Controlled Data

- `content/games/_registry.json`: registered V1 games.
- `content/games/arena/`: Arena registry docs and metadata.
- `content/games/pong/`: Pong registry docs and metadata.
- `assets/manifest.json`: asset root manifest.
- `assets/prompts/`: source prompts for generated assets.
- `assets/public/`: product-ready public assets staged outside `web/`.
- `web/assets/`: assets currently served by the SPA.

## Live Host Data

These are Host-owned runtime paths and are not product source.

- `runtime_data/live/db/cortisol_arcade.sqlite3`: current SQLite database.
- `runtime_data/live/uploads/`: uploaded files.
- `runtime_data/live/logs/`: Host logs and diagnostics.
- `runtime_data/live/exports/`: local-only restore backups and uncommitted exports.
- `runtime_data/live/sync_snapshot_staging/`: temporary unencrypted staging used only while creating/restoring encrypted snapshots.
- `runtime_data/live/world_state/dirty_state.json`: dirty-state ledger owned by the Host.
- `runtime_data/live/world_state/sync_state.json`: last sync backup/error state.
- `runtime_data/live/world_state/sync_passphrase.txt`: optional local passphrase file. This is ignored and must never be committed.
- `runtime_data/live/pending_restore/`: decrypted restore payload staged for the next Host start.

`runtime_data/live/*` is gitignored. Only its placeholder file is tracked.

On first startup, the Host copies legacy local data from `server/data/cortisol_arcade.sqlite3` and `server/uploads/` into the new live runtime paths if the new paths are empty. The legacy paths remain ignored and are not the production source of truth.

## Sync Data

`runtime_data/sync/` is for encrypted/exportable snapshot data that is safe to commit to the main repo.

Allowed artifacts:

- `runtime_data/sync/snapshots/*.world.enc`: encrypted world snapshot bundles containing DB backup, uploads, and an encrypted payload manifest.
- `runtime_data/sync/snapshots/*.manifest.json`: commit-safe sidecar metadata for each encrypted bundle.
- `runtime_data/sync/index.json`: commit-safe index of known encrypted snapshots.

Not allowed:

- raw SQLite DB files
- raw upload blobs
- generated local snapshot keys
- session tokens
- unencrypted staging payloads

## Dirty-State Contract

The Host tracks meaningful changes in `runtime_data/live/world_state/dirty_state.json`. A snapshot clears dirty state after the encrypted artifact is written.

Meaningful dirty reasons:

- `account_created`
- `wallet_created`, `wallet_renamed`, `wallet_deleted`, `wallet_reordered`, `wallet_transfer`
- `economy_exchange`, `token_launch`, `liquidity_changed`, `market_action`
- `match_result`
- `message_sent`, `message_deleted`
- `upload_created`, `upload_deleted`
- `moderation_changed`, `stats_changed`
- `world_import`, `runtime_settings_changed`

Session creation, login, logout, room join/leave, queue changes, and transient room chat are not meaningful dirty state unless later persisted.

## Snapshot Contract

- Export uses `POST /api/runtime/snapshot` or `POST /api/runtime/backup` and writes an encrypted `.world.enc` file plus `.manifest.json` sidecar under `runtime_data/sync/snapshots/`.
- Export payloads are staged under `runtime_data/live/sync_snapshot_staging/`, encrypted, written to sync, then deleted.
- If `CORTISOL_SYNC_PASSPHRASE` is set, it is used to derive the encryption key.
- If no env passphrase is set, Host reads `runtime_data/live/world_state/sync_passphrase.txt` or the path in `CORTISOL_SYNC_PASSPHRASE_FILE`.
- Host does not create a fake default secret. Backup and restore fail clearly with `sync_secret_missing` until a passphrase is configured.
- The legacy `CORTISOL_WORLD_SNAPSHOT_KEY` and `runtime_data/live/world_state/snapshot.key` are accepted only as compatibility fallbacks.
- Import uses `POST /api/runtime/restore` to decrypt and stage a pending restore. The restore is applied at the next Host startup before SQLite opens.

## Backup Triggers

- Manual backup: admin-only `POST /api/runtime/backup` or `POST /api/runtime/snapshot` with reason `manual`.
- Dirty-threshold backup: Host creates reason `dirty-threshold` after `CORTISOL_DIRTY_BACKUP_THRESHOLD` meaningful changes. Default threshold is `25`.
- Exit backup: Host creates reason `exit` during graceful cleanup when dirty state exists and `CORTISOL_BACKUP_ON_EXIT` is enabled. It is enabled by default.

## Contract Rules

- Host data is authoritative only while owned by the Host process.
- Source-controlled content can seed or describe runtime behavior, but it must not pretend to be live data.
- Live data must not be committed.
- Sync data must be encrypted or explicitly sanitized.
- Client must not own world persistence or snapshot logic.
- Migrations must preserve existing local DB users and wallets unless a destructive reset is explicitly requested.
