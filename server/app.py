from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from aiohttp import web

# Ensure `python server/app.py` can import sibling modules and `game/`.
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import admin_cli
import auth
from db import Database
from http_api import register_api_routes
from uploads import UploadManager
from util import DB_PATH, UPLOAD_ROOT, WEB_ROOT, ensure_dirs, get_env_config, local_ips
from ws import WSHub


LEGACY_PAGE_REDIRECTS = {
    "home.html": "/#/home",
    "login.html": "/#/play",
    "lobby.html": "/#/play",
    "play.html": "/#/play",
    "arena.html": "/#/arena",
    "wallet.html": "/#/wallets",
    "wallets.html": "/#/wallets",
    "exchange.html": "/#/wallets?action=exchange",
    "market.html": "/#/market",
    "token_create.html": "/#/create-token",
    "explorer.html": "/#/explorer",
    "minigames.html": "/#/minigames",
    "pong.html": "/#/pong",
    "reaction.html": "/#/reaction",
    "typing.html": "/#/typing",
    "chess.html": "/#/chess",
    "messages.html": "/#/messages",
    "dm.html": "/#/messages",
    "hub.html": "/#/hub",
    "leaderboard.html": "/#/leaderboard",
    "settings.html": "/#/settings",
    "coming_soon.html": "/#/play",
}


async def page_handler(request: web.Request) -> web.StreamResponse:
    name = request.match_info.get("page", "index.html")
    target = LEGACY_PAGE_REDIRECTS.get(name, "/")
    query = request.query_string
    if query:
        sep = "&" if "?" in target else "?"
        target = f"{target}{sep}{query}"
    raise web.HTTPFound(target)


async def index_handler(request: web.Request) -> web.StreamResponse:
    return web.FileResponse(WEB_ROOT / "index.html")


async def session_cleanup_loop(app: web.Application) -> None:
    db: Database = app["db"]
    try:
        while True:
            db.cleanup_expired_sessions()
            await asyncio.sleep(1800)
    except asyncio.CancelledError:
        raise


async def market_loop(app: web.Application) -> None:
    db: Database = app["db"]
    ws_hub: WSHub = app["ws_hub"]
    try:
        while True:
            cycle = db.run_market_cycle()
            if cycle.get("bot_actions") or cycle.get("block"):
                await ws_hub.on_market_cycle(cycle)
            await asyncio.sleep(2)
    except asyncio.CancelledError:
        raise


async def startup(app: web.Application) -> None:
    await app["ws_hub"].start()
    app["uploads"].start(app)
    app["session_cleanup_task"] = asyncio.create_task(session_cleanup_loop(app))
    app["market_task"] = asyncio.create_task(market_loop(app))
    loop = asyncio.get_running_loop()
    app["admin_cli_thread"] = admin_cli.start_stdin_repl(
        loop,
        {"db": app["db"], "ws_hub": app["ws_hub"], "uploads": app["uploads"]},
    )


async def cleanup(app: web.Application) -> None:
    for task_name in ("session_cleanup_task", "market_task"):
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


def build_app() -> web.Application:
    ensure_dirs()
    cfg = get_env_config()
    db = Database(DB_PATH)
    app = web.Application(middlewares=[auth.auth_middleware], client_max_size=2 * 1024**3)
    app["cfg"] = cfg
    app["db"] = db
    app["uploads"] = UploadManager(db, UPLOAD_ROOT)
    app["ws_hub"] = WSHub(app, db)

    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", app["ws_hub"].ws_handler)
    register_api_routes(app)

    app.router.add_get("/index.html", index_handler)
    app.router.add_get(
        "/{page:(home|login|lobby|play|arena|wallet|wallets|exchange|market|token_create|explorer|minigames|pong|reaction|typing|chess|messages|hub|dm|leaderboard|settings|coming_soon)\\.html}",
        page_handler,
    )
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
    print(
        f"MAX_UPLOAD_MB={cfg['MAX_UPLOAD_MB']} | "
        f"MAX_TOTAL_STORAGE_GB={cfg['MAX_TOTAL_STORAGE_GB']} | "
        f"RETENTION_HOURS={cfg['RETENTION_HOURS']}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Cortisol Arcade aiohttp server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    app = build_app()
    print_startup_banner(args.host, args.port, app)
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
