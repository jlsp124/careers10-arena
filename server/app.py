from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

# Ensure `python server/app.py` can import sibling modules and `game/`.
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import admin_cli
import auth
from db import Database
from uploads import UploadManager
from util import DB_PATH, UPLOAD_ROOT, WEB_ROOT, ensure_dirs, get_env_config, local_ips, now_ts, random_token
from ws import WSHub


SESSION_SECONDS = 7 * 24 * 3600
HUB_CATEGORIES = {"Resume", "References", "Interview", "Assignment Help", "Resources"}


def _json_error(code: str, status: int = 400, **extra: Any) -> web.Response:
    payload = {"error": code}
    payload.update(extra)
    return web.json_response(payload, status=status)


def _sanitize_username(value: str) -> str:
    value = (value or "").strip()
    keep = []
    for ch in value:
        if ch.isalnum() or ch in "._-":
            keep.append(ch)
    return "".join(keep)[:32]


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
    cfg = request.app["cfg"]
    data = await parse_json(request)
    username = _sanitize_username(str(data.get("username", "")))
    display_name = str(data.get("display_name") or username).strip()[:48] or username
    password = str(data.get("password") or "")
    bootstrap_secret = str(data.get("bootstrap_secret") or "").strip()

    if len(username) < 2:
        return _json_error("username_too_short")
    if len(password) < 1:
        return _json_error("password_required")
    if db.get_user_by_name(username):
        return _json_error("username_taken", status=409)

    is_admin = db.user_count() == 0
    if cfg.get("ADMIN_BOOTSTRAP_SECRET") and bootstrap_secret == cfg["ADMIN_BOOTSTRAP_SECRET"]:
        is_admin = True

    salt_hex, digest_hex = auth.hash_password(password)
    try:
        user = db.create_user(username, display_name, salt_hex, digest_hex, is_admin=is_admin)
    except Exception as e:
        return _json_error("register_failed", detail=str(e), status=500)

    token = random_token(24)
    db.create_session(int(user["id"]), token, now_ts() + SESSION_SECONDS)
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
    db: Database = request.app["db"]
    return web.json_response(
        {
            "ok": True,
            "usage_note": "Brainstorm/help understand concepts. Do not post finished assignment answers.",
            "posts": db.hub_feed(limit=200),
        }
    )


async def api_hub_post(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    if int(user.get("muted_until", 0)) > now_ts():
        return _json_error("muted", status=403, muted_until=int(user["muted_until"]))
    db: Database = request.app["db"]
    data = await parse_json(request)
    category = str(data.get("category") or "").strip()
    title = str(data.get("title") or "").strip()[:120]
    body = str(data.get("body") or "").strip()[:4000]
    tags = str(data.get("tags") or "").strip()[:120]
    if category not in HUB_CATEGORIES:
        return _json_error("bad_category", allowed=sorted(HUB_CATEGORIES))
    if not title or not body:
        return _json_error("title_and_body_required")
    post = db.create_hub_post(int(user["id"]), category, title, body, tags)
    ws_hub: WSHub = request.app["ws_hub"]
    await ws_hub.on_hub_post_created(post)
    return web.json_response({"ok": True, "post": post})




async def api_wallets(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    host_wallet = db.ensure_host_wallet()
    return web.json_response({
        "ok": True,
        "wallets": db.list_wallets_for_user(int(user["id"])),
        "host_wallet": host_wallet,
        "blocks": db.list_recent_blocks(limit=20),
    })


async def api_wallet_create(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    label = str(data.get("label") or "Wallet")
    wallet = db.create_wallet(int(user["id"]), label=label)
    return web.json_response({"ok": True, "wallet": wallet})


async def api_wallet_send(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    from_addr = str(data.get("from_address") or "").strip()
    to_addr = str(data.get("to_address") or "").strip()
    amount = int(data.get("amount") or 0)
    if amount <= 0 or not from_addr or not to_addr:
        return _json_error("bad_wallet_transfer")
    wallet = db.get_wallet(from_addr)
    if not wallet or int(wallet.get("owner_user_id") or 0) != int(user["id"]):
        return _json_error("wallet_not_owned", status=403)
    ok = db.transfer_wallet(from_addr, to_addr, amount, memo=f"user_send:{user['id']}")
    if not ok:
        return _json_error("wallet_transfer_failed")
    return web.json_response({"ok": True})


async def api_exchange_spend(request: web.Request) -> web.Response:
    user = auth.require_user(request)
    db: Database = request.app["db"]
    data = await parse_json(request)
    wallet_address = str(data.get("wallet_address") or "").strip()
    amount = int(data.get("amount") or 0)
    if amount <= 0 or not wallet_address:
        return _json_error("bad_exchange")
    ok = db.exchange_cortisol_for_rank(int(user["id"]), wallet_address, amount)
    if not ok:
        return _json_error("exchange_failed")
    return web.json_response({"ok": True, "me": db.me_payload(int(user["id"]))})

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


async def page_handler(request: web.Request) -> web.StreamResponse:
    name = request.match_info.get("page", "index.html")
    route_map = {
        "login.html": "/#/play",
        "lobby.html": "/#/play",
        "arena.html": "/#/arena",
        "minigames.html": "/#/minigames",
        "hub.html": "/#/hub",
        "dm.html": "/#/messages",
        "coming_soon.html": "/#/play",
    }
    query = request.query_string
    target = route_map.get(name, "/")
    if query:
        # Keep query string for old shared links (client router can read it if needed).
        sep = "&" if "?" in target else "?"
        target = f"{target}{sep}{query}"
    raise web.HTTPFound(target)


async def index_handler(request: web.Request) -> web.StreamResponse:
    return web.FileResponse(WEB_ROOT / "index.html")


async def startup(app: web.Application) -> None:
    await app["ws_hub"].start()
    app["uploads"].start(app)
    app["session_cleanup_task"] = asyncio.create_task(session_cleanup_loop(app))
    app["mining_task"] = asyncio.create_task(mining_loop(app))
    loop = asyncio.get_running_loop()
    app["admin_cli_thread"] = admin_cli.start_stdin_repl(loop, {"db": app["db"], "ws_hub": app["ws_hub"], "uploads": app["uploads"]})


async def cleanup(app: web.Application) -> None:
    for task_name in ("session_cleanup_task", "mining_task"):
        task = app.get(task_name)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    await app["uploads"].stop()
    await app["ws_hub"].stop()
    app["db"].close()




async def mining_loop(app: web.Application) -> None:
    db: Database = app["db"]
    db.ensure_host_wallet()
    try:
        while True:
            await asyncio.sleep(30)
            db.mine_block(reward_amount=5)
    except asyncio.CancelledError:
        raise

async def session_cleanup_loop(app: web.Application) -> None:
    db: Database = app["db"]
    try:
        while True:
            db.cleanup_expired_sessions()
            await asyncio.sleep(1800)
    except asyncio.CancelledError:
        raise


def build_app() -> web.Application:
    ensure_dirs()
    cfg = get_env_config()
    db = Database(DB_PATH)
    app = web.Application(middlewares=[auth.auth_middleware], client_max_size=2 * 1024**3)
    app["cfg"] = cfg
    app["db"] = db
    app["uploads"] = UploadManager(db, UPLOAD_ROOT)
    ws_hub = WSHub(app, db)
    app["ws_hub"] = ws_hub

    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", ws_hub.ws_handler)

    app.router.add_post("/api/register", api_register)
    app.router.add_post("/api/login", api_login)
    app.router.add_post("/api/logout", api_logout)
    app.router.add_get("/api/me", api_me)
    app.router.add_get("/api/config", api_config)
    app.router.add_get("/api/wallets", api_wallets)
    app.router.add_post("/api/wallets/create", api_wallet_create)
    app.router.add_post("/api/wallets/send", api_wallet_send)
    app.router.add_post("/api/exchange/spend", api_exchange_spend)
    app.router.add_get("/api/leaderboard", api_leaderboard)
    app.router.add_get("/api/hub_feed", api_hub_feed)
    app.router.add_post("/api/hub_post", api_hub_post)
    app.router.add_post("/api/upload", app["uploads"].handle_upload)
    app.router.add_get("/api/file/{file_id}", app["uploads"].handle_download)

    app.router.add_get("/index.html", index_handler)
    app.router.add_get("/{page:(login|lobby|arena|minigames|hub|dm|coming_soon)\\.html}", page_handler)
    app.router.add_static("/css", str(WEB_ROOT / "css"))
    app.router.add_static("/js", str(WEB_ROOT / "js"))
    app.router.add_static("/assets", str(WEB_ROOT / "assets"))

    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
    return app


def print_startup_banner(host: str, port: int, app: web.Application) -> None:
    cfg = app["cfg"]
    db: Database = app["db"]
    ips = local_ips()
    admin_count = sum(1 for u in db.list_users_brief(limit=500) if int(u.get("is_admin", 0)) == 1)
    join_urls = []
    for ip in ips:
        if host not in {"0.0.0.0", "::"} and ip != host and ip != "127.0.0.1":
            continue
        join_urls.append(f"http://{ip}:{port}/")
    print("Cortisol Arcade Server")
    print(f"Detected local IPs: {', '.join(ips)}")
    if join_urls:
        print(f"Join URL: {join_urls[0]}")
    else:
        print(f"Join URL: http://localhost:{port}/")
    print(f"Admin status: {admin_count} admin account(s) in DB (first account becomes admin if none exist)")
    print(f"Uploads stored at: {UPLOAD_ROOT}")
    print(f"MAX_UPLOAD_MB={cfg['MAX_UPLOAD_MB']} | MAX_TOTAL_STORAGE_GB={cfg['MAX_TOTAL_STORAGE_GB']} | RETENTION_HOURS={cfg['RETENTION_HOURS']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="LAN-only Cortisol Arcade aiohttp server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    app = build_app()
    print_startup_banner(args.host, args.port, app)
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
