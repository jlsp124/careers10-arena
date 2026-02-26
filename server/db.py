import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from util import clamp, cortisol_tier, now_ts


class Database:
    def __init__(self, path: Path):
        self.path = str(path)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL;")
        self.conn.execute("PRAGMA foreign_keys=ON;")
        self.init_schema()

    def init_schema(self) -> None:
        with self._lock, self.conn:
            self.conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    pw_salt TEXT NOT NULL,
                    pw_hash TEXT NOT NULL,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    muted_until INTEGER NOT NULL DEFAULT 0,
                    banned_until INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

                CREATE TABLE IF NOT EXISTS stats (
                    user_id INTEGER PRIMARY KEY,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    kos INTEGER NOT NULL DEFAULT 0,
                    deaths INTEGER NOT NULL DEFAULT 0,
                    streak INTEGER NOT NULL DEFAULT 0,
                    cortisol INTEGER NOT NULL DEFAULT 1000,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS hub_posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    tags TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_hub_posts_created ON hub_posts(created_at DESC);

                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    storage_name TEXT NOT NULL UNIQUE,
                    original_name TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    mime TEXT NOT NULL,
                    uploader_id INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    sha256 TEXT,
                    download_count INTEGER NOT NULL DEFAULT 0,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS dm_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id INTEGER NOT NULL,
                    recipient_id INTEGER NOT NULL,
                    body TEXT NOT NULL DEFAULT '',
                    file_id INTEGER,
                    created_at INTEGER NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_dm_file ON dm_messages(file_id);

                CREATE TABLE IF NOT EXISTS bans_mutes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    until_ts INTEGER NOT NULL,
                    reason TEXT NOT NULL DEFAULT '',
                    moderator_id INTEGER,
                    created_at INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_bans_mutes_user ON bans_mutes(user_id, kind, active);
                """
            )

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def _one(self, query: str, params: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
        cur = self.conn.execute(query, tuple(params))
        return cur.fetchone()

    def _all(self, query: str, params: Iterable[Any] = ()) -> List[sqlite3.Row]:
        cur = self.conn.execute(query, tuple(params))
        return cur.fetchall()

    def cleanup_expired_sessions(self, now: Optional[int] = None) -> int:
        now = now or now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            return cur.rowcount

    def user_count(self) -> int:
        with self._lock:
            row = self._one("SELECT COUNT(*) AS c FROM users")
            return int(row["c"] if row else 0)

    def get_user_by_name(self, username: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, pw_salt, pw_hash, is_admin, muted_until, banned_until, created_at "
                "FROM users WHERE lower(username)=lower(?)",
                (username,),
            )
            return dict(row) if row else None

    def resolve_username(self, name: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, is_admin FROM users "
                "WHERE lower(username)=lower(?) OR lower(display_name)=lower(?)",
                (name, name),
            )
            return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, is_admin, muted_until, banned_until, created_at "
                "FROM users WHERE id=?",
                (user_id,),
            )
            if not row:
                return None
            user = dict(row)
            user["stats"] = self.get_stats(user_id)
            return user

    def create_user(
        self,
        username: str,
        display_name: str,
        pw_salt: str,
        pw_hash: str,
        *,
        is_admin: bool = False,
    ) -> Dict[str, Any]:
        ts = now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute(
                """
                INSERT INTO users (username, display_name, pw_salt, pw_hash, is_admin, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (username, display_name, pw_salt, pw_hash, 1 if is_admin else 0, ts),
            )
            user_id = int(cur.lastrowid)
            self.conn.execute("INSERT INTO stats (user_id) VALUES (?)", (user_id,))
        return self.get_user_by_id(user_id)  # type: ignore[return-value]

    def create_session(self, user_id: int, token: str, expires_at: int) -> None:
        ts = now_ts()
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token, user_id, ts, expires_at),
            )

    def get_user_by_session(self, token: str, now: Optional[int] = None) -> Optional[Dict[str, Any]]:
        now = now or now_ts()
        with self._lock:
            row = self._one(
                """
                SELECT u.id, u.username, u.display_name, u.is_admin, u.muted_until, u.banned_until, u.created_at, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token=? AND s.expires_at > ?
                """,
                (token, now),
            )
            if not row:
                return None
            user = dict(row)
            user["stats"] = self.get_stats(int(user["id"]))
            return user

    def delete_session(self, token: str) -> None:
        with self._lock, self.conn:
            self.conn.execute("DELETE FROM sessions WHERE token=?", (token,))

    def get_stats(self, user_id: int) -> Dict[str, Any]:
        with self._lock:
            row = self._one(
                "SELECT wins, losses, kos, deaths, streak, cortisol FROM stats WHERE user_id=?",
                (user_id,),
            )
            if not row:
                return {
                    "wins": 0,
                    "losses": 0,
                    "kos": 0,
                    "deaths": 0,
                    "streak": 0,
                    "cortisol": 1000,
                    "tier": "Stable",
                }
            stats = dict(row)
            stats["tier"] = cortisol_tier(int(stats["cortisol"]))
            return stats

    def me_payload(self, user_id: int) -> Dict[str, Any]:
        user = self.get_user_by_id(user_id)
        if not user:
            raise KeyError("user_not_found")
        return {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "is_admin": bool(user["is_admin"]),
            "muted_until": int(user["muted_until"]),
            "banned_until": int(user["banned_until"]),
            "stats": user["stats"],
        }

    def list_users_brief(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT u.id, u.username, u.display_name, u.is_admin, u.muted_until, u.banned_until,
                       COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses,
                       COALESCE(s.cortisol,1000) AS cortisol
                FROM users u
                LEFT JOIN stats s ON s.user_id = u.id
                ORDER BY u.username ASC
                LIMIT ?
                """,
                (limit,),
            )
            return [dict(r) for r in rows]

    def search_users(self, q: str, limit: int = 20) -> List[Dict[str, Any]]:
        like = f"%{q}%"
        with self._lock:
            rows = self._all(
                """
                SELECT id, username, display_name, is_admin
                FROM users
                WHERE username LIKE ? OR display_name LIKE ?
                ORDER BY username ASC
                LIMIT ?
                """,
                (like, like, limit),
            )
            return [dict(r) for r in rows]

    def apply_match_result(
        self,
        user_id: int,
        *,
        win: bool,
        kos_delta: int = 0,
        deaths_delta: int = 0,
    ) -> Dict[str, Any]:
        with self._lock, self.conn:
            self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
            row = self._one(
                "SELECT wins, losses, kos, deaths, streak, cortisol FROM stats WHERE user_id=?",
                (user_id,),
            )
            assert row is not None
            wins = int(row["wins"])
            losses = int(row["losses"])
            kos = int(row["kos"]) + int(kos_delta)
            deaths = int(row["deaths"]) + int(deaths_delta)
            streak = int(row["streak"])
            cortisol = int(row["cortisol"])
            if win:
                wins += 1
                cortisol -= 25 + 5 * streak
                streak += 1
            else:
                losses += 1
                cortisol += 20
                streak = 0
            cortisol = int(clamp(cortisol, 0, 5000))
            self.conn.execute(
                "UPDATE stats SET wins=?, losses=?, kos=?, deaths=?, streak=?, cortisol=? WHERE user_id=?",
                (wins, losses, kos, deaths, streak, cortisol, user_id),
            )
        return self.get_stats(user_id)

    def add_match_bulk_results(self, results: List[Dict[str, Any]]) -> None:
        for item in results:
            self.apply_match_result(
                int(item["user_id"]),
                win=bool(item.get("win")),
                kos_delta=int(item.get("kos_delta", 0)),
                deaths_delta=int(item.get("deaths_delta", 0)),
            )

    def leaderboard(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT u.id, u.username, u.display_name, s.wins, s.losses, s.kos, s.deaths, s.streak, s.cortisol
                FROM users u
                JOIN stats s ON s.user_id = u.id
                ORDER BY s.cortisol ASC, s.wins DESC, u.username ASC
                LIMIT ?
                """,
                (limit,),
            )
            out = []
            for row in rows:
                item = dict(row)
                item["tier"] = cortisol_tier(int(item["cortisol"]))
                out.append(item)
            return out

    def hub_feed(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT p.id, p.category, p.title, p.body, p.tags, p.created_at,
                       u.id AS user_id, u.username, u.display_name
                FROM hub_posts p
                JOIN users u ON u.id = p.user_id
                WHERE p.deleted = 0
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT ?
                """,
                (limit,),
            )
            return [dict(r) for r in rows]

    def create_hub_post(self, user_id: int, category: str, title: str, body: str, tags: str) -> Dict[str, Any]:
        ts = now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO hub_posts (user_id, category, title, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, category, title, body, tags, ts),
            )
            post_id = int(cur.lastrowid)
        posts = self.hub_feed(limit=200)
        for post in posts:
            if int(post["id"]) == post_id:
                return post
        raise KeyError("post_create_failed")

    def delete_hub_post(self, post_id: int) -> bool:
        with self._lock, self.conn:
            cur = self.conn.execute("UPDATE hub_posts SET deleted=1 WHERE id=?", (post_id,))
            return cur.rowcount > 0

    def create_file_record(
        self,
        storage_name: str,
        original_name: str,
        size_bytes: int,
        mime: str,
        uploader_id: int,
        expires_at: int,
        sha256: Optional[str],
    ) -> Dict[str, Any]:
        ts = now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute(
                """
                INSERT INTO files (storage_name, original_name, size_bytes, mime, uploader_id, created_at, expires_at, sha256)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (storage_name, original_name, size_bytes, mime, uploader_id, ts, expires_at, sha256),
            )
            file_id = int(cur.lastrowid)
        return self.get_file(file_id)  # type: ignore[return-value]

    def get_file(self, file_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, storage_name, original_name, size_bytes, mime, uploader_id, created_at, expires_at, sha256, download_count, deleted "
                "FROM files WHERE id=?",
                (file_id,),
            )
            return dict(row) if row else None

    def file_total_bytes(self) -> int:
        with self._lock:
            row = self._one("SELECT COALESCE(SUM(size_bytes),0) AS s FROM files WHERE deleted=0")
            return int(row["s"] if row else 0)

    def list_expired_files(self, now: Optional[int] = None) -> List[Dict[str, Any]]:
        now = now or now_ts()
        with self._lock:
            rows = self._all("SELECT * FROM files WHERE deleted=0 AND expires_at <= ?", (now,))
            return [dict(r) for r in rows]

    def mark_file_deleted(self, file_id: int) -> bool:
        with self._lock, self.conn:
            cur = self.conn.execute("UPDATE files SET deleted=1 WHERE id=?", (file_id,))
            return cur.rowcount > 0

    def delete_file_record(self, file_id: int) -> bool:
        return self.mark_file_deleted(file_id)

    def increment_file_download(self, file_id: int) -> None:
        with self._lock, self.conn:
            self.conn.execute("UPDATE files SET download_count=download_count+1 WHERE id=?", (file_id,))

    def can_access_file(self, user_id: int, file_id: int) -> bool:
        with self._lock:
            file_row = self._one("SELECT uploader_id, deleted FROM files WHERE id=?", (file_id,))
            if not file_row or int(file_row["deleted"]) == 1:
                return False
            if int(file_row["uploader_id"]) == user_id:
                return True
            row = self._one(
                """
                SELECT 1 FROM dm_messages
                WHERE file_id=? AND deleted=0 AND (sender_id=? OR recipient_id=?)
                LIMIT 1
                """,
                (file_id, user_id, user_id),
            )
            return bool(row)

    def create_dm_message(
        self,
        sender_id: int,
        recipient_id: int,
        body: str,
        file_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        ts = now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO dm_messages (sender_id, recipient_id, body, file_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (sender_id, recipient_id, body, file_id, ts),
            )
            msg_id = int(cur.lastrowid)
        return self.get_dm_message(msg_id)  # type: ignore[return-value]

    def get_dm_message(self, msg_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                """
                SELECT m.id, m.sender_id, m.recipient_id, m.body, m.file_id, m.created_at, m.deleted,
                       su.username AS sender_username, su.display_name AS sender_display_name
                FROM dm_messages m
                JOIN users su ON su.id = m.sender_id
                WHERE m.id=?
                """,
                (msg_id,),
            )
            if not row:
                return None
            msg = dict(row)
            if msg.get("file_id"):
                msg["file"] = self.get_file(int(msg["file_id"]))
            return msg

    def list_dm_threads(self, user_id: int, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                WITH convo AS (
                    SELECT CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END AS other_id,
                           MAX(id) AS last_id
                    FROM dm_messages
                    WHERE deleted=0 AND (sender_id=? OR recipient_id=?)
                    GROUP BY other_id
                )
                SELECT c.other_id, m.id AS last_message_id, m.body, m.file_id, m.created_at,
                       u.username, u.display_name, u.is_admin
                FROM convo c
                JOIN dm_messages m ON m.id = c.last_id
                JOIN users u ON u.id = c.other_id
                ORDER BY m.created_at DESC
                LIMIT ?
                """,
                (user_id, user_id, user_id, limit),
            )
            return [dict(r) for r in rows]

    def list_dm_messages(self, user_a: int, user_b: int, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT m.id, m.sender_id, m.recipient_id, m.body, m.file_id, m.created_at, m.deleted,
                       su.username AS sender_username, su.display_name AS sender_display_name
                FROM dm_messages m
                JOIN users su ON su.id = m.sender_id
                WHERE m.deleted=0 AND (
                    (m.sender_id=? AND m.recipient_id=?) OR
                    (m.sender_id=? AND m.recipient_id=?)
                )
                ORDER BY m.created_at ASC, m.id ASC
                LIMIT ?
                """,
                (user_a, user_b, user_b, user_a, limit),
            )
            out = []
            for row in rows:
                msg = dict(row)
                if msg.get("file_id"):
                    msg["file"] = self.get_file(int(msg["file_id"]))
                out.append(msg)
            return out

    def delete_dm_message(self, msg_id: int) -> bool:
        with self._lock, self.conn:
            cur = self.conn.execute("UPDATE dm_messages SET deleted=1, body='[removed by admin]' WHERE id=?", (msg_id,))
            return cur.rowcount > 0

    def set_user_mute(self, user_id: int, until_ts: int, moderator_id: Optional[int], reason: str = "") -> None:
        with self._lock, self.conn:
            self.conn.execute("UPDATE users SET muted_until=? WHERE id=?", (until_ts, user_id))
            self.conn.execute(
                "INSERT INTO bans_mutes (user_id, kind, until_ts, reason, moderator_id, created_at, active) VALUES (?, 'mute', ?, ?, ?, ?, 1)",
                (user_id, until_ts, reason, moderator_id, now_ts()),
            )

    def set_user_ban(self, user_id: int, until_ts: int, moderator_id: Optional[int], reason: str = "") -> None:
        with self._lock, self.conn:
            self.conn.execute("UPDATE users SET banned_until=? WHERE id=?", (until_ts, user_id))
            self.conn.execute(
                "INSERT INTO bans_mutes (user_id, kind, until_ts, reason, moderator_id, created_at, active) VALUES (?, 'ban', ?, ?, ?, ?, 1)",
                (user_id, until_ts, reason, moderator_id, now_ts()),
            )

    def set_stats_field(self, user_id: int, field: str, value: int) -> bool:
        if field not in {"wins", "losses", "kos", "deaths", "streak", "cortisol"}:
            return False
        if field == "cortisol":
            value = int(clamp(value, 0, 5000))
        with self._lock, self.conn:
            self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
            self.conn.execute(f"UPDATE stats SET {field}=? WHERE user_id=?", (int(value), user_id))
        return True

