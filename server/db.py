import hashlib
import json
import math
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

from util import clamp, cortisol_tier, now_ts


MARKET_STEP_SECONDS = 2
MARKET_BLOCK_INTERVAL_SECONDS = 10
DEFAULT_TOKEN_AIRDROP = 25.0
DEFAULT_TOKEN_SUPPLY_CAP = 1_000_000.0
WALLET_NAME_LIMIT = 40
TOKEN_NAME_LIMIT = 40
TOKEN_SYMBOL_LIMIT = 8
TOKEN_DESC_LIMIT = 240

BOT_SEED_DEFINITIONS = [
    {
        "slug": "maker-mel",
        "username": "bot_maker_mel",
        "display_name": "Maker Mel",
        "wallet_name": "Mel Liquidity",
        "persona": "Keeps spreads tight and likes orderly markets.",
        "strategy": "mean_reversion",
        "risk_level": "low",
        "starting_cc": 1800.0,
    },
    {
        "slug": "trend-troy",
        "username": "bot_trend_troy",
        "display_name": "Trend Troy",
        "wallet_name": "Troy Momentum",
        "persona": "Chases breakouts and dumps weakness fast.",
        "strategy": "momentum",
        "risk_level": "high",
        "starting_cc": 1400.0,
    },
    {
        "slug": "rotation-rin",
        "username": "bot_rotation_rin",
        "display_name": "Rotation Rin",
        "wallet_name": "Rin Rotation",
        "persona": "Rotates between sectors when volume shifts.",
        "strategy": "rotation",
        "risk_level": "medium",
        "starting_cc": 1600.0,
    },
]


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

                CREATE TABLE IF NOT EXISTS wallets (
                    address TEXT PRIMARY KEY,
                    owner_user_id INTEGER,
                    label TEXT NOT NULL DEFAULT 'Wallet',
                    balance INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_wallet_owner ON wallets(owner_user_id);

                CREATE TABLE IF NOT EXISTS wallet_transfers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_address TEXT,
                    to_address TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    memo TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cortisol_blocks (
                    height INTEGER PRIMARY KEY,
                    prev_hash TEXT NOT NULL,
                    block_hash TEXT NOT NULL,
                    reward_address TEXT NOT NULL,
                    reward_amount INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
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
            self._ensure_user_columns()
            self._ensure_wallet_columns()
            self._ensure_economy_schema()
            self._ensure_token_columns()
            self._ensure_bot_schema()
            self._ensure_explorer_schema()
            self._seed_base_token()
            self._backfill_explorer_history()
            self._seed_market_bots()

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def _one(self, query: str, params: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
        cur = self.conn.execute(query, tuple(params))
        return cur.fetchone()

    def _all(self, query: str, params: Iterable[Any] = ()) -> List[sqlite3.Row]:
        cur = self.conn.execute(query, tuple(params))
        return cur.fetchall()

    def _column_names(self, table: str) -> Set[str]:
        rows = self._all(f"PRAGMA table_info({table})")
        return {str(r["name"]) for r in rows}

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        if column not in self._column_names(table):
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _normalize_slug(self, value: str, fallback: str = "") -> str:
        raw = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
        if raw:
            return raw[:48]
        clean_fallback = re.sub(r"[^a-z0-9]+", "-", (fallback or "").strip().lower()).strip("-")
        return (clean_fallback or "item")[:48]

    def _normalize_wallet_name(self, value: str, fallback: str = "Wallet") -> str:
        clean = (value or "").strip()
        return (clean[:WALLET_NAME_LIMIT] or fallback)[:WALLET_NAME_LIMIT]

    def _normalize_token_symbol(self, value: str) -> str:
        return "".join(ch for ch in (value or "").upper() if ch.isalnum())[:TOKEN_SYMBOL_LIMIT]

    def _normalize_wallet_sort_order_locked(self, user_id: Optional[int] = None) -> None:
        params: List[Any] = []
        query = (
            "SELECT id, user_id FROM wallets "
            "WHERE COALESCE(deleted, 0)=0"
        )
        if user_id is not None:
            query += " AND user_id=?"
            params.append(int(user_id))
        query += " ORDER BY CASE WHEN user_id IS NULL THEN 1 ELSE 0 END, user_id ASC, created_at ASC, id ASC"
        rows = self._all(query, params)
        grouped: Dict[Optional[int], List[int]] = {}
        for row in rows:
            grouped.setdefault(row["user_id"], []).append(int(row["id"]))
        for owner_id, wallet_ids in grouped.items():
            for idx, wallet_id in enumerate(wallet_ids):
                self.conn.execute("UPDATE wallets SET sort_order=? WHERE id=?", (idx, wallet_id))

    def _ensure_user_columns(self) -> None:
        self._ensure_column("users", "is_bot", "INTEGER NOT NULL DEFAULT 0")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot)")

    def _ensure_wallet_columns(self) -> None:
        cols = self._column_names("wallets")
        if "id" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN id INTEGER")
        if "user_id" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN user_id INTEGER")
        if "name" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN name TEXT")
        if "sort_order" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN sort_order INTEGER")
        if "deleted" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
        if "wallet_kind" not in cols:
            self.conn.execute("ALTER TABLE wallets ADD COLUMN wallet_kind TEXT NOT NULL DEFAULT 'user'")
        self.conn.execute("UPDATE wallets SET user_id=owner_user_id WHERE user_id IS NULL")
        self.conn.execute("UPDATE wallets SET name=label WHERE name IS NULL OR trim(name)=''")
        self.conn.execute("UPDATE wallets SET id=rowid WHERE id IS NULL")
        self.conn.execute("UPDATE wallets SET deleted=0 WHERE deleted IS NULL")
        self.conn.execute("UPDATE wallets SET wallet_kind='system' WHERE address='host_miner'")
        self.conn.execute("UPDATE wallets SET wallet_kind='user' WHERE wallet_kind IS NULL OR trim(wallet_kind)=''")
        self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_id ON wallets(id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_wallets_user_order ON wallets(user_id, deleted, sort_order, id)")
        self._normalize_wallet_sort_order_locked()

    def _ensure_economy_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_user_id INTEGER,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                params_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(creator_user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator_user_id);

            CREATE TABLE IF NOT EXISTS balances (
                wallet_id INTEGER NOT NULL,
                token_id INTEGER NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                PRIMARY KEY(wallet_id, token_id),
                FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_balances_wallet ON balances(wallet_id);
            CREATE INDEX IF NOT EXISTS idx_balances_token ON balances(token_id);

            CREATE TABLE IF NOT EXISTS prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_id INTEGER NOT NULL,
                ts INTEGER NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_prices_token_ts ON prices(token_id, ts DESC);

            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                wallet_id INTEGER NOT NULL,
                token_id INTEGER NOT NULL,
                side TEXT NOT NULL,
                amount REAL NOT NULL,
                price REAL NOT NULL,
                ts INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_trades_user_ts ON trades(user_id, ts DESC);
            CREATE INDEX IF NOT EXISTS idx_trades_wallet_ts ON trades(wallet_id, ts DESC);

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                wallet_id INTEGER,
                kind TEXT NOT NULL,
                delta_cortisol INTEGER NOT NULL DEFAULT 0,
                delta_cc REAL NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}',
                ts INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_user_ts ON transactions(user_id, ts DESC);

            CREATE TABLE IF NOT EXISTS market_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )

    def _ensure_token_columns(self) -> None:
        cols = self._column_names("tokens")
        if "slug" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN slug TEXT")
        if "category" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN category TEXT NOT NULL DEFAULT 'arcade'")
        if "theme" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN theme TEXT NOT NULL DEFAULT 'default'")
        if "website_url" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN website_url TEXT NOT NULL DEFAULT ''")
        if "icon_file_id" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN icon_file_id INTEGER")
        if "launch_price" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN launch_price REAL NOT NULL DEFAULT 1.0")
        if "volatility_profile" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN volatility_profile TEXT NOT NULL DEFAULT 'medium'")
        if "supply_cap" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN supply_cap REAL NOT NULL DEFAULT 0")
        if "circulating_supply" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN circulating_supply REAL NOT NULL DEFAULT 0")
        if "metadata_json" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
        if "status" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
        if "creator_wallet_id" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN creator_wallet_id INTEGER")
        self.conn.execute("UPDATE tokens SET slug=lower(symbol) WHERE slug IS NULL OR trim(slug)=''")
        self.conn.execute("UPDATE tokens SET category=CASE WHEN symbol='CC' THEN 'currency' ELSE COALESCE(NULLIF(category,''), 'arcade') END")
        self.conn.execute("UPDATE tokens SET theme=COALESCE(NULLIF(theme,''), NULLIF(json_extract(params_json, '$.theme'), ''), 'default')")
        self.conn.execute("UPDATE tokens SET website_url='' WHERE website_url IS NULL")
        self.conn.execute("UPDATE tokens SET volatility_profile=COALESCE(NULLIF(volatility_profile,''), 'medium')")
        self.conn.execute("UPDATE tokens SET metadata_json='{}' WHERE metadata_json IS NULL OR trim(metadata_json)=''")
        self.conn.execute("UPDATE tokens SET status=COALESCE(NULLIF(status,''), 'active')")
        self.conn.execute(
            "UPDATE tokens SET supply_cap=CASE WHEN supply_cap <= 0 THEN ? ELSE supply_cap END",
            (DEFAULT_TOKEN_SUPPLY_CAP,),
        )
        self.conn.execute(
            "UPDATE tokens SET circulating_supply=CASE "
            "WHEN circulating_supply > 0 THEN circulating_supply "
            "WHEN symbol='CC' THEN circulating_supply "
            "ELSE ? END",
            (DEFAULT_TOKEN_AIRDROP,),
        )
        rows = self._all("SELECT id FROM tokens WHERE launch_price <= 0")
        for row in rows:
            price_row = self._one("SELECT price FROM prices WHERE token_id=? ORDER BY ts ASC, id ASC LIMIT 1", (int(row["id"]),))
            launch_price = float(price_row["price"] if price_row else 1.0)
            self.conn.execute("UPDATE tokens SET launch_price=? WHERE id=?", (launch_price, int(row["id"])))
        self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_slug ON tokens(slug)")

    def _ensure_bot_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bot_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                wallet_id INTEGER NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                persona TEXT NOT NULL,
                strategy TEXT NOT NULL,
                risk_level TEXT NOT NULL DEFAULT 'medium',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                last_action_at INTEGER NOT NULL DEFAULT 0,
                config_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_bot_accounts_active ON bot_accounts(is_active, strategy);
            """
        )

    def _ensure_explorer_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS explorer_blocks (
                height INTEGER PRIMARY KEY,
                prev_hash TEXT NOT NULL,
                block_hash TEXT NOT NULL UNIQUE,
                miner_wallet_id INTEGER,
                reward_address TEXT NOT NULL,
                reward_amount INTEGER NOT NULL DEFAULT 0,
                tx_count INTEGER NOT NULL DEFAULT 0,
                volume_cc REAL NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_explorer_blocks_created ON explorer_blocks(created_at DESC);

            CREATE TABLE IF NOT EXISTS explorer_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tx_hash TEXT NOT NULL UNIQUE,
                block_height INTEGER,
                tx_kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                user_id INTEGER,
                bot_account_id INTEGER,
                wallet_id INTEGER,
                counterparty_wallet_id INTEGER,
                token_id INTEGER,
                side TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                price REAL NOT NULL DEFAULT 0,
                value_cc REAL NOT NULL DEFAULT 0,
                fee_cc REAL NOT NULL DEFAULT 0,
                memo TEXT NOT NULL DEFAULT '',
                source_table TEXT NOT NULL DEFAULT '',
                source_id INTEGER,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY(bot_account_id) REFERENCES bot_accounts(id) ON DELETE SET NULL,
                FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE SET NULL,
                FOREIGN KEY(block_height) REFERENCES explorer_blocks(height) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_explorer_txs_created ON explorer_transactions(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_explorer_txs_block ON explorer_transactions(block_height, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_explorer_txs_wallet ON explorer_transactions(wallet_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_explorer_txs_token ON explorer_transactions(token_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_explorer_txs_status ON explorer_transactions(status, created_at DESC);
            """
        )

    def _upsert_market_meta_locked(self, key: str, value: Any) -> None:
        self.conn.execute(
            "INSERT INTO market_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )

    def _seed_base_token(self) -> None:
        ts = now_ts()
        row = self._one("SELECT id FROM tokens WHERE symbol='CC'")
        if not row:
            params = {
                "volatility": 0.0,
                "drift_strength": 1.0,
                "min_price": 1.0,
                "max_price": 1.0,
                "target_price": 1.0,
                "bias": 0.0,
                "step_seconds": MARKET_STEP_SECONDS,
            }
            cur = self.conn.execute(
                """
                INSERT INTO tokens (
                    creator_user_id, creator_wallet_id, name, symbol, slug, description,
                    params_json, created_at, category, theme, website_url, launch_price,
                    volatility_profile, supply_cap, circulating_supply, metadata_json, status
                )
                VALUES (
                    NULL, NULL, 'Cortisol Coin', 'CC', 'cc', 'Base in-game currency',
                    ?, ?, 'currency', 'arcade', '', 1.0,
                    'low', ?, 0, '{}', 'active'
                )
                """,
                (json.dumps(params, separators=(",", ":")), ts, DEFAULT_TOKEN_SUPPLY_CAP),
            )
            token_id = int(cur.lastrowid)
            self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, 1.0)", (token_id, ts))
        self._upsert_market_meta_locked("last_step_ts", ts)
        self._upsert_market_meta_locked("last_block_ts", ts)
        self._migrate_legacy_cc_balances()

    def cleanup_expired_sessions(self, now: Optional[int] = None) -> int:
        now = now or now_ts()
        with self._lock, self.conn:
            cur = self.conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            return cur.rowcount

    def user_count(self) -> int:
        with self._lock:
            row = self._one("SELECT COUNT(*) AS c FROM users WHERE COALESCE(is_bot, 0)=0")
            return int(row["c"] if row else 0)

    def get_user_by_name(self, username: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, pw_salt, pw_hash, is_admin, is_bot, muted_until, banned_until, created_at "
                "FROM users WHERE lower(username)=lower(?)",
                (username,),
            )
            return dict(row) if row else None

    def resolve_username(self, name: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, is_admin, is_bot FROM users "
                "WHERE COALESCE(is_bot, 0)=0 AND (lower(username)=lower(?) OR lower(display_name)=lower(?))",
                (name, name),
            )
            return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                "SELECT id, username, display_name, is_admin, is_bot, muted_until, banned_until, created_at "
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
            wallet_address = self._new_wallet_address()
            wallet_id = self._next_wallet_id_locked()
            wallet_name = self._normalize_wallet_name("Main Wallet", fallback="Main Wallet")
            self.conn.execute(
                """
                INSERT INTO wallets (
                    address, owner_user_id, label, balance, created_at, id, user_id, name,
                    sort_order, deleted, wallet_kind
                )
                VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 0, 'user')
                """,
                (wallet_address, user_id, wallet_name, ts, wallet_id, user_id, wallet_name),
            )
            wallet_row = self._one("SELECT id FROM wallets WHERE address=?", (wallet_address,))
            if wallet_row:
                self._credit_balance_locked(int(wallet_row["id"]), self.cc_token_id(), 0.0)
        return self.get_user_by_id(user_id)  # type: ignore[return-value]

    def _new_wallet_address(self) -> str:
        seed = f"{now_ts()}:{self.user_count()}:{time.time_ns()}"
        return "cw_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]

    def _next_wallet_id_locked(self) -> int:
        row = self._one("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM wallets")
        return int(row["n"] if row else 1)

    def _next_wallet_sort_order_locked(self, user_id: Optional[int]) -> int:
        row = self._one(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM wallets "
            "WHERE ((user_id=?) OR (user_id IS NULL AND ? IS NULL)) AND COALESCE(deleted, 0)=0",
            (user_id, user_id),
        )
        return int(row["n"] if row else 0)

    def _active_wallet_rows_locked(self, user_id: int) -> List[sqlite3.Row]:
        return self._all(
            """
            SELECT id, address, user_id, name, created_at, sort_order, deleted, wallet_kind
            FROM wallets
            WHERE user_id=? AND COALESCE(deleted, 0)=0
            ORDER BY sort_order ASC, created_at ASC, id ASC
            """,
            (user_id,),
        )

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
                SELECT u.id, u.username, u.display_name, u.is_admin, u.is_bot, u.muted_until, u.banned_until, u.created_at, s.expires_at
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
            "is_bot": bool(user.get("is_bot")),
            "muted_until": int(user["muted_until"]),
            "banned_until": int(user["banned_until"]),
            "stats": user["stats"],
        }

    def list_users_brief(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT u.id, u.username, u.display_name, u.is_admin, u.is_bot, u.muted_until, u.banned_until,
                       COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses,
                       COALESCE(s.cortisol,1000) AS cortisol
                FROM users u
                LEFT JOIN stats s ON s.user_id = u.id
                WHERE COALESCE(u.is_bot, 0)=0
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
                SELECT id, username, display_name, is_admin, is_bot
                FROM users
                WHERE COALESCE(is_bot, 0)=0 AND (username LIKE ? OR display_name LIKE ?)
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
                SELECT u.id, u.username, u.display_name, u.is_bot, s.wins, s.losses, s.kos, s.deaths, s.streak, s.cortisol
                FROM users u
                JOIN stats s ON s.user_id = u.id
                WHERE COALESCE(u.is_bot, 0)=0
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

    def list_wallets_for_user(self, user_id: int) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT address, owner_user_id, label, balance, created_at, id, user_id, name, sort_order, deleted, wallet_kind
                FROM wallets
                WHERE owner_user_id=? AND COALESCE(deleted, 0)=0
                ORDER BY sort_order ASC, created_at ASC, id ASC
                """,
                (user_id,),
            )
            return [dict(r) for r in rows]

    def create_wallet(self, user_id: int, label: str = "Wallet") -> Dict[str, Any]:
        ts = now_ts()
        addr = self._new_wallet_address()
        wallet_id = self._next_wallet_id_locked()
        clean_label = self._normalize_wallet_name(label)
        with self._lock, self.conn:
            self.conn.execute(
                """
                INSERT INTO wallets (
                    address, owner_user_id, label, balance, created_at, id, user_id, name,
                    sort_order, deleted, wallet_kind
                )
                VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 'user')
                """,
                (addr, user_id, clean_label, ts, wallet_id, user_id, clean_label, self._next_wallet_sort_order_locked(user_id)),
            )
            row = self._one(
                "SELECT address, owner_user_id, label, balance, created_at, id, user_id, name, sort_order, deleted, wallet_kind FROM wallets WHERE address=?",
                (addr,),
            )
            return dict(row) if row else {"address": addr, "owner_user_id": user_id, "label": clean_label, "balance": 0, "created_at": ts}

    def get_wallet(self, address: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one(
                """
                SELECT id, address, owner_user_id, label, balance, created_at, user_id, name, sort_order, deleted, wallet_kind
                FROM wallets
                WHERE address=?
                """,
                (address,),
            )
            return dict(row) if row else None

    def transfer_wallet(self, from_address: Optional[str], to_address: str, amount: int, memo: str = "") -> bool:
        amount = int(amount)
        if amount <= 0:
            return False
        with self._lock, self.conn:
            to_wallet = self._one("SELECT address, balance FROM wallets WHERE address=?", (to_address,))
            if not to_wallet:
                return False
            if from_address:
                from_wallet = self._one("SELECT address, balance FROM wallets WHERE address=?", (from_address,))
                if not from_wallet or int(from_wallet["balance"]) < amount:
                    return False
                self.conn.execute("UPDATE wallets SET balance=balance-? WHERE address=?", (amount, from_address))
            self.conn.execute("UPDATE wallets SET balance=balance+? WHERE address=?", (amount, to_address))
            self.conn.execute(
                "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
                (from_address, to_address, amount, memo[:120], now_ts()),
            )
        return True

    def ensure_host_wallet(self) -> Dict[str, Any]:
        with self._lock, self.conn:
            row = self._one(
                """
                SELECT address, owner_user_id, label, balance, created_at, id, user_id, name, sort_order, deleted, wallet_kind
                FROM wallets
                WHERE address='host_miner'
                """
            )
            if row:
                self._credit_balance_locked(int(row["id"]), self.cc_token_id(), 0.0)
                return dict(row)
            ts = now_ts()
            wallet_id = self._next_wallet_id_locked()
            self.conn.execute(
                """
                INSERT INTO wallets (
                    address, owner_user_id, label, balance, created_at, id, user_id, name,
                    sort_order, deleted, wallet_kind
                )
                VALUES ('host_miner', NULL, 'Host Miner', 0, ?, ?, NULL, 'Host Miner', 0, 0, 'system')
                """,
                (ts, wallet_id),
            )
            self._credit_balance_locked(wallet_id, self.cc_token_id(), 0.0)
            return {
                "address": "host_miner",
                "owner_user_id": None,
                "label": "Host Miner",
                "balance": 0,
                "created_at": ts,
                "id": wallet_id,
                "user_id": None,
                "name": "Host Miner",
                "sort_order": 0,
                "deleted": 0,
                "wallet_kind": "system",
            }

    def mine_block(self, reward_amount: int = 5) -> Dict[str, Any]:
        reward_amount = max(1, int(reward_amount))
        host = self.ensure_host_wallet()
        with self._lock, self.conn:
            last = self._one("SELECT height, block_hash FROM cortisol_blocks ORDER BY height DESC LIMIT 1")
            prev_hash = str(last["block_hash"]) if last else "genesis"
            height = int(last["height"]) + 1 if last else 1
            block_hash = hashlib.sha256(f"{height}:{prev_hash}:{host['address']}:{reward_amount}:{now_ts()}".encode("utf-8")).hexdigest()
            created = now_ts()
            self.conn.execute(
                "INSERT INTO cortisol_blocks (height, prev_hash, block_hash, reward_address, reward_amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (height, prev_hash, block_hash, host["address"], reward_amount, created),
            )
            self.conn.execute("UPDATE wallets SET balance=balance+? WHERE address=?", (reward_amount, host["address"]))
            self.conn.execute(
                "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
                (None, host["address"], reward_amount, f"block_reward_{height}", created),
            )
            return {
                "height": height,
                "prev_hash": prev_hash,
                "block_hash": block_hash,
                "reward_address": host["address"],
                "reward_amount": reward_amount,
                "created_at": created,
            }

    def list_recent_blocks(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                "SELECT height, prev_hash, block_hash, reward_address, reward_amount, created_at FROM cortisol_blocks ORDER BY height DESC LIMIT ?",
                (limit,),
            )
            return [dict(r) for r in rows]

    def exchange_cortisol_for_rank(self, user_id: int, wallet_address: str, amount: int) -> bool:
        amount = max(1, int(amount))
        with self._lock, self.conn:
            wallet = self._one("SELECT owner_user_id, balance FROM wallets WHERE address=?", (wallet_address,))
            if not wallet or int(wallet["owner_user_id"] or 0) != int(user_id) or int(wallet["balance"]) < amount:
                return False
            self.conn.execute("UPDATE wallets SET balance=balance-? WHERE address=?", (amount, wallet_address))
            self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
            self.conn.execute("UPDATE stats SET cortisol=MIN(5000, cortisol + ?) WHERE user_id=?", (amount, user_id))
            self.conn.execute(
                "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
                (wallet_address, "exchange_sink", amount, "exchange_for_rank", now_ts()),
            )
            return True

    # --- Economy V2 helpers ---

    def cc_token_id(self) -> int:
        row = self._one("SELECT id FROM tokens WHERE symbol='CC'")
        if not row:
            raise KeyError("cc_token_missing")
        return int(row["id"])

    def _migrate_legacy_cc_balances(self) -> None:
        cc_id = self.cc_token_id()
        rows = self._all("SELECT id, balance FROM wallets")
        for row in rows:
            wid = int(row["id"])
            legacy_balance = float(row["balance"] or 0)
            cur = self._one("SELECT amount FROM balances WHERE wallet_id=? AND token_id=?", (wid, cc_id))
            if cur is None:
                self.conn.execute("INSERT INTO balances (wallet_id, token_id, amount) VALUES (?, ?, ?)", (wid, cc_id, max(0.0, legacy_balance)))
            else:
                amount = float(cur["amount"] or 0)
                if amount <= 0 and legacy_balance > 0:
                    self.conn.execute("UPDATE balances SET amount=? WHERE wallet_id=? AND token_id=?", (legacy_balance, wid, cc_id))
            self._sync_wallet_cc_balance_locked(wid)

    def _wallet_by_id_locked(self, wallet_id: int) -> Optional[sqlite3.Row]:
        return self._one(
            """
            SELECT id, address, user_id, owner_user_id, label, name, created_at, sort_order, deleted, wallet_kind
            FROM wallets
            WHERE id=?
            """,
            (wallet_id,),
        )

    def _wallet_by_address_locked(self, address: str) -> Optional[sqlite3.Row]:
        return self._one(
            """
            SELECT id, address, user_id, owner_user_id, label, name, created_at, sort_order, deleted, wallet_kind
            FROM wallets
            WHERE address=?
            """,
            (address,),
        )

    def _ensure_main_wallet_locked(self, user_id: int) -> int:
        row = self._one(
            """
            SELECT id
            FROM wallets
            WHERE user_id=? AND COALESCE(deleted, 0)=0
            ORDER BY sort_order ASC, created_at ASC, id ASC
            LIMIT 1
            """,
            (user_id,),
        )
        if row:
            return int(row["id"])
        ts = now_ts()
        addr = self._new_wallet_address()
        wallet_id = self._next_wallet_id_locked()
        wallet_name = self._normalize_wallet_name("Main Wallet", fallback="Main Wallet")
        self.conn.execute(
            """
            INSERT INTO wallets (
                address, owner_user_id, label, balance, created_at, id, user_id, name,
                sort_order, deleted, wallet_kind
            )
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 0, 'user')
            """,
            (addr, user_id, wallet_name, ts, wallet_id, user_id, wallet_name),
        )
        new_row = self._one("SELECT id FROM wallets WHERE address=?", (addr,))
        assert new_row is not None
        wid = int(new_row["id"])
        self._credit_balance_locked(wid, self.cc_token_id(), 0.0)
        return wid

    def _wallet_amount_locked(self, wallet_id: int, token_id: int) -> float:
        row = self._one("SELECT amount FROM balances WHERE wallet_id=? AND token_id=?", (wallet_id, token_id))
        return float(row["amount"] if row else 0.0)

    def _sync_wallet_cc_balance_locked(self, wallet_id: int) -> None:
        self.conn.execute(
            "UPDATE wallets SET balance=? WHERE id=?",
            (int(self._wallet_amount_locked(wallet_id, self.cc_token_id())), wallet_id),
        )

    def _credit_balance_locked(self, wallet_id: int, token_id: int, amount: float) -> None:
        amount = float(amount)
        cur = self._one("SELECT amount FROM balances WHERE wallet_id=? AND token_id=?", (wallet_id, token_id))
        if cur:
            self.conn.execute("UPDATE balances SET amount=? WHERE wallet_id=? AND token_id=?", (float(cur["amount"] or 0) + amount, wallet_id, token_id))
        else:
            self.conn.execute("INSERT INTO balances (wallet_id, token_id, amount) VALUES (?, ?, ?)", (wallet_id, token_id, amount))
        if int(token_id) == self.cc_token_id():
            self._sync_wallet_cc_balance_locked(wallet_id)

    def _debit_balance_locked(self, wallet_id: int, token_id: int, amount: float) -> bool:
        amount = float(amount)
        current = self._wallet_amount_locked(wallet_id, token_id)
        if current + 1e-9 < amount:
            return False
        self.conn.execute("UPDATE balances SET amount=? WHERE wallet_id=? AND token_id=?", (current - amount, wallet_id, token_id))
        if int(token_id) == self.cc_token_id():
            self._sync_wallet_cc_balance_locked(wallet_id)
        return True

    def _wallet_tokens_locked(self, wallet_id: int) -> List[Dict[str, Any]]:
        rows = self._all(
            """
            SELECT b.token_id, b.amount, t.name, t.symbol, t.slug, t.description, t.category, t.theme, t.icon_file_id,
                   (SELECT p.price FROM prices p WHERE p.token_id=b.token_id ORDER BY p.ts DESC, p.id DESC LIMIT 1) AS price
            FROM balances b
            JOIN tokens t ON t.id = b.token_id
            WHERE b.wallet_id=? AND (b.amount > 0.0000001 OR t.symbol='CC')
            ORDER BY CASE WHEN t.symbol='CC' THEN 0 ELSE 1 END, t.symbol ASC
            """,
            (wallet_id,),
        )
        out: List[Dict[str, Any]] = []
        for row in rows:
            price = float(row["price"] or 0)
            amount = float(row["amount"] or 0)
            out.append(
                {
                    "token_id": int(row["token_id"]),
                    "name": row["name"],
                    "symbol": row["symbol"],
                    "slug": row["slug"],
                    "description": row["description"],
                    "category": row["category"],
                    "theme": row["theme"],
                    "icon_file_id": row["icon_file_id"],
                    "amount": round(amount, 6),
                    "price": round(price, 6),
                    "value_cc": round(amount * price, 6),
                }
            )
        return out

    def _wallet_total_cc_locked(self, wallet_id: int) -> float:
        total = 0.0
        for tok in self._wallet_tokens_locked(wallet_id):
            total += float(tok["value_cc"])
        return total

    def _wallet_activity_locked(self, wallet_id: int, limit: int = 40) -> List[Dict[str, Any]]:
        rows = self._all(
            """
            SELECT id, user_id, wallet_id, kind, delta_cortisol, delta_cc, meta_json, ts
            FROM transactions
            WHERE wallet_id=?
            ORDER BY ts DESC, id DESC
            LIMIT ?
            """,
            (wallet_id, limit),
        )
        out = []
        for row in rows:
            item = dict(row)
            try:
                item["meta"] = json.loads(item.pop("meta_json") or "{}")
            except Exception:
                item["meta"] = {}
            out.append(item)
        return out

    def _wallet_payload_locked(self, wallet_row: sqlite3.Row) -> Dict[str, Any]:
        wallet_id = int(wallet_row["id"])
        tokens = self._wallet_tokens_locked(wallet_id)
        return {
            "id": wallet_id,
            "address": wallet_row["address"],
            "name": wallet_row["name"] or wallet_row["label"] or "Wallet",
            "created_at": int(wallet_row["created_at"]),
            "sort_order": int(wallet_row["sort_order"] or 0),
            "wallet_kind": wallet_row["wallet_kind"] or "user",
            "deleted": bool(wallet_row["deleted"]),
            "tokens": tokens,
            "total_value_cc": round(sum(float(t["value_cc"]) for t in tokens), 6),
            "activity": self._wallet_activity_locked(wallet_id, limit=20),
        }

    def list_wallets_v2(self, user_id: int) -> List[Dict[str, Any]]:
        with self._lock, self.conn:
            self._ensure_main_wallet_locked(user_id)
            rows = self._all(
                """
                SELECT id, address, user_id, owner_user_id, label, name, created_at, sort_order, deleted, wallet_kind
                FROM wallets
                WHERE user_id=? AND COALESCE(deleted, 0)=0
                ORDER BY sort_order ASC, created_at ASC, id ASC
                """,
                (user_id,),
            )
            return [self._wallet_payload_locked(row) for row in rows]

    def create_wallet_v2(self, user_id: int, name: str = "Wallet") -> Dict[str, Any]:
        clean = self._normalize_wallet_name(name)
        ts = now_ts()
        addr = self._new_wallet_address()
        wallet_id = self._next_wallet_id_locked()
        with self._lock, self.conn:
            self.conn.execute(
                """
                INSERT INTO wallets (
                    address, owner_user_id, label, balance, created_at, id, user_id, name,
                    sort_order, deleted, wallet_kind
                )
                VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 'user')
                """,
                (addr, user_id, clean, ts, wallet_id, user_id, clean, self._next_wallet_sort_order_locked(user_id)),
            )
            row = self._one(
                """
                SELECT id, address, user_id, owner_user_id, label, name, created_at, sort_order, deleted, wallet_kind
                FROM wallets
                WHERE address=?
                """,
                (addr,),
            )
            assert row is not None
            self._credit_balance_locked(int(row["id"]), self.cc_token_id(), 0.0)
            return self._wallet_payload_locked(row)

    def rename_wallet_v2(self, user_id: int, wallet_id: int, name: str) -> Optional[Dict[str, Any]]:
        clean = self._normalize_wallet_name(name)
        with self._lock, self.conn:
            row = self._wallet_by_id_locked(wallet_id)
            if not row or bool(row["deleted"]) or int(row["user_id"] or 0) != int(user_id):
                return None
            self.conn.execute("UPDATE wallets SET name=?, label=? WHERE id=?", (clean, clean, wallet_id))
            updated = self._wallet_by_id_locked(wallet_id)
            return self._wallet_payload_locked(updated) if updated else None

    def reorder_wallets_v2(self, user_id: int, wallet_ids: List[int]) -> List[Dict[str, Any]]:
        with self._lock, self.conn:
            rows = self._active_wallet_rows_locked(user_id)
            current_ids = [int(row["id"]) for row in rows]
            seen: Set[int] = set()
            ordered = []
            for wallet_id in wallet_ids:
                if wallet_id in current_ids and wallet_id not in seen:
                    ordered.append(wallet_id)
                    seen.add(wallet_id)
            ordered.extend(wallet_id for wallet_id in current_ids if wallet_id not in seen)
            for idx, wallet_id in enumerate(ordered):
                self.conn.execute("UPDATE wallets SET sort_order=? WHERE id=?", (idx, wallet_id))
            rows = self._active_wallet_rows_locked(user_id)
            return [self._wallet_payload_locked(row) for row in rows]

    def delete_wallet_v2(self, user_id: int, wallet_id: int) -> Optional[Dict[str, Any]]:
        with self._lock, self.conn:
            wallets = self._active_wallet_rows_locked(user_id)
            if len(wallets) <= 1:
                return None
            doomed = next((row for row in wallets if int(row["id"]) == int(wallet_id)), None)
            if not doomed:
                return None
            fallback = next((row for row in wallets if int(row["id"]) != int(wallet_id)), None)
            if not fallback:
                return None
            fallback_id = int(fallback["id"])
            for row in self._all("SELECT token_id, amount FROM balances WHERE wallet_id=? AND amount > 0.0000001", (wallet_id,)):
                token_id = int(row["token_id"])
                amount = float(row["amount"] or 0.0)
                if amount <= 0:
                    continue
                self._credit_balance_locked(fallback_id, token_id, amount)
                self.conn.execute("UPDATE balances SET amount=0 WHERE wallet_id=? AND token_id=?", (wallet_id, token_id))
                meta = {
                    "from_wallet_id": int(wallet_id),
                    "to_wallet_id": fallback_id,
                    "token_id": token_id,
                    "amount": amount,
                    "reason": "wallet_delete",
                }
                self._insert_transaction_locked(user_id, int(wallet_id), "wallet_delete_out", 0, 0.0, meta)
                self._insert_transaction_locked(user_id, fallback_id, "wallet_delete_in", 0, 0.0, meta)
                self._insert_explorer_transaction_locked(
                    tx_kind="wallet_delete_merge",
                    user_id=user_id,
                    wallet_id=int(wallet_id),
                    counterparty_wallet_id=fallback_id,
                    token_id=token_id,
                    side="merge",
                    amount=amount,
                    price=1.0 if token_id == self.cc_token_id() else self._token_price_locked(token_id),
                    value_cc=amount if token_id == self.cc_token_id() else amount * self._token_price_locked(token_id),
                    memo="wallet delete merge",
                    meta=meta,
                )
            self.conn.execute("UPDATE wallets SET deleted=1 WHERE id=?", (wallet_id,))
            self._normalize_wallet_sort_order_locked(user_id)
            return {
                "deleted_wallet_id": int(wallet_id),
                "fallback_wallet_id": fallback_id,
                "wallets": self.list_wallets_v2(user_id),
            }

    def wallet_transfer_v2(self, user_id: int, from_wallet_id: int, to_wallet_id: int, token_id: int, amount: float) -> Optional[Dict[str, Any]]:
        amount = float(amount)
        if amount <= 0:
            return None
        with self._lock, self.conn:
            from_row = self._wallet_by_id_locked(from_wallet_id)
            to_row = self._wallet_by_id_locked(to_wallet_id)
            if not from_row or not to_row:
                return None
            if bool(from_row["deleted"]) or bool(to_row["deleted"]):
                return None
            if int(from_row["user_id"] or 0) != int(user_id):
                return None
            if int(from_row["id"]) == int(to_row["id"]):
                return None
            if not self._debit_balance_locked(int(from_row["id"]), token_id, amount):
                return None
            self._credit_balance_locked(int(to_row["id"]), token_id, amount)
            token_row = self._one("SELECT id, symbol, name FROM tokens WHERE id=?", (token_id,))
            if not token_row:
                return None
            price = 1.0 if int(token_id) == self.cc_token_id() else self._token_price_locked(int(token_id))
            meta = {
                "from_wallet_id": int(from_row["id"]),
                "to_wallet_id": int(to_row["id"]),
                "token_id": token_id,
                "symbol": token_row["symbol"],
                "amount": amount,
            }
            self._insert_transaction_locked(user_id, int(from_row["id"]), "wallet_transfer_out", 0, 0.0, meta)
            to_user_id = int(to_row["user_id"] or 0)
            if to_user_id:
                self._insert_transaction_locked(to_user_id, int(to_row["id"]), "wallet_transfer_in", 0, 0.0, meta)
            if int(token_id) == self.cc_token_id():
                self.conn.execute(
                    "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
                    (from_row["address"], to_row["address"], int(amount), "wallet_transfer_v2", now_ts()),
                )
            tx_id = self._insert_explorer_transaction_locked(
                tx_kind="wallet_transfer",
                user_id=user_id,
                wallet_id=int(from_row["id"]),
                counterparty_wallet_id=int(to_row["id"]),
                token_id=int(token_id),
                side="transfer",
                amount=amount,
                price=price,
                value_cc=amount * price,
                memo="wallet transfer",
                meta=meta,
            )
            return {
                "token_id": int(token_id),
                "symbol": token_row["symbol"],
                "amount": round(amount, 6),
                "from_wallet_id": int(from_row["id"]),
                "to_wallet_id": int(to_row["id"]),
                "from_wallet": self._wallet_payload_locked(from_row),
                "to_wallet": self._wallet_payload_locked(to_row),
                "explorer_transaction_id": tx_id,
            }

    def _insert_transaction_locked(self, user_id: int, wallet_id: Optional[int], kind: str, delta_cortisol: int, delta_cc: float, meta: Dict[str, Any]) -> None:
        self.conn.execute(
            "INSERT INTO transactions (user_id, wallet_id, kind, delta_cortisol, delta_cc, meta_json, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, wallet_id, kind, int(delta_cortisol), float(delta_cc), json.dumps(meta, separators=(",", ":")), now_ts()),
        )

    def exchange_cortisol_cc(self, user_id: int, wallet_id: int, kind: str, amount: int) -> Optional[Dict[str, Any]]:
        amount = int(amount)
        if amount <= 0:
            return None
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or int(wallet["user_id"] or 0) != int(user_id):
                return None
            self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
            stats = self._one("SELECT cortisol FROM stats WHERE user_id=?", (user_id,))
            assert stats is not None
            cortisol_before = int(stats["cortisol"])
            cc_id = self.cc_token_id()
            cc_before = self._wallet_amount_locked(wallet_id, cc_id)

            fee = 0.02
            delta_cortisol = 0
            delta_cc = 0.0

            if kind == "stress_for_coins":
                delta_cortisol = min(amount, max(0, 5000 - cortisol_before))
                if delta_cortisol <= 0:
                    return None
                rate = 0.05 + (cortisol_before / 20000.0)
                gain_cc = math.floor(delta_cortisol * rate * (1.0 - fee))
                if gain_cc <= 0:
                    return None
                cortisol_after = min(5000, cortisol_before + delta_cortisol)
                cc_after = cc_before + float(gain_cc)
                delta_cc = float(gain_cc)
                meta = {"kind": kind, "rate": rate, "fee": fee, "delta_cortisol": delta_cortisol, "gain_cc": gain_cc}
            elif kind == "coins_for_calm":
                spend = min(amount, int(cc_before))
                if spend <= 0:
                    return None
                calm_per_coin = 2.4 - min(0.9, cortisol_before / 6000.0)
                calm_delta = math.floor(spend * calm_per_coin * (1.0 - fee))
                if calm_delta <= 0:
                    return None
                cortisol_after = max(0, cortisol_before - calm_delta)
                cc_after = cc_before - float(spend)
                delta_cortisol = cortisol_after - cortisol_before
                delta_cc = -float(spend)
                meta = {"kind": kind, "calm_per_coin": calm_per_coin, "fee": fee, "coins_spent": spend, "calm_delta": calm_delta}
            else:
                return None

            self.conn.execute("UPDATE stats SET cortisol=? WHERE user_id=?", (int(cortisol_after), user_id))
            self.conn.execute("UPDATE balances SET amount=? WHERE wallet_id=? AND token_id=?", (float(cc_after), wallet_id, cc_id))
            self.conn.execute("UPDATE wallets SET balance=? WHERE id=?", (int(cc_after), wallet_id))
            self._insert_transaction_locked(user_id, wallet_id, "cortisol_exchange", int(cortisol_after - cortisol_before), float(delta_cc), meta)

            return {
                "cortisol_before": cortisol_before,
                "cortisol_after": int(cortisol_after),
                "delta_cortisol": int(cortisol_after - cortisol_before),
                "cc_before": round(cc_before, 4),
                "cc_after": round(float(cc_after), 4),
                "delta_cc": round(float(delta_cc), 4),
                "tier": cortisol_tier(int(cortisol_after)),
            }

    def apply_arena_match_results(self, results: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
        summary: Dict[int, Dict[str, Any]] = {}
        with self._lock, self.conn:
            cc_id = self.cc_token_id()
            for row in results:
                uid = int(row.get("user_id") or 0)
                if not uid:
                    continue
                win = bool(row.get("win"))
                kos = int(row.get("kos") or 0)
                deaths = int(row.get("deaths") or 0)
                cc_earned = max(0, int(row.get("cc_earned") or 0))

                self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (uid,))
                stats = self._one("SELECT wins, losses, kos, deaths, streak, cortisol FROM stats WHERE user_id=?", (uid,))
                assert stats is not None
                wins = int(stats["wins"])
                losses = int(stats["losses"])
                total_kos = int(stats["kos"]) + kos
                total_deaths = int(stats["deaths"]) + deaths
                streak = int(stats["streak"])
                cortisol_before = int(stats["cortisol"])
                if win:
                    wins += 1
                    cortisol_after = max(0, cortisol_before - (30 + 5 * min(streak, 6)))
                    streak += 1
                else:
                    losses += 1
                    cortisol_after = min(5000, cortisol_before + 18)
                    streak = 0

                self.conn.execute(
                    "UPDATE stats SET wins=?, losses=?, kos=?, deaths=?, streak=?, cortisol=? WHERE user_id=?",
                    (wins, losses, total_kos, total_deaths, streak, int(cortisol_after), uid),
                )

                wallet_id = self._ensure_main_wallet_locked(uid)
                if cc_earned > 0:
                    self._credit_balance_locked(wallet_id, cc_id, float(cc_earned))
                cc_new = self._wallet_amount_locked(wallet_id, cc_id)
                self.conn.execute("UPDATE wallets SET balance=? WHERE id=?", (int(cc_new), wallet_id))

                self._insert_transaction_locked(
                    uid,
                    wallet_id,
                    "arena_match",
                    int(cortisol_after - cortisol_before),
                    float(cc_earned),
                    {
                        "win": win,
                        "kos": kos,
                        "deaths": deaths,
                        "cc_earned": cc_earned,
                    },
                )

                summary[uid] = {
                    "cortisol_before": cortisol_before,
                    "cortisol_after": int(cortisol_after),
                    "cortisol_delta": int(cortisol_after - cortisol_before),
                    "cc_credited": cc_earned,
                }
        return summary

    def _default_token_params(self, volatility_key: str, initial_price: float = 10.0) -> Dict[str, Any]:
        vkey = (volatility_key or "medium").lower()
        if vkey == "low":
            volatility = 0.008
            drift_strength = 42.0
        elif vkey == "high":
            volatility = 0.03
            drift_strength = 18.0
        else:
            volatility = 0.016
            drift_strength = 28.0
        return {
            "volatility": volatility,
            "drift_strength": drift_strength,
            "min_price": 0.25,
            "max_price": 500.0,
            "target_price": float(initial_price),
            "bias": 0.0,
            "step_seconds": 2,
        }

    def _parse_params(self, raw: str) -> Dict[str, Any]:
        try:
            parsed = json.loads(raw or "{}")
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return self._default_token_params("medium")

    def _det_noise(self, token_id: int, step_index: int) -> float:
        seed = hashlib.sha256(f"{token_id}:{step_index}".encode("utf-8")).hexdigest()[:8]
        val = int(seed, 16) / float(0xFFFFFFFF)
        return (val - 0.5) * 2.0

    def advance_market(self, now: Optional[int] = None, max_steps: int = 180) -> None:
        now = int(now or now_ts())
        with self._lock, self.conn:
            row = self._one("SELECT value FROM market_meta WHERE key='last_step_ts'")
            last_step = int(row["value"]) if row else now
            if last_step <= 0:
                last_step = now
            step_seconds = 2
            steps = max(0, min(max_steps, (now - last_step) // step_seconds))
            if steps <= 0:
                return

            token_rows = self._all("SELECT id, symbol, params_json FROM tokens")
            for i in range(1, steps + 1):
                step_ts = last_step + (i * step_seconds)
                for token in token_rows:
                    token_id = int(token["id"])
                    if token["symbol"] == "CC":
                        self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, 1.0)", (token_id, step_ts))
                        continue
                    params = self._parse_params(token["params_json"])
                    prev = self._one("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 1", (token_id,))
                    prev_price = float(prev["price"] if prev else params.get("target_price", 10.0))
                    target = float(params.get("target_price", 10.0))
                    drift_k = max(1.0, float(params.get("drift_strength", 25.0)))
                    bias = float(params.get("bias", 0.0))
                    vol = max(0.0001, float(params.get("volatility", 0.01)))
                    min_price = max(0.01, float(params.get("min_price", 0.1)))
                    max_price = max(min_price + 0.01, float(params.get("max_price", 500.0)))
                    noise = self._det_noise(token_id, step_ts)
                    drift = ((target - prev_price) / drift_k) / max(target, 1.0) + bias
                    trend_burst = math.sin((step_ts + (token_id * 97)) / 37.0) * vol * 0.35
                    shock = (noise * vol) + trend_burst
                    next_price = prev_price * math.exp(drift + shock)
                    next_price = clamp(next_price, min_price, max_price)
                    self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, ?)", (token_id, step_ts, float(next_price)))

            self.conn.execute(
                "INSERT INTO market_meta (key, value) VALUES ('last_step_ts', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(last_step + (steps * step_seconds)),),
            )

    def market_snapshot(self, user_id: int, wallet_id: Optional[int] = None) -> Dict[str, Any]:
        self.advance_market()
        with self._lock, self.conn:
            if wallet_id is None:
                wallet_id = self._ensure_main_wallet_locked(user_id)
            wallet = self._wallet_by_id_locked(int(wallet_id))
            if not wallet or int(wallet["user_id"] or 0) != int(user_id):
                wallet_id = self._ensure_main_wallet_locked(user_id)
                wallet = self._wallet_by_id_locked(int(wallet_id))
            assert wallet is not None

            rows = self._all("SELECT id, creator_user_id, name, symbol, description, params_json, created_at FROM tokens ORDER BY CASE WHEN symbol='CC' THEN 0 ELSE 1 END, created_at ASC")
            tokens: List[Dict[str, Any]] = []
            for row in rows:
                tid = int(row["id"])
                params = self._parse_params(row["params_json"])
                last_price = self._one("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 1", (tid,))
                history_rows = self._all("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 40", (tid,))
                history = [round(float(r["price"]), 6) for r in reversed(history_rows)]
                bal = self._wallet_amount_locked(int(wallet["id"]), tid)
                tokens.append(
                    {
                        "id": tid,
                        "creator_user_id": row["creator_user_id"],
                        "name": row["name"],
                        "symbol": row["symbol"],
                        "description": row["description"],
                        "params": params,
                        "price": round(float(last_price["price"] if last_price else 0.0), 6),
                        "history": history,
                        "wallet_amount": round(bal, 6),
                    }
                )

            return {
                "wallet": self._wallet_payload_locked(wallet),
                "tokens": tokens,
                "simulation_note": "Simulation only. No real money.",
            }

    def execute_trade(self, user_id: int, wallet_id: int, token_id: int, side: str, amount: float) -> Optional[Dict[str, Any]]:
        side = (side or "").lower()
        amount = float(amount)
        if side not in {"buy", "sell"} or amount <= 0:
            return None
        self.advance_market()
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or int(wallet["user_id"] or 0) != int(user_id):
                return None
            token = self._one("SELECT id, symbol, name FROM tokens WHERE id=?", (token_id,))
            if not token:
                return None
            price_row = self._one("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 1", (token_id,))
            if not price_row:
                return None
            price = float(price_row["price"])
            cc_id = self.cc_token_id()
            if int(token_id) == cc_id:
                return None
            fee = 0.01

            if side == "buy":
                cc_cost = amount * price
                total = cc_cost * (1.0 + fee)
                if not self._debit_balance_locked(wallet_id, cc_id, total):
                    return None
                self._credit_balance_locked(wallet_id, int(token_id), amount)
                delta_cc = -total
            else:
                if not self._debit_balance_locked(wallet_id, int(token_id), amount):
                    return None
                proceeds = amount * price * (1.0 - fee)
                self._credit_balance_locked(wallet_id, cc_id, proceeds)
                delta_cc = proceeds

            ts = now_ts()
            self.conn.execute(
                "INSERT INTO trades (user_id, wallet_id, token_id, side, amount, price, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, wallet_id, token_id, side, amount, price, ts),
            )
            cc_new = self._wallet_amount_locked(wallet_id, cc_id)
            self.conn.execute("UPDATE wallets SET balance=? WHERE id=?", (int(cc_new), wallet_id))
            self._insert_transaction_locked(
                user_id,
                wallet_id,
                "trade",
                0,
                float(delta_cc),
                {"side": side, "token_id": int(token_id), "symbol": token["symbol"], "amount": amount, "price": price, "fee": fee},
            )

            return {
                "token_id": int(token_id),
                "symbol": token["symbol"],
                "side": side,
                "amount": round(amount, 6),
                "price": round(price, 6),
                "delta_cc": round(float(delta_cc), 6),
                "wallet": self._wallet_payload_locked(wallet),
            }

    def create_token(self, user_id: int, wallet_id: int, name: str, symbol: str, description: str, volatility: str, theme: str) -> Optional[Dict[str, Any]]:
        clean_name = (name or "").strip()[:40]
        clean_symbol = "".join(ch for ch in (symbol or "").upper() if ch.isalnum())[:8]
        clean_desc = (description or "").strip()[:240]
        if len(clean_name) < 2 or len(clean_symbol) < 2 or clean_symbol == "CC":
            return None

        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or int(wallet["user_id"] or 0) != int(user_id):
                return None
            exists = self._one("SELECT id FROM tokens WHERE symbol=?", (clean_symbol,))
            if exists:
                return None
            params = self._default_token_params(volatility, initial_price=10.0)
            params["theme"] = (theme or "default")[:24]
            ts = now_ts()
            cur = self.conn.execute(
                "INSERT INTO tokens (creator_user_id, name, symbol, description, params_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, clean_name, clean_symbol, clean_desc, json.dumps(params, separators=(",", ":")), ts),
            )
            token_id = int(cur.lastrowid)
            self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, ?)", (token_id, ts, 10.0))
            airdrop = 25.0
            self._credit_balance_locked(wallet_id, token_id, airdrop)
            self._insert_transaction_locked(
                user_id,
                wallet_id,
                "token_airdrop",
                0,
                0.0,
                {"token_id": token_id, "symbol": clean_symbol, "amount": airdrop, "theme": params["theme"]},
            )
            return {
                "id": token_id,
                "name": clean_name,
                "symbol": clean_symbol,
                "description": clean_desc,
                "price": 10.0,
                "airdrop": airdrop,
                "params": params,
            }

    # --- Compatibility wrappers ---

    def wallets_api_payload(self, user_id: int) -> Dict[str, Any]:
        wallets = self.list_wallets_v2(user_id)
        with self._lock:
            tx_rows = self._all(
                "SELECT id, user_id, wallet_id, kind, delta_cortisol, delta_cc, meta_json, ts FROM transactions WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT 60",
                (user_id,),
            )
        tx = []
        for row in tx_rows:
            item = dict(row)
            try:
                item["meta"] = json.loads(item.pop("meta_json") or "{}")
            except Exception:
                item["meta"] = {}
            tx.append(item)
        return {
            "wallets": wallets,
            "default_wallet_id": wallets[0]["id"] if wallets else None,
            "transactions": tx,
        }

    def _resolve_token_locked(self, token_ref: Any) -> Optional[sqlite3.Row]:
        ref = str(token_ref or "").strip()
        if not ref:
            return None
        if ref.isdigit():
            row = self._one(
                """
                SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                       category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                       supply_cap, circulating_supply, metadata_json, status
                FROM tokens
                WHERE id=?
                """,
                (int(ref),),
            )
            if row:
                return row
        return self._one(
            """
            SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                   category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                   supply_cap, circulating_supply, metadata_json, status
            FROM tokens
            WHERE lower(symbol)=lower(?) OR lower(slug)=lower(?)
            """,
            (ref, ref),
        )

    def _token_price_locked(self, token_id: int) -> float:
        row = self._one("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 1", (token_id,))
        return float(row["price"] if row else 0.0)

    def _token_price_history_locked(self, token_id: int, limit: int = 40) -> List[float]:
        rows = self._all("SELECT price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT ?", (token_id, limit))
        return [round(float(row["price"]), 6) for row in reversed(rows)]

    def _basic_user_ref_locked(self, user_id: Optional[int]) -> Optional[Dict[str, Any]]:
        if not user_id:
            return None
        row = self._one("SELECT id, username, display_name, is_admin, is_bot FROM users WHERE id=?", (int(user_id),))
        return dict(row) if row else None

    def _basic_wallet_ref_locked(self, wallet_id: Optional[int]) -> Optional[Dict[str, Any]]:
        if not wallet_id:
            return None
        row = self._wallet_by_id_locked(int(wallet_id))
        if not row:
            return None
        return {
            "id": int(row["id"]),
            "address": row["address"],
            "name": row["name"] or row["label"] or "Wallet",
            "wallet_kind": row["wallet_kind"] or "user",
            "deleted": bool(row["deleted"]),
            "owner": self._basic_user_ref_locked(int(row["user_id"] or 0) or None),
        }

    def _basic_token_ref_locked(self, token_id: Optional[int]) -> Optional[Dict[str, Any]]:
        if not token_id:
            return None
        row = self._resolve_token_locked(token_id)
        if not row:
            return None
        return {
            "id": int(row["id"]),
            "symbol": row["symbol"],
            "name": row["name"],
            "slug": row["slug"],
            "price": round(self._token_price_locked(int(row["id"])), 6),
            "category": row["category"],
            "theme": row["theme"],
        }

    def _token_base_payload_locked(
        self,
        token_row: sqlite3.Row,
        *,
        wallet_id: Optional[int] = None,
        history_limit: int = 40,
    ) -> Dict[str, Any]:
        token_id = int(token_row["id"])
        params = self._parse_params(token_row["params_json"])
        metadata: Dict[str, Any]
        try:
            parsed_meta = json.loads(token_row["metadata_json"] or "{}")
            metadata = parsed_meta if isinstance(parsed_meta, dict) else {}
        except Exception:
            metadata = {}
        history = self._token_price_history_locked(token_id, limit=history_limit)
        price = history[-1] if history else round(float(token_row["launch_price"] or 0.0), 6)
        baseline = history[-12] if len(history) >= 12 else (history[0] if history else price)
        change_pct = 0.0 if baseline <= 0 else ((price - baseline) / baseline) * 100.0
        volume_row = self._one(
            "SELECT COALESCE(SUM(ABS(value_cc)), 0) AS v FROM explorer_transactions WHERE token_id=? AND tx_kind='trade'",
            (token_id,),
        )
        holder_row = self._one(
            "SELECT COUNT(*) AS c FROM balances WHERE token_id=? AND amount > 0.0000001",
            (token_id,),
        )
        circulating_supply = round(float(token_row["circulating_supply"] or 0.0), 6)
        wallet_amount = round(self._wallet_amount_locked(int(wallet_id), token_id), 6) if wallet_id else 0.0
        creator = self._basic_user_ref_locked(int(token_row["creator_user_id"] or 0) or None)
        return {
            "id": token_id,
            "creator_user_id": int(token_row["creator_user_id"] or 0) or None,
            "creator_wallet_id": int(token_row["creator_wallet_id"] or 0) or None,
            "creator": creator,
            "creator_is_bot": bool(creator and creator.get("is_bot")),
            "name": token_row["name"],
            "symbol": token_row["symbol"],
            "slug": token_row["slug"],
            "description": token_row["description"],
            "category": token_row["category"],
            "theme": token_row["theme"],
            "website_url": token_row["website_url"],
            "icon_file_id": int(token_row["icon_file_id"] or 0) or None,
            "launch_price": round(float(token_row["launch_price"] or 0.0), 6),
            "volatility_profile": token_row["volatility_profile"],
            "supply_cap": round(float(token_row["supply_cap"] or 0.0), 6),
            "circulating_supply": circulating_supply,
            "market_cap_cc": round(circulating_supply * price, 6),
            "holder_count": int(holder_row["c"] if holder_row else 0),
            "price": round(price, 6),
            "change_pct": round(change_pct, 4),
            "volume_cc": round(float(volume_row["v"] if volume_row else 0.0), 6),
            "wallet_amount": wallet_amount,
            "wallet_value_cc": round(wallet_amount * price, 6),
            "history": history,
            "params": params,
            "metadata": metadata,
            "status": token_row["status"],
            "created_at": int(token_row["created_at"]),
        }

    def _token_detail_payload_locked(self, token_row: sqlite3.Row, *, wallet_id: Optional[int] = None) -> Dict[str, Any]:
        payload = self._token_base_payload_locked(token_row, wallet_id=wallet_id, history_limit=80)
        token_id = int(token_row["id"])
        trade_rows = self._all(
            "SELECT * FROM explorer_transactions WHERE token_id=? AND tx_kind='trade' ORDER BY created_at DESC, id DESC LIMIT 20",
            (token_id,),
        )
        holder_rows = self._all(
            """
            SELECT b.wallet_id, b.amount
            FROM balances b
            JOIN wallets w ON w.id = b.wallet_id
            WHERE b.token_id=? AND b.amount > 0.0000001
            ORDER BY b.amount DESC
            LIMIT 10
            """,
            (token_id,),
        )
        payload["recent_trades"] = [self._explorer_transaction_payload_from_row_locked(row) for row in trade_rows]
        payload["top_holders"] = [
            {
                "wallet": self._basic_wallet_ref_locked(int(row["wallet_id"])),
                "amount": round(float(row["amount"] or 0.0), 6),
                "value_cc": round(float(row["amount"] or 0.0) * payload["price"], 6),
            }
            for row in holder_rows
        ]
        return payload

    def _wallet_list_item_locked(self, wallet_row: sqlite3.Row) -> Dict[str, Any]:
        wallet_id = int(wallet_row["id"])
        token_count_row = self._one(
            "SELECT COUNT(*) AS c FROM balances WHERE wallet_id=? AND amount > 0.0000001",
            (wallet_id,),
        )
        last_activity_row = self._one(
            """
            SELECT created_at
            FROM explorer_transactions
            WHERE wallet_id=? OR counterparty_wallet_id=?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (wallet_id, wallet_id),
        )
        return {
            "id": wallet_id,
            "address": wallet_row["address"],
            "name": wallet_row["name"] or wallet_row["label"] or "Wallet",
            "wallet_kind": wallet_row["wallet_kind"] or "user",
            "deleted": bool(wallet_row["deleted"]),
            "owner": self._basic_user_ref_locked(int(wallet_row["user_id"] or 0) or None),
            "sort_order": int(wallet_row["sort_order"] or 0),
            "created_at": int(wallet_row["created_at"]),
            "cc_balance": round(self._wallet_amount_locked(wallet_id, self.cc_token_id()), 6),
            "token_count": int(token_count_row["c"] if token_count_row else 0),
            "total_value_cc": round(self._wallet_total_cc_locked(wallet_id), 6),
            "last_activity_at": int(last_activity_row["created_at"] if last_activity_row else wallet_row["created_at"]),
        }

    def _explorer_transaction_payload_from_row_locked(self, row: sqlite3.Row) -> Dict[str, Any]:
        item = dict(row)
        try:
            meta = json.loads(item.pop("meta_json") or "{}")
            item["meta"] = meta if isinstance(meta, dict) else {}
        except Exception:
            item["meta"] = {}
        item["user"] = self._basic_user_ref_locked(int(item["user_id"] or 0) or None)
        item["wallet"] = self._basic_wallet_ref_locked(int(item["wallet_id"] or 0) or None)
        item["counterparty_wallet"] = self._basic_wallet_ref_locked(int(item["counterparty_wallet_id"] or 0) or None)
        item["token"] = self._basic_token_ref_locked(int(item["token_id"] or 0) or None)
        if item.get("bot_account_id"):
            bot_row = self._one(
                "SELECT id, slug, strategy, risk_level, last_action_at FROM bot_accounts WHERE id=?",
                (int(item["bot_account_id"]),),
            )
            item["bot"] = dict(bot_row) if bot_row else None
        else:
            item["bot"] = None
        return item

    def _insert_explorer_transaction_locked(
        self,
        *,
        tx_kind: str,
        user_id: Optional[int] = None,
        bot_account_id: Optional[int] = None,
        wallet_id: Optional[int] = None,
        counterparty_wallet_id: Optional[int] = None,
        token_id: Optional[int] = None,
        side: str = "",
        amount: float = 0.0,
        price: float = 0.0,
        value_cc: float = 0.0,
        fee_cc: float = 0.0,
        memo: str = "",
        meta: Optional[Dict[str, Any]] = None,
        tx_hash: Optional[str] = None,
        block_height: Optional[int] = None,
        status: str = "pending",
        source_table: str = "",
        source_id: Optional[int] = None,
        created_at: Optional[int] = None,
    ) -> int:
        created_at = int(created_at or now_ts())
        if block_height is not None:
            status = "confirmed"
        if not tx_hash:
            seed = (
                f"{tx_kind}:{user_id}:{bot_account_id}:{wallet_id}:{counterparty_wallet_id}:{token_id}:"
                f"{side}:{amount}:{price}:{value_cc}:{created_at}:{time.time_ns()}"
            )
            tx_hash = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]
        cur = self.conn.execute(
            """
            INSERT OR IGNORE INTO explorer_transactions (
                tx_hash, block_height, tx_kind, status, user_id, bot_account_id, wallet_id,
                counterparty_wallet_id, token_id, side, amount, price, value_cc, fee_cc,
                memo, source_table, source_id, meta_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tx_hash,
                block_height,
                tx_kind,
                status,
                user_id,
                bot_account_id,
                wallet_id,
                counterparty_wallet_id,
                token_id,
                side,
                float(amount),
                float(price),
                float(value_cc),
                float(fee_cc),
                memo[:160],
                source_table,
                source_id,
                json.dumps(meta or {}, separators=(",", ":")),
                created_at,
            ),
        )
        if cur.lastrowid:
            return int(cur.lastrowid)
        row = self._one("SELECT id FROM explorer_transactions WHERE tx_hash=?", (tx_hash,))
        if not row:
            raise KeyError("explorer_transaction_insert_failed")
        return int(row["id"])

    def _find_block_height_for_ts_locked(self, ts: int) -> Optional[int]:
        row = self._one(
            "SELECT height FROM explorer_blocks WHERE created_at<=? ORDER BY created_at DESC, height DESC LIMIT 1",
            (int(ts),),
        )
        return int(row["height"]) if row else None

    def _backfill_explorer_history(self) -> None:
        with self._lock, self.conn:
            marker = self._one("SELECT value FROM market_meta WHERE key='explorer_backfill_v2'")
            if marker and str(marker["value"]) == "1":
                return
            cc_id = self.cc_token_id()
            for row in self._all(
                "SELECT height, prev_hash, block_hash, reward_address, reward_amount, created_at FROM cortisol_blocks ORDER BY height ASC"
            ):
                miner_wallet = self._wallet_by_address_locked(str(row["reward_address"]))
                miner_wallet_id = int(miner_wallet["id"]) if miner_wallet else None
                self.conn.execute(
                    """
                    INSERT OR IGNORE INTO explorer_blocks (
                        height, prev_hash, block_hash, miner_wallet_id, reward_address,
                        reward_amount, tx_count, volume_cc, created_at, meta_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(row["height"]),
                        row["prev_hash"],
                        row["block_hash"],
                        miner_wallet_id,
                        row["reward_address"],
                        int(row["reward_amount"]),
                        1,
                        float(row["reward_amount"]),
                        int(row["created_at"]),
                        json.dumps({"legacy": True}, separators=(",", ":")),
                    ),
                )
                self._insert_explorer_transaction_locked(
                    tx_hash=f"legacy-block-{int(row['height'])}",
                    block_height=int(row["height"]),
                    tx_kind="block_reward",
                    status="confirmed",
                    wallet_id=miner_wallet_id,
                    token_id=cc_id,
                    side="reward",
                    amount=float(row["reward_amount"]),
                    price=1.0,
                    value_cc=float(row["reward_amount"]),
                    memo=f"block_reward_{int(row['height'])}",
                    meta={"legacy": True, "reward_address": row["reward_address"]},
                    source_table="cortisol_blocks",
                    source_id=int(row["height"]),
                    created_at=int(row["created_at"]),
                )
            for row in self._all("SELECT id, user_id, wallet_id, token_id, side, amount, price, ts FROM trades ORDER BY id ASC"):
                value_cc = float(row["amount"] or 0.0) * float(row["price"] or 0.0)
                self._insert_explorer_transaction_locked(
                    tx_hash=f"legacy-trade-{int(row['id'])}",
                    block_height=self._find_block_height_for_ts_locked(int(row["ts"])),
                    tx_kind="trade",
                    status="confirmed",
                    user_id=int(row["user_id"]),
                    wallet_id=int(row["wallet_id"]),
                    token_id=int(row["token_id"]),
                    side=str(row["side"]),
                    amount=float(row["amount"] or 0.0),
                    price=float(row["price"] or 0.0),
                    value_cc=value_cc,
                    fee_cc=round(value_cc * 0.01, 6),
                    memo="legacy_trade",
                    meta={"legacy": True},
                    source_table="trades",
                    source_id=int(row["id"]),
                    created_at=int(row["ts"]),
                )
            for row in self._all(
                "SELECT id, from_address, to_address, amount, memo, created_at FROM wallet_transfers ORDER BY id ASC"
            ):
                memo = str(row["memo"] or "")
                if memo.startswith("block_reward_"):
                    continue
                from_wallet = self._wallet_by_address_locked(str(row["from_address"])) if row["from_address"] else None
                to_wallet = self._wallet_by_address_locked(str(row["to_address"])) if row["to_address"] else None
                self._insert_explorer_transaction_locked(
                    tx_hash=f"legacy-wallet-transfer-{int(row['id'])}",
                    block_height=self._find_block_height_for_ts_locked(int(row["created_at"])),
                    tx_kind="wallet_transfer",
                    status="confirmed",
                    user_id=int(from_wallet["user_id"] or 0) or None if from_wallet else None,
                    wallet_id=int(from_wallet["id"]) if from_wallet else None,
                    counterparty_wallet_id=int(to_wallet["id"]) if to_wallet else None,
                    token_id=cc_id,
                    side="transfer",
                    amount=float(row["amount"] or 0.0),
                    price=1.0,
                    value_cc=float(row["amount"] or 0.0),
                    memo=memo or "legacy_wallet_transfer",
                    meta={"legacy": True, "from_address": row["from_address"], "to_address": row["to_address"]},
                    source_table="wallet_transfers",
                    source_id=int(row["id"]),
                    created_at=int(row["created_at"]),
                )
            self._upsert_market_meta_locked("explorer_backfill_v2", 1)

    def _seed_market_bots(self) -> None:
        with self._lock, self.conn:
            cc_id = self.cc_token_id()
            for seed in BOT_SEED_DEFINITIONS:
                user_row = self._one("SELECT id FROM users WHERE lower(username)=lower(?)", (seed["username"],))
                if user_row:
                    user_id = int(user_row["id"])
                    self.conn.execute(
                        "UPDATE users SET display_name=?, is_bot=1 WHERE id=?",
                        (seed["display_name"], user_id),
                    )
                else:
                    ts = now_ts()
                    salt = hashlib.sha256(f"{seed['slug']}:salt".encode("utf-8")).hexdigest()[:32]
                    pw_hash = hashlib.sha256(f"{seed['slug']}:pw:{self.path}".encode("utf-8")).hexdigest()
                    cur = self.conn.execute(
                        """
                        INSERT INTO users (username, display_name, pw_salt, pw_hash, is_admin, is_bot, created_at)
                        VALUES (?, ?, ?, ?, 0, 1, ?)
                        """,
                        (seed["username"], seed["display_name"], salt, pw_hash, ts),
                    )
                    user_id = int(cur.lastrowid)
                    self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
                wallet_id = self._ensure_main_wallet_locked(user_id)
                wallet_name = self._normalize_wallet_name(seed["wallet_name"], fallback=seed["wallet_name"])
                self.conn.execute(
                    "UPDATE wallets SET name=?, label=?, wallet_kind='bot' WHERE id=?",
                    (wallet_name, wallet_name, wallet_id),
                )
                config = {
                    "cooldown": 6 if seed["risk_level"] == "low" else 4,
                    "trade_fraction": 0.04 if seed["risk_level"] == "low" else (0.07 if seed["risk_level"] == "high" else 0.055),
                }
                self.conn.execute(
                    """
                    INSERT INTO bot_accounts (user_id, wallet_id, slug, persona, strategy, risk_level, is_active, created_at, config_json)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        wallet_id=excluded.wallet_id,
                        slug=excluded.slug,
                        persona=excluded.persona,
                        strategy=excluded.strategy,
                        risk_level=excluded.risk_level,
                        config_json=excluded.config_json
                    """,
                    (
                        user_id,
                        wallet_id,
                        seed["slug"],
                        seed["persona"],
                        seed["strategy"],
                        seed["risk_level"],
                        now_ts(),
                        json.dumps(config, separators=(",", ":")),
                    ),
                )
                current_cc = self._wallet_amount_locked(wallet_id, cc_id)
                if current_cc + 1e-9 < float(seed["starting_cc"]):
                    self._credit_balance_locked(wallet_id, cc_id, float(seed["starting_cc"]) - current_cc)

    def list_bot_accounts(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._all(
                """
                SELECT id, user_id, wallet_id, slug, persona, strategy, risk_level, is_active, created_at, last_action_at
                FROM bot_accounts
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            )
            return [
                {
                    "id": int(row["id"]),
                    "slug": row["slug"],
                    "persona": row["persona"],
                    "strategy": row["strategy"],
                    "risk_level": row["risk_level"],
                    "is_active": bool(row["is_active"]),
                    "created_at": int(row["created_at"]),
                    "last_action_at": int(row["last_action_at"]),
                    "user": self._basic_user_ref_locked(int(row["user_id"])),
                    "wallet": self._basic_wallet_ref_locked(int(row["wallet_id"])),
                }
                for row in rows
            ]

    def _run_bot_activity_locked(self, now: int, max_actions: int = 6) -> List[Dict[str, Any]]:
        token_rows = self._all(
            """
            SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                   category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                   supply_cap, circulating_supply, metadata_json, status
            FROM tokens
            WHERE symbol != 'CC' AND status='active'
            ORDER BY id ASC
            """
        )
        if not token_rows:
            return []
        actions: List[Dict[str, Any]] = []
        cc_id = self.cc_token_id()
        bot_rows = self._all(
            "SELECT id, user_id, wallet_id, slug, strategy, risk_level, last_action_at, config_json FROM bot_accounts WHERE is_active=1 ORDER BY id ASC"
        )
        for bot in bot_rows:
            config: Dict[str, Any]
            try:
                parsed = json.loads(bot["config_json"] or "{}")
                config = parsed if isinstance(parsed, dict) else {}
            except Exception:
                config = {}
            cooldown = max(2, int(config.get("cooldown", 5)))
            if int(now) - int(bot["last_action_at"] or 0) < cooldown:
                continue
            token = token_rows[((now // MARKET_STEP_SECONDS) + int(bot["id"])) % len(token_rows)]
            token_id = int(token["id"])
            history = self._token_price_history_locked(token_id, limit=8)
            if len(history) < 2:
                continue
            price = max(0.01, history[-1])
            compare_price = history[-4] if len(history) >= 4 else history[0]
            params = self._parse_params(token["params_json"])
            target_price = max(0.01, float(params.get("target_price", price)))
            cc_balance = self._wallet_amount_locked(int(bot["wallet_id"]), cc_id)
            holdings = self._wallet_amount_locked(int(bot["wallet_id"]), token_id)
            trade_fraction = float(config.get("trade_fraction", 0.05))
            side = ""
            amount = 0.0
            if bot["strategy"] == "mean_reversion":
                if price < target_price * 0.97 and cc_balance > price * 4:
                    side = "buy"
                    amount = min((cc_balance * trade_fraction) / (price * 1.01), 18.0)
                elif price > target_price * 1.05 and holdings > 0.5:
                    side = "sell"
                    amount = min(max(holdings * 0.25, 0.5), 14.0)
            elif bot["strategy"] == "momentum":
                momentum = (price - compare_price) / max(compare_price, 0.01)
                if momentum > 0.035 and cc_balance > price * 3:
                    side = "buy"
                    amount = min((cc_balance * (trade_fraction + 0.015)) / (price * 1.01), 20.0)
                elif momentum < -0.025 and holdings > 0.5:
                    side = "sell"
                    amount = min(max(holdings * 0.3, 0.5), 20.0)
            else:
                phase = self._det_noise((int(bot["id"]) * 997) + token_id, now)
                if phase > 0.25 and cc_balance > price * 2:
                    side = "buy"
                    amount = min((cc_balance * trade_fraction) / (price * 1.01), 12.0)
                elif phase < -0.25 and holdings > 0.5:
                    side = "sell"
                    amount = min(max(holdings * 0.22, 0.5), 12.0)
            if side == "buy":
                amount = min(amount, cc_balance / max(price * 1.01, 0.01))
            elif side == "sell":
                amount = min(amount, holdings)
            if side not in {"buy", "sell"} or amount <= 0.2:
                continue
            result = self._execute_trade_locked(
                int(bot["user_id"]),
                int(bot["wallet_id"]),
                token_id,
                side,
                round(amount, 6),
                actor_bot_id=int(bot["id"]),
                reason="bot_loop",
            )
            if not result:
                continue
            self.conn.execute("UPDATE bot_accounts SET last_action_at=? WHERE id=?", (now, int(bot["id"])))
            actions.append(
                {
                    "bot_id": int(bot["id"]),
                    "bot_slug": bot["slug"],
                    "strategy": bot["strategy"],
                    "wallet_id": int(bot["wallet_id"]),
                    "token_id": result["token_id"],
                    "symbol": result["symbol"],
                    "side": result["side"],
                    "amount": result["amount"],
                    "price": result["price"],
                    "explorer_transaction_id": result["explorer_transaction_id"],
                }
            )
            if len(actions) >= max_actions:
                break
        return actions

    def _execute_trade_locked(
        self,
        user_id: int,
        wallet_id: int,
        token_id: int,
        side: str,
        amount: float,
        *,
        actor_bot_id: Optional[int] = None,
        reason: str = "user_trade",
    ) -> Optional[Dict[str, Any]]:
        side = (side or "").lower()
        amount = float(amount)
        if side not in {"buy", "sell"} or amount <= 0:
            return None
        wallet = self._wallet_by_id_locked(wallet_id)
        if not wallet or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
            return None
        token = self._resolve_token_locked(token_id)
        if not token:
            return None
        cc_id = self.cc_token_id()
        if int(token_id) == cc_id:
            return None
        price = max(0.0001, self._token_price_locked(int(token_id)))
        fee = 0.01
        value_cc = amount * price
        if side == "buy":
            total_cost = value_cc * (1.0 + fee)
            if not self._debit_balance_locked(wallet_id, cc_id, total_cost):
                return None
            self._credit_balance_locked(wallet_id, int(token_id), amount)
            delta_cc = -total_cost
            fee_cc = total_cost - value_cc
        else:
            if not self._debit_balance_locked(wallet_id, int(token_id), amount):
                return None
            proceeds = value_cc * (1.0 - fee)
            self._credit_balance_locked(wallet_id, cc_id, proceeds)
            delta_cc = proceeds
            fee_cc = value_cc - proceeds
        ts = now_ts()
        cur = self.conn.execute(
            "INSERT INTO trades (user_id, wallet_id, token_id, side, amount, price, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, wallet_id, token_id, side, amount, price, ts),
        )
        tx_meta = {
            "side": side,
            "token_id": int(token_id),
            "symbol": token["symbol"],
            "amount": round(amount, 6),
            "price": round(price, 6),
            "fee_cc": round(fee_cc, 6),
            "reason": reason,
        }
        self._insert_transaction_locked(user_id, wallet_id, "trade", 0, float(delta_cc), tx_meta)
        explorer_tx_id = self._insert_explorer_transaction_locked(
            tx_kind="trade",
            user_id=user_id,
            bot_account_id=actor_bot_id,
            wallet_id=wallet_id,
            token_id=int(token_id),
            side=side,
            amount=amount,
            price=price,
            value_cc=value_cc,
            fee_cc=fee_cc,
            memo=reason,
            meta={"symbol": token["symbol"], "source_trade_id": int(cur.lastrowid)},
            source_table="trades",
            source_id=int(cur.lastrowid),
            created_at=ts,
        )
        return {
            "token_id": int(token_id),
            "symbol": token["symbol"],
            "side": side,
            "amount": round(amount, 6),
            "price": round(price, 6),
            "delta_cc": round(float(delta_cc), 6),
            "fee_cc": round(float(fee_cc), 6),
            "explorer_transaction_id": explorer_tx_id,
            "wallet": self._wallet_payload_locked(wallet),
        }

    def _default_token_params(self, volatility_key: str, initial_price: float = 10.0) -> Dict[str, Any]:
        vkey = (volatility_key or "medium").lower()
        if vkey == "low":
            volatility = 0.008
            drift_strength = 42.0
        elif vkey == "high":
            volatility = 0.03
            drift_strength = 18.0
        else:
            volatility = 0.016
            drift_strength = 28.0
        return {
            "volatility": volatility,
            "drift_strength": drift_strength,
            "min_price": 0.25,
            "max_price": 500.0,
            "target_price": float(initial_price),
            "bias": 0.0,
            "step_seconds": MARKET_STEP_SECONDS,
        }

    def _parse_params(self, raw: str) -> Dict[str, Any]:
        params = self._default_token_params("medium")
        try:
            parsed = json.loads(raw or "{}")
            if isinstance(parsed, dict):
                params.update(parsed)
        except Exception:
            pass
        return params

    def _det_noise(self, token_id: int, step_index: int) -> float:
        seed = hashlib.sha256(f"{token_id}:{step_index}".encode("utf-8")).hexdigest()[:8]
        val = int(seed, 16) / float(0xFFFFFFFF)
        return (val - 0.5) * 2.0

    def _maybe_mine_block_locked(self, now: int, *, force: bool = False, reward_amount: Optional[int] = None) -> Optional[Dict[str, Any]]:
        pending_rows = self._all(
            "SELECT id, value_cc FROM explorer_transactions WHERE status='pending' ORDER BY created_at ASC, id ASC LIMIT 500"
        )
        last_row = self._one("SELECT height, block_hash, created_at FROM explorer_blocks ORDER BY height DESC LIMIT 1")
        last_ts = int(last_row["created_at"]) if last_row else 0
        if not force:
            if pending_rows and now - last_ts < max(MARKET_STEP_SECONDS * 2, 4):
                return None
            if not pending_rows and now - last_ts < MARKET_BLOCK_INTERVAL_SECONDS:
                return None
        host = self.ensure_host_wallet()
        height = int(last_row["height"]) + 1 if last_row else 1
        prev_hash = str(last_row["block_hash"]) if last_row else "genesis"
        reward_amount = max(1, int(reward_amount or (2 + min(8, len(pending_rows)))))
        block_hash = hashlib.sha256(f"{height}:{prev_hash}:{host['address']}:{reward_amount}:{now}".encode("utf-8")).hexdigest()
        volume_cc = round(sum(abs(float(row["value_cc"] or 0.0)) for row in pending_rows), 6)
        self.conn.execute(
            """
            INSERT INTO explorer_blocks (
                height, prev_hash, block_hash, miner_wallet_id, reward_address, reward_amount,
                tx_count, volume_cc, created_at, meta_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                height,
                prev_hash,
                block_hash,
                int(host["id"]),
                host["address"],
                reward_amount,
                len(pending_rows) + 1,
                volume_cc,
                now,
                json.dumps({"pending_before_confirm": len(pending_rows)}, separators=(",", ":")),
            ),
        )
        self.conn.execute(
            "INSERT OR IGNORE INTO cortisol_blocks (height, prev_hash, block_hash, reward_address, reward_amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (height, prev_hash, block_hash, host["address"], reward_amount, now),
        )
        self._credit_balance_locked(int(host["id"]), self.cc_token_id(), float(reward_amount))
        self.conn.execute(
            "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
            (None, host["address"], reward_amount, f"block_reward_{height}", now),
        )
        self._insert_explorer_transaction_locked(
            tx_hash=f"block-{height}-reward",
            block_height=height,
            tx_kind="block_reward",
            status="confirmed",
            wallet_id=int(host["id"]),
            token_id=self.cc_token_id(),
            side="reward",
            amount=float(reward_amount),
            price=1.0,
            value_cc=float(reward_amount),
            memo=f"block_reward_{height}",
            meta={"reward_address": host["address"]},
            source_table="explorer_blocks",
            source_id=height,
            created_at=now,
        )
        if pending_rows:
            ids = [int(row["id"]) for row in pending_rows]
            placeholders = ",".join("?" for _ in ids)
            self.conn.execute(
                f"UPDATE explorer_transactions SET block_height=?, status='confirmed' WHERE id IN ({placeholders})",
                (height, *ids),
            )
        self._upsert_market_meta_locked("last_block_ts", now)
        return self.explorer_block(height)

    def mine_block(self, reward_amount: int = 5) -> Dict[str, Any]:
        with self._lock, self.conn:
            block = self._maybe_mine_block_locked(now_ts(), force=True, reward_amount=max(1, int(reward_amount)))
            if not block:
                raise KeyError("block_mine_failed")
            return block["block"]

    def list_recent_blocks(self, limit: int = 20) -> List[Dict[str, Any]]:
        return self.explorer_blocks(limit=limit).get("blocks", [])

    def run_market_cycle(self, now: Optional[int] = None) -> Dict[str, Any]:
        tick_ts = int(now or now_ts())
        self.advance_market(now=tick_ts)
        with self._lock, self.conn:
            bot_actions = self._run_bot_activity_locked(tick_ts)
            block = self._maybe_mine_block_locked(tick_ts)
            return {"ts": tick_ts, "bot_actions": bot_actions, "block": block}

    def advance_market(self, now: Optional[int] = None, max_steps: int = 180) -> Dict[str, Any]:
        now = int(now or now_ts())
        with self._lock, self.conn:
            row = self._one("SELECT value FROM market_meta WHERE key='last_step_ts'")
            last_step = int(row["value"]) if row else now
            if last_step <= 0:
                last_step = now
            steps = max(0, min(max_steps, (now - last_step) // MARKET_STEP_SECONDS))
            if steps <= 0:
                return {"steps": 0, "last_step_ts": last_step}
            token_rows = self._all("SELECT id, symbol, params_json, status FROM tokens")
            for i in range(1, steps + 1):
                step_ts = last_step + (i * MARKET_STEP_SECONDS)
                for token in token_rows:
                    token_id = int(token["id"])
                    if token["symbol"] == "CC":
                        self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, 1.0)", (token_id, step_ts))
                        continue
                    if str(token["status"] or "active") not in {"active", "listed"}:
                        continue
                    params = self._parse_params(token["params_json"])
                    prev_price = self._token_price_locked(token_id) or float(params.get("target_price", 10.0))
                    target = float(params.get("target_price", 10.0))
                    drift_k = max(1.0, float(params.get("drift_strength", 25.0)))
                    bias = float(params.get("bias", 0.0))
                    vol = max(0.0001, float(params.get("volatility", 0.01)))
                    min_price = max(0.01, float(params.get("min_price", 0.1)))
                    max_price = max(min_price + 0.01, float(params.get("max_price", 500.0)))
                    noise = self._det_noise(token_id, step_ts)
                    drift = ((target - prev_price) / drift_k) / max(target, 1.0) + bias
                    trend_burst = math.sin((step_ts + (token_id * 97)) / 37.0) * vol * 0.35
                    shock = (noise * vol) + trend_burst
                    next_price = clamp(prev_price * math.exp(drift + shock), min_price, max_price)
                    self.conn.execute(
                        "INSERT INTO prices (token_id, ts, price) VALUES (?, ?, ?)",
                        (token_id, step_ts, float(next_price)),
                    )
            self._upsert_market_meta_locked("last_step_ts", last_step + (steps * MARKET_STEP_SECONDS))
            return {"steps": steps, "last_step_ts": last_step + (steps * MARKET_STEP_SECONDS)}

    def exchange_cortisol_cc(self, user_id: int, wallet_id: int, kind: str, amount: int) -> Optional[Dict[str, Any]]:
        amount = int(amount)
        if amount <= 0:
            return None
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
                return None
            self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (user_id,))
            stats = self._one("SELECT cortisol FROM stats WHERE user_id=?", (user_id,))
            assert stats is not None
            cortisol_before = int(stats["cortisol"])
            cc_id = self.cc_token_id()
            cc_before = self._wallet_amount_locked(wallet_id, cc_id)
            fee = 0.02
            delta_cc = 0.0
            if kind == "stress_for_coins":
                delta_cortisol = min(amount, max(0, 5000 - cortisol_before))
                if delta_cortisol <= 0:
                    return None
                rate = 0.05 + (cortisol_before / 20000.0)
                gain_cc = math.floor(delta_cortisol * rate * (1.0 - fee))
                if gain_cc <= 0:
                    return None
                cortisol_after = min(5000, cortisol_before + delta_cortisol)
                self._credit_balance_locked(wallet_id, cc_id, float(gain_cc))
                delta_cc = float(gain_cc)
                meta = {"kind": kind, "rate": rate, "fee": fee, "delta_cortisol": delta_cortisol, "gain_cc": gain_cc}
                explorer_side = "buy"
                explorer_amount = float(gain_cc)
            elif kind == "coins_for_calm":
                spend = min(amount, int(cc_before))
                if spend <= 0:
                    return None
                calm_per_coin = 2.4 - min(0.9, cortisol_before / 6000.0)
                calm_delta = math.floor(spend * calm_per_coin * (1.0 - fee))
                if calm_delta <= 0:
                    return None
                cortisol_after = max(0, cortisol_before - calm_delta)
                if not self._debit_balance_locked(wallet_id, cc_id, float(spend)):
                    return None
                delta_cc = -float(spend)
                meta = {"kind": kind, "calm_per_coin": calm_per_coin, "fee": fee, "coins_spent": spend, "calm_delta": calm_delta}
                explorer_side = "sell"
                explorer_amount = float(spend)
            else:
                return None
            self.conn.execute("UPDATE stats SET cortisol=? WHERE user_id=?", (int(cortisol_after), user_id))
            self._insert_transaction_locked(
                user_id,
                wallet_id,
                "cortisol_exchange",
                int(cortisol_after - cortisol_before),
                float(delta_cc),
                meta,
            )
            explorer_tx_id = self._insert_explorer_transaction_locked(
                tx_kind="exchange",
                user_id=user_id,
                wallet_id=wallet_id,
                token_id=cc_id,
                side=explorer_side,
                amount=explorer_amount,
                price=1.0,
                value_cc=abs(delta_cc),
                memo=kind,
                meta=meta,
            )
            cc_after = self._wallet_amount_locked(wallet_id, cc_id)
            return {
                "cortisol_before": cortisol_before,
                "cortisol_after": int(cortisol_after),
                "delta_cortisol": int(cortisol_after - cortisol_before),
                "cc_before": round(cc_before, 4),
                "cc_after": round(float(cc_after), 4),
                "delta_cc": round(float(delta_cc), 4),
                "tier": cortisol_tier(int(cortisol_after)),
                "explorer_transaction_id": explorer_tx_id,
            }

    def apply_arena_match_results(self, results: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
        summary: Dict[int, Dict[str, Any]] = {}
        with self._lock, self.conn:
            cc_id = self.cc_token_id()
            for row in results:
                uid = int(row.get("user_id") or 0)
                if not uid:
                    continue
                win = bool(row.get("win"))
                kos = int(row.get("kos") or 0)
                deaths = int(row.get("deaths") or 0)
                cc_earned = max(0, int(row.get("cc_earned") or 0))
                self.conn.execute("INSERT OR IGNORE INTO stats (user_id) VALUES (?)", (uid,))
                stats = self._one("SELECT wins, losses, kos, deaths, streak, cortisol FROM stats WHERE user_id=?", (uid,))
                assert stats is not None
                wins = int(stats["wins"])
                losses = int(stats["losses"])
                total_kos = int(stats["kos"]) + kos
                total_deaths = int(stats["deaths"]) + deaths
                streak = int(stats["streak"])
                cortisol_before = int(stats["cortisol"])
                if win:
                    wins += 1
                    cortisol_after = max(0, cortisol_before - (30 + 5 * min(streak, 6)))
                    streak += 1
                else:
                    losses += 1
                    cortisol_after = min(5000, cortisol_before + 18)
                    streak = 0
                self.conn.execute(
                    "UPDATE stats SET wins=?, losses=?, kos=?, deaths=?, streak=?, cortisol=? WHERE user_id=?",
                    (wins, losses, total_kos, total_deaths, streak, int(cortisol_after), uid),
                )
                wallet_id = self._ensure_main_wallet_locked(uid)
                if cc_earned > 0:
                    self._credit_balance_locked(wallet_id, cc_id, float(cc_earned))
                self._insert_transaction_locked(
                    uid,
                    wallet_id,
                    "arena_match",
                    int(cortisol_after - cortisol_before),
                    float(cc_earned),
                    {"win": win, "kos": kos, "deaths": deaths, "cc_earned": cc_earned},
                )
                if cc_earned > 0:
                    self._insert_explorer_transaction_locked(
                        tx_kind="arena_reward",
                        user_id=uid,
                        wallet_id=wallet_id,
                        token_id=cc_id,
                        side="reward",
                        amount=float(cc_earned),
                        price=1.0,
                        value_cc=float(cc_earned),
                        memo="arena_match",
                        meta={"win": win, "kos": kos, "deaths": deaths},
                    )
                summary[uid] = {
                    "cortisol_before": cortisol_before,
                    "cortisol_after": int(cortisol_after),
                    "cortisol_delta": int(cortisol_after - cortisol_before),
                    "cc_credited": cc_earned,
                }
        return summary

    def _sort_market_tokens_locked(self, tokens: List[Dict[str, Any]], sort: str) -> List[Dict[str, Any]]:
        sort_key = (sort or "market_cap_desc").lower()
        reverse = sort_key.endswith("_desc")
        if sort_key in {"price_desc", "price_asc"}:
            return sorted(tokens, key=lambda item: (float(item["price"]), item["symbol"]), reverse=reverse)
        if sort_key in {"change_desc", "change_asc"}:
            return sorted(tokens, key=lambda item: (float(item["change_pct"]), item["symbol"]), reverse=reverse)
        if sort_key in {"volume_desc", "volume_asc"}:
            return sorted(tokens, key=lambda item: (float(item["volume_cc"]), item["symbol"]), reverse=reverse)
        if sort_key in {"created_desc", "created_asc", "newest", "oldest"}:
            rev = sort_key in {"created_desc", "newest"}
            return sorted(tokens, key=lambda item: (int(item["created_at"]), item["symbol"]), reverse=rev)
        if sort_key in {"symbol_desc", "symbol_asc"}:
            return sorted(tokens, key=lambda item: str(item["symbol"]).upper(), reverse=reverse)
        return sorted(tokens, key=lambda item: (float(item["market_cap_cc"]), item["symbol"]), reverse=True)

    def market_snapshot(
        self,
        user_id: int,
        wallet_id: Optional[int] = None,
        *,
        token_ref: Optional[str] = None,
        search: str = "",
        sort: str = "market_cap_desc",
        owned_only: bool = False,
        category: str = "",
        limit: int = 100,
    ) -> Dict[str, Any]:
        self.advance_market()
        with self._lock, self.conn:
            if wallet_id is None:
                wallet_id = self._ensure_main_wallet_locked(user_id)
            wallet = self._wallet_by_id_locked(int(wallet_id))
            if not wallet or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
                wallet_id = self._ensure_main_wallet_locked(user_id)
                wallet = self._wallet_by_id_locked(int(wallet_id))
            assert wallet is not None
            search_l = (search or "").strip().lower()
            category_l = (category or "").strip().lower()
            token_rows = self._all(
                """
                SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                       category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                       supply_cap, circulating_supply, metadata_json, status
                FROM tokens
                WHERE status != 'hidden'
                ORDER BY CASE WHEN symbol='CC' THEN 0 ELSE 1 END, created_at ASC
                """
            )
            tokens: List[Dict[str, Any]] = []
            for row in token_rows:
                item = self._token_base_payload_locked(row, wallet_id=int(wallet["id"]), history_limit=40)
                if owned_only and float(item["wallet_amount"]) <= 0:
                    continue
                if category_l and str(item["category"]).lower() != category_l:
                    continue
                if search_l and not any(search_l in str(item.get(key, "")).lower() for key in ("name", "symbol", "slug", "description", "theme", "category")):
                    continue
                tokens.append(item)
            tokens = self._sort_market_tokens_locked(tokens, sort)
            if limit > 0:
                tokens = tokens[:limit]
            selected_token = None
            if token_ref:
                token_row = self._resolve_token_locked(token_ref)
                if token_row:
                    selected_token = self._token_detail_payload_locked(token_row, wallet_id=int(wallet["id"]))
            return {
                "wallet": self._wallet_payload_locked(wallet),
                "wallets": self.list_wallets_v2(user_id),
                "tokens": tokens,
                "selected_token": selected_token,
                "summary": {
                    "token_count": len(tokens),
                    "owned_token_count": sum(1 for item in tokens if float(item["wallet_amount"]) > 0),
                    "market_cap_cc": round(sum(float(item["market_cap_cc"]) for item in tokens), 6),
                    "volume_cc": round(sum(float(item["volume_cc"]) for item in tokens), 6),
                },
                "filters": {
                    "search": search,
                    "sort": sort,
                    "owned_only": bool(owned_only),
                    "category": category,
                    "limit": limit,
                    "token_ref": token_ref,
                },
                "simulation_note": "Simulation only. No real money.",
            }

    def execute_trade(self, user_id: int, wallet_id: int, token_id: int, side: str, amount: float) -> Optional[Dict[str, Any]]:
        self.advance_market()
        with self._lock, self.conn:
            return self._execute_trade_locked(user_id, wallet_id, token_id, side, amount, reason="user_trade")

    def create_token(
        self,
        user_id: int,
        wallet_id: int,
        name: str,
        symbol: str,
        description: str,
        volatility: str,
        theme: str,
        *,
        category: str = "arcade",
        website_url: str = "",
        icon_file_id: Optional[int] = None,
        initial_supply: float = DEFAULT_TOKEN_AIRDROP,
        supply_cap: float = DEFAULT_TOKEN_SUPPLY_CAP,
        launch_price: float = 10.0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        clean_name = (name or "").strip()[:TOKEN_NAME_LIMIT]
        clean_symbol = self._normalize_token_symbol(symbol)
        clean_desc = (description or "").strip()[:TOKEN_DESC_LIMIT]
        clean_theme = self._normalize_slug(theme or "default", fallback="default").replace("-", "_")[:24] or "default"
        clean_category = self._normalize_slug(category or "arcade", fallback="arcade")[:24] or "arcade"
        clean_url = (website_url or "").strip()[:200]
        if clean_url and not clean_url.startswith(("http://", "https://")):
            clean_url = ""
        if len(clean_name) < 2 or len(clean_symbol) < 2 or clean_symbol == "CC":
            return None
        try:
            launch_price = clamp(float(launch_price), 0.25, 5000.0)
            initial_supply = max(1.0, float(initial_supply))
            supply_cap = max(initial_supply, float(supply_cap))
        except (TypeError, ValueError):
            return None
        if icon_file_id:
            file_row = self.get_file(int(icon_file_id))
            if not file_row or int(file_row["deleted"]) == 1 or not self.can_access_file(user_id, int(icon_file_id)):
                return None
        token_meta = metadata if isinstance(metadata, dict) else {}
        slug_base = self._normalize_slug(f"{clean_name}-{clean_symbol}", fallback=clean_symbol)
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
                return None
            if self._one("SELECT id FROM tokens WHERE symbol=?", (clean_symbol,)):
                return None
            slug = slug_base
            suffix = 2
            while self._one("SELECT id FROM tokens WHERE slug=?", (slug,)):
                slug = f"{slug_base[:43]}-{suffix}"
                suffix += 1
            params = self._default_token_params(volatility, initial_price=launch_price)
            params["theme"] = clean_theme
            params["category"] = clean_category
            ts = now_ts()
            cur = self.conn.execute(
                """
                INSERT INTO tokens (
                    creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                    category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                    supply_cap, circulating_supply, metadata_json, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
                """,
                (
                    user_id,
                    wallet_id,
                    clean_name,
                    clean_symbol,
                    slug,
                    clean_desc,
                    json.dumps(params, separators=(",", ":")),
                    ts,
                    clean_category,
                    clean_theme,
                    clean_url,
                    int(icon_file_id) if icon_file_id else None,
                    float(launch_price),
                    (volatility or "medium").lower(),
                    float(supply_cap),
                    float(initial_supply),
                    json.dumps(token_meta, separators=(",", ":")),
                ),
            )
            token_id = int(cur.lastrowid)
            self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, ?)", (token_id, ts, float(launch_price)))
            self._credit_balance_locked(wallet_id, token_id, float(initial_supply))
            self._insert_transaction_locked(
                user_id,
                wallet_id,
                "token_airdrop",
                0,
                0.0,
                {"token_id": token_id, "symbol": clean_symbol, "amount": initial_supply, "theme": clean_theme},
            )
            explorer_tx_id = self._insert_explorer_transaction_locked(
                tx_kind="token_create",
                user_id=user_id,
                wallet_id=wallet_id,
                token_id=token_id,
                side="launch",
                amount=float(initial_supply),
                price=float(launch_price),
                value_cc=float(initial_supply * launch_price),
                memo="token launch",
                meta={"symbol": clean_symbol, "theme": clean_theme, "category": clean_category},
                source_table="tokens",
                source_id=token_id,
                created_at=ts,
            )
            token_row = self._resolve_token_locked(token_id)
            assert token_row is not None
            payload = self._token_detail_payload_locked(token_row, wallet_id=wallet_id)
            payload["airdrop"] = round(float(initial_supply), 6)
            payload["explorer_transaction_id"] = explorer_tx_id
            return payload

    def wallets_api_payload(self, user_id: int) -> Dict[str, Any]:
        wallets = self.list_wallets_v2(user_id)
        with self._lock:
            tx_rows = self._all(
                "SELECT id, user_id, wallet_id, kind, delta_cortisol, delta_cc, meta_json, ts FROM transactions WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT 80",
                (user_id,),
            )
        transactions = []
        for row in tx_rows:
            item = dict(row)
            try:
                item["meta"] = json.loads(item.pop("meta_json") or "{}")
            except Exception:
                item["meta"] = {}
            transactions.append(item)
        recent_blocks = self.list_recent_blocks(limit=5)
        return {
            "wallets": wallets,
            "default_wallet_id": wallets[0]["id"] if wallets else None,
            "transactions": transactions,
            "summary": {
                "wallet_count": len(wallets),
                "total_value_cc": round(sum(float(wallet["total_value_cc"]) for wallet in wallets), 6),
                "pending_explorer_transactions": len(self.explorer_transactions(limit=200, status="pending")["transactions"]),
            },
            "bots": self.list_bot_accounts(limit=6),
            "recent_blocks": recent_blocks,
        }

    def dashboard_payload(self, user_id: int) -> Dict[str, Any]:
        wallet_payload = self.wallets_api_payload(user_id)
        default_wallet_id = wallet_payload.get("default_wallet_id")
        market = self.market_snapshot(user_id, wallet_id=int(default_wallet_id) if default_wallet_id else None, limit=8)
        return {
            "me": self.me_payload(user_id),
            "stats": self.get_stats(user_id),
            "wallets": wallet_payload,
            "market": {
                "summary": market["summary"],
                "tokens": market["tokens"][:8],
                "selected_token": market["selected_token"],
            },
            "explorer": self.explorer_overview(limit_blocks=6, limit_transactions=8),
            "bots": self.list_bot_accounts(limit=6),
            "simulation_note": "Simulation only. No real money.",
        }

    def explorer_blocks(self, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        with self._lock:
            total_row = self._one("SELECT COUNT(*) AS c FROM explorer_blocks")
            rows = self._all(
                "SELECT * FROM explorer_blocks ORDER BY height DESC LIMIT ? OFFSET ?",
                (max(1, limit), max(0, offset)),
            )
            blocks = []
            for row in rows:
                item = dict(row)
                try:
                    item["meta"] = json.loads(item.pop("meta_json") or "{}")
                except Exception:
                    item["meta"] = {}
                item["miner_wallet"] = self._basic_wallet_ref_locked(int(item["miner_wallet_id"] or 0) or None)
                blocks.append(item)
            return {"total": int(total_row["c"] if total_row else 0), "blocks": blocks}

    def explorer_block(self, height: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._one("SELECT * FROM explorer_blocks WHERE height=?", (int(height),))
            if not row:
                return None
            block = dict(row)
            try:
                block["meta"] = json.loads(block.pop("meta_json") or "{}")
            except Exception:
                block["meta"] = {}
            block["miner_wallet"] = self._basic_wallet_ref_locked(int(block["miner_wallet_id"] or 0) or None)
            tx_rows = self._all(
                "SELECT * FROM explorer_transactions WHERE block_height=? ORDER BY created_at ASC, id ASC",
                (int(height),),
            )
            return {
                "block": block,
                "transactions": [self._explorer_transaction_payload_from_row_locked(tx_row) for tx_row in tx_rows],
            }

    def explorer_transactions(
        self,
        limit: int = 50,
        offset: int = 0,
        *,
        wallet_ref: Optional[str] = None,
        token_ref: Optional[str] = None,
        kind: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            clauses: List[str] = []
            params: List[Any] = []
            if wallet_ref:
                wallet = self._wallet_by_id_locked(int(wallet_ref)) if str(wallet_ref).isdigit() else self._wallet_by_address_locked(str(wallet_ref))
                if not wallet:
                    return {"total": 0, "transactions": []}
                clauses.append("(wallet_id=? OR counterparty_wallet_id=?)")
                params.extend([int(wallet["id"]), int(wallet["id"])])
            if token_ref:
                token = self._resolve_token_locked(token_ref)
                if not token:
                    return {"total": 0, "transactions": []}
                clauses.append("token_id=?")
                params.append(int(token["id"]))
            if kind:
                clauses.append("tx_kind=?")
                params.append(str(kind))
            if status:
                clauses.append("status=?")
                params.append(str(status))
            where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            total_row = self._one(f"SELECT COUNT(*) AS c FROM explorer_transactions {where_sql}", params)
            rows = self._all(
                f"SELECT * FROM explorer_transactions {where_sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (*params, max(1, limit), max(0, offset)),
            )
            return {
                "total": int(total_row["c"] if total_row else 0),
                "transactions": [self._explorer_transaction_payload_from_row_locked(row) for row in rows],
            }

    def explorer_transaction(self, tx_ref: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if str(tx_ref).isdigit():
                row = self._one("SELECT * FROM explorer_transactions WHERE id=?", (int(tx_ref),))
            else:
                row = self._one("SELECT * FROM explorer_transactions WHERE tx_hash=?", (str(tx_ref),))
            return self._explorer_transaction_payload_from_row_locked(row) if row else None

    def explorer_wallets(self, limit: int = 50, offset: int = 0, *, search: str = "", sort: str = "value_desc") -> Dict[str, Any]:
        with self._lock:
            rows = self._all(
                """
                SELECT id, address, user_id, owner_user_id, label, name, created_at, sort_order, deleted, wallet_kind
                FROM wallets
                ORDER BY created_at DESC, id DESC
                """
            )
            items = [self._wallet_list_item_locked(row) for row in rows]
            search_l = (search or "").strip().lower()
            if search_l:
                items = [
                    item
                    for item in items
                    if search_l in str(item["address"]).lower()
                    or search_l in str(item["name"]).lower()
                    or search_l in str((item.get("owner") or {}).get("username", "")).lower()
                ]
            sort_key = (sort or "value_desc").lower()
            if sort_key in {"created_desc", "created_asc"}:
                items.sort(key=lambda item: (int(item["created_at"]), item["id"]), reverse=sort_key.endswith("_desc"))
            elif sort_key in {"activity_desc", "activity_asc"}:
                items.sort(key=lambda item: (int(item["last_activity_at"]), item["id"]), reverse=sort_key.endswith("_desc"))
            else:
                items.sort(key=lambda item: (float(item["total_value_cc"]), item["id"]), reverse=True)
            sliced = items[max(0, offset): max(0, offset) + max(1, limit)]
            return {"total": len(items), "wallets": sliced}

    def explorer_wallet(self, wallet_ref: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            wallet = self._wallet_by_id_locked(int(wallet_ref)) if str(wallet_ref).isdigit() else self._wallet_by_address_locked(wallet_ref)
            if not wallet:
                return None
            return {
                "wallet": self._wallet_payload_locked(wallet),
                "owner": self._basic_user_ref_locked(int(wallet["user_id"] or 0) or None),
                "transactions": self.explorer_transactions(limit=30, wallet_ref=str(wallet["id"]))["transactions"],
            }

    def explorer_tokens(self, limit: int = 50, offset: int = 0, *, search: str = "", sort: str = "market_cap_desc") -> Dict[str, Any]:
        self.advance_market()
        with self._lock:
            rows = self._all(
                """
                SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                       category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                       supply_cap, circulating_supply, metadata_json, status
                FROM tokens
                WHERE status != 'hidden'
                ORDER BY created_at ASC
                """
            )
            items = [self._token_base_payload_locked(row, wallet_id=None, history_limit=30) for row in rows]
            search_l = (search or "").strip().lower()
            if search_l:
                items = [
                    item
                    for item in items
                    if any(search_l in str(item.get(key, "")).lower() for key in ("name", "symbol", "slug", "description", "category"))
                ]
            items = self._sort_market_tokens_locked(items, sort)
            sliced = items[max(0, offset): max(0, offset) + max(1, limit)]
            return {"total": len(items), "tokens": sliced}

    def explorer_token(self, token_ref: str) -> Optional[Dict[str, Any]]:
        self.advance_market()
        with self._lock:
            row = self._resolve_token_locked(token_ref)
            if not row:
                return None
            return self._token_detail_payload_locked(row)

    def explorer_overview(self, limit_blocks: int = 10, limit_transactions: int = 15) -> Dict[str, Any]:
        with self._lock:
            counts = {
                "blocks": int(self._one("SELECT COUNT(*) AS c FROM explorer_blocks")["c"]),
                "transactions": int(self._one("SELECT COUNT(*) AS c FROM explorer_transactions")["c"]),
                "wallets": int(self._one("SELECT COUNT(*) AS c FROM wallets WHERE COALESCE(deleted, 0)=0")["c"]),
                "tokens": int(self._one("SELECT COUNT(*) AS c FROM tokens WHERE status != 'hidden'")["c"]),
                "bots": int(self._one("SELECT COUNT(*) AS c FROM bot_accounts WHERE is_active=1")["c"]),
            }
        return {
            "counts": counts,
            "latest_blocks": self.explorer_blocks(limit=limit_blocks)["blocks"],
            "latest_transactions": self.explorer_transactions(limit=limit_transactions)["transactions"],
            "top_tokens": self.explorer_tokens(limit=5, sort="market_cap_desc")["tokens"],
            "top_wallets": self.explorer_wallets(limit=5, sort="value_desc")["wallets"],
            "bots": self.list_bot_accounts(limit=5),
        }

    def can_delete_file(self, user_id: int, file_id: int, *, is_admin: bool = False) -> bool:
        file_row = self.get_file(file_id)
        if not file_row or int(file_row["deleted"]) == 1:
            return False
        return bool(is_admin) or int(file_row["uploader_id"]) == int(user_id)

    def delete_file_for_actor(self, user_id: int, file_id: int, *, is_admin: bool = False) -> bool:
        if not self.can_delete_file(user_id, file_id, is_admin=is_admin):
            return False
        return self.mark_file_deleted(file_id)
