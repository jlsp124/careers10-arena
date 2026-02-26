from __future__ import annotations

import asyncio
import traceback
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set

from aiohttp import WSMsgType, web

import auth
from game.arena_sim import ArenaRoom
from game.minigames.chess import ChessRoom
from game.minigames.pong import PongRoom
from game.minigames.reaction_duel import ReactionDuelRoom
from game.minigames.typing_duel import TypingDuelRoom
from matchmaking import Matchmaker
from util import json_loads, local_ips, now_ts, random_token, safe_int


class WSHub:
    def __init__(self, app: web.Application, db):
        self.app = app
        self.db = db
        self.all_sockets: Set[web.WebSocketResponse] = set()
        self.socket_user: Dict[web.WebSocketResponse, Optional[dict]] = {}
        self.user_sockets: Dict[int, Set[web.WebSocketResponse]] = defaultdict(set)
        self.user_rooms: Dict[int, Set[str]] = defaultdict(set)
        self.rooms: Dict[str, Any] = {}
        self.room_kind: Dict[str, str] = {}
        self.room_id_map: Dict[str, str] = {}
        self.room_task: Optional[asyncio.Task] = None
        self._lobby_broadcast_accum = 0.0
        self._lock = asyncio.Lock()
        self.boss_enabled = True
        self._server_notice_seq = 0
        self.matchmaker = Matchmaker()

    async def start(self) -> None:
        if self.room_task and not self.room_task.done():
            return
        self.room_task = asyncio.create_task(self._tick_loop())

    async def stop(self) -> None:
        if self.room_task:
            self.room_task.cancel()
            try:
                await self.room_task
            except asyncio.CancelledError:
                pass
        for ws in list(self.all_sockets):
            await ws.close()

    async def _tick_loop(self) -> None:
        loop = asyncio.get_running_loop()
        last = loop.time()
        try:
            while True:
                await asyncio.sleep(1 / 60)
                now = loop.time()
                dt = now - last
                last = now
                await self._tick_rooms(dt)
        except asyncio.CancelledError:
            raise

    async def _tick_rooms(self, dt: float) -> None:
        dirty_lobby = False
        empty_keys: List[str] = []
        for key, room in list(self.rooms.items()):
            try:
                if hasattr(room, "tick"):
                    room.tick(dt)
                for event in room.drain_outbox():
                    await self._dispatch_room_event(key, event)
                    if event.get("type", "").endswith(("_end", "_roster")) or event.get("type") in {"arena_start"}:
                        dirty_lobby = True
                if not getattr(room, "members", None):
                    empty_keys.append(key)
            except Exception:
                traceback.print_exc()
                await self._broadcast_room(key, {"type": "room_error", "room_key": key})
        for key in empty_keys:
            self.rooms.pop(key, None)
            self.room_kind.pop(key, None)
            self.room_id_map.pop(key, None)
            dirty_lobby = True
        self._lobby_broadcast_accum += dt
        if dirty_lobby or self._lobby_broadcast_accum >= 1.0:
            self._lobby_broadcast_accum = 0.0
            await self.broadcast_lobby_state()

    async def _dispatch_room_event(self, room_key: str, event: dict) -> None:
        to_user = event.pop("to_user", None)
        if to_user:
            await self.send_to_user(int(to_user), event)
        else:
            await self._broadcast_room(room_key, event)

    def _make_room_key(self, kind: str, room_id: str) -> str:
        return f"{kind}:{room_id}"

    def _sanitize_room_id(self, value: str) -> str:
        value = (value or "").strip().lower()
        keep = []
        for ch in value:
            if ch.isalnum() or ch in "-_":
                keep.append(ch)
        return "".join(keep)[:32] or random_token(6)

    def _create_room(self, kind: str, room_id: str, msg: dict):
        if kind == "arena":
            mode_name = str(msg.get("arena_mode_name") or msg.get("mode_name") or "ffa").lower()
            if mode_name == "boss" and not self.boss_enabled:
                mode_name = "ffa"
            room = ArenaRoom(room_id, self.db, mode_name=mode_name, match_seconds=safe_int(msg.get("match_seconds"), 90))
        elif kind == "chess":
            room = ChessRoom(room_id, self.db)
        elif kind == "pong":
            room = PongRoom(room_id, self.db)
        elif kind == "reaction":
            room = ReactionDuelRoom(room_id, self.db)
        elif kind == "typing":
            room = TypingDuelRoom(room_id, self.db)
        else:
            raise ValueError("unknown_room_kind")
        return room

    async def _join_room_for_uid(
        self,
        uid: int,
        *,
        kind: str,
        room_id: str,
        room_params: Optional[dict] = None,
        send_room_joined: bool = True,
    ) -> Optional[str]:
        user = self.db.get_user_by_id(int(uid))
        if not user:
            return None
        room_params = room_params or {}
        key = self._make_room_key(kind, room_id)
        if key not in self.rooms:
            msg = {"kind": kind, "room_id": room_id, **room_params}
            self.rooms[key] = self._create_room(kind, room_id, msg)
            self.room_kind[key] = kind
            self.room_id_map[key] = room_id
        room = self.rooms[key]

        if kind == "arena":
            result = room.join(user)
        else:
            result = room.join(int(uid))
        self.user_rooms[int(uid)].add(key)

        if send_room_joined:
            await self.send_to_user(int(uid), {"type": "room_joined", "room_key": key, "room_id": room_id, "kind": kind, **result})
        await self._dispatch_room_event(key, room.snapshot())
        for ev in room.drain_outbox():
            await self._dispatch_room_event(key, ev)
        return key

    async def _leave_user_room_by_key(self, uid: int, room_key: str) -> None:
        room = self.rooms.get(room_key)
        if not room:
            self.user_rooms[int(uid)].discard(room_key)
            return
        try:
            room.leave(int(uid))
        except Exception:
            traceback.print_exc()
        self.user_rooms[int(uid)].discard(room_key)
        for ev in room.drain_outbox():
            await self._dispatch_room_event(room_key, ev)
        try:
            await self._dispatch_room_event(room_key, room.snapshot())
        except Exception:
            pass

    async def _leave_user_all_rooms(self, uid: int) -> None:
        for room_key in list(self.user_rooms.get(int(uid), set())):
            await self._leave_user_room_by_key(int(uid), room_key)

    async def _apply_queue_update_events(self, updates: List[dict]) -> None:
        # Dispatch directly to users for queue messages (not room-scoped).
        for ev in updates:
            to_user = ev.get("to_user")
            payload = dict(ev)
            payload.pop("to_user", None)
            if to_user:
                await self.send_to_user(int(to_user), payload)

    async def _handle_matchmaking_join(self, uid: int, kind: str, mode: str) -> None:
        result = self.matchmaker.join(uid, kind, mode)
        if not result.get("ok"):
            await self.send_to_user(uid, {"type": "error", "error": result.get("error", "queue_join_failed")})
            return
        left = result.get("left")
        if left:
            payload = self.matchmaker.queue_left_payload(uid, left)
            if payload:
                await self.send_to_user(uid, {k: v for k, v in payload.items() if k != "to_user"})
        await self._apply_queue_update_events(result.get("updates", []))

        for match in result.get("matches", []):
            await self._create_match_from_queue(match["kind"], match["mode"], [int(x) for x in match["user_ids"]])

    async def _handle_matchmaking_leave(self, uid: int, kind: Optional[str], mode: Optional[str]) -> None:
        result = self.matchmaker.leave(uid, kind=kind, mode=mode)
        left = result.get("left")
        if left:
            payload = self.matchmaker.queue_left_payload(uid, left)
            if payload:
                await self.send_to_user(uid, {k: v for k, v in payload.items() if k != "to_user"})
        await self._apply_queue_update_events(result.get("updates", []))

    async def _create_match_from_queue(self, kind: str, mode: str, user_ids: List[int]) -> None:
        room_id = self._sanitize_room_id(random_token(6))
        room_params: dict = {}
        if kind == "arena":
            room_params = {"arena_mode_name": mode, "match_seconds": 90}
        await self.broadcast_lobby_state()
        for uid in user_ids:
            # Prevent multi-room state conflicts on auto-match.
            await self._leave_user_all_rooms(uid)

        for uid in user_ids:
            await self.send_to_user(
                uid,
                {
                    "type": "match_found",
                    "kind": kind,
                    "mode": mode,
                    "room_id": room_id,
                    "room_key": self._make_room_key(kind, room_id),
                    "players": user_ids,
                },
            )

        for uid in user_ids:
            await self._join_room_for_uid(uid, kind=kind, room_id=room_id, room_params=room_params, send_room_joined=True)
        await self.broadcast_lobby_state()

    async def ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30, autoping=True, max_msg_size=2 * 1024 * 1024)
        await ws.prepare(request)
        self.all_sockets.add(ws)
        self.socket_user[ws] = None
        await ws.send_json({"type": "hello_required"})

        # If middleware already authenticated the request (query/header token), bind immediately.
        if request.get("user"):
            await self._bind_socket_user(ws, request["user"])

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json_loads(msg.data)
                    except Exception:
                        await ws.send_json({"type": "error", "error": "invalid_json"})
                        continue
                    await self._handle_ws_message(ws, data)
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            await self._handle_disconnect(ws)
        return ws

    async def _bind_socket_user(self, ws: web.WebSocketResponse, user: dict) -> None:
        existing = self.socket_user.get(ws)
        if existing and int(existing["id"]) == int(user["id"]):
            return
        self.socket_user[ws] = user
        uid = int(user["id"])
        self.user_sockets[uid].add(ws)
        await ws.send_json({"type": "hello_ok", "me": self.db.me_payload(uid), "server": {"boss_enabled": self.boss_enabled}})
        await ws.send_json({"type": "presence", "online": self.online_users_payload()})
        await ws.send_json({"type": "lobby_state", **self.build_lobby_state()})
        await self.broadcast_presence()

    async def _handle_disconnect(self, ws: web.WebSocketResponse) -> None:
        user = self.socket_user.pop(ws, None)
        self.all_sockets.discard(ws)
        if user:
            uid = int(user["id"])
            self.user_sockets[uid].discard(ws)
            if not self.user_sockets[uid]:
                self.user_sockets.pop(uid, None)
                mm_result = self.matchmaker.remove_user(uid)
                if mm_result.get("updates"):
                    await self._apply_queue_update_events(mm_result["updates"])
                # Remove from rooms when user fully offline
                await self._leave_user_all_rooms(uid)
                self.user_rooms.pop(uid, None)
                await self.broadcast_presence()
                await self.broadcast_lobby_state()

    async def _handle_ws_message(self, ws: web.WebSocketResponse, data: dict) -> None:
        t = data.get("type")
        if t == "hello":
            token = str(data.get("token") or "").strip()
            if not token:
                await ws.send_json({"type": "error", "error": "missing_token"})
                return
            user = self.db.get_user_by_session(token, now_ts())
            if not user:
                await ws.send_json({"type": "error", "error": "bad_token"})
                return
            if int(user.get("banned_until", 0)) > now_ts():
                await ws.send_json({"type": "error", "error": "banned", "banned_until": int(user["banned_until"])})
                return
            await self._bind_socket_user(ws, user)
            return

        user = self.socket_user.get(ws)
        if not user:
            await ws.send_json({"type": "error", "error": "hello_first"})
            return
        uid = int(user["id"])

        if t == "ping":
            await ws.send_json({"type": "pong", "ts": data.get("ts")})
            return
        if t == "get_lobby":
            await ws.send_json({"type": "lobby_state", **self.build_lobby_state()})
            return
        if t == "user_search":
            q = str(data.get("q") or "").strip()
            users = self.db.search_users(q, limit=20) if q else self.db.list_users_brief(limit=50)
            await ws.send_json({"type": "user_search_result", "users": users})
            return
        if t == "queue_join":
            kind = str(data.get("kind") or "").lower()
            mode = str(data.get("mode") or "1v1").lower()
            if kind == "arena" and mode == "boss" and not self.boss_enabled:
                await ws.send_json({"type": "error", "error": "boss_disabled"})
                return
            await self._handle_matchmaking_join(uid, kind, mode)
            await self.broadcast_lobby_state()
            return
        if t == "queue_leave":
            kind = data.get("kind")
            mode = data.get("mode")
            await self._handle_matchmaking_leave(uid, str(kind).lower() if kind is not None else None, str(mode).lower() if mode is not None else None)
            await self.broadcast_lobby_state()
            return

        # Room lifecycle
        if t in {"join_room", "room_join"}:
            kind = str(data.get("kind") or data.get("mode") or "arena").lower()
            room_id = self._sanitize_room_id(str(data.get("room_id") or "room"))
            if kind not in {"arena", "chess", "pong", "reaction", "typing"}:
                await ws.send_json({"type": "error", "error": "unknown_room_kind"})
                return
            # Joining a room cancels queueing to avoid hidden queued state.
            await self._handle_matchmaking_leave(uid, None, None)
            await self._join_room_for_uid(uid, kind=kind, room_id=room_id, room_params=data, send_room_joined=True)
            await self.broadcast_lobby_state()
            return

        if t in {"leave_room", "room_leave"}:
            kind = str(data.get("kind") or data.get("mode") or "arena").lower()
            room_id = self._sanitize_room_id(str(data.get("room_id") or "room"))
            key = self._make_room_key(kind, room_id)
            await self._leave_user_room_by_key(uid, key)
            await self.broadcast_lobby_state()
            return

        if t == "room_chat":
            muted_until = int(user.get("muted_until", 0))
            if muted_until > now_ts():
                await ws.send_json({"type": "error", "error": "muted", "muted_until": muted_until})
                return
            room_key = str(data.get("room_key") or "")
            text = str(data.get("text") or "").strip()
            if not text:
                return
            if room_key not in self.rooms or uid not in self.rooms[room_key].members:
                await ws.send_json({"type": "error", "error": "not_in_room"})
                return
            await self._broadcast_room(
                room_key,
                {
                    "type": "room_chat",
                    "room_key": room_key,
                    "from_user_id": uid,
                    "from_name": user.get("display_name") or user["username"],
                    "text": text[:400],
                    "created_at": now_ts(),
                },
            )
            return

        # Arena / minigame routing
        routed = False
        for key in list(self.user_rooms.get(uid, set())):
            room = self.rooms.get(key)
            if not room:
                continue
            kind = self.room_kind.get(key)
            if kind == "arena" and t.startswith("arena_"):
                room.handle(uid, data)
                for ev in room.drain_outbox():
                    await self._dispatch_room_event(key, ev)
                routed = True
            elif kind == "chess" and t.startswith("chess_"):
                room.handle(uid, data)
                for ev in room.drain_outbox():
                    await self._dispatch_room_event(key, ev)
                await self._dispatch_room_event(key, room.snapshot())
                routed = True
            elif kind == "pong" and t.startswith("pong_"):
                room.handle(uid, data)
                for ev in room.drain_outbox():
                    await self._dispatch_room_event(key, ev)
                routed = True
            elif kind == "reaction" and t.startswith("reaction_"):
                room.handle(uid, data)
                for ev in room.drain_outbox():
                    await self._dispatch_room_event(key, ev)
                await self._dispatch_room_event(key, room.snapshot())
                routed = True
            elif kind == "typing" and t.startswith("typing_"):
                room.handle(uid, data)
                for ev in room.drain_outbox():
                    await self._dispatch_room_event(key, ev)
                await self._dispatch_room_event(key, room.snapshot())
                routed = True
        if routed:
            return

        # DMs and moderation
        if t == "dm_threads":
            await ws.send_json({"type": "dm_threads", "threads": self.db.list_dm_threads(uid, limit=100)})
            return
        if t == "dm_history":
            other_id = safe_int(data.get("other_id"), 0)
            if not other_id:
                await ws.send_json({"type": "error", "error": "missing_other_id"})
                return
            await ws.send_json({"type": "dm_history", "other_id": other_id, "messages": self.db.list_dm_messages(uid, other_id, limit=300)})
            return
        if t == "dm_send":
            muted_until = int(user.get("muted_until", 0))
            if muted_until > now_ts():
                await ws.send_json({"type": "error", "error": "muted", "muted_until": muted_until})
                return
            other_id = safe_int(data.get("recipient_id"), 0)
            body = str(data.get("body") or "").strip()
            file_id = data.get("file_id")
            if not other_id:
                await ws.send_json({"type": "error", "error": "missing_recipient"})
                return
            if not body and not file_id:
                await ws.send_json({"type": "error", "error": "empty_message"})
                return
            if file_id is not None:
                file_id = safe_int(file_id, 0)
                if not file_id or not self.db.can_access_file(uid, file_id):
                    await ws.send_json({"type": "error", "error": "file_not_accessible"})
                    return
            msg_row = self.db.create_dm_message(uid, other_id, body[:1500], file_id=file_id if file_id else None)
            payload = {"type": "dm_new", "message": msg_row}
            await self.send_to_user(uid, payload)
            await self.send_to_user(other_id, payload)
            return
        if t == "hub_delete":
            if not bool(user.get("is_admin")):
                await ws.send_json({"type": "error", "error": "admin_only"})
                return
            post_id = safe_int(data.get("post_id"), 0)
            ok = self.db.delete_hub_post(post_id)
            await self.broadcast_json({"type": "hub_deleted", "post_id": post_id, "ok": ok})
            return
        if t == "dm_delete":
            if not bool(user.get("is_admin")):
                await ws.send_json({"type": "error", "error": "admin_only"})
                return
            msg_id = safe_int(data.get("message_id"), 0)
            ok = self.db.delete_dm_message(msg_id)
            await self.broadcast_json({"type": "dm_deleted", "message_id": msg_id, "ok": ok})
            return
        if t == "admin_mute":
            if not bool(user.get("is_admin")):
                await ws.send_json({"type": "error", "error": "admin_only"})
                return
            target_id = safe_int(data.get("user_id"), 0)
            minutes = max(0, safe_int(data.get("minutes"), 5))
            if target_id:
                until_ts = now_ts() + minutes * 60
                self.db.set_user_mute(target_id, until_ts, int(user["id"]), reason="in-app")
                await self.send_to_user(target_id, {"type": "moderation", "kind": "mute", "until_ts": until_ts})
                await ws.send_json({"type": "admin_mute_ok", "user_id": target_id, "until_ts": until_ts})
            return
        if t == "admin_ban":
            if not bool(user.get("is_admin")):
                await ws.send_json({"type": "error", "error": "admin_only"})
                return
            target_id = safe_int(data.get("user_id"), 0)
            minutes = max(1, safe_int(data.get("minutes"), 10))
            if target_id:
                until_ts = now_ts() + minutes * 60
                self.db.set_user_ban(target_id, until_ts, int(user["id"]), reason="in-app")
                await self.send_to_user(target_id, {"type": "moderation", "kind": "ban", "until_ts": until_ts})
                await self.kick_user(target_id)
                await ws.send_json({"type": "admin_ban_ok", "user_id": target_id, "until_ts": until_ts})
            return

        await ws.send_json({"type": "error", "error": "unknown_message_type", "got": t})

    def online_users_payload(self) -> List[dict]:
        users = []
        for uid in sorted(self.user_sockets):
            user = self.db.get_user_by_id(uid)
            if not user:
                continue
            users.append(
                {
                    "id": user["id"],
                    "username": user["username"],
                    "display_name": user["display_name"],
                    "is_admin": bool(user["is_admin"]),
                    "stats": user.get("stats") or self.db.get_stats(uid),
                }
            )
        return users

    def build_lobby_state(self) -> dict:
        rooms = []
        for key, room in self.rooms.items():
            kind = self.room_kind.get(key, "room")
            room_id = self.room_id_map.get(key, key)
            players = getattr(room, "players", [])
            spectators = getattr(room, "spectators", set())
            state = getattr(room, "state", "unknown")
            if isinstance(players, dict):
                player_ids = [uid for uid in players.values() if uid]
                player_count = len(player_ids)
                players_field = players
            elif isinstance(players, (list, tuple)):
                player_ids = list(players)
                player_count = len(player_ids)
                players_field = list(players)
            else:
                player_ids = []
                player_count = 0
                players_field = players
            entry = {
                "room_key": key,
                "room_id": room_id,
                "kind": kind,
                "state": state,
                "players": players_field,
                "player_count": player_count,
                "spectator_count": len(spectators) if hasattr(spectators, "__len__") else 0,
            }
            if kind == "arena":
                entry["mode_name"] = getattr(room, "mode_name", "ffa")
                entry["time_left"] = round(getattr(room, "time_left", 0.0), 2)
            rooms.append(entry)
        rooms.sort(key=lambda r: (r["kind"], r["room_id"]))
        return {
            "rooms": rooms,
            "online": self.online_users_payload(),
            "server": {"boss_enabled": self.boss_enabled, "local_ips": local_ips()},
            "queues": self.matchmaker.queue_snapshot(),
        }

    async def broadcast_presence(self) -> None:
        await self.broadcast_json({"type": "presence", "online": self.online_users_payload()})

    async def broadcast_lobby_state(self) -> None:
        await self.broadcast_json({"type": "lobby_state", **self.build_lobby_state()})

    async def broadcast_json(self, payload: dict) -> None:
        dead: List[web.WebSocketResponse] = []
        for ws in list(self.all_sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self._handle_disconnect(ws)

    async def _broadcast_room(self, room_key: str, payload: dict) -> None:
        room = self.rooms.get(room_key)
        if not room:
            return
        recipients = list(getattr(room, "members", set()))
        for uid in recipients:
            await self.send_to_user(uid, payload)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        for ws in list(self.user_sockets.get(int(user_id), set())):
            try:
                await ws.send_json(payload)
            except Exception:
                await self._handle_disconnect(ws)

    async def on_hub_post_created(self, post: dict) -> None:
        await self.broadcast_json({"type": "hub_new_post", "post": post})

    async def on_file_deleted(self, file_id: int) -> None:
        await self.broadcast_json({"type": "file_deleted", "file_id": file_id})

    async def announce(self, text: str) -> None:
        self._server_notice_seq += 1
        await self.broadcast_json({"type": "announcement", "id": self._server_notice_seq, "text": text[:500], "created_at": now_ts()})

    async def kick_user(self, user_id: int) -> None:
        for ws in list(self.user_sockets.get(int(user_id), set())):
            try:
                await ws.send_json({"type": "kicked"})
            except Exception:
                pass
            try:
                await ws.close()
            except Exception:
                pass

    def list_rooms_admin(self) -> List[dict]:
        return self.build_lobby_state()["rooms"]

    def list_users_admin(self) -> List[dict]:
        users = []
        for uid in self.user_sockets:
            user = self.db.get_user_by_id(uid)
            if user:
                users.append({"id": uid, "username": user["username"], "display_name": user["display_name"], "rooms": sorted(self.user_rooms.get(uid, set()))})
        users.sort(key=lambda u: u["username"])
        return users

    async def force_room_start(self, room_key: str) -> bool:
        room = self.rooms.get(room_key)
        if not room:
            return False
        if hasattr(room, "_try_start"):
            room._try_start(force=True)  # type: ignore[attr-defined]
            for ev in room.drain_outbox():
                await self._dispatch_room_event(room_key, ev)
            await self._dispatch_room_event(room_key, room.snapshot())
            await self.broadcast_lobby_state()
            return True
        return False

    async def force_room_end(self, room_key: str) -> bool:
        room = self.rooms.get(room_key)
        if not room:
            return False
        if hasattr(room, "finish_match"):
            room.finish_match("admin_end")  # type: ignore[attr-defined]
        elif hasattr(room, "finish"):
            room.finish("admin_end")  # type: ignore[attr-defined]
        elif hasattr(room, "game") and hasattr(room, "state"):
            # ChessRoom path
            try:
                room.game.force_draw("admin_end")
                room.state = "ended"
                room.ended = True
                if hasattr(room, "_apply_result_if_needed"):
                    room._apply_result_if_needed()
                room.outbox.append({"type": "chess_end", "room_id": room.room_id, "status": "draw", "reason": "admin_end"})
            except Exception:
                return False
        else:
            return False
        for ev in room.drain_outbox():
            await self._dispatch_room_event(room_key, ev)
        await self._dispatch_room_event(room_key, room.snapshot())
        await self.broadcast_lobby_state()
        return True

    async def set_boss_enabled(self, enabled: bool) -> None:
        self.boss_enabled = bool(enabled)
        await self.broadcast_json({"type": "server_flag", "boss_enabled": self.boss_enabled})
        await self.broadcast_lobby_state()
