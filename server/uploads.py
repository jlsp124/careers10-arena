import asyncio
import hashlib
import os
from pathlib import Path
from typing import Optional

from aiohttp import web

from auth import require_user
from util import get_env_config, now_ts, random_hex


class UploadManager:
    def __init__(self, db, root: Path):
        self.db = db
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._cleanup_task: Optional[asyncio.Task] = None

    @property
    def config(self):
        return get_env_config()

    def build_storage_name(self, original_name: str) -> str:
        suffix = Path(original_name).suffix[:16]
        return f"{random_hex(16)}{suffix}"

    async def handle_upload(self, request: web.Request) -> web.Response:
        user = require_user(request)
        cfg = self.config
        total_used = self.db.file_total_bytes()
        if total_used >= cfg["MAX_TOTAL_STORAGE_BYTES"]:
            return web.json_response(
                {
                    "error": "storage_full",
                    "detail": f"Total storage cap reached ({cfg['MAX_TOTAL_STORAGE_GB']} GB).",
                },
                status=413,
            )

        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != "file":
            return web.json_response({"error": "missing_file_part"}, status=400)
        original_name = (part.filename or "upload.bin").strip() or "upload.bin"
        mime = (part.headers.get("Content-Type") or "application/octet-stream").strip()
        allowlist = cfg["UPLOAD_ALLOWLIST_MIME"]
        if allowlist and mime not in allowlist:
            return web.json_response({"error": "mime_not_allowed", "allowed": allowlist}, status=415)

        storage_name = self.build_storage_name(original_name)
        tmp_path = self.root / f".tmp-{storage_name}"
        final_path = self.root / storage_name
        digest = hashlib.sha256()
        written = 0

        try:
            with tmp_path.open("wb") as f:
                while True:
                    chunk = await part.read_chunk(64 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > cfg["MAX_UPLOAD_BYTES"]:
                        raise web.HTTPRequestEntityTooLarge(
                            max_size=cfg["MAX_UPLOAD_BYTES"], actual_size=written
                        )
                    if total_used + written > cfg["MAX_TOTAL_STORAGE_BYTES"]:
                        raise web.HTTPRequestEntityTooLarge(
                            max_size=cfg["MAX_TOTAL_STORAGE_BYTES"], actual_size=total_used + written
                        )
                    digest.update(chunk)
                    f.write(chunk)

            os.replace(tmp_path, final_path)
            record = self.db.create_file_record(
                storage_name=storage_name,
                original_name=original_name,
                size_bytes=written,
                mime=mime,
                uploader_id=int(user["id"]),
                expires_at=now_ts() + cfg["RETENTION_SECONDS"],
                sha256=digest.hexdigest(),
            )
            return web.json_response(
                {
                    "ok": True,
                    "file": {
                        "id": record["id"],
                        "original_name": record["original_name"],
                        "size_bytes": record["size_bytes"],
                        "mime": record["mime"],
                        "expires_at": record["expires_at"],
                    },
                }
            )
        except web.HTTPRequestEntityTooLarge:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            return web.json_response(
                {
                    "error": "upload_too_large",
                    "detail": (
                        f"Max upload is {cfg['MAX_UPLOAD_MB']} MB. "
                        f"Total storage cap is {cfg['MAX_TOTAL_STORAGE_GB']} GB."
                    ),
                },
                status=413,
            )
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise

    async def handle_download(self, request: web.Request) -> web.StreamResponse:
        user = require_user(request)
        try:
            file_id = int(request.match_info["file_id"])
        except (KeyError, ValueError):
            raise web.HTTPNotFound()
        record = self.db.get_file(file_id)
        if not record or int(record["deleted"]) == 1:
            raise web.HTTPNotFound()
        if int(record["expires_at"]) <= now_ts():
            raise web.HTTPGone(text="File expired")
        if not bool(user.get("is_admin")) and not self.db.can_access_file(int(user["id"]), file_id):
            raise web.HTTPForbidden()
        path = self.root / record["storage_name"]
        if not path.exists():
            raise web.HTTPNotFound()
        self.db.increment_file_download(file_id)
        return web.FileResponse(
            path,
            headers={
                "Content-Type": record["mime"] or "application/octet-stream",
                "Content-Disposition": f'attachment; filename="{record["original_name"]}"',
            },
        )

    async def cleanup_once(self) -> int:
        removed = 0
        for record in self.db.list_expired_files():
            path = self.root / record["storage_name"]
            if path.exists():
                path.unlink(missing_ok=True)
            if self.db.mark_file_deleted(int(record["id"])):
                removed += 1
        return removed

    async def cleanup_loop(self, interval_seconds: int = 300) -> None:
        try:
            while True:
                await self.cleanup_once()
                await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise

    def start(self, app) -> None:
        self._cleanup_task = asyncio.create_task(self.cleanup_loop())
        app["upload_cleanup_task"] = self._cleanup_task

    async def stop(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def purge_all(self) -> int:
        count = 0
        big_now = 10**12
        for record in self.db.list_expired_files(now=big_now):
            path = self.root / record["storage_name"]
            if path.exists():
                path.unlink(missing_ok=True)
            if self.db.mark_file_deleted(int(record["id"])):
                count += 1
        return count

    async def delete_file(self, file_id: int) -> bool:
        record = self.db.get_file(int(file_id))
        if not record:
            return False
        path = self.root / record["storage_name"]
        if path.exists():
            path.unlink(missing_ok=True)
        return bool(self.db.mark_file_deleted(int(file_id)))
