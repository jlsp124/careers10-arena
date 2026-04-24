from __future__ import annotations

import argparse
import asyncio
import logging
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
from host_control_api import register_host_control_routes
from http_api import register_api_routes
from uploads import UploadManager
from util import (
    DB_PATH,
    RUNTIME_CONFIG,
    RUNTIME_PATHS,
    UPLOAD_ROOT,
    WEB_ROOT,
    ensure_dirs,
    get_env_config,
    local_ips,
)
from world_state import DirtyStateTracker, SyncBackupController, WorldSnapshotManager
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
    "messages.html": "/#/messages",
    "dm.html": "/#/messages",
    "leaderboard.html": "/#/leaderboard",
    "settings.html": "/#/settings",
}


def configure_runtime_logging() -> None:
    log_path = RUNTIME_PATHS.logs_dir / "host.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if isinstance(handler, logging.FileHandler) and Path(handler.baseFilename) == log_path:
            return
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)


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
    sync_backups: SyncBackupController = app["sync_backups"]
    try:
        while True:
            cycle = db.run_market_cycle()
            if cycle.get("bot_actions") or cycle.get("block"):
                sync_backups.mark_dirty(
                    db,
                    "market_action",
                    {
                        "bot_actions": len(cycle.get("bot_actions") or []),
                        "block": bool(cycle.get("block")),
                    },
                )
                await ws_hub.on_market_cycle(cycle)
            await asyncio.sleep(2)
    except asyncio.CancelledError:
        raise


async def startup(app: web.Application) -> None:
    await app["ws_hub"].start()
    app["uploads"].start(app)
    app["session_cleanup_task"] = asyncio.create_task(session_cleanup_loop(app))
    app["market_task"] = asyncio.create_task(market_loop(app))
    app["admin_cli_thread"] = None
    if app["runtime_config"].admin_console_enabled:
        loop = asyncio.get_running_loop()
        app["admin_cli_thread"] = admin_cli.start_stdin_repl(
            loop,
            {
                "db": app["db"],
                "ws_hub": app["ws_hub"],
                "uploads": app["uploads"],
                "dirty_state": app["dirty_state"],
                "sync_backups": app["sync_backups"],
            },
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
    backup_result = app["sync_backups"].backup_on_exit(app["db"])
    if not backup_result.get("ok"):
        logging.getLogger(__name__).error("Exit backup failed: %s", backup_result)
    app["db"].close()


async def run_until_shutdown(app: web.Application, host: str, port: int) -> None:
    app["shutdown_event"] = asyncio.Event()
    app["server_host"] = host
    app["server_port"] = port
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port)
    try:
        await site.start()
        await app["shutdown_event"].wait()
    finally:
        await runner.cleanup()


def build_app() -> web.Application:
    startup_restore = ensure_dirs()
    configure_runtime_logging()
    cfg = get_env_config()
    db = Database(DB_PATH)
    dirty_state = DirtyStateTracker(RUNTIME_PATHS.dirty_state_path)
    snapshots = WorldSnapshotManager(RUNTIME_CONFIG, dirty_state)
    sync_backups = SyncBackupController(RUNTIME_CONFIG, snapshots, dirty_state)
    app = web.Application(middlewares=[auth.auth_middleware], client_max_size=2 * 1024**3)
    app["cfg"] = cfg
    app["runtime_config"] = RUNTIME_CONFIG
    app["runtime_paths"] = RUNTIME_PATHS
    app["startup_restore"] = startup_restore
    app["dirty_state"] = dirty_state
    app["world_snapshots"] = snapshots
    app["sync_backups"] = sync_backups
    app["db"] = db
    app["uploads"] = UploadManager(db, UPLOAD_ROOT)
    app["ws_hub"] = WSHub(app, db)

    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", app["ws_hub"].ws_handler)
    register_api_routes(app)
    register_host_control_routes(app)

    app.router.add_get("/index.html", index_handler)
    app.router.add_get(
        "/{page:(home|login|lobby|play|arena|wallet|wallets|exchange|market|token_create|explorer|minigames|pong|messages|dm|leaderboard|settings)\\.html}",
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
    runtime_config = app["runtime_config"]
    ips = local_ips()
    admin_count = sum(1 for u in db.list_users_brief(limit=500) if int(u.get("is_admin", 0)) == 1)
    join_urls = []
    for ip in ips:
        if host not in {"0.0.0.0", "::"} and ip != host and ip != "127.0.0.1":
            continue
        join_urls.append(f"http://{ip}:{port}/")
    print("Cortisol Host")
    print(f"Detected local IPs: {', '.join(ips)}")
    if join_urls:
        print(f"Join URL: {join_urls[0]}")
    else:
        print(f"Join URL: http://localhost:{port}/")
    print(f"Admin status: {admin_count} admin account(s) in DB (first account becomes admin if none exist)")
    print(f"Runtime live data: {RUNTIME_PATHS.live_root}")
    print(f"Database: {DB_PATH}")
    print(f"Uploads stored at: {UPLOAD_ROOT}")
    print(f"Sync snapshots: {RUNTIME_PATHS.sync_snapshots_dir}")
    print(
        "Sync backups: "
        f"dirty threshold={runtime_config.dirty_backup_threshold} | "
        f"exit={'enabled' if runtime_config.backup_on_exit_enabled else 'disabled'} | "
        f"secret={'configured' if runtime_config.public_dict()['sync_secret_configured'] else 'missing'}"
    )
    print(f"Admin stdin console: {'enabled' if runtime_config.admin_console_enabled else 'disabled'}")
    if app.get("startup_restore"):
        print(f"Applied pending restore: {app['startup_restore'].get('snapshot_id')}")
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
    try:
        asyncio.run(run_until_shutdown(app, args.host, args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
