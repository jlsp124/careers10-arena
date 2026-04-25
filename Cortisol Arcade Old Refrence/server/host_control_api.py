from __future__ import annotations

import hmac
import os
from pathlib import Path
from typing import Any, Dict, List

from aiohttp import web

from util import local_ips, now_ts, safe_int
from world_state import SnapshotSyncError, snapshot_error_payload


CONTROL_TOKEN_ENV = "CORTISOL_HOST_CONTROL_TOKEN"


def register_host_control_routes(app: web.Application) -> None:
    app.router.add_get("/api/host-control/status", api_host_status)
    app.router.add_get("/api/host-control/logs", api_host_logs)
    app.router.add_post("/api/host-control/backup", api_host_backup)
    app.router.add_post("/api/host-control/restore", api_host_restore)
    app.router.add_post("/api/host-control/sync-secret", api_host_sync_secret)
    app.router.add_post("/api/host-control/announce", api_host_announce)
    app.router.add_post("/api/host-control/kick", api_host_kick)
    app.router.add_post("/api/host-control/mute", api_host_mute)
    app.router.add_post("/api/host-control/ban", api_host_ban)
    app.router.add_post("/api/host-control/shutdown", api_host_shutdown)


def _require_control_token(request: web.Request) -> None:
    expected = os.getenv(CONTROL_TOKEN_ENV, "").strip()
    if not expected:
        token_path = request.app["runtime_paths"].world_state_dir / "host_control_token.txt"
        if token_path.exists():
            expected = token_path.read_text(encoding="utf-8").strip()
    supplied = request.headers.get("X-Host-Control-Token", "").strip()
    if not expected:
        raise web.HTTPForbidden(text='{"error":"host_control_disabled"}', content_type="application/json")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise web.HTTPForbidden(text='{"error":"host_control_forbidden"}', content_type="application/json")


async def _parse_json(request: web.Request) -> Dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _host_urls(request: web.Request) -> Dict[str, Any]:
    port = int(request.app.get("server_port") or request.url.port or 8080)
    bind_host = str(request.app.get("server_host") or "0.0.0.0")
    lan_urls = [f"http://{ip}:{port}/" for ip in local_ips()]
    return {
        "bind_host": bind_host,
        "port": port,
        "local_url": f"http://localhost:{port}/",
        "lan_urls": lan_urls,
    }


async def api_host_status(request: web.Request) -> web.Response:
    _require_control_token(request)
    db = request.app["db"]
    users = db.list_users_brief(limit=500)
    online = request.app["ws_hub"].list_users_admin()
    rooms = request.app["ws_hub"].list_rooms_admin()
    snapshots = request.app["world_snapshots"].list_snapshots(limit=50)
    admin_count = sum(1 for user in users if int(user.get("is_admin", 0)) == 1)
    payload = {
        "ok": True,
        "server": {
            "role": "Cortisol Host",
            "surface": "host-control",
            **_host_urls(request),
        },
        "world": {
            "users": len(users),
            "admins": admin_count,
            "online": len(online),
            "rooms": len(rooms),
            "uploaded_bytes": db.file_total_bytes(),
        },
        "runtime": request.app["runtime_config"].public_dict(),
        "dirty_state": request.app["dirty_state"].payload(),
        "sync": request.app["sync_backups"].status(),
        "snapshots": snapshots,
        "users": users,
        "online_users": online,
        "rooms": rooms,
        "startup_restore": request.app.get("startup_restore"),
    }
    return web.json_response(payload)


async def api_host_logs(request: web.Request) -> web.Response:
    _require_control_token(request)
    lines = max(20, min(1000, safe_int(request.query.get("lines"), 200)))
    log_path = request.app["runtime_paths"].logs_dir / "host.log"
    return web.json_response({"ok": True, "path": str(log_path), "lines": _tail_lines(log_path, lines)})


async def api_host_backup(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    note = str(data.get("note") or "Host control manual backup").strip()
    try:
        result = request.app["sync_backups"].manual_backup(request.app["db"], note=note)
    except SnapshotSyncError as exc:
        return web.json_response(snapshot_error_payload(exc), status=400)
    except Exception as exc:
        return web.json_response({"error": "snapshot_create_failed", "detail": str(exc)}, status=500)
    return web.json_response(result)


async def api_host_restore(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    snapshot_ref = str(data.get("snapshot") or data.get("snapshot_id") or "").strip()
    if not snapshot_ref:
        return web.json_response({"error": "missing_snapshot"}, status=400)
    try:
        restore = request.app["world_snapshots"].stage_restore(snapshot_ref)
    except FileNotFoundError:
        return web.json_response({"error": "snapshot_not_found"}, status=404)
    except SnapshotSyncError as exc:
        return web.json_response(snapshot_error_payload(exc), status=400)
    except Exception as exc:
        return web.json_response({"error": "snapshot_restore_stage_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "restore": restore, "restart_required": True})


async def api_host_sync_secret(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    try:
        result = request.app["sync_backups"].write_local_passphrase(str(data.get("passphrase") or ""))
    except SnapshotSyncError as exc:
        return web.json_response(snapshot_error_payload(exc), status=400)
    return web.json_response(result)


async def api_host_announce(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    text = str(data.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "missing_text"}, status=400)
    await request.app["ws_hub"].announce(text)
    return web.json_response({"ok": True})


async def api_host_kick(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    user_id = safe_int(data.get("user_id"), 0)
    if user_id <= 0:
        return web.json_response({"error": "missing_user_id"}, status=400)
    await request.app["ws_hub"].kick_user(user_id)
    return web.json_response({"ok": True, "user_id": user_id})


async def api_host_mute(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    return await _apply_moderation(request, data, kind="mute")


async def api_host_ban(request: web.Request) -> web.Response:
    _require_control_token(request)
    data = await _parse_json(request)
    return await _apply_moderation(request, data, kind="ban")


async def api_host_shutdown(request: web.Request) -> web.Response:
    _require_control_token(request)
    event = request.app.get("shutdown_event")
    if event is None:
        return web.json_response({"error": "shutdown_not_available"}, status=409)
    event.set()
    return web.json_response({"ok": True, "stopping": True})


async def _apply_moderation(request: web.Request, data: Dict[str, Any], *, kind: str) -> web.Response:
    user_id = safe_int(data.get("user_id"), 0)
    minutes = max(0 if kind == "mute" else 1, safe_int(data.get("minutes"), 10))
    if user_id <= 0:
        return web.json_response({"error": "missing_user_id"}, status=400)
    until_ts = now_ts() + minutes * 60
    db = request.app["db"]
    if kind == "mute":
        db.set_user_mute(user_id, until_ts, None, reason="host_control")
    else:
        db.set_user_ban(user_id, until_ts, None, reason="host_control")
    request.app["sync_backups"].mark_dirty(db, "moderation_changed", {"kind": kind, "user_id": user_id, "source": "host_control"})
    await request.app["ws_hub"].send_to_user(user_id, {"type": "moderation", "kind": kind, "until_ts": until_ts})
    if kind == "ban":
        await request.app["ws_hub"].kick_user(user_id)
    return web.json_response({"ok": True, "kind": kind, "user_id": user_id, "until_ts": until_ts})


def _tail_lines(path: Path, lines: int) -> List[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    return text.splitlines()[-lines:]
