from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import secrets
import shutil
import tarfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from runtime import RuntimeConfig, RuntimePaths, apply_pending_restore_if_present


SNAPSHOT_SCHEMA_VERSION = 2
INDEX_SCHEMA_VERSION = 1
ALLOWED_SNAPSHOT_REASONS = {"manual", "exit", "dirty-threshold"}

MEANINGFUL_DIRTY_REASONS = {
    "account_created",
    "wallet_created",
    "wallet_renamed",
    "wallet_deleted",
    "wallet_reordered",
    "wallet_transfer",
    "economy_exchange",
    "token_launch",
    "liquidity_changed",
    "market_action",
    "match_result",
    "message_sent",
    "message_deleted",
    "upload_created",
    "upload_deleted",
    "moderation_changed",
    "stats_changed",
    "world_import",
    "runtime_settings_changed",
}


class SnapshotSyncError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class SyncSecretMissing(SnapshotSyncError):
    def __init__(self) -> None:
        super().__init__(
            "sync_secret_missing",
            "Set CORTISOL_SYNC_PASSPHRASE or configure a local sync passphrase file before backup/restore.",
        )


class SnapshotDecryptionError(SnapshotSyncError):
    def __init__(self) -> None:
        super().__init__(
            "snapshot_decrypt_failed",
            "Snapshot could not be decrypted. The sync passphrase is missing, wrong, or the bundle is corrupt.",
        )


class SnapshotFormatError(SnapshotSyncError):
    def __init__(self, message: str) -> None:
        super().__init__("snapshot_format_error", message)


class DirtyStateTracker:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._state = self._load()

    def mark(self, reason: str, detail: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if reason not in MEANINGFUL_DIRTY_REASONS:
            reason = "runtime_settings_changed"
        now = _now_iso()
        with self._lock:
            if not self._state.get("dirty"):
                self._state["dirty"] = True
                self._state["dirty_since"] = now
            self._state["last_dirty_at"] = now
            self._state["version"] = int(self._state.get("version") or 0) + 1
            self._state["event_count"] = int(self._state.get("event_count") or 0) + 1
            self._state["dirty_event_count"] = int(self._state.get("dirty_event_count") or 0) + 1
            reasons = self._state.setdefault("reasons", {})
            entry = reasons.setdefault(reason, {"count": 0, "last_at": now, "last_detail": None})
            entry["count"] = int(entry.get("count") or 0) + 1
            entry["last_at"] = now
            entry["last_detail"] = detail or {}
            self._persist_locked()
            return self.payload()

    def clear(self, snapshot_id: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            self._state["dirty"] = False
            self._state["dirty_since"] = None
            self._state["dirty_event_count"] = 0
            self._state["last_clean_at"] = _now_iso()
            self._state["last_snapshot_id"] = snapshot_id or self._state.get("last_snapshot_id")
            self._state["reasons"] = {}
            self._persist_locked()
            return self.payload()

    def payload(self) -> Dict[str, Any]:
        with self._lock:
            payload = json.loads(json.dumps(self._state))
            payload["meaningful_reasons"] = sorted(MEANINGFUL_DIRTY_REASONS)
            return payload

    def _load(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except json.JSONDecodeError:
                data = {}
        data.setdefault("dirty", False)
        data.setdefault("dirty_since", None)
        data.setdefault("dirty_event_count", int(data.get("event_count") or 0) if data.get("dirty") else 0)
        data.setdefault("event_count", int(data.get("dirty_event_count") or 0))
        data.setdefault("last_clean_at", None)
        data.setdefault("last_snapshot_id", None)
        data.setdefault("reasons", {})
        data.setdefault("version", 0)
        return data

    def _persist_locked(self) -> None:
        tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        tmp_path.write_text(json.dumps(self._state, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp_path, self.path)


class SyncBackupController:
    def __init__(self, config: RuntimeConfig, snapshots: "WorldSnapshotManager", dirty: DirtyStateTracker):
        self.config = config
        self.snapshots = snapshots
        self.dirty = dirty
        self.state_path = config.paths.sync_state_path
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._last_failed_dirty_count = 0
        self._state = self._load_state()

    def mark_dirty(self, db: Any, reason: str, detail: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        dirty_state = self.dirty.mark(reason, detail)
        self.maybe_dirty_threshold_backup(db, dirty_state)
        return dirty_state

    def manual_backup(self, db: Any, note: str = "") -> Dict[str, Any]:
        return self.create_backup(db, reason="manual", note=note, raise_on_error=True)

    def backup_on_exit(self, db: Any) -> Dict[str, Any]:
        if not self.config.backup_on_exit_enabled:
            return {"ok": True, "skipped": True, "reason": "backup_on_exit_disabled"}
        if not self.dirty.payload().get("dirty"):
            return {"ok": True, "skipped": True, "reason": "not_dirty"}
        return self.create_backup(db, reason="exit", note="Graceful Cortisol Host shutdown.", raise_on_error=False)

    def maybe_dirty_threshold_backup(self, db: Any, dirty_state: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        threshold = int(self.config.dirty_backup_threshold)
        if threshold <= 0:
            return None
        dirty_state = dirty_state or self.dirty.payload()
        dirty_count = int(dirty_state.get("dirty_event_count") or 0)
        if dirty_count < threshold:
            return None
        if self._last_failed_dirty_count and dirty_count < self._last_failed_dirty_count + threshold:
            return None
        return self.create_backup(
            db,
            reason="dirty-threshold",
            note=f"Automatic backup after {dirty_count} meaningful changes.",
            raise_on_error=False,
        )

    def create_backup(self, db: Any, *, reason: str, note: str = "", raise_on_error: bool) -> Dict[str, Any]:
        try:
            snapshot = self.snapshots.create_snapshot(db, reason=reason, note=note)
        except SnapshotSyncError as exc:
            if reason == "dirty-threshold":
                self._last_failed_dirty_count = int(self.dirty.payload().get("dirty_event_count") or 0)
            self._record_error(exc.code, exc.message, reason)
            if raise_on_error:
                raise
            return {"ok": False, "error": exc.code, "detail": exc.message, "reason": reason}
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            if reason == "dirty-threshold":
                self._last_failed_dirty_count = int(self.dirty.payload().get("dirty_event_count") or 0)
            self._record_error("snapshot_create_failed", message, reason)
            if raise_on_error:
                raise
            return {"ok": False, "error": "snapshot_create_failed", "detail": message, "reason": reason}

        self._last_failed_dirty_count = 0
        self._record_backup(snapshot, reason)
        return {"ok": True, "snapshot": snapshot}

    def write_local_passphrase(self, passphrase: str) -> Dict[str, Any]:
        result = self.snapshots.write_local_passphrase(passphrase)
        with self._lock:
            self._state["secret_configured_at"] = _now_iso()
            self._state["secret_source"] = result["source"]
            self._persist_state_locked()
        return result

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "secret_configured": self.snapshots.secret_configured(),
                "secret_sources": self.snapshots.secret_sources(),
                "backup_on_exit_enabled": self.config.backup_on_exit_enabled,
                "dirty_backup_threshold": self.config.dirty_backup_threshold,
                "last_backup": self._state.get("last_backup"),
                "last_error": self._state.get("last_error"),
                "secret_configured_at": self._state.get("secret_configured_at"),
            }

    def _record_backup(self, snapshot: Dict[str, Any], reason: str) -> None:
        with self._lock:
            self._state["last_backup"] = {
                "snapshot_id": snapshot.get("snapshot_id"),
                "reason": reason,
                "created_at": snapshot.get("created_at"),
                "path": snapshot.get("bundle_path"),
            }
            self._state["last_error"] = None
            self._persist_state_locked()

    def _record_error(self, code: str, message: str, reason: str) -> None:
        with self._lock:
            self._state["last_error"] = {
                "code": code,
                "message": message,
                "reason": reason,
                "created_at": _now_iso(),
            }
            self._persist_state_locked()

    def _load_state(self) -> Dict[str, Any]:
        if self.state_path.exists():
            try:
                data = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
        return {"schema_version": 1, "last_backup": None, "last_error": None}

    def _persist_state_locked(self) -> None:
        tmp_path = self.state_path.with_suffix(f"{self.state_path.suffix}.tmp")
        tmp_path.write_text(json.dumps(self._state, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp_path, self.state_path)


class WorldSnapshotManager:
    def __init__(self, config: RuntimeConfig, dirty: DirtyStateTracker):
        self.config = config
        self.paths = config.paths
        self.dirty = dirty

    def create_snapshot(self, db: Any, *, reason: str = "manual", note: str = "") -> Dict[str, Any]:
        reason = _clean_reason(reason)
        secret, secret_source = _load_sync_secret(self.paths)
        snapshot_id = _snapshot_id()
        staging = self.paths.sync_snapshot_staging_dir / snapshot_id
        payload_root = staging / "payload"
        payload_root.mkdir(parents=True, exist_ok=True)
        try:
            payload_meta = self._stage_live_payload(db, payload_root, snapshot_id, reason, note)
            raw_payload = _tar_gz_dir(payload_root)
            payload_sha256 = hashlib.sha256(raw_payload).hexdigest()
            salt = secrets.token_bytes(16)
            encrypted = _encrypt_payload_bytes(secret, salt, raw_payload)
            encrypted_sha256 = hashlib.sha256(encrypted).hexdigest()

            bundle_path = self.paths.sync_snapshots_dir / f"{snapshot_id}.world.enc"
            manifest_path = self.paths.sync_snapshots_dir / f"{snapshot_id}.manifest.json"
            self.paths.sync_snapshots_dir.mkdir(parents=True, exist_ok=True)
            bundle_path.write_bytes(encrypted)

            manifest = self._build_manifest(
                snapshot_id=snapshot_id,
                reason=reason,
                note=note,
                bundle_path=bundle_path,
                encrypted_sha256=encrypted_sha256,
                encrypted_size=len(encrypted),
                payload_sha256=payload_sha256,
                payload_meta=payload_meta,
                salt=salt,
                secret_source=secret_source,
            )
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
            self._write_index()
            self.dirty.clear(snapshot_id=snapshot_id)
            return self._snapshot_public_payload(manifest_path, manifest)
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def list_snapshots(self, limit: int = 50) -> List[Dict[str, Any]]:
        snapshots = []
        manifests = sorted(
            self.paths.sync_snapshots_dir.glob("*.manifest.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for path in manifests:
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
                snapshots.append(self._snapshot_public_payload(path, manifest))
            except (json.JSONDecodeError, FileNotFoundError, SnapshotFormatError):
                continue
            if len(snapshots) >= limit:
                break
        return snapshots

    def stage_restore(self, snapshot_ref: str) -> Dict[str, Any]:
        secret, _secret_source = _load_sync_secret(self.paths)
        manifest_path = self._resolve_snapshot_manifest(snapshot_ref)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        _validate_manifest(manifest)
        bundle_path = self._bundle_path_from_manifest(manifest)
        encrypted = bundle_path.read_bytes()
        expected_bundle_sha = str((manifest.get("bundle") or {}).get("sha256") or "")
        if hashlib.sha256(encrypted).hexdigest() != expected_bundle_sha:
            raise SnapshotFormatError("Snapshot bundle hash mismatch.")

        salt = base64.b64decode(str(((manifest.get("crypto") or {}).get("kdf") or {}).get("salt") or ""))
        raw_payload = _decrypt_payload_bytes(secret, salt, encrypted)
        if hashlib.sha256(raw_payload).hexdigest() != str((manifest.get("payload") or {}).get("sha256") or ""):
            raise SnapshotFormatError("Snapshot payload hash mismatch.")

        snapshot_id = str(manifest.get("snapshot_id") or manifest_path.stem)
        staging = self.paths.sync_snapshot_staging_dir / f"restore-{snapshot_id}"
        extracted = staging / "extracted"
        shutil.rmtree(staging, ignore_errors=True)
        extracted.mkdir(parents=True, exist_ok=True)
        try:
            _extract_tar_gz(raw_payload, extracted)
            staged_live = self.paths.pending_restore_dir / "live"
            shutil.rmtree(self.paths.pending_restore_dir, ignore_errors=True)
            (staged_live / "db").mkdir(parents=True, exist_ok=True)
            db_source = extracted / "db" / "cortisol_arcade.sqlite3"
            if not db_source.exists():
                raise SnapshotFormatError("Snapshot payload is missing db/cortisol_arcade.sqlite3.")
            shutil.copy2(db_source, staged_live / "db" / "cortisol_arcade.sqlite3")
            if (extracted / "uploads").exists():
                shutil.copytree(extracted / "uploads", staged_live / "uploads", dirs_exist_ok=True)
            else:
                (staged_live / "uploads").mkdir(parents=True, exist_ok=True)
            restore_manifest = {
                "snapshot_id": snapshot_id,
                "source_snapshot": _repo_relative(manifest_path, self.paths.project_root),
                "source_bundle": _repo_relative(bundle_path, self.paths.project_root),
                "staged_at": _now_iso(),
                "restart_required": True,
            }
            self.paths.pending_restore_dir.mkdir(parents=True, exist_ok=True)
            (self.paths.pending_restore_dir / "restore.json").write_text(
                json.dumps(restore_manifest, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            return restore_manifest
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def restore_live_data_from_snapshot(self, snapshot_ref: str) -> Dict[str, Any]:
        staged = self.stage_restore(snapshot_ref)
        applied = apply_pending_restore_if_present(self.paths)
        return {"staged": staged, "applied": applied}

    def secret_configured(self) -> bool:
        try:
            _load_sync_secret(self.paths)
            return True
        except SyncSecretMissing:
            return False

    def secret_sources(self) -> List[str]:
        sources = []
        if os.getenv("CORTISOL_SYNC_PASSPHRASE", "").strip():
            sources.append("env:CORTISOL_SYNC_PASSPHRASE")
        if os.getenv("CORTISOL_WORLD_SNAPSHOT_KEY", "").strip():
            sources.append("env:CORTISOL_WORLD_SNAPSHOT_KEY")
        if self.paths.sync_passphrase_path.exists() and self.paths.sync_passphrase_path.read_text(encoding="utf-8").strip():
            sources.append("file:CORTISOL_SYNC_PASSPHRASE_FILE")
        if self.paths.snapshot_key_path.exists() and self.paths.snapshot_key_path.read_text(encoding="utf-8").strip():
            sources.append("file:CORTISOL_SNAPSHOT_KEY_PATH")
        return sources

    def write_local_passphrase(self, passphrase: str) -> Dict[str, Any]:
        clean = (passphrase or "").strip()
        if len(clean) < 8:
            raise SnapshotSyncError("sync_passphrase_too_short", "Sync passphrase must be at least 8 characters.")
        self.paths.sync_passphrase_path.parent.mkdir(parents=True, exist_ok=True)
        self.paths.sync_passphrase_path.write_text(clean, encoding="utf-8")
        return {"ok": True, "source": "file:CORTISOL_SYNC_PASSPHRASE_FILE", "path": str(self.paths.sync_passphrase_path)}

    def _stage_live_payload(
        self,
        db: Any,
        payload_root: Path,
        snapshot_id: str,
        reason: str,
        note: str,
    ) -> Dict[str, Any]:
        db_target = payload_root / "db" / "cortisol_arcade.sqlite3"
        db_target.parent.mkdir(parents=True, exist_ok=True)
        if hasattr(db, "backup_to"):
            db.backup_to(db_target)
        elif self.paths.db_path.exists():
            shutil.copy2(self.paths.db_path, db_target)
        else:
            raise FileNotFoundError(f"Live DB not found: {self.paths.db_path}")

        uploads_target = payload_root / "uploads"
        uploads_target.mkdir(parents=True, exist_ok=True)
        upload_count = 0
        upload_bytes = 0
        if self.paths.uploads_dir.exists():
            for source in self.paths.uploads_dir.rglob("*"):
                if not source.is_file() or source.name.startswith(".tmp-"):
                    continue
                target = uploads_target / source.relative_to(self.paths.uploads_dir)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                upload_count += 1
                upload_bytes += int(source.stat().st_size)

        manifest = {
            "schema_version": SNAPSHOT_SCHEMA_VERSION,
            "kind": "cortisol_world_payload",
            "product": "Cortisol Arcade",
            "created_by": "Cortisol Host",
            "app_version": self.config.app_version,
            "snapshot_id": snapshot_id,
            "created_at": _now_iso(),
            "reason": reason,
            "note": note[:500],
            "runtime_model": {
                "live": "runtime_data/live",
                "sync": "runtime_data/sync",
                "client_persistence": "preferences_and_session_only",
            },
            "dirty_state": self.dirty.payload(),
            "payload": {"db": "db/cortisol_arcade.sqlite3", "upload_count": upload_count, "upload_bytes": upload_bytes},
        }
        (payload_root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
        return {"upload_count": upload_count, "upload_bytes": upload_bytes, "db_included": True}

    def _build_manifest(
        self,
        *,
        snapshot_id: str,
        reason: str,
        note: str,
        bundle_path: Path,
        encrypted_sha256: str,
        encrypted_size: int,
        payload_sha256: str,
        payload_meta: Dict[str, Any],
        salt: bytes,
        secret_source: str,
    ) -> Dict[str, Any]:
        created_at = _now_iso()
        return {
            "schema_version": SNAPSHOT_SCHEMA_VERSION,
            "kind": "cortisol_world_snapshot_manifest",
            "product": "Cortisol Arcade",
            "created_by": "Cortisol Host",
            "app_version": self.config.app_version,
            "snapshot_id": snapshot_id,
            "created_at": created_at,
            "reason": reason,
            "note": note[:500],
            "encrypted": True,
            "commit_safe": True,
            "bundle": {
                "path": _repo_relative(bundle_path, self.paths.sync_root),
                "sha256": encrypted_sha256,
                "size_bytes": encrypted_size,
            },
            "payload": {
                "format": "tar.gz",
                "sha256": payload_sha256,
                "db_included": bool(payload_meta.get("db_included")),
                "upload_count": int(payload_meta.get("upload_count") or 0),
                "upload_bytes": int(payload_meta.get("upload_bytes") or 0),
            },
            "crypto": {
                "scheme": "Fernet",
                "kdf": {
                    "name": "PBKDF2HMAC-SHA256",
                    "iterations": 390000,
                    "salt": base64.b64encode(salt).decode("ascii"),
                },
                "secret_source": secret_source,
            },
            "dirty_state": _dirty_summary(self.dirty.payload()),
        }

    def _write_index(self) -> None:
        snapshots = []
        for manifest_path in sorted(self.paths.sync_snapshots_dir.glob("*.manifest.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                _validate_manifest(manifest)
                snapshots.append(self._snapshot_public_payload(manifest_path, manifest))
            except (json.JSONDecodeError, FileNotFoundError, SnapshotFormatError):
                continue
        snapshots.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
        index = {
            "schema_version": INDEX_SCHEMA_VERSION,
            "kind": "cortisol_world_snapshot_index",
            "product": "Cortisol Arcade",
            "updated_at": _now_iso(),
            "snapshot_count": len(snapshots),
            "snapshots": snapshots,
        }
        (self.paths.sync_root / "index.json").write_text(json.dumps(index, indent=2, sort_keys=True), encoding="utf-8")

    def _resolve_snapshot_manifest(self, snapshot_ref: str) -> Path:
        ref = (snapshot_ref or "").strip()
        if not ref:
            raise FileNotFoundError("missing_snapshot_ref")
        path = Path(ref)
        if not path.is_absolute():
            if ref.endswith(".manifest.json"):
                path = self.paths.sync_snapshots_dir / Path(ref).name
            elif ref.endswith(".world.enc"):
                path = self.paths.sync_snapshots_dir / Path(ref).name.replace(".world.enc", ".manifest.json")
            else:
                path = self.paths.sync_snapshots_dir / f"{ref}.manifest.json"
        path = path.resolve()
        base = self.paths.sync_snapshots_dir.resolve()
        if os.path.commonpath([str(base), str(path)]) != str(base):
            raise FileNotFoundError(str(path))
        if not path.exists():
            raise FileNotFoundError(str(path))
        return path

    def _bundle_path_from_manifest(self, manifest: Dict[str, Any]) -> Path:
        bundle = manifest.get("bundle") or {}
        rel_path = str(bundle.get("path") or "")
        if not rel_path:
            raise SnapshotFormatError("Snapshot manifest is missing bundle.path.")
        path = (self.paths.sync_root / rel_path).resolve()
        base = self.paths.sync_root.resolve()
        if os.path.commonpath([str(base), str(path)]) != str(base):
            raise SnapshotFormatError("Snapshot bundle path escapes runtime_data/sync.")
        if not path.exists():
            raise FileNotFoundError(str(path))
        return path

    def _snapshot_public_payload(self, manifest_path: Path, manifest: Dict[str, Any]) -> Dict[str, Any]:
        bundle_path = self._bundle_path_from_manifest(manifest)
        return {
            "snapshot_id": manifest.get("snapshot_id"),
            "created_at": manifest.get("created_at"),
            "reason": manifest.get("reason"),
            "app_version": manifest.get("app_version"),
            "schema_version": manifest.get("schema_version"),
            "manifest_path": _repo_relative(manifest_path, self.paths.project_root),
            "bundle_path": _repo_relative(bundle_path, self.paths.project_root),
            "size_bytes": bundle_path.stat().st_size,
            "format": "tar.gz+fernet",
            "encrypted": True,
        }


def snapshot_error_payload(exc: Exception) -> Dict[str, str]:
    if isinstance(exc, SnapshotSyncError):
        return {"error": exc.code, "detail": exc.message}
    return {"error": "snapshot_error", "detail": str(exc) or exc.__class__.__name__}


def _load_sync_secret(paths: RuntimePaths) -> Tuple[str, str]:
    env_passphrase = os.getenv("CORTISOL_SYNC_PASSPHRASE", "").strip()
    if env_passphrase:
        return env_passphrase, "env:CORTISOL_SYNC_PASSPHRASE"
    legacy_env = os.getenv("CORTISOL_WORLD_SNAPSHOT_KEY", "").strip()
    if legacy_env:
        return legacy_env, "env:CORTISOL_WORLD_SNAPSHOT_KEY"
    if paths.sync_passphrase_path.exists():
        value = paths.sync_passphrase_path.read_text(encoding="utf-8").strip()
        if value:
            return value, "file:CORTISOL_SYNC_PASSPHRASE_FILE"
    if paths.snapshot_key_path.exists():
        value = paths.snapshot_key_path.read_text(encoding="utf-8").strip()
        if value:
            return value, "file:CORTISOL_SNAPSHOT_KEY_PATH"
    raise SyncSecretMissing()


def _clean_reason(reason: str) -> str:
    clean = (reason or "manual").strip().lower()
    if clean not in ALLOWED_SNAPSHOT_REASONS:
        raise SnapshotFormatError(f"Unsupported snapshot reason: {reason}")
    return clean


def _validate_manifest(manifest: Dict[str, Any]) -> None:
    if int(manifest.get("schema_version") or 0) != SNAPSHOT_SCHEMA_VERSION:
        raise SnapshotFormatError("Unsupported snapshot schema version.")
    if manifest.get("kind") != "cortisol_world_snapshot_manifest":
        raise SnapshotFormatError("Not a Cortisol world snapshot manifest.")
    _clean_reason(str(manifest.get("reason") or ""))
    if not manifest.get("snapshot_id") or not manifest.get("created_at"):
        raise SnapshotFormatError("Snapshot manifest is missing snapshot_id or created_at.")


def _encrypt_payload_bytes(secret: str, salt: bytes, payload: bytes) -> bytes:
    return Fernet(_derive_fernet_key(secret, salt)).encrypt(payload)


def _decrypt_payload_bytes(secret: str, salt: bytes, encrypted: bytes) -> bytes:
    try:
        return Fernet(_derive_fernet_key(secret, salt)).decrypt(encrypted)
    except InvalidToken as exc:
        raise SnapshotDecryptionError() from exc


def _derive_fernet_key(secret: str, salt: bytes, iterations: int = 390000) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return base64.urlsafe_b64encode(kdf.derive(secret.encode("utf-8")))


def _tar_gz_dir(source_dir: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for child in sorted(source_dir.rglob("*")):
            tar.add(child, arcname=str(child.relative_to(source_dir)))
    return buf.getvalue()


def _extract_tar_gz(payload: bytes, target_dir: Path) -> None:
    base = target_dir.resolve()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tar:
        for member in tar.getmembers():
            member_target = (base / member.name).resolve()
            if os.path.commonpath([str(base), str(member_target)]) != str(base):
                raise SnapshotFormatError("Snapshot contains an unsafe path.")
        tar.extractall(base)


def _dirty_summary(dirty_state: Dict[str, Any]) -> Dict[str, Any]:
    reasons = {}
    for reason, value in (dirty_state.get("reasons") or {}).items():
        if isinstance(value, dict):
            reasons[reason] = {"count": int(value.get("count") or 0), "last_at": value.get("last_at")}
    return {
        "dirty": bool(dirty_state.get("dirty")),
        "dirty_since": dirty_state.get("dirty_since"),
        "dirty_event_count": int(dirty_state.get("dirty_event_count") or 0),
        "event_count": int(dirty_state.get("event_count") or 0),
        "reasons": reasons,
    }


def _repo_relative(path: Path, base: Path) -> str:
    try:
        return str(path.resolve().relative_to(base.resolve())).replace("\\", "/")
    except ValueError:
        return str(path)


def _snapshot_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{secrets.token_hex(4)}"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
