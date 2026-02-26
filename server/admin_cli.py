from __future__ import annotations

import argparse
import asyncio
import shlex
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from util import now_ts


HELP_TEXT = """Admin CLI commands:
  rooms
  users
  kick <name>
  mute <name> <minutes>
  ban <name> <minutes>
  announce <text>
  start <room_key>
  end <room_key>
  setwins <name> <n>
  setcortisol <name> <n>
  deletepost <id>
  deletefile <file_id>
  purgeuploads
  boss on|off
  help
  quit
"""


def _resolve_user(db, name: str) -> Optional[dict]:
    return db.resolve_username(name)


def _print_table_rows(rows):
    if not rows:
        print("(none)")
        return
    for row in rows:
        print(row)


async def _async_delete_file(state: Dict[str, Any], file_id: int) -> bool:
    uploads = state.get("uploads")
    ws_hub = state.get("ws_hub")
    ok = False
    if uploads and hasattr(uploads, "delete_file"):
        ok = await uploads.delete_file(file_id)
    else:
        ok = bool(state["db"].delete_file_record(file_id))
    if ok and ws_hub:
        await ws_hub.on_file_deleted(file_id)
    return ok


async def execute_command_async(state: Dict[str, Any], line: str) -> bool:
    line = line.strip()
    if not line:
        return True
    try:
        parts = shlex.split(line)
    except ValueError as e:
        print(f"Parse error: {e}")
        return True
    cmd = parts[0].lower()
    args = parts[1:]
    db = state["db"]
    ws_hub = state.get("ws_hub")

    if cmd in {"help", "?"}:
        print(HELP_TEXT)
        return True
    if cmd in {"quit", "exit"}:
        return False
    if cmd == "rooms":
        rows = ws_hub.list_rooms_admin() if ws_hub else []
        _print_table_rows(rows)
        return True
    if cmd == "users":
        print("Online:")
        _print_table_rows(ws_hub.list_users_admin() if ws_hub else [])
        print("All users:")
        _print_table_rows(db.list_users_brief(limit=500))
        return True
    if cmd == "kick" and len(args) >= 1:
        user = _resolve_user(db, args[0])
        if not user:
            print("User not found")
            return True
        if ws_hub:
            await ws_hub.kick_user(int(user["id"]))
        print(f"Kicked {user['username']}")
        return True
    if cmd == "mute" and len(args) >= 2:
        user = _resolve_user(db, args[0])
        if not user:
            print("User not found")
            return True
        minutes = max(0, int(args[1]))
        until_ts = now_ts() + minutes * 60
        db.set_user_mute(int(user["id"]), until_ts, None, reason="admin_cli")
        if ws_hub:
            await ws_hub.send_to_user(int(user["id"]), {"type": "moderation", "kind": "mute", "until_ts": until_ts})
        print(f"Muted {user['username']} until {until_ts}")
        return True
    if cmd == "ban" and len(args) >= 2:
        user = _resolve_user(db, args[0])
        if not user:
            print("User not found")
            return True
        minutes = max(1, int(args[1]))
        until_ts = now_ts() + minutes * 60
        db.set_user_ban(int(user["id"]), until_ts, None, reason="admin_cli")
        if ws_hub:
            await ws_hub.send_to_user(int(user["id"]), {"type": "moderation", "kind": "ban", "until_ts": until_ts})
            await ws_hub.kick_user(int(user["id"]))
        print(f"Banned {user['username']} until {until_ts}")
        return True
    if cmd == "announce" and args:
        text = line.split(" ", 1)[1]
        if ws_hub:
            await ws_hub.announce(text)
        print("Announcement sent")
        return True
    if cmd == "start" and args:
        room_key = args[0]
        ok = await ws_hub.force_room_start(room_key) if ws_hub else False
        print(f"start {room_key}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "end" and args:
        room_key = args[0]
        ok = await ws_hub.force_room_end(room_key) if ws_hub else False
        print(f"end {room_key}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "setwins" and len(args) >= 2:
        user = _resolve_user(db, args[0])
        if not user:
            print("User not found")
            return True
        n = int(args[1])
        ok = db.set_stats_field(int(user["id"]), "wins", n)
        print(f"setwins {user['username']}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "setcortisol" and len(args) >= 2:
        user = _resolve_user(db, args[0])
        if not user:
            print("User not found")
            return True
        n = int(args[1])
        ok = db.set_stats_field(int(user["id"]), "cortisol", n)
        print(f"setcortisol {user['username']}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "deletepost" and args:
        post_id = int(args[0])
        ok = db.delete_hub_post(post_id)
        if ok and ws_hub:
            await ws_hub.broadcast_json({"type": "hub_deleted", "post_id": post_id, "ok": True})
        print(f"deletepost {post_id}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "deletefile" and args:
        file_id = int(args[0])
        ok = await _async_delete_file(state, file_id)
        print(f"deletefile {file_id}: {'ok' if ok else 'failed'}")
        return True
    if cmd == "purgeuploads":
        uploads = state.get("uploads")
        if uploads:
            n = await uploads.purge_all()
            print(f"Purged {n} upload records/files")
        else:
            print("No upload manager attached")
        return True
    if cmd == "boss" and args:
        flag = args[0].lower()
        enabled = flag in {"on", "1", "true", "yes"}
        if ws_hub:
            await ws_hub.set_boss_enabled(enabled)
        print(f"boss {'on' if enabled else 'off'}")
        return True

    print("Unknown command or wrong args. Type `help`.")
    return True


def start_stdin_repl(loop: asyncio.AbstractEventLoop, state: Dict[str, Any]) -> threading.Thread:
    def _worker():
        print("\n[Admin CLI] Type `help` for commands. Ctrl+C stops server.")
        while True:
            try:
                line = input("admin> ")
            except EOFError:
                break
            except KeyboardInterrupt:
                print()
                break
            fut = asyncio.run_coroutine_threadsafe(execute_command_async(state, line), loop)
            try:
                should_continue = fut.result()
            except Exception as e:
                print(f"Command error: {e}")
                continue
            if not should_continue:
                break

    t = threading.Thread(target=_worker, name="admin-cli", daemon=True)
    t.start()
    return t


def main() -> None:
    parser = argparse.ArgumentParser(description="Standalone admin DB viewer for careers10-arena.")
    parser.add_argument("--db", default=str((Path(__file__).resolve().parent / "data" / "careers10_arena.sqlite3")))
    args = parser.parse_args()

    from db import Database  # local import to avoid startup cycles in server mode

    db = Database(Path(args.db))
    print("Standalone mode (no live WebSocket room control).")
    print(HELP_TEXT)

    async def _loop():
        state = {"db": db}
        while True:
            try:
                line = input("admin-db> ")
            except (EOFError, KeyboardInterrupt):
                print()
                break
            keep = await execute_command_async(state, line)
            if not keep:
                break

    try:
        asyncio.run(_loop())
    finally:
        db.close()


if __name__ == "__main__":
    main()

