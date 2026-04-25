from __future__ import annotations

import json
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


def packaged_resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent)).resolve()
    return Path(__file__).resolve().parents[1].resolve()


def packaged_app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return packaged_resource_root()


PROJECT_ROOT = packaged_resource_root()
APP_ROOT = packaged_app_root()


@dataclass(frozen=True)
class RuntimePaths:
    project_root: Path
    root: Path
    live_root: Path
    sync_root: Path
    db_path: Path
    uploads_dir: Path
    logs_dir: Path
    exports_dir: Path
    sync_snapshot_staging_dir: Path
    sync_snapshots_dir: Path
    world_state_dir: Path
    dirty_state_path: Path
    sync_state_path: Path
    sync_passphrase_path: Path
    snapshot_key_path: Path
    pending_restore_dir: Path
    legacy_db_path: Path
    legacy_uploads_dir: Path

    @property
    def db_dir(self) -> Path:
        return self.db_path.parent

    def public_dict(self) -> Dict[str, str]:
        return {
            "root": str(self.root),
            "live_root": str(self.live_root),
            "sync_root": str(self.sync_root),
            "db": str(self.db_path),
            "uploads": str(self.uploads_dir),
            "logs": str(self.logs_dir),
            "exports": str(self.exports_dir),
            "sync_snapshot_staging": str(self.sync_snapshot_staging_dir),
            "sync_snapshots": str(self.sync_snapshots_dir),
            "dirty_state": str(self.dirty_state_path),
            "sync_state": str(self.sync_state_path),
            "sync_passphrase_file": str(self.sync_passphrase_path),
        }


@dataclass(frozen=True)
class RuntimeConfig:
    paths: RuntimePaths
    admin_console_enabled: bool
    backup_on_exit_enabled: bool
    dirty_backup_threshold: int
    app_version: str

    def public_dict(self) -> Dict[str, Any]:
        return {
            "product": "Cortisol Arcade",
            "host": "Cortisol Host",
            "client": "Cortisol Client",
            "app_version": self.app_version,
            "admin_console_enabled": self.admin_console_enabled,
            "backup_on_exit_enabled": self.backup_on_exit_enabled,
            "dirty_backup_threshold": self.dirty_backup_threshold,
            "paths": self.paths.public_dict(),
            "live_data_gitignored": True,
            "sync_data_policy": "encrypted_snapshots_only",
            "sync_secret_configured": _sync_secret_configured(self.paths),
        }


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _path_env(name: str, default: Path, project_root: Path) -> Path:
    raw = os.getenv(name)
    if not raw:
        return default.resolve()
    path = Path(raw).expanduser()
    if not path.is_absolute():
        base = APP_ROOT if getattr(sys, "frozen", False) else project_root
        path = base / path
    return path.resolve()


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _sync_secret_configured(paths: RuntimePaths) -> bool:
    if os.getenv("CORTISOL_SYNC_PASSPHRASE", "").strip():
        return True
    if os.getenv("CORTISOL_WORLD_SNAPSHOT_KEY", "").strip():
        return True
    secret_file = os.getenv("CORTISOL_SYNC_PASSPHRASE_FILE", "").strip()
    candidate = Path(secret_file).expanduser() if secret_file else paths.sync_passphrase_path
    if not candidate.is_absolute():
        candidate = paths.project_root / candidate
    if candidate.exists() and candidate.read_text(encoding="utf-8").strip():
        return True
    return paths.snapshot_key_path.exists() and bool(paths.snapshot_key_path.read_text(encoding="utf-8").strip())


def build_runtime_config(project_root: Optional[Path] = None) -> RuntimeConfig:
    project_root = (project_root or PROJECT_ROOT).resolve()
    default_runtime_root = (APP_ROOT if getattr(sys, "frozen", False) else project_root) / "runtime_data"
    root = _path_env("CORTISOL_RUNTIME_ROOT", default_runtime_root, project_root)
    live_root = _path_env("CORTISOL_RUNTIME_LIVE_DIR", root / "live", project_root)
    sync_root = _path_env("CORTISOL_RUNTIME_SYNC_DIR", root / "sync", project_root)
    db_path = _path_env("CORTISOL_DB_PATH", live_root / "db" / "cortisol_arcade.sqlite3", project_root)
    uploads_dir = _path_env("CORTISOL_UPLOADS_DIR", live_root / "uploads", project_root)
    logs_dir = _path_env("CORTISOL_LOGS_DIR", live_root / "logs", project_root)
    exports_dir = _path_env("CORTISOL_EXPORTS_DIR", live_root / "exports", project_root)
    sync_snapshot_staging_dir = _path_env(
        "CORTISOL_SYNC_SNAPSHOT_STAGING_DIR",
        live_root / "sync_snapshot_staging",
        project_root,
    )
    sync_snapshots_dir = _path_env("CORTISOL_SYNC_SNAPSHOTS_DIR", sync_root / "snapshots", project_root)
    world_state_dir = _path_env("CORTISOL_WORLD_STATE_DIR", live_root / "world_state", project_root)
    dirty_state_path = _path_env("CORTISOL_DIRTY_STATE_PATH", world_state_dir / "dirty_state.json", project_root)
    sync_state_path = _path_env("CORTISOL_SYNC_STATE_PATH", world_state_dir / "sync_state.json", project_root)
    sync_passphrase_path = _path_env(
        "CORTISOL_SYNC_PASSPHRASE_FILE",
        world_state_dir / "sync_passphrase.txt",
        project_root,
    )
    snapshot_key_path = _path_env("CORTISOL_SNAPSHOT_KEY_PATH", world_state_dir / "snapshot.key", project_root)
    pending_restore_dir = _path_env("CORTISOL_PENDING_RESTORE_DIR", live_root / "pending_restore", project_root)

    paths = RuntimePaths(
        project_root=project_root,
        root=root,
        live_root=live_root,
        sync_root=sync_root,
        db_path=db_path,
        uploads_dir=uploads_dir,
        logs_dir=logs_dir,
        exports_dir=exports_dir,
        sync_snapshot_staging_dir=sync_snapshot_staging_dir,
        sync_snapshots_dir=sync_snapshots_dir,
        world_state_dir=world_state_dir,
        dirty_state_path=dirty_state_path,
        sync_state_path=sync_state_path,
        sync_passphrase_path=sync_passphrase_path,
        snapshot_key_path=snapshot_key_path,
        pending_restore_dir=pending_restore_dir,
        legacy_db_path=project_root / "server" / "data" / "cortisol_arcade.sqlite3",
        legacy_uploads_dir=project_root / "server" / "uploads",
    )
    return RuntimeConfig(
        paths=paths,
        admin_console_enabled=_bool_env("CORTISOL_ADMIN_CONSOLE", False),
        backup_on_exit_enabled=_bool_env("CORTISOL_BACKUP_ON_EXIT", True),
        dirty_backup_threshold=max(0, _int_env("CORTISOL_DIRTY_BACKUP_THRESHOLD", 25)),
        app_version=os.getenv("CORTISOL_APP_VERSION", "0.1.0-dev").strip() or "0.1.0-dev",
    )


def ensure_runtime_dirs(config: RuntimeConfig) -> Optional[Dict[str, Any]]:
    paths = config.paths
    for directory in (
        paths.root,
        paths.live_root,
        paths.sync_root,
        paths.db_dir,
        paths.uploads_dir,
        paths.logs_dir,
        paths.exports_dir,
        paths.sync_snapshot_staging_dir,
        paths.sync_snapshots_dir,
        paths.world_state_dir,
        paths.pending_restore_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    restore_result = apply_pending_restore_if_present(paths)
    _copy_legacy_db_if_needed(paths)
    _copy_legacy_uploads_if_needed(paths)
    _write_runtime_manifest(config, restore_result)
    return restore_result


def apply_pending_restore_if_present(paths: RuntimePaths) -> Optional[Dict[str, Any]]:
    manifest_path = paths.pending_restore_dir / "restore.json"
    if not manifest_path.exists():
        return None

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    staged_live = paths.pending_restore_dir / "live"
    staged_db = staged_live / "db" / "cortisol_arcade.sqlite3"
    staged_uploads = staged_live / "uploads"
    if not staged_db.exists():
        raise RuntimeError(f"Pending restore is missing staged DB: {staged_db}")

    snapshot_id = str(manifest.get("snapshot_id") or "unknown")
    backup_dir = paths.exports_dir / "restore-backups" / f"{int(time.time())}-{snapshot_id}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    _backup_current_live_data(paths, backup_dir)
    _replace_db(paths.db_path, staged_db)
    _replace_uploads(paths.uploads_dir, staged_uploads)

    applied = {
        "snapshot_id": snapshot_id,
        "applied_at": _now_iso(),
        "backup_dir": str(backup_dir),
        "source_snapshot": manifest.get("source_snapshot"),
    }
    (paths.world_state_dir / "last_restore.json").write_text(
        json.dumps(applied, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    _write_clean_dirty_state(paths, snapshot_id)
    shutil.rmtree(paths.pending_restore_dir, ignore_errors=True)
    paths.pending_restore_dir.mkdir(parents=True, exist_ok=True)
    return applied


def _backup_current_live_data(paths: RuntimePaths, backup_dir: Path) -> None:
    backup_db_dir = backup_dir / "db"
    backup_db_dir.mkdir(parents=True, exist_ok=True)
    for source in _sqlite_file_set(paths.db_path):
        if source.exists():
            shutil.copy2(source, backup_db_dir / source.name)
    if paths.uploads_dir.exists() and any(paths.uploads_dir.iterdir()):
        shutil.copytree(paths.uploads_dir, backup_dir / "uploads", dirs_exist_ok=True)


def _replace_db(target: Path, source: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    for db_file in _sqlite_file_set(target):
        if db_file.exists():
            db_file.unlink()
    shutil.copy2(source, target)


def _replace_uploads(target: Path, source: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    if source.exists():
        shutil.copytree(source, target, dirs_exist_ok=True)


def _sqlite_file_set(db_path: Path) -> tuple[Path, Path, Path]:
    return (db_path, Path(f"{db_path}-wal"), Path(f"{db_path}-shm"))


def _copy_legacy_db_if_needed(paths: RuntimePaths) -> None:
    if paths.db_path.exists() or not paths.legacy_db_path.exists():
        return
    paths.db_dir.mkdir(parents=True, exist_ok=True)
    for source in _sqlite_file_set(paths.legacy_db_path):
        if source.exists():
            suffix = source.name.replace(paths.legacy_db_path.name, "")
            target = Path(f"{paths.db_path}{suffix}") if suffix else paths.db_path
            shutil.copy2(source, target)


def _copy_legacy_uploads_if_needed(paths: RuntimePaths) -> None:
    if not paths.legacy_uploads_dir.exists():
        return
    if any(p for p in paths.uploads_dir.iterdir() if not p.name.startswith(".tmp-")):
        return
    for source in paths.legacy_uploads_dir.rglob("*"):
        if not source.is_file() or source.name.startswith(".tmp-"):
            continue
        target = paths.uploads_dir / source.relative_to(paths.legacy_uploads_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def _write_runtime_manifest(config: RuntimeConfig, restore_result: Optional[Dict[str, Any]]) -> None:
    paths = config.paths
    payload = config.public_dict()
    payload["last_startup_restore"] = restore_result
    payload["updated_at"] = _now_iso()
    (paths.world_state_dir / "runtime-config.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _write_clean_dirty_state(paths: RuntimePaths, snapshot_id: str) -> None:
    payload = {
        "dirty": False,
        "dirty_since": None,
        "event_count": 0,
        "last_clean_at": _now_iso(),
        "last_snapshot_id": snapshot_id,
        "last_restore_snapshot_id": snapshot_id,
        "reasons": {},
        "version": 0,
    }
    paths.dirty_state_path.parent.mkdir(parents=True, exist_ok=True)
    paths.dirty_state_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
