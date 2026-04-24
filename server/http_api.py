from __future__ import annotations

from typing import Any, Dict, Optional

from aiohttp import web

import auth
from db import Database
from util import now_ts, random_token
from world_state import SnapshotSyncError, snapshot_error_payload


SESSION_SECONDS = 7 * 24 * 3600
HUB_REMOVED_ERROR = "hub_removed_from_v1"


def _json_error(code: str, status: int = 400, **extra: Any) -> web.Response:
    payload = {"error": code}
    payload.update(extra)
    return web.json_response(payload, status=status)


def _require_admin_user(request: web.Request) -> dict:
    user = auth.require_user(request)
    if not bool(user.get("is_admin")):
        raise web.HTTPForbidden(text='{"error":"admin_only"}', content_type="application/json")
    return user


def _mark_dirty(request: web.Request, reason: str, detail: Optional[Dict[str, Any]] = None) -> None:
    sync_backups = request.app.get("sync_backups")
    if sync_backups:
        sync_backups.mark_dirty(request.app["db"], reason, detail or {})
        return
    tracker = request.app.get("dirty_state")
    if tracker:
        tracker.mark(reason, detail or {})


def _sanitize_username(value: str) -> str:
    value = (value or "").strip()
    keep = []
    for ch in value:
        if ch.isalnum() or ch in "._-":
            keep.append(ch)
    return "".join(keep)[:32]


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def parse_json(request: web.Request) -> Dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text='{"error":"invalid_json"}', content_type="application/json")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text='{"error":"json_object_required"}', content_type="application/json")
    return data


async def api_register(request: web.Request) -> web.Response:
    db: Database = request.app["db"]
    data = await parse_json(request)
    username = _sanitize_username(str(data.get("username", "")))
    display_name = str(data.get("display_name") or username).strip()[:48] or username
    password = str(data.get("password") or "")

    if len(username) < 2:
        return _json_error("username_too_short")
    if len(password) < 1:
        return _json_error("password_required")
    if db.get_user_by_name(username):
        return _json_error("username_taken", status=409)

    is_admin = db.user_count() == 0

    salt_hex, digest_hex = auth.hash_password(password)
    try:
        user = db.create_user(username, display_name, salt_hex, digest_hex, is_admin=is_admin)
    except Exception as e:
        return _json_error("register_failed", detail=str(e), status=500)

    token = random_token(24)
    db.create_session(int(user["id"]), token, now_ts() + SESSION_SECONDS)
    _mark_dirty(request, "account_created", {"user_id": int(user["id"]), "is_admin": bool(is_admin)})
    resp = web.json_response({"ok": True, "token": token, "me": db.me_payload(int(user["id"]))})
    resp.set_cookie("session_token", token, max_age=SESSION_SECONDS, httponly=False, samesite="Lax")
    return resp


async def api_login(request: web.Request) -> web.Response:
    db: Database = request.app["db"]
    data = await parse_json(request)
    username = _sanitize_username(str(data.get("username", "")))
    password = str(data.get("password") or "")
    user = db.get_user_by_name(username)
    if not user:
        return _json_error("invalid_credentials", status=401)
    if int(user.get("banned_until", 0)) > now_ts():
        return _json_error("banned", status=403, banned_until=int(user["banned_until"]))
    if not auth.verify_password(password, user["pw_salt"], user["pw_hash"]):
        return _json_error("invalid_credentials", status=401)
    token = random_token(24)
    db.create_session(int(user["id"]), token, now_ts() + SESSION_SECONDS)
    resp = web.json_response({"ok": True, "token": token, "me": db.me_payload(int(user["id"]))})
    resp.set_cookie("session_token", token, max_age=SESSION_SECONDS, httponly=False, samesite="Lax")
    return resp


async def api_logout(request: web.Request) -> web.Response:
    db: Database = request.app["db"]
    token = request.get("session_token")
    if token:
        db.delete_session(token)
    resp = web.json_response({"ok": True})
    resp.del_cookie("session_token")
    return resp


async def api_me(request: web.Request) -> web.Response:
    user = request.get("user")
    if not user:
        return _json_error("not_logged_in", status=401)
    db: Database = request.app["db"]
    return web.json_response({"ok": True, "me": db.me_payload(int(user["id"]))})


async def api_leaderboard(request: web.Request) -> web.Response:
    db: Database = request.app["db"]
    limit = min(200, max(1, int(request.query.get("limit", "100"))))
    return web.json_response({"ok": True, "rows": db.leaderboard(limit=limit)})


async def api_hub_feed(request: web.Request) -> web.Response:
    return _json_error(HUB_REMOVED_ERROR, status=410, replacement="messages_and_room_chat")


async def api_hub_post(request: web.Request) -> web.Response:
    auth.require_user(request)
    return _json_error(HUB_REMOVED_ERROR, status=410, replacement="messages_and_room_chat")


async def api_wallets(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.wallets_api_payload(int(user["id"]))
    payload["ok"] = True
    payload["stats"] = db.get_stats(int(user["id"]))
    payload["simulation_note"] = "Simulation only. No real money."
    return web.json_response(payload)


async def api_wallet_create(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    label = str(data.get("label") or data.get("name") or "Wallet")
    wallet = db.create_wallet_v2(int(user["id"]), name=label)
    _mark_dirty(request, "wallet_created", {"user_id": int(user["id"]), "wallet_id": wallet.get("id")})
    return web.json_response({"ok": True, "wallet": wallet, "wallets": db.list_wallets_v2(int(user["id"]))})


async def api_wallet_rename(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = _safe_int(data.get("wallet_id"))
    name = str(data.get("name") or data.get("label") or "").strip()
    if wallet_id <= 0 or not name:
        return _json_error("bad_wallet_rename")
    wallet = db.rename_wallet_v2(int(user["id"]), wallet_id, name)
    if not wallet:
        return _json_error("wallet_rename_failed")
    _mark_dirty(request, "wallet_renamed", {"user_id": int(user["id"]), "wallet_id": wallet_id})
    return web.json_response({"ok": True, "wallet": wallet, "wallets": db.list_wallets_v2(int(user["id"]))})


async def api_wallet_delete(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = _safe_int(data.get("wallet_id"))
    transfer_wallet_id = _safe_int(data.get("transfer_wallet_id")) or None
    if wallet_id <= 0:
        return _json_error("bad_wallet_delete")
    result = db.delete_wallet_v2(int(user["id"]), wallet_id, transfer_wallet_id=transfer_wallet_id)
    if not result:
        return _json_error("wallet_delete_failed")
    _mark_dirty(request, "wallet_deleted", {"user_id": int(user["id"]), "wallet_id": wallet_id})
    return web.json_response({"ok": True, **result})


async def api_wallet_reorder(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_ids = data.get("wallet_ids")
    if not isinstance(wallet_ids, list):
        return _json_error("bad_wallet_reorder")
    reordered = db.reorder_wallets_v2(int(user["id"]), [_safe_int(wallet_id) for wallet_id in wallet_ids if _safe_int(wallet_id) > 0])
    _mark_dirty(request, "wallet_reordered", {"user_id": int(user["id"]), "wallet_ids": [w["id"] for w in reordered]})
    return web.json_response({"ok": True, "wallets": reordered, "default_wallet_id": reordered[0]["id"] if reordered else None})


async def api_wallet_transfer(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    from_wallet_id = int(data.get("from_wallet_id") or 0)
    to_wallet_id = int(data.get("to_wallet_id") or 0)
    token_id = int(data.get("token_id") or 0)
    amount = float(data.get("amount") or 0)
    if from_wallet_id <= 0 and data.get("from_address"):
        old_from = db.get_wallet(str(data.get("from_address")))
        if old_from and old_from.get("id"):
            from_wallet_id = int(old_from["id"])
    if to_wallet_id <= 0 and data.get("to_address"):
        old_to = db.get_wallet(str(data.get("to_address")))
        if old_to and old_to.get("id"):
            to_wallet_id = int(old_to["id"])
    if token_id <= 0:
        token_id = db.cc_token_id()
    if from_wallet_id <= 0 or to_wallet_id <= 0 or token_id <= 0 or amount <= 0:
        return _json_error("bad_wallet_transfer", detail="from_wallet_id/to_wallet_id/token_id/amount required")
    result = db.wallet_transfer_v2(int(user["id"]), from_wallet_id, to_wallet_id, token_id, amount)
    if not result:
        return _json_error("wallet_transfer_failed")
    _mark_dirty(
        request,
        "wallet_transfer",
        {"user_id": int(user["id"]), "from_wallet_id": from_wallet_id, "to_wallet_id": to_wallet_id, "token_id": token_id},
    )
    return web.json_response({"ok": True, "transfer": result})


async def api_exchange(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = int(data.get("wallet_id") or 0)
    kind = str(data.get("kind") or "").strip()
    amount = int(data.get("amount") or 0)
    if wallet_id <= 0 and data.get("wallet_address"):
        old_wallet = db.get_wallet(str(data.get("wallet_address")))
        if old_wallet and old_wallet.get("id"):
            wallet_id = int(old_wallet["id"])
    if not kind:
        kind = "coins_for_calm"
    if amount <= 0 or wallet_id <= 0 or kind not in {"stress_for_coins", "coins_for_calm"}:
        return _json_error("bad_exchange", detail="wallet_id, amount, and kind are required")
    result = db.exchange_cortisol_cc(int(user["id"]), wallet_id, kind, amount)
    if not result:
        return _json_error("exchange_failed")
    _mark_dirty(request, "economy_exchange", {"user_id": int(user["id"]), "wallet_id": wallet_id, "kind": kind})
    return web.json_response({"ok": True, "result": result, "me": db.me_payload(int(user["id"]))})


async def api_market(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    wallet_id = int(request.query.get("wallet_id", "0") or 0) or None
    payload = db.market_snapshot(
        int(user["id"]),
        wallet_id=wallet_id,
        token_ref=request.query.get("token") or request.query.get("token_ref"),
        search=str(request.query.get("search", "")),
        sort=str(request.query.get("sort", "market_cap_desc")),
        owned_only=_parse_bool(request.query.get("owned_only") or request.query.get("only_owned")),
        category=str(request.query.get("category", "")),
        limit=max(1, min(200, _safe_int(request.query.get("limit"), 100))),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_liquidity(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = _safe_int(data.get("wallet_id"))
    token_id = _safe_int(data.get("token_id"))
    action = str(data.get("action") or "").strip().lower()
    cc_amount = _safe_float(data.get("cc_amount") or data.get("amount"))
    share_pct = _safe_float(data.get("share_pct") or data.get("percent"))
    if wallet_id <= 0 or token_id <= 0 or action not in {"add", "remove"}:
        return _json_error("bad_liquidity_request")
    result = db.manage_liquidity(
        int(user["id"]),
        wallet_id,
        token_id,
        action,
        cc_amount=cc_amount,
        share_pct=share_pct,
    )
    if not result:
        return _json_error("liquidity_action_failed")
    _mark_dirty(
        request,
        "liquidity_changed",
        {"user_id": int(user["id"]), "wallet_id": wallet_id, "token_id": token_id, "action": action},
    )
    return web.json_response({"ok": True, "result": result})


async def api_trade(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = int(data.get("wallet_id") or 0)
    token_id = int(data.get("token_id") or 0)
    side = str(data.get("side") or "").strip().lower()
    amount = float(data.get("amount") or 0)
    if wallet_id <= 0 or token_id <= 0 or side not in {"buy", "sell"} or amount <= 0:
        return _json_error("bad_trade")
    result = db.execute_trade(int(user["id"]), wallet_id, token_id, side, amount)
    if not result:
        return _json_error("trade_failed")
    _mark_dirty(
        request,
        "market_action",
        {"user_id": int(user["id"]), "wallet_id": wallet_id, "token_id": token_id, "side": side},
    )
    return web.json_response({"ok": True, "trade": result})


async def api_token_create(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_id = int(data.get("wallet_id") or 0)
    name = str(data.get("name") or "").strip()
    symbol = str(data.get("symbol") or "").strip()
    description = str(data.get("description") or "").strip()
    seed_liquidity = _safe_float(data.get("seed_liquidity_cc") or data.get("seed_liquidity") or data.get("initial_supply"), 35.0)
    creator_allocation_pct = _safe_float(data.get("creator_allocation_pct") or data.get("creator_allocation"), 22.0)
    volatility = str(data.get("volatility") or data.get("volatility_profile") or ("low" if seed_liquidity >= 120 else ("medium" if seed_liquidity >= 60 else "chaos"))).strip().lower()
    theme = str(data.get("theme") or data.get("theme_color") or "default").strip().lower()
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    if data.get("tags") is not None:
        metadata["tags"] = data.get("tags")
    if data.get("theme_color") is not None:
        metadata["theme_color"] = str(data.get("theme_color") or "").strip()
    result = db.create_token(
        int(user["id"]),
        wallet_id,
        name,
        symbol,
        description,
        volatility,
        theme,
        category=str(data.get("category") or data.get("sector") or "arcade"),
        website_url=str(data.get("website_url") or data.get("website") or ""),
        icon_file_id=_safe_int(data.get("icon_file_id") or data.get("image_file_id")) or None,
        seed_liquidity_cc=seed_liquidity,
        creator_allocation_pct=creator_allocation_pct,
        initial_supply=_safe_float(data.get("initial_supply") or data.get("airdrop"), 25.0),
        supply_cap=_safe_float(data.get("supply_cap") or data.get("max_supply"), 1_000_000.0),
        launch_price=_safe_float(data.get("launch_price") or data.get("initial_price"), 10.0),
        metadata=metadata,
    )
    if not result:
        return _json_error("token_create_failed")
    _mark_dirty(request, "token_launch", {"user_id": int(user["id"]), "wallet_id": wallet_id, "token_id": result.get("id")})
    return web.json_response({"ok": True, "token": result})


async def api_dashboard(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.dashboard_payload(int(user["id"]), wallet_id=_safe_int(request.query.get("wallet_id")) or None)
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_overview(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.explorer_overview(
        limit_blocks=max(1, min(50, _safe_int(request.query.get("block_limit"), 10))),
        limit_transactions=max(1, min(100, _safe_int(request.query.get("tx_limit"), 15))),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_blocks(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.explorer_blocks(
        limit=max(1, min(100, _safe_int(request.query.get("limit"), 20))),
        offset=max(0, _safe_int(request.query.get("offset"), 0)),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_block(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    height = _safe_int(request.match_info.get("height"))
    payload = db.explorer_block(height)
    if not payload:
        return _json_error("block_not_found", status=404)
    return web.json_response({"ok": True, **payload})


async def api_explorer_transactions(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.explorer_transactions(
        limit=max(1, min(200, _safe_int(request.query.get("limit"), 50))),
        offset=max(0, _safe_int(request.query.get("offset"), 0)),
        wallet_ref=request.query.get("wallet") or request.query.get("wallet_ref"),
        token_ref=request.query.get("token") or request.query.get("token_ref"),
        kind=request.query.get("kind"),
        status=request.query.get("status"),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_transaction(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    tx_ref = str(request.match_info.get("tx_id") or "")
    payload = db.explorer_transaction(tx_ref)
    if not payload:
        return _json_error("transaction_not_found", status=404)
    return web.json_response({"ok": True, "transaction": payload})


async def api_explorer_wallets(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.explorer_wallets(
        limit=max(1, min(200, _safe_int(request.query.get("limit"), 50))),
        offset=max(0, _safe_int(request.query.get("offset"), 0)),
        search=str(request.query.get("search", "")),
        sort=str(request.query.get("sort", "value_desc")),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_wallet(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    wallet_ref = str(request.match_info.get("wallet_ref") or "")
    payload = db.explorer_wallet(wallet_ref)
    if not payload:
        return _json_error("wallet_not_found", status=404)
    return web.json_response({"ok": True, **payload})


async def api_explorer_tokens(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    payload = db.explorer_tokens(
        limit=max(1, min(200, _safe_int(request.query.get("limit"), 50))),
        offset=max(0, _safe_int(request.query.get("offset"), 0)),
        search=str(request.query.get("search", "")),
        sort=str(request.query.get("sort", "market_cap_desc")),
    )
    payload["ok"] = True
    return web.json_response(payload)


async def api_explorer_token(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    token_ref = str(request.match_info.get("token_ref") or "")
    payload = db.explorer_token(token_ref)
    if not payload:
        return _json_error("token_not_found", status=404)
    return web.json_response({"ok": True, "token": payload})


async def api_explorer_search(request: web.Request) -> web.Response:
    auth.require_user(request)
    db: Database = request.app["db"]
    q = str(request.query.get("q") or "").strip()
    payload = db.explorer_search(q, limit=max(1, min(15, _safe_int(request.query.get("limit"), 8))))
    payload["ok"] = True
    return web.json_response(payload)


async def api_runtime_status(request: web.Request) -> web.Response:
    _require_admin_user(request)
    snapshots = request.app["world_snapshots"].list_snapshots(limit=20)
    return web.json_response(
        {
            "ok": True,
            "runtime": request.app["runtime_config"].public_dict(),
            "dirty_state": request.app["dirty_state"].payload(),
            "sync": request.app["sync_backups"].status(),
            "snapshots": snapshots,
            "startup_restore": request.app.get("startup_restore"),
        }
    )


async def api_runtime_snapshot(request: web.Request) -> web.Response:
    _require_admin_user(request)
    data = await parse_json(request)
    note = str(data.get("note") or "").strip()
    try:
        result = request.app["sync_backups"].manual_backup(request.app["db"], note=note)
    except SnapshotSyncError as e:
        return web.json_response(snapshot_error_payload(e), status=400)
    except Exception as e:
        return _json_error("snapshot_create_failed", detail=str(e), status=500)
    return web.json_response({"ok": True, **result, "dirty_state": request.app["dirty_state"].payload()})


async def api_runtime_backup(request: web.Request) -> web.Response:
    return await api_runtime_snapshot(request)


async def api_runtime_sync_secret(request: web.Request) -> web.Response:
    _require_admin_user(request)
    data = await parse_json(request)
    passphrase = str(data.get("passphrase") or "")
    try:
        result = request.app["sync_backups"].write_local_passphrase(passphrase)
    except SnapshotSyncError as e:
        return web.json_response(snapshot_error_payload(e), status=400)
    return web.json_response(result)


async def api_runtime_restore(request: web.Request) -> web.Response:
    _require_admin_user(request)
    data = await parse_json(request)
    snapshot_ref = str(data.get("snapshot") or data.get("snapshot_id") or "").strip()
    if not snapshot_ref:
        return _json_error("missing_snapshot")
    try:
        restore = request.app["world_snapshots"].stage_restore(snapshot_ref)
    except FileNotFoundError:
        return _json_error("snapshot_not_found", status=404)
    except SnapshotSyncError as e:
        return web.json_response(snapshot_error_payload(e), status=400)
    except Exception as e:
        return _json_error("snapshot_restore_stage_failed", detail=str(e), status=500)
    return web.json_response({"ok": True, "restore": restore, "restart_required": True})


async def api_config(request: web.Request) -> web.Response:
    cfg = request.app["cfg"]
    return web.json_response(
        {
            "ok": True,
            "config": {
                "max_upload_mb": cfg["MAX_UPLOAD_MB"],
                "retention_hours": cfg["RETENTION_HOURS"],
                "max_total_storage_gb": cfg["MAX_TOTAL_STORAGE_GB"],
            }
        }
    )


def register_api_routes(app: web.Application) -> None:
    app.router.add_post("/api/register", api_register)
    app.router.add_post("/api/login", api_login)
    app.router.add_post("/api/logout", api_logout)
    app.router.add_get("/api/me", api_me)
    app.router.add_get("/api/config", api_config)
    app.router.add_get("/api/dashboard", api_dashboard)
    app.router.add_get("/api/wallets", api_wallets)
    app.router.add_post("/api/wallets/create", api_wallet_create)
    app.router.add_post("/api/wallets/rename", api_wallet_rename)
    app.router.add_post("/api/wallets/delete", api_wallet_delete)
    app.router.add_post("/api/wallets/reorder", api_wallet_reorder)
    app.router.add_post("/api/wallets/transfer", api_wallet_transfer)
    app.router.add_post("/api/wallets/send", api_wallet_transfer)
    app.router.add_get("/api/market", api_market)
    app.router.add_post("/api/liquidity", api_liquidity)
    app.router.add_post("/api/trade", api_trade)
    app.router.add_post("/api/exchange", api_exchange)
    app.router.add_post("/api/exchange/spend", api_exchange)
    app.router.add_post("/api/token/create", api_token_create)
    app.router.add_get("/api/explorer/overview", api_explorer_overview)
    app.router.add_get("/api/explorer/blocks", api_explorer_blocks)
    app.router.add_get("/api/explorer/block/{height}", api_explorer_block)
    app.router.add_get("/api/explorer/transactions", api_explorer_transactions)
    app.router.add_get("/api/explorer/transaction/{tx_id}", api_explorer_transaction)
    app.router.add_get("/api/explorer/wallets", api_explorer_wallets)
    app.router.add_get("/api/explorer/wallet/{wallet_ref}", api_explorer_wallet)
    app.router.add_get("/api/explorer/tokens", api_explorer_tokens)
    app.router.add_get("/api/explorer/token/{token_ref}", api_explorer_token)
    app.router.add_get("/api/explorer/search", api_explorer_search)
    app.router.add_get("/api/runtime/status", api_runtime_status)
    app.router.add_post("/api/runtime/snapshot", api_runtime_snapshot)
    app.router.add_post("/api/runtime/backup", api_runtime_backup)
    app.router.add_post("/api/runtime/sync-secret", api_runtime_sync_secret)
    app.router.add_post("/api/runtime/restore", api_runtime_restore)
    app.router.add_get("/api/leaderboard", api_leaderboard)
    app.router.add_get("/api/hub_feed", api_hub_feed)
    app.router.add_post("/api/hub_post", api_hub_post)
    app.router.add_post("/api/upload", app["uploads"].handle_upload)
    app.router.add_get("/api/file/{file_id}", app["uploads"].handle_download)
    app.router.add_post("/api/file/{file_id}/delete", app["uploads"].handle_delete)
