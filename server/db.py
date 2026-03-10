import hashlib
import json
import math
import re
import secrets
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
TRADE_FEE_RATE = 0.0125
EXCHANGE_BASE_FEE = 0.03
MIN_LAUNCH_LIQUIDITY_CC = 25.0
MAX_SIM_STEP_SECONDS = 300
LIQUIDITY_BOOTSTRAP_UNITS = 1000.0

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
    {
        "slug": "chaos-cam",
        "username": "bot_chaos_cam",
        "display_name": "Chaos Cam",
        "wallet_name": "Cam Chaos Vault",
        "persona": "Launches low-float nonsense and leans into volatility clusters.",
        "strategy": "chaos",
        "risk_level": "high",
        "starting_cc": 1550.0,
    },
    {
        "slug": "revival-vee",
        "username": "bot_revival_vee",
        "display_name": "Revival Vee",
        "wallet_name": "Vee Rescue Pool",
        "persona": "Adds rescue liquidity when dead charts start whispering again.",
        "strategy": "revival",
        "risk_level": "medium",
        "starting_cc": 1750.0,
    },
    {
        "slug": "rug-rhett",
        "username": "bot_rug_rhett",
        "display_name": "Rug Rhett",
        "wallet_name": "Rhett Exit Bag",
        "persona": "Seeds risky pools, lets them run, then yanks depth when the tape is hot.",
        "strategy": "rugger",
        "risk_level": "high",
        "starting_cc": 2100.0,
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
            self._ensure_liquidity_schema()
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
        if "liquidity_cc" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN liquidity_cc REAL NOT NULL DEFAULT 0")
        if "liquidity_tokens" not in cols:
            self.conn.execute("ALTER TABLE tokens ADD COLUMN liquidity_tokens REAL NOT NULL DEFAULT 0")
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
        self.conn.execute(
            """
            UPDATE tokens
            SET liquidity_cc=CASE
                WHEN symbol='CC' THEN 0
                WHEN liquidity_cc > 0 THEN liquidity_cc
                ELSE MAX(18.0, COALESCE(launch_price, 1.0) * 16.0)
            END
            """
        )
        self.conn.execute(
            """
            UPDATE tokens
            SET liquidity_tokens=CASE
                WHEN symbol='CC' THEN 0
                WHEN liquidity_tokens > 0 THEN liquidity_tokens
                ELSE MAX(1.0, liquidity_cc / MAX(COALESCE(launch_price, 1.0), 0.01))
            END
            """
        )
        self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_slug ON tokens(slug)")

    def _ensure_liquidity_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS liquidity_positions (
                token_id INTEGER NOT NULL,
                wallet_id INTEGER NOT NULL,
                share_units REAL NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(token_id, wallet_id),
                FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_liquidity_positions_wallet ON liquidity_positions(wallet_id, updated_at DESC);
            """
        )

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
        while True:
            seed = f"{now_ts()}:{self.user_count()}:{time.time_ns()}:{secrets.token_hex(6)}"
            address = "cw_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
            if not self._one("SELECT 1 FROM wallets WHERE address=?", (address,)):
                return address

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

    def admin_send_cortisol(self, to_address: str, amount: int, memo: str = "admin_cli_send") -> bool:
        amount = int(amount)
        if amount <= 0:
            return False
        host = self.ensure_host_wallet()
        with self._lock, self.conn:
            to_wallet = self._wallet_by_address_locked(to_address)
            if not to_wallet or bool(to_wallet["deleted"]):
                return False
            host_wallet_id = int(host["id"])
            to_wallet_id = int(to_wallet["id"])
            cc_id = self.cc_token_id()
            self._credit_balance_locked(host_wallet_id, cc_id, float(amount))
            if not self._debit_balance_locked(host_wallet_id, cc_id, float(amount)):
                return False
            self._credit_balance_locked(to_wallet_id, cc_id, float(amount))
            cur = self.conn.execute(
                "INSERT INTO wallet_transfers (from_address, to_address, amount, memo, created_at) VALUES (?, ?, ?, ?, ?)",
                ("host_miner", to_address, amount, memo[:120], now_ts()),
            )
            transfer_id = int(cur.lastrowid)
            meta = {
                "from_wallet_id": host_wallet_id,
                "to_wallet_id": to_wallet_id,
                "token_id": cc_id,
                "symbol": "CC",
                "amount": float(amount),
                "memo": memo[:120],
            }
            to_user_id = int(to_wallet["user_id"] or 0)
            if to_user_id:
                self._insert_transaction_locked(to_user_id, to_wallet_id, "wallet_transfer_in", 0, 0.0, meta)
            self._insert_explorer_transaction_locked(
                tx_kind="wallet_transfer",
                wallet_id=host_wallet_id,
                counterparty_wallet_id=to_wallet_id,
                token_id=cc_id,
                side="transfer",
                amount=float(amount),
                price=1.0,
                value_cc=float(amount),
                memo=memo[:120],
                meta=meta,
                source_table="wallet_transfers",
                source_id=transfer_id,
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
                   t.metadata_json,
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
            token_id = int(row["token_id"])
            try:
                metadata = json.loads(row["metadata_json"] or "{}")
                if not isinstance(metadata, dict):
                    metadata = {}
            except Exception:
                metadata = {}
            out.append(
                {
                    "token_id": token_id,
                    "name": row["name"],
                    "symbol": row["symbol"],
                    "slug": row["slug"],
                    "description": row["description"],
                    "category": row["category"],
                    "theme": row["theme"],
                    "icon_file_id": row["icon_file_id"],
                    "icon_url": self._icon_url_locked(int(row["icon_file_id"] or 0) or None),
                    "theme_color": self._theme_color_from_metadata_locked(row, metadata),
                    "amount": round(amount, 6),
                    "price": round(price, 6),
                    "value_cc": round(amount * price, 6),
                    "change_pct": round(self._token_change_over_seconds_locked(token_id, 900), 4),
                    "change_24h": round(self._token_change_over_seconds_locked(token_id, 3600), 4),
                    "recent_movement": round(self._token_change_over_seconds_locked(token_id, 300), 4),
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
        lp_rows = self._all(
            """
            SELECT lp.token_id, lp.share_units, t.name, t.symbol, t.slug
            FROM liquidity_positions lp
            JOIN tokens t ON t.id = lp.token_id
            WHERE lp.wallet_id=?
            ORDER BY lp.updated_at DESC, t.symbol ASC
            LIMIT 10
            """,
            (wallet_id,),
        )
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
            "liquidity_positions": [
                {
                    "token_id": int(row["token_id"]),
                    "name": row["name"],
                    "symbol": row["symbol"],
                    "slug": row["slug"],
                    "share_units": round(float(row["share_units"] or 0.0), 6),
                    "share_pct": round(
                        100.0
                        * float(row["share_units"] or 0.0)
                        / max(self._liquidity_units_total_locked(int(row["token_id"])), 0.000001),
                        4,
                    ),
                }
                for row in lp_rows
            ],
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

    def delete_wallet_v2(self, user_id: int, wallet_id: int, transfer_wallet_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self._lock, self.conn:
            wallets = self._active_wallet_rows_locked(user_id)
            if len(wallets) <= 1:
                return None
            doomed = next((row for row in wallets if int(row["id"]) == int(wallet_id)), None)
            if not doomed:
                return None
            fallback = None
            if transfer_wallet_id:
                fallback = next((row for row in wallets if int(row["id"]) == int(transfer_wallet_id) and int(row["id"]) != int(wallet_id)), None)
            if not fallback:
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
            for lp_row in self._all("SELECT token_id, share_units FROM liquidity_positions WHERE wallet_id=?", (wallet_id,)):
                token_id = int(lp_row["token_id"])
                share_units = float(lp_row["share_units"] or 0.0)
                if share_units <= 0:
                    continue
                self._set_liquidity_units_locked(token_id, fallback_id, self._liquidity_units_for_wallet_locked(token_id, fallback_id) + share_units)
                self._set_liquidity_units_locked(token_id, int(wallet_id), 0.0)
                self._insert_explorer_transaction_locked(
                    tx_kind="wallet_delete_merge",
                    user_id=user_id,
                    wallet_id=int(wallet_id),
                    counterparty_wallet_id=fallback_id,
                    token_id=token_id,
                    side="lp_merge",
                    amount=share_units,
                    price=self._token_price_locked(token_id),
                    value_cc=0.0,
                    memo="wallet delete lp merge",
                    meta={"share_units": share_units, "reason": "wallet_delete_lp"},
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

    def _market_mood_snapshot_locked(self, step_ts: int) -> Dict[str, Any]:
        mood = self._market_meta_float_locked("market_mood", 0.06)
        target = self._market_meta_float_locked("market_mood_target", 0.08)
        until = self._market_meta_int_locked("market_mood_until", 0)
        regime = self._one("SELECT value FROM market_meta WHERE key='market_mood_regime'")
        regime_name = str(regime["value"]) if regime else "balanced"
        if step_ts >= until:
            roll = self._det_noise(7771, step_ts)
            if roll <= -0.6:
                regime_name = "risk_off"
                target = -0.7
            elif roll <= -0.2:
                regime_name = "cooldown"
                target = -0.24
            elif roll <= 0.25:
                regime_name = "balanced"
                target = 0.08
            elif roll <= 0.72:
                regime_name = "risk_on"
                target = 0.48
            else:
                regime_name = "mania"
                target = 0.86
            until = step_ts + 240 + int((abs(self._det_noise(7811, step_ts)) + 0.2) * 780)
            self._upsert_market_meta_locked("market_mood_target", round(target, 6))
            self._upsert_market_meta_locked("market_mood_until", until)
            self._upsert_market_meta_locked("market_mood_regime", regime_name)
        mood = clamp(mood + ((target - mood) * 0.16) + (self._det_noise(7717, step_ts) * 0.045), -1.0, 1.0)
        self._upsert_market_meta_locked("market_mood", round(mood, 6))
        return {"mood": round(mood, 6), "target": round(target, 6), "until": until, "regime": regime_name}

    def _insert_market_event_locked(
        self,
        token_id: int,
        *,
        label: str,
        step_ts: int,
        side: str = "",
        value_cc: float = 0.0,
        amount: float = 0.0,
        price: Optional[float] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> int:
        event_price = float(price if price is not None else self._token_price_locked(token_id))
        event_meta = {"event_label": label, **(meta or {})}
        return self._insert_explorer_transaction_locked(
            tx_kind="market_event",
            token_id=int(token_id),
            side=side,
            amount=float(amount),
            price=event_price,
            value_cc=float(value_cc),
            memo=label.lower().replace(" ", "_")[:80],
            meta=event_meta,
            created_at=step_ts,
        )

    def _maybe_refresh_token_regime_locked(
        self,
        token_row: sqlite3.Row,
        params: Dict[str, Any],
        *,
        step_ts: int,
        market_mood: float,
    ) -> Optional[str]:
        if int(params.get("regime_until", 0) or 0) > step_ts and params.get("regime"):
            return None
        token_id = int(token_row["id"])
        reserves = self._token_reserves_locked(token_row)
        liquidity_value = reserves["cc"] * 2.0
        heat = float(params.get("heat", 0.0))
        roll = self._det_noise((token_id * 37) + 11, step_ts)
        next_regime = "grind"
        if liquidity_value < 40.0 and (roll < -0.25 or market_mood < -0.2):
            next_regime = "dead"
        elif liquidity_value < 75.0 and market_mood > 0.35 and roll > 0.1:
            next_regime = "revival"
        elif market_mood > 0.55 and roll > -0.1:
            next_regime = "surge"
        elif market_mood < -0.45 and roll < 0.15:
            next_regime = "panic"
        elif heat > 0.72 and abs(roll) > 0.55:
            next_regime = "reversal"
        elif liquidity_value < 80.0 or abs(roll) > 0.52:
            next_regime = "chop"
        if next_regime == params.get("regime"):
            params["regime_until"] = step_ts + 240
            return None
        params["regime"] = next_regime
        params["regime_until"] = step_ts + (180 if next_regime in {"surge", "panic", "reversal"} else 360)
        label_map = {
            "dead": "Dead tape",
            "revival": "Revival bid",
            "surge": "Momentum burst",
            "panic": "Sell cascade",
            "reversal": "Sharp reversal",
            "chop": "Chaotic chop",
            "grind": "Slow grind",
        }
        return label_map.get(next_regime, next_regime.title())

    def _simulate_token_step_locked(
        self,
        token_row: sqlite3.Row,
        *,
        step_ts: int,
        step_seconds: int,
        market_mood: float,
    ) -> Optional[Dict[str, Any]]:
        token_id = int(token_row["id"])
        if token_row["symbol"] == "CC" or str(token_row["status"] or "active") not in {"active", "listed"}:
            return None
        params = self._parse_params(token_row["params_json"])
        regime_event = self._maybe_refresh_token_regime_locked(token_row, params, step_ts=step_ts, market_mood=market_mood)
        regime = str(params.get("regime") or "grind")
        reserves = self._token_reserves_locked(token_row)
        current_price = max(0.0001, reserves["cc"] / max(reserves["tokens"], 0.000001))
        liquidity_value = max(10.0, reserves["cc"] * 2.0)
        liq_scale = clamp(145.0 / max(40.0, liquidity_value), 0.22, 3.1)
        volatility = clamp(float(params.get("volatility_base", params.get("volatility", 0.02))) * (1.0 + liq_scale * 0.55), 0.0035, 0.075)
        reversion = float(params.get("reversion_strength", 0.16))
        momentum = float(params.get("momentum", 0.0))
        heat = float(params.get("heat", 0.0))
        regime_bias_map = {
            "dead": -0.022,
            "revival": 0.026,
            "surge": 0.034,
            "panic": -0.04,
            "reversal": -momentum * 0.03,
            "chop": 0.0,
            "grind": 0.011,
        }
        target = float(params.get("mean_anchor", current_price))
        mean_reversion = ((target - current_price) / max(target, 0.01)) * reversion
        directional = regime_bias_map.get(regime, 0.0) + (market_mood * float(params.get("bot_interest", 0.3)) * 0.018)
        noise = self._det_noise((token_id * 19) + 3, step_ts) * volatility
        dt_scale = math.sqrt(max(1, step_seconds) / MARKET_STEP_SECONDS)
        synthetic_cc = max(0.0, liquidity_value * abs((directional + noise + (momentum * 0.04)) * dt_scale) * 0.018)
        synthetic_cc = clamp(synthetic_cc, 0.0, max(2.0, reserves["cc"] * 0.08))
        pressure_side = ""
        flow_result = None
        if regime_event:
            self._insert_market_event_locked(token_id, label=regime_event, step_ts=step_ts, price=current_price, meta={"regime": regime})
        if synthetic_cc > 0.04:
            if directional + noise + (momentum * 0.03) >= 0:
                pressure_side = "buy"
                flow_result = self._apply_cc_flow_locked(token_row, synthetic_cc, fee_rate=0.004, ts=step_ts)
            else:
                pressure_side = "sell"
                token_flow = synthetic_cc / max(current_price, 0.01)
                flow_result = self._apply_token_flow_locked(token_row, token_flow, fee_rate=0.004, ts=step_ts)
        if flow_result:
            after_price = float(flow_result["after_price"])
            params["momentum"] = round(clamp((momentum * 0.84) + ((after_price - current_price) / max(current_price, 0.01)) * 6.0, -1.3, 1.3), 6)
            params["heat"] = round(clamp((heat * 0.88) + abs(after_price - current_price) / max(current_price, 0.01), 0.0, 2.0), 6)
            params["mean_anchor"] = round((target * 0.92) + (after_price * 0.08), 6)
            self._save_token_params_locked(token_id, params)
            if abs(after_price - current_price) / max(current_price, 0.01) >= 0.025:
                label = "Synthetic bid" if pressure_side == "buy" else "Synthetic flush"
                value_cc = synthetic_cc if pressure_side == "buy" else float(flow_result["cc_out"])
                amount = float(flow_result.get("token_out") or synthetic_cc / max(current_price, 0.01))
                self._insert_market_event_locked(
                    token_id,
                    label=label,
                    step_ts=step_ts,
                    side=pressure_side,
                    value_cc=value_cc,
                    amount=amount,
                    price=after_price,
                    meta={"regime": regime, "source": "price_engine"},
                )
            return {"token_id": token_id, "symbol": token_row["symbol"], "side": pressure_side, "price": after_price}
        params["momentum"] = round(momentum * 0.9, 6)
        params["heat"] = round(heat * 0.96, 6)
        self._save_token_params_locked(token_id, params)
        self._record_pool_price_locked(token_id, ts=step_ts)
        return None

    def _resolve_token_locked(self, token_ref: Any) -> Optional[sqlite3.Row]:
        ref = str(token_ref or "").strip()
        if not ref:
            return None
        if ref.isdigit():
            row = self._one(
                """
                SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                       category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                       supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
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
                   supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
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

    def _token_price_points_locked(self, token_id: int, limit: int = 80) -> List[Dict[str, Any]]:
        rows = self._all(
            "SELECT ts, price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT ?",
            (token_id, max(2, limit)),
        )
        return [{"ts": int(row["ts"]), "price": round(float(row["price"] or 0.0), 6)} for row in reversed(rows)]

    def _save_token_params_locked(self, token_id: int, params: Dict[str, Any]) -> None:
        self.conn.execute(
            "UPDATE tokens SET params_json=? WHERE id=?",
            (json.dumps(params, separators=(",", ":")), int(token_id)),
        )

    def _market_meta_float_locked(self, key: str, default: float = 0.0) -> float:
        row = self._one("SELECT value FROM market_meta WHERE key=?", (key,))
        if not row:
            return float(default)
        try:
            return float(row["value"])
        except (TypeError, ValueError):
            return float(default)

    def _market_meta_int_locked(self, key: str, default: int = 0) -> int:
        row = self._one("SELECT value FROM market_meta WHERE key=?", (key,))
        if not row:
            return int(default)
        try:
            return int(float(row["value"]))
        except (TypeError, ValueError):
            return int(default)

    def _token_price_at_or_before_locked(self, token_id: int, ts: int) -> float:
        row = self._one(
            "SELECT price FROM prices WHERE token_id=? AND ts<=? ORDER BY ts DESC, id DESC LIMIT 1",
            (int(token_id), int(ts)),
        )
        return float(row["price"] if row else 0.0)

    def _token_change_over_seconds_locked(self, token_id: int, seconds: int, *, now: Optional[int] = None) -> float:
        now_ts_value = int(now or now_ts())
        current_price = self._token_price_locked(int(token_id))
        if current_price <= 0:
            return 0.0
        prior_price = self._token_price_at_or_before_locked(int(token_id), now_ts_value - max(1, int(seconds)))
        if prior_price <= 0:
            return 0.0
        return ((current_price - prior_price) / prior_price) * 100.0

    def _token_volume_window_locked(self, token_id: int, seconds: int) -> float:
        row = self._one(
            """
            SELECT COALESCE(SUM(ABS(value_cc)), 0) AS v
            FROM explorer_transactions
            WHERE token_id=? AND created_at>=? AND tx_kind IN ('trade', 'market_event', 'liquidity_add', 'liquidity_remove')
            """,
            (int(token_id), now_ts() - max(1, int(seconds))),
        )
        return float(row["v"] if row else 0.0)

    def _liquidity_units_total_locked(self, token_id: int) -> float:
        row = self._one("SELECT COALESCE(SUM(share_units), 0) AS u FROM liquidity_positions WHERE token_id=?", (int(token_id),))
        return float(row["u"] if row else 0.0)

    def _liquidity_units_for_wallet_locked(self, token_id: int, wallet_id: int) -> float:
        row = self._one(
            "SELECT share_units FROM liquidity_positions WHERE token_id=? AND wallet_id=?",
            (int(token_id), int(wallet_id)),
        )
        return float(row["share_units"] if row else 0.0)

    def _set_liquidity_units_locked(self, token_id: int, wallet_id: int, share_units: float) -> None:
        ts = now_ts()
        amount = max(0.0, float(share_units))
        if amount <= 0.0000001:
            self.conn.execute(
                "DELETE FROM liquidity_positions WHERE token_id=? AND wallet_id=?",
                (int(token_id), int(wallet_id)),
            )
            return
        self.conn.execute(
            """
            INSERT INTO liquidity_positions (token_id, wallet_id, share_units, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(token_id, wallet_id) DO UPDATE SET
                share_units=excluded.share_units,
                updated_at=excluded.updated_at
            """,
            (int(token_id), int(wallet_id), amount, ts, ts),
        )

    def _icon_url_locked(self, icon_file_id: Optional[int]) -> str:
        return f"/api/file/{int(icon_file_id)}" if icon_file_id else ""

    def _theme_color_from_metadata_locked(self, token_row: sqlite3.Row, metadata: Dict[str, Any]) -> str:
        raw = str(metadata.get("theme_color") or "").strip()
        if raw.startswith("#") and len(raw) in {4, 7}:
            return raw
        seed = str(token_row["slug"] or token_row["symbol"] or token_row["name"] or "ca")
        hue = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:6], 16) % 360
        return f"hsl({hue} 72% 58%)"

    def _token_reserves_locked(self, token_row: sqlite3.Row) -> Dict[str, float]:
        token_id = int(token_row["id"])
        fresh_row = self._one("SELECT symbol, launch_price, liquidity_cc, liquidity_tokens FROM tokens WHERE id=?", (token_id,))
        if not fresh_row:
            return {"cc": 0.0, "tokens": 0.0}
        if fresh_row["symbol"] == "CC":
            return {"cc": 0.0, "tokens": 0.0}
        cc_reserve = float(fresh_row["liquidity_cc"] or 0.0)
        token_reserve = float(fresh_row["liquidity_tokens"] or 0.0)
        if cc_reserve > 0.000001 and token_reserve > 0.000001:
            return {"cc": cc_reserve, "tokens": token_reserve}
        mark_price = max(0.01, self._token_price_locked(token_id) or float(fresh_row["launch_price"] or 1.0))
        cc_reserve = max(18.0, mark_price * 18.0)
        token_reserve = max(4.0, cc_reserve / mark_price)
        self.conn.execute(
            "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
            (cc_reserve, token_reserve, token_id),
        )
        return {"cc": cc_reserve, "tokens": token_reserve}

    def _record_pool_price_locked(self, token_id: int, *, ts: Optional[int] = None) -> float:
        ts_value = int(ts or now_ts())
        token_row = self._resolve_token_locked(token_id)
        if not token_row:
            return 0.0
        if token_row["symbol"] == "CC":
            price = 1.0
        else:
            reserves = self._token_reserves_locked(token_row)
            price = max(0.0001, reserves["cc"] / max(reserves["tokens"], 0.000001))
        last_row = self._one(
            "SELECT ts, price FROM prices WHERE token_id=? ORDER BY ts DESC, id DESC LIMIT 1",
            (int(token_id),),
        )
        if last_row and int(last_row["ts"]) == ts_value and abs(float(last_row["price"] or 0.0) - price) < 0.0000001:
            return price
        self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, ?)", (int(token_id), ts_value, price))
        return price

    def _quote_buy_cost_locked(self, token_row: sqlite3.Row, amount_out: float, fee_rate: float = TRADE_FEE_RATE) -> Optional[Dict[str, float]]:
        amount = float(amount_out)
        if amount <= 0:
            return None
        reserves = self._token_reserves_locked(token_row)
        x = reserves["cc"]
        y = reserves["tokens"]
        if amount >= y * 0.82:
            return None
        k = x * y
        effective_in = (k / (y - amount)) - x
        if effective_in <= 0:
            return None
        cc_total = effective_in / max(0.000001, 1.0 - fee_rate)
        current_price = x / max(y, 0.000001)
        average_price = cc_total / amount
        slippage_pct = ((average_price / max(current_price, 0.000001)) - 1.0) * 100.0
        return {
            "cc_total": cc_total,
            "fee_cc": cc_total - effective_in,
            "average_price": average_price,
            "slippage_pct": slippage_pct,
        }

    def _quote_sell_proceeds_locked(self, token_row: sqlite3.Row, amount_in: float, fee_rate: float = TRADE_FEE_RATE) -> Optional[Dict[str, float]]:
        amount = float(amount_in)
        if amount <= 0:
            return None
        reserves = self._token_reserves_locked(token_row)
        x = reserves["cc"]
        y = reserves["tokens"]
        effective_in = amount * max(0.000001, 1.0 - fee_rate)
        k = x * y
        cc_out = x - (k / (y + effective_in))
        if cc_out <= 0:
            return None
        current_price = x / max(y, 0.000001)
        average_price = cc_out / amount
        slippage_pct = (1.0 - (average_price / max(current_price, 0.000001))) * 100.0
        return {
            "cc_out": cc_out,
            "fee_cc": (amount - effective_in) * current_price,
            "average_price": average_price,
            "slippage_pct": slippage_pct,
        }

    def _apply_cc_flow_locked(
        self,
        token_row: sqlite3.Row,
        cc_in: float,
        *,
        fee_rate: float = TRADE_FEE_RATE,
        ts: Optional[int] = None,
    ) -> Optional[Dict[str, float]]:
        cc_amount = max(0.0, float(cc_in))
        if cc_amount <= 0.000001:
            return None
        reserves = self._token_reserves_locked(token_row)
        x = reserves["cc"]
        y = reserves["tokens"]
        effective_in = cc_amount * max(0.000001, 1.0 - fee_rate)
        k = x * y
        token_out = y - (k / (x + effective_in))
        if token_out <= 0.000001 or token_out >= y * 0.82:
            return None
        self.conn.execute(
            "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
            (x + cc_amount, y - token_out, int(token_row["id"])),
        )
        after_price = self._record_pool_price_locked(int(token_row["id"]), ts=ts)
        return {
            "token_out": token_out,
            "average_price": cc_amount / token_out,
            "fee_cc": cc_amount - effective_in,
            "after_price": after_price,
        }

    def _apply_token_flow_locked(
        self,
        token_row: sqlite3.Row,
        token_in: float,
        *,
        fee_rate: float = TRADE_FEE_RATE,
        ts: Optional[int] = None,
    ) -> Optional[Dict[str, float]]:
        token_amount = max(0.0, float(token_in))
        if token_amount <= 0.000001:
            return None
        reserves = self._token_reserves_locked(token_row)
        x = reserves["cc"]
        y = reserves["tokens"]
        effective_in = token_amount * max(0.000001, 1.0 - fee_rate)
        k = x * y
        cc_out = x - (k / (y + effective_in))
        if cc_out <= 0.000001:
            return None
        self.conn.execute(
            "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
            (max(0.000001, x - cc_out), y + token_amount, int(token_row["id"])),
        )
        after_price = self._record_pool_price_locked(int(token_row["id"]), ts=ts)
        return {
            "cc_out": cc_out,
            "average_price": cc_out / token_amount,
            "fee_cc": (token_amount - effective_in) * (x / max(y, 0.000001)),
            "after_price": after_price,
        }

    def _token_chart_payload_locked(self, token_id: int, *, limit: int = 80) -> Dict[str, Any]:
        points = self._token_price_points_locked(token_id, limit=limit)
        if not points:
            return {"points": [], "markers": []}
        start_ts = int(points[0]["ts"])
        tx_rows = self._all(
            """
            SELECT tx_kind, side, amount, value_cc, price, created_at, memo, meta_json
            FROM explorer_transactions
            WHERE token_id=? AND created_at>=?
            ORDER BY created_at ASC, id ASC
            """,
            (int(token_id), start_ts),
        )
        indexed = []
        for point in points:
            indexed.append({"ts": int(point["ts"]), "price": float(point["price"]), "volume_cc": 0.0})
        cursor = 0
        markers: List[Dict[str, Any]] = []
        for row in tx_rows:
            tx_ts = int(row["created_at"])
            while cursor + 1 < len(indexed) and indexed[cursor + 1]["ts"] <= tx_ts:
                cursor += 1
            indexed[cursor]["volume_cc"] += abs(float(row["value_cc"] or 0.0))
            if row["tx_kind"] not in {"trade"} or len(markers) >= 14:
                try:
                    meta = json.loads(row["meta_json"] or "{}")
                except Exception:
                    meta = {}
                label = str(meta.get("event_label") or row["memo"] or row["tx_kind"]).replace("_", " ").strip()
                markers.append(
                    {
                        "ts": tx_ts,
                        "kind": row["tx_kind"],
                        "side": row["side"],
                        "label": label[:18] or row["tx_kind"],
                    }
                )
        return {
            "points": [
                {"ts": item["ts"], "price": round(item["price"], 6), "volume_cc": round(item["volume_cc"], 6)}
                for item in indexed
            ],
            "markers": markers,
        }

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
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
            if not isinstance(metadata, dict):
                metadata = {}
        except Exception:
            metadata = {}
        return {
            "id": int(row["id"]),
            "symbol": row["symbol"],
            "name": row["name"],
            "slug": row["slug"],
            "price": round(self._token_price_locked(int(row["id"])), 6),
            "category": row["category"],
            "theme": row["theme"],
            "theme_color": self._theme_color_from_metadata_locked(row, metadata),
            "icon_url": self._icon_url_locked(int(row["icon_file_id"] or 0) or None),
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
        price_points = self._token_price_points_locked(token_id, limit=history_limit)
        history = [point["price"] for point in price_points]
        reserves = self._token_reserves_locked(token_row) if token_row["symbol"] != "CC" else {"cc": 0.0, "tokens": 0.0}
        price = history[-1] if history else (
            1.0 if token_row["symbol"] == "CC" else round(reserves["cc"] / max(reserves["tokens"], 0.000001), 6)
        )
        change_pct = self._token_change_over_seconds_locked(token_id, 900)
        change_hour = self._token_change_over_seconds_locked(token_id, 3600)
        change_day = self._token_change_over_seconds_locked(token_id, 86400)
        holder_row = self._one(
            "SELECT COUNT(*) AS c FROM balances WHERE token_id=? AND amount > 0.0000001",
            (token_id,),
        )
        recent_activity_row = self._one(
            "SELECT COUNT(*) AS c FROM explorer_transactions WHERE token_id=? AND created_at>=?",
            (token_id, now_ts() - 1800),
        )
        recent_bot_row = self._one(
            """
            SELECT COUNT(*) AS c
            FROM explorer_transactions
            WHERE token_id=? AND created_at>=? AND bot_account_id IS NOT NULL
            """,
            (token_id, now_ts() - 3600),
        )
        circulating_supply = round(float(token_row["circulating_supply"] or 0.0), 6)
        wallet_amount = round(self._wallet_amount_locked(int(wallet_id), token_id), 6) if wallet_id else 0.0
        creator = self._basic_user_ref_locked(int(token_row["creator_user_id"] or 0) or None)
        total_lp_units = self._liquidity_units_total_locked(token_id)
        creator_lp_units = self._liquidity_units_for_wallet_locked(token_id, int(token_row["creator_wallet_id"] or 0)) if token_row["creator_wallet_id"] else 0.0
        wallet_lp_units = self._liquidity_units_for_wallet_locked(token_id, int(wallet_id)) if wallet_id else 0.0
        liquidity_value_cc = 0.0 if token_row["symbol"] == "CC" else reserves["cc"] * 2.0
        recent_volume_cc = self._token_volume_window_locked(token_id, 1800)
        volume_day_cc = self._token_volume_window_locked(token_id, 86400)
        creator_lp_share_pct = 100.0 * creator_lp_units / max(total_lp_units, 0.000001) if total_lp_units else 0.0
        wallet_lp_share_pct = 100.0 * wallet_lp_units / max(total_lp_units, 0.000001) if total_lp_units else 0.0
        chaos_score = clamp(
            abs(change_pct) * 2.4
            + max(0.0, 90.0 - min(90.0, liquidity_value_cc)) * 0.75
            + max(0.0, creator_lp_share_pct - 55.0) * 0.7
            + float(recent_bot_row["c"] if recent_bot_row else 0) * 5.0,
            0.0,
            100.0,
        )
        stability_score = clamp(
            (math.log10(liquidity_value_cc + 10.0) * 28.0)
            - (abs(change_pct) * 0.7)
            - (abs(change_hour) * 0.2),
            0.0,
            100.0,
        )
        risk_score = clamp(chaos_score * 0.6 + max(0.0, 70.0 - stability_score) * 0.55, 0.0, 100.0)
        risk_flags: List[str] = []
        if token_row["symbol"] != "CC" and liquidity_value_cc < 70:
            risk_flags.append("Low liquidity")
        if token_row["symbol"] != "CC" and creator_lp_share_pct > 72:
            risk_flags.append("Creator controls pool")
        if token_row["symbol"] != "CC" and float(params.get("creator_rug_bias", 0.0)) > 0.62:
            risk_flags.append("Rug-prone creator")
        if token_row["symbol"] != "CC" and str(params.get("regime") or "") in {"panic", "dead"}:
            risk_flags.append("Panic regime")
        if token_row["symbol"] != "CC" and abs(change_day) > 45:
            risk_flags.append("Violent drawdown")
        regime = str(params.get("regime") or "grind").replace("_", " ")
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
            "theme_color": self._theme_color_from_metadata_locked(token_row, metadata),
            "website_url": token_row["website_url"],
            "icon_file_id": int(token_row["icon_file_id"] or 0) or None,
            "icon_url": self._icon_url_locked(int(token_row["icon_file_id"] or 0) or None),
            "launch_price": round(float(token_row["launch_price"] or 0.0), 6),
            "volatility_profile": token_row["volatility_profile"],
            "supply_cap": round(float(token_row["supply_cap"] or 0.0), 6),
            "circulating_supply": circulating_supply,
            "market_cap_cc": round(circulating_supply * price, 6),
            "holder_count": int(holder_row["c"] if holder_row else 0),
            "price": round(price, 6),
            "change_pct": round(change_pct, 4),
            "change_1h": round(change_hour, 4),
            "change_24h": round(change_day, 4),
            "recent_movement": round(change_pct, 4),
            "volume_cc": round(recent_volume_cc, 6),
            "volume_24h": round(volume_day_cc, 6),
            "wallet_amount": wallet_amount,
            "wallet_value_cc": round(wallet_amount * price, 6),
            "history": history,
            "chart": self._token_chart_payload_locked(token_id, limit=max(40, history_limit)),
            "params": params,
            "metadata": metadata,
            "status": token_row["status"],
            "created_at": int(token_row["created_at"]),
            "liquidity_cc": round(reserves["cc"], 6),
            "liquidity_tokens": round(reserves["tokens"], 6),
            "liquidity_value_cc": round(liquidity_value_cc, 6),
            "stability_score": round(stability_score, 2),
            "chaos_score": round(chaos_score, 2),
            "risk_score": round(risk_score, 2),
            "risk_profile": "extreme" if risk_score >= 75 else ("high" if risk_score >= 55 else ("medium" if risk_score >= 30 else "low")),
            "risk_flags": risk_flags,
            "regime": regime,
            "trend_score": round(recent_volume_cc * 0.12 + abs(change_pct) * 8.0 + float(recent_activity_row["c"] if recent_activity_row else 0) * 5.0, 4),
            "bot_participation": int(recent_bot_row["c"] if recent_bot_row else 0),
            "recent_activity_count": int(recent_activity_row["c"] if recent_activity_row else 0),
            "creator_liquidity_share_pct": round(creator_lp_share_pct, 4),
            "wallet_liquidity_share_pct": round(wallet_lp_share_pct, 4),
        }

    def _token_detail_payload_locked(self, token_row: sqlite3.Row, *, wallet_id: Optional[int] = None) -> Dict[str, Any]:
        payload = self._token_base_payload_locked(token_row, wallet_id=wallet_id, history_limit=80)
        token_id = int(token_row["id"])
        trade_rows = self._all(
            "SELECT * FROM explorer_transactions WHERE token_id=? AND tx_kind='trade' ORDER BY created_at DESC, id DESC LIMIT 20",
            (token_id,),
        )
        event_rows = self._all(
            """
            SELECT *
            FROM explorer_transactions
            WHERE token_id=? AND tx_kind IN ('trade', 'liquidity_add', 'liquidity_remove', 'market_event', 'token_create')
            ORDER BY created_at DESC, id DESC
            LIMIT 30
            """,
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
        lp_rows = self._all(
            """
            SELECT wallet_id, share_units
            FROM liquidity_positions
            WHERE token_id=?
            ORDER BY share_units DESC, wallet_id ASC
            LIMIT 10
            """,
            (token_id,),
        )
        payload["recent_trades"] = [self._explorer_transaction_payload_from_row_locked(row) for row in trade_rows]
        payload["recent_events"] = [self._explorer_transaction_payload_from_row_locked(row) for row in event_rows]
        payload["top_holders"] = [
            {
                "wallet": self._basic_wallet_ref_locked(int(row["wallet_id"])),
                "amount": round(float(row["amount"] or 0.0), 6),
                "value_cc": round(float(row["amount"] or 0.0) * payload["price"], 6),
            }
            for row in holder_rows
        ]
        total_lp_units = self._liquidity_units_total_locked(token_id)
        payload["liquidity_positions"] = [
            {
                "wallet": self._basic_wallet_ref_locked(int(row["wallet_id"])),
                "share_units": round(float(row["share_units"] or 0.0), 6),
                "share_pct": round(100.0 * float(row["share_units"] or 0.0) / max(total_lp_units, 0.000001), 4),
                "pool_value_cc": round(payload["liquidity_value_cc"] * float(row["share_units"] or 0.0) / max(total_lp_units, 0.000001), 6),
            }
            for row in lp_rows
        ]
        payload["creator_wallet"] = self._basic_wallet_ref_locked(int(token_row["creator_wallet_id"] or 0) or None)
        payload["trade_preview"] = {
            "fee_rate": TRADE_FEE_RATE,
            "can_manage_liquidity": bool(wallet_id and int(wallet_id) == int(token_row["creator_wallet_id"] or 0)),
            "wallet_liquidity_share_pct": payload["wallet_liquidity_share_pct"],
        }
        return payload

    def _wallet_list_item_locked(self, wallet_row: sqlite3.Row) -> Dict[str, Any]:
        wallet_id = int(wallet_row["id"])
        owner = self._basic_user_ref_locked(int(wallet_row["user_id"] or 0) or None)
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
            "owner": owner,
            "owner_kind": "bot" if owner and owner.get("is_bot") else (wallet_row["wallet_kind"] or "wallet"),
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
        item["summary"] = self._explorer_transaction_summary_locked(item)
        return item

    def _explorer_transaction_summary_locked(self, item: Dict[str, Any]) -> str:
        meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
        if meta.get("summary"):
            return str(meta["summary"])
        symbol = (
            str((item.get("token") or {}).get("symbol") or "")
            or str(meta.get("symbol") or "")
            or "asset"
        )
        tx_kind = str(item.get("tx_kind") or item.get("kind") or "activity").replace("_", " ")
        if item.get("tx_kind") == "trade":
            return f"{str(item.get('side') or '').upper()} {float(item.get('amount') or 0):.4f} {symbol} @ {float(item.get('price') or 0):.4f} CC"
        if item.get("tx_kind") in {"liquidity_add", "liquidity_remove"}:
            return f"{tx_kind.title()} | {float(item.get('value_cc') or 0):.2f} CC depth"
        if item.get("tx_kind") == "token_create":
            return f"Launch {symbol} | {float(item.get('value_cc') or 0):.2f} CC seeded"
        if item.get("tx_kind") == "market_event":
            return str(meta.get("event_label") or tx_kind.title())
        if item.get("tx_kind") == "wallet_transfer":
            return f"Transfer {float(item.get('amount') or 0):.4f} {symbol}"
        return f"{tx_kind.title()} | {float(item.get('amount') or 0):.4f} {symbol}"

    def _latest_market_activity_locked(self, limit: int = 20, *, bot_only: bool = False) -> List[Dict[str, Any]]:
        clause = "AND bot_account_id IS NOT NULL" if bot_only else ""
        rows = self._all(
            f"""
            SELECT *
            FROM explorer_transactions
            WHERE token_id IS NOT NULL
              AND tx_kind IN ('trade', 'liquidity_add', 'liquidity_remove', 'token_create', 'market_event', 'exchange')
              {clause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (max(1, limit),),
        )
        return [self._explorer_transaction_payload_from_row_locked(row) for row in rows]

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

    def _maybe_bot_launch_locked(self, now: int, market_mood: float) -> Optional[Dict[str, Any]]:
        last_launch = self._market_meta_int_locked("last_bot_launch_ts", 0)
        active_tokens_row = self._one("SELECT COUNT(*) AS c FROM tokens WHERE symbol!='CC' AND status='active'")
        active_tokens = int(active_tokens_row["c"] if active_tokens_row else 0)
        if now - last_launch < (150 if active_tokens < 8 else 280):
            return None
        if active_tokens >= 10 and self._det_noise(9021, now) < 0.28:
            return None
        bot_rows = self._all(
            """
            SELECT id, user_id, wallet_id, slug, strategy, risk_level, last_action_at
            FROM bot_accounts
            WHERE is_active=1 AND strategy IN ('chaos', 'rugger', 'revival', 'rotation')
            ORDER BY id ASC
            """
        )
        if not bot_rows:
            return None
        eligible = [row for row in bot_rows if self._wallet_amount_locked(int(row["wallet_id"]), self.cc_token_id()) >= 180.0]
        if not eligible:
            return None
        bot = eligible[(now // 13) % len(eligible)]
        if now - int(bot["last_action_at"] or 0) < 40:
            return None
        vocab = {
            "chaos": (["Feral", "Static", "Glitch", "Turbo"], ["Lemon", "Gremlin", "Racer", "Alarm"], "chaos"),
            "rugger": (["Exit", "Late", "Greedy", "Final"], ["Couch", "Fuse", "Curtain", "Switch"], "meme"),
            "revival": (["Return", "Echo", "Ghost", "Rescue"], ["Signal", "Beacon", "Pulse", "Thread"], "social"),
            "rotation": (["Sector", "Flow", "Drift", "Orbit"], ["Lane", "Shift", "Basket", "Index"], "utility"),
        }
        firsts, lasts, category = vocab.get(str(bot["strategy"]), vocab["chaos"])
        seed_a = abs(int(self._det_noise(int(bot["id"]) * 13, now) * 10000))
        seed_b = abs(int(self._det_noise(int(bot["id"]) * 17, now + 31) * 10000))
        name = f"{firsts[seed_a % len(firsts)]} {lasts[seed_b % len(lasts)]}"
        symbol = self._normalize_token_symbol(f"{name.split()[0][:3]}{(now % 97):02d}") or f"B{int(bot['id'])}{now % 10}"
        strategy = str(bot["strategy"])
        seed_liquidity_cc = clamp(
            self._wallet_amount_locked(int(bot["wallet_id"]), self.cc_token_id()) * (0.1 if strategy == "rugger" else 0.075),
            32.0,
            170.0,
        )
        creator_pct = 42.0 if strategy == "rugger" else (18.0 if strategy == "revival" else 28.0)
        hue = 24 if strategy == "rugger" else (196 if strategy == "revival" else (336 if strategy == "chaos" else 132))
        token = self.create_token(
            int(bot["user_id"]),
            int(bot["wallet_id"]),
            name,
            symbol,
            f"{name} launched by {bot['slug']} to farm simulated order flow.",
            "chaos" if strategy in {"chaos", "rugger"} else "medium",
            strategy,
            category=category,
            seed_liquidity_cc=seed_liquidity_cc,
            creator_allocation_pct=creator_pct,
            metadata={"bot_launch": True, "theme_color": f"hsl({hue} 74% 58%)"},
            actor_bot_id=int(bot["id"]),
        )
        if not token:
            return None
        self.conn.execute("UPDATE bot_accounts SET last_action_at=? WHERE id=?", (now, int(bot["id"])))
        self._upsert_market_meta_locked("last_bot_launch_ts", now)
        return {
            "bot_id": int(bot["id"]),
            "bot_slug": bot["slug"],
            "strategy": bot["strategy"],
            "kind": "launch",
            "token_id": token["id"],
            "symbol": token["symbol"],
            "seed_liquidity_cc": token["seed_liquidity_cc"],
            "explorer_transaction_id": token["explorer_transaction_id"],
        }

    def _run_bot_activity_locked(self, now: int, max_actions: int = 6) -> List[Dict[str, Any]]:
        token_rows = self._all(
            """
            SELECT id, creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                   category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                   supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
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
            if len(actions) >= max_actions:
                break
            try:
                parsed = json.loads(bot["config_json"] or "{}")
                config = parsed if isinstance(parsed, dict) else {}
            except Exception:
                config = {}
            cooldown = max(3, int(config.get("cooldown", 6 if bot["strategy"] in {"mean_reversion", "revival"} else 4)))
            if int(now) - int(bot["last_action_at"] or 0) < cooldown:
                continue
            wallet_id = int(bot["wallet_id"])
            cc_balance = self._wallet_amount_locked(wallet_id, cc_id)
            trade_fraction = float(config.get("trade_fraction", 0.055))
            token_views = [self._token_base_payload_locked(row, wallet_id=wallet_id, history_limit=24) for row in token_rows]
            if not token_views:
                continue
            selected = None
            action_kind = ""
            amount = 0.0
            side = ""
            share_pct = 0.0
            strategy = str(bot["strategy"])
            if strategy == "mean_reversion":
                candidates = sorted(token_views, key=lambda item: abs(float(item["price"]) - float(item["params"].get("mean_anchor", item["price"]))), reverse=True)
                selected = candidates[0]
                anchor = max(0.01, float(selected["params"].get("mean_anchor", selected["price"])))
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                if float(selected["price"]) < anchor * 0.94 and cc_balance > 24:
                    action_kind = "trade"
                    side = "buy"
                    amount = min((cc_balance * trade_fraction) / max(float(selected["price"]), 0.01), max(2.5, selected["liquidity_tokens"] * 0.035))
                elif float(selected["price"]) > anchor * 1.07 and holdings > 0.75:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.24, 0.4), max(1.2, selected["liquidity_tokens"] * 0.03))
                elif cc_balance > 26 and holdings > 6 and float(selected["liquidity_value_cc"]) < 150:
                    action_kind = "liquidity"
                    side = "add"
                    amount = clamp(cc_balance * 0.035, 8.0, 24.0)
            elif strategy == "momentum":
                candidates = sorted(token_views, key=lambda item: (float(item["trend_score"]), float(item["change_pct"])), reverse=True)
                selected = candidates[0]
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                if float(selected["change_pct"]) > 1.1 and cc_balance > 18:
                    action_kind = "trade"
                    side = "buy"
                    amount = min((cc_balance * (trade_fraction + 0.02)) / max(float(selected["price"]), 0.01), max(3.0, selected["liquidity_tokens"] * 0.04))
                elif holdings > 0.7 and float(selected["change_pct"]) < -0.8:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.32, 0.5), max(1.2, selected["liquidity_tokens"] * 0.03))
            elif strategy == "rotation":
                candidates = sorted(token_views, key=lambda item: (float(item["volume_cc"]), float(item["stability_score"])), reverse=True)
                selected = candidates[0]
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                if holdings > 0.6 and float(selected["change_1h"]) < -1.5:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.28, 0.4), 14.0)
                elif cc_balance > 22:
                    action_kind = "trade"
                    side = "buy"
                    amount = min((cc_balance * trade_fraction) / max(float(selected["price"]), 0.01), 14.0)
            elif strategy == "chaos":
                candidates = sorted(token_views, key=lambda item: (float(item["chaos_score"]), -float(item["liquidity_value_cc"])), reverse=True)
                selected = candidates[0]
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                lp_share = float(selected["wallet_liquidity_share_pct"])
                if lp_share > 4 and float(selected["trend_score"]) > 18 and self._det_noise(int(bot["id"]) * 23, now) > 0.35:
                    action_kind = "liquidity"
                    side = "remove"
                    share_pct = clamp(12.0 + abs(self._det_noise(int(selected["id"]), now)) * 18.0, 8.0, 32.0)
                elif cc_balance > 16 and float(selected["liquidity_value_cc"]) < 120:
                    action_kind = "trade"
                    side = "buy"
                    amount = min((cc_balance * (trade_fraction + 0.025)) / max(float(selected["price"]), 0.01), max(4.0, selected["liquidity_tokens"] * 0.06))
                elif holdings > 0.7:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.35, 0.5), max(2.0, selected["liquidity_tokens"] * 0.04))
            elif strategy == "revival":
                candidates = sorted(
                    token_views,
                    key=lambda item: (
                        item["regime"] in {"dead", "revival", "panic"},
                        float(item["change_24h"]) * -1.0,
                        float(item["liquidity_value_cc"]) * -1.0,
                    ),
                    reverse=True,
                )
                selected = candidates[0]
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                if cc_balance > 18 and selected["regime"] in {"dead", "revival", "panic"}:
                    if float(selected["wallet_liquidity_share_pct"]) > 0.5 and holdings > 4:
                        action_kind = "liquidity"
                        side = "add"
                        amount = clamp(cc_balance * 0.03, 6.0, 18.0)
                    else:
                        action_kind = "trade"
                        side = "buy"
                        amount = min((cc_balance * trade_fraction) / max(float(selected["price"]), 0.01), max(2.5, selected["liquidity_tokens"] * 0.03))
                elif holdings > 0.8 and float(selected["change_pct"]) > 1.4:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.18, 0.4), 10.0)
            elif strategy == "rugger":
                created = [item for item in token_views if int(item["creator_wallet_id"] or 0) == wallet_id]
                selected = (sorted(created, key=lambda item: (float(item["trend_score"]), float(item["wallet_liquidity_share_pct"])), reverse=True)[0] if created else token_views[0])
                holdings = self._wallet_amount_locked(wallet_id, int(selected["id"]))
                if float(selected["wallet_liquidity_share_pct"]) > 16 and float(selected["trend_score"]) > 12 and self._det_noise(int(bot["id"]) * 29, now) > 0.25:
                    action_kind = "liquidity"
                    side = "remove"
                    share_pct = clamp(15.0 + abs(self._det_noise(int(selected["id"]) * 5, now)) * 22.0, 12.0, 38.0)
                elif holdings > 0.8 and float(selected["change_pct"]) > 1.0:
                    action_kind = "trade"
                    side = "sell"
                    amount = min(max(holdings * 0.22, 0.5), 14.0)
                elif cc_balance > 22 and float(selected["chaos_score"]) > 35:
                    action_kind = "trade"
                    side = "buy"
                    amount = min((cc_balance * trade_fraction) / max(float(selected["price"]), 0.01), 12.0)
            if not selected or not action_kind:
                continue
            result: Optional[Dict[str, Any]] = None
            if action_kind == "trade":
                if side == "buy":
                    amount = min(amount, (cc_balance * 0.82) / max(float(selected["price"]), 0.01))
                else:
                    amount = min(amount, self._wallet_amount_locked(wallet_id, int(selected["id"])))
                if amount > 0.12:
                    result = self._execute_trade_locked(
                        int(bot["user_id"]),
                        wallet_id,
                        int(selected["id"]),
                        side,
                        round(amount, 6),
                        actor_bot_id=int(bot["id"]),
                        reason=f"bot_{strategy}",
                    )
            elif action_kind == "liquidity":
                result = self.manage_liquidity(
                    int(bot["user_id"]),
                    wallet_id,
                    int(selected["id"]),
                    side,
                    cc_amount=round(amount, 6),
                    share_pct=round(share_pct, 6),
                    actor_bot_id=int(bot["id"]),
                    reason=f"bot_{strategy}",
                )
            if not result:
                continue
            self.conn.execute("UPDATE bot_accounts SET last_action_at=? WHERE id=?", (now, int(bot["id"])))
            actions.append(
                {
                    "bot_id": int(bot["id"]),
                    "bot_slug": bot["slug"],
                    "strategy": strategy,
                    "wallet_id": wallet_id,
                    "token_id": int(selected["id"]),
                    "symbol": selected["symbol"],
                    "kind": action_kind,
                    "side": side,
                    "amount": round(float(amount if action_kind == "trade" else result.get("cc_delta", 0.0)), 6),
                    "price": round(float(result.get("price_after") or result.get("price") or selected["price"]), 6),
                    "explorer_transaction_id": result["explorer_transaction_id"],
                }
            )
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
        params = self._parse_params(token["params_json"])
        fee_rate = clamp(float(params.get("trade_fee", TRADE_FEE_RATE)), 0.0025, 0.06)
        spot_price = max(0.0001, self._record_pool_price_locked(int(token_id)))
        quote: Optional[Dict[str, float]]
        if side == "buy":
            quote = self._quote_buy_cost_locked(token, amount, fee_rate)
            if not quote:
                return None
            total_cost = float(quote["cc_total"])
            if not self._debit_balance_locked(wallet_id, cc_id, total_cost):
                return None
            reserves = self._token_reserves_locked(token)
            self.conn.execute(
                "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
                (reserves["cc"] + total_cost, reserves["tokens"] - amount, int(token_id)),
            )
            self._credit_balance_locked(wallet_id, int(token_id), amount)
            delta_cc = -total_cost
            fee_cc = float(quote["fee_cc"])
            value_cc = total_cost
            average_price = float(quote["average_price"])
            slippage_pct = float(quote["slippage_pct"])
        else:
            quote = self._quote_sell_proceeds_locked(token, amount, fee_rate)
            if not quote:
                return None
            if not self._debit_balance_locked(wallet_id, int(token_id), amount):
                return None
            proceeds = float(quote["cc_out"])
            reserves = self._token_reserves_locked(token)
            self.conn.execute(
                "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
                (max(0.000001, reserves["cc"] - proceeds), reserves["tokens"] + amount, int(token_id)),
            )
            self._credit_balance_locked(wallet_id, cc_id, proceeds)
            delta_cc = proceeds
            fee_cc = float(quote["fee_cc"])
            value_cc = proceeds
            average_price = float(quote["average_price"])
            slippage_pct = float(quote["slippage_pct"])
        ts = now_ts()
        after_price = self._record_pool_price_locked(int(token_id), ts=ts)
        updated_token = self._resolve_token_locked(token_id)
        liquidity_value = 0.0
        if updated_token and updated_token["symbol"] != "CC":
            reserves_after = self._token_reserves_locked(updated_token)
            liquidity_value = max(1.0, reserves_after["cc"] * 2.0)
        signed_pressure = (value_cc / max(liquidity_value, 1.0)) * (1.0 if side == "buy" else -1.0)
        params["momentum"] = round(clamp(float(params.get("momentum", 0.0)) * 0.76 + signed_pressure * 3.0, -1.25, 1.25), 6)
        params["heat"] = round(clamp(float(params.get("heat", 0.0)) * 0.86 + abs(signed_pressure) * 4.0, 0.0, 1.75), 6)
        params["mean_anchor"] = round((float(params.get("mean_anchor", spot_price)) * 0.9) + (after_price * 0.1), 6)
        params["last_trade_ts"] = ts
        if side == "buy" and after_price >= spot_price * 1.035:
            params["regime"] = "surge"
            params["regime_until"] = max(int(params.get("regime_until", 0) or 0), ts + 300)
        elif side == "sell" and after_price <= spot_price * 0.965:
            params["regime"] = "panic"
            params["regime_until"] = max(int(params.get("regime_until", 0) or 0), ts + 360)
        self._save_token_params_locked(int(token_id), params)
        cur = self.conn.execute(
            "INSERT INTO trades (user_id, wallet_id, token_id, side, amount, price, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, wallet_id, token_id, side, amount, average_price, ts),
        )
        tx_meta = {
            "side": side,
            "token_id": int(token_id),
            "symbol": token["symbol"],
            "amount": round(amount, 6),
            "price": round(average_price, 6),
            "spot_price": round(spot_price, 6),
            "after_price": round(after_price, 6),
            "fee_cc": round(fee_cc, 6),
            "slippage_pct": round(slippage_pct, 4),
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
            price=average_price,
            value_cc=value_cc,
            fee_cc=fee_cc,
            memo=reason,
            meta={
                "symbol": token["symbol"],
                "source_trade_id": int(cur.lastrowid),
                "spot_price": round(spot_price, 6),
                "after_price": round(after_price, 6),
                "slippage_pct": round(slippage_pct, 4),
                "summary": f"{side.upper()} {amount:.4f} {token['symbol']} @ {average_price:.4f} CC",
            },
            source_table="trades",
            source_id=int(cur.lastrowid),
            created_at=ts,
        )
        wallet_after = self._wallet_by_id_locked(wallet_id)
        return {
            "token_id": int(token_id),
            "symbol": token["symbol"],
            "side": side,
            "amount": round(amount, 6),
            "price": round(average_price, 6),
            "spot_price": round(spot_price, 6),
            "after_price": round(after_price, 6),
            "delta_cc": round(float(delta_cc), 6),
            "fee_cc": round(float(fee_cc), 6),
            "slippage_pct": round(float(slippage_pct), 4),
            "explorer_transaction_id": explorer_tx_id,
            "wallet": self._wallet_payload_locked(wallet_after or wallet),
        }

    def manage_liquidity(
        self,
        user_id: int,
        wallet_id: int,
        token_id: int,
        action: str,
        *,
        cc_amount: float = 0.0,
        share_pct: float = 0.0,
        actor_bot_id: Optional[int] = None,
        reason: str = "liquidity_panel",
    ) -> Optional[Dict[str, Any]]:
        action_key = (action or "").strip().lower()
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            token = self._resolve_token_locked(token_id)
            if not wallet or not token or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
                return None
            if token["symbol"] == "CC":
                return None
            params = self._parse_params(token["params_json"])
            reserves = self._token_reserves_locked(token)
            total_units = self._liquidity_units_total_locked(token_id)
            wallet_units = self._liquidity_units_for_wallet_locked(token_id, wallet_id)
            ts = now_ts()
            if action_key == "add":
                deposit_cc = max(1.0, float(cc_amount))
                token_needed = reserves["tokens"] * (deposit_cc / max(reserves["cc"], 0.000001))
                if not self._debit_balance_locked(wallet_id, self.cc_token_id(), deposit_cc):
                    return None
                if not self._debit_balance_locked(wallet_id, token_id, token_needed):
                    self._credit_balance_locked(wallet_id, self.cc_token_id(), deposit_cc)
                    return None
                minted_units = LIQUIDITY_BOOTSTRAP_UNITS if total_units <= 0.000001 else total_units * (deposit_cc / max(reserves["cc"], 0.000001))
                self._set_liquidity_units_locked(token_id, wallet_id, wallet_units + minted_units)
                self.conn.execute(
                    "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
                    (reserves["cc"] + deposit_cc, reserves["tokens"] + token_needed, token_id),
                )
                delta_cc = -deposit_cc
                tx_kind = "liquidity_add"
                event_label = "Liquidity added"
                units_delta = minted_units
                token_delta = token_needed
                share_fraction = minted_units / max(total_units + minted_units, 0.000001)
                params["heat"] = round(clamp(float(params.get("heat", 0.0)) * 0.7, 0.0, 1.5), 6)
                params["regime"] = params.get("regime") or "grind"
            elif action_key == "remove":
                remove_pct = clamp(float(share_pct), 0.5, 100.0)
                if wallet_units <= 0.000001 or total_units <= 0.000001:
                    return None
                units_to_burn = wallet_units * (remove_pct / 100.0)
                share_fraction = units_to_burn / max(total_units, 0.000001)
                withdraw_cc = reserves["cc"] * share_fraction
                withdraw_tokens = reserves["tokens"] * share_fraction
                self._set_liquidity_units_locked(token_id, wallet_id, wallet_units - units_to_burn)
                self.conn.execute(
                    "UPDATE tokens SET liquidity_cc=?, liquidity_tokens=? WHERE id=?",
                    (
                        max(0.000001, reserves["cc"] - withdraw_cc),
                        max(0.000001, reserves["tokens"] - withdraw_tokens),
                        token_id,
                    ),
                )
                self._credit_balance_locked(wallet_id, self.cc_token_id(), withdraw_cc)
                self._credit_balance_locked(wallet_id, token_id, withdraw_tokens)
                delta_cc = withdraw_cc
                tx_kind = "liquidity_remove"
                event_label = "Liquidity removed"
                units_delta = -units_to_burn
                token_delta = withdraw_tokens
                if int(wallet_id) == int(token["creator_wallet_id"] or 0) and remove_pct >= 45.0:
                    params["regime"] = "panic"
                    params["regime_until"] = max(int(params.get("regime_until", 0) or 0), ts + 600)
                    params["creator_rug_bias"] = round(clamp(float(params.get("creator_rug_bias", 0.35)) + 0.1, 0.0, 1.0), 6)
                    event_label = "Creator pulled liquidity"
                params["heat"] = round(clamp(float(params.get("heat", 0.0)) * 0.95 + share_fraction * 4.0, 0.0, 2.0), 6)
            else:
                return None
            after_price = self._record_pool_price_locked(token_id, ts=ts)
            params["last_liquidity_ts"] = ts
            params["mean_anchor"] = round((float(params.get("mean_anchor", after_price)) * 0.82) + (after_price * 0.18), 6)
            self._save_token_params_locked(token_id, params)
            meta = {
                "token_id": token_id,
                "symbol": token["symbol"],
                "cc_amount": round(abs(float(delta_cc)), 6),
                "token_amount": round(float(token_delta), 6),
                "share_units_delta": round(float(units_delta), 6),
                "share_fraction": round(float(share_fraction), 6),
                "event_label": event_label,
                "reason": reason,
            }
            self._insert_transaction_locked(user_id, wallet_id, tx_kind, 0, float(delta_cc), meta)
            explorer_tx_id = self._insert_explorer_transaction_locked(
                tx_kind=tx_kind,
                user_id=user_id,
                bot_account_id=actor_bot_id,
                wallet_id=wallet_id,
                token_id=token_id,
                side=action_key,
                amount=abs(float(token_delta)),
                price=after_price,
                value_cc=abs(float(delta_cc)),
                memo=reason,
                meta=meta,
                created_at=ts,
            )
            wallet_after = self._wallet_by_id_locked(wallet_id)
            return {
                "action": action_key,
                "token_id": token_id,
                "symbol": token["symbol"],
                "cc_delta": round(float(delta_cc), 6),
                "token_delta": round(float(token_delta), 6),
                "share_units_delta": round(float(units_delta), 6),
                "price_after": round(after_price, 6),
                "explorer_transaction_id": explorer_tx_id,
                "wallet": self._wallet_payload_locked(wallet_after or wallet),
            }

    def _default_token_params(
        self,
        volatility_key: str,
        initial_price: float = 10.0,
        *,
        seed_liquidity_cc: float = 60.0,
        creator_allocation_pct: float = 22.0,
        category: str = "arcade",
        market_mood: float = 0.0,
    ) -> Dict[str, Any]:
        vkey = (volatility_key or "medium").lower()
        if vkey == "low":
            base_vol = 0.012
        elif vkey == "high":
            base_vol = 0.032
        elif vkey == "chaos":
            base_vol = 0.05
        else:
            base_vol = 0.02
        liq = max(10.0, float(seed_liquidity_cc))
        liquidity_damp = clamp(1.18 - (math.log10(liq + 10.0) * 0.22), 0.38, 1.18)
        volatility = clamp(base_vol * liquidity_damp, 0.004, 0.065)
        initial_price = max(0.04, float(initial_price))
        creator_pct = clamp(float(creator_allocation_pct), 8.0, 55.0)
        category_key = self._normalize_slug(category or "arcade", fallback="arcade")
        initial_regime = "dead" if liq < 35 else ("frenzy" if category_key in {"chaos", "meme"} else "grind")
        return {
            "volatility": volatility,
            "volatility_base": volatility,
            "trade_fee": TRADE_FEE_RATE,
            "min_price": max(0.01, initial_price * 0.08),
            "max_price": max(250.0, initial_price * 80.0),
            "target_price": float(initial_price),
            "mean_anchor": float(initial_price),
            "seed_liquidity_cc": float(liq),
            "creator_allocation_pct": float(creator_pct),
            "liquidity_sensitivity": round(clamp(1.2 - math.log10(liq + 10.0) * 0.18, 0.24, 1.22), 6),
            "reversion_strength": round(clamp(0.11 + math.log10(liq + 10.0) * 0.035, 0.08, 0.32), 6),
            "creator_rug_bias": round(
                clamp(((creator_pct - 18.0) / 45.0) + (0.12 if category_key in {"chaos", "meme"} else 0.0), 0.08, 0.95),
                6,
            ),
            "bot_interest": round(clamp(0.28 + (0.2 if category_key in {"chaos", "meme"} else 0.06) + max(market_mood, 0.0) * 0.24, 0.08, 0.96), 6),
            "regime": initial_regime,
            "regime_until": now_ts() + (480 if initial_regime == "frenzy" else 720),
            "momentum": 0.0,
            "heat": 0.2 if category_key in {"chaos", "meme"} else 0.08,
            "last_trade_ts": 0,
            "last_liquidity_ts": 0,
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
        cycle = self.advance_market(now=tick_ts)
        cycle["ts"] = tick_ts
        return cycle

    def advance_market(self, now: Optional[int] = None, max_steps: int = 2400) -> Dict[str, Any]:
        now = int(now or now_ts())
        with self._lock, self.conn:
            row = self._one("SELECT value FROM market_meta WHERE key='last_step_ts'")
            last_step = int(row["value"]) if row else now
            if last_step <= 0:
                last_step = now
            if last_step >= now:
                return {"steps": 0, "last_step_ts": last_step, "downtime_seconds": 0, "bot_actions": [], "engine_events": [], "block": None}
            steps = 0
            bot_actions: List[Dict[str, Any]] = []
            engine_events: List[Dict[str, Any]] = []
            last_block = None
            mood_snapshot: Dict[str, Any] = self._market_mood_snapshot_locked(last_step)
            downtime_seconds = max(0, now - last_step)
            while last_step < now and steps < max_steps:
                remaining = max(0, now - last_step)
                if remaining <= 600:
                    step_seconds = MARKET_STEP_SECONDS
                elif remaining <= 7200:
                    step_seconds = 10
                elif remaining <= 86400:
                    step_seconds = 60
                else:
                    step_seconds = MAX_SIM_STEP_SECONDS
                remaining_steps = max(1, max_steps - steps)
                distributed = int(math.ceil(remaining / remaining_steps))
                step_seconds = max(MARKET_STEP_SECONDS, min(MAX_SIM_STEP_SECONDS, max(step_seconds, distributed)))
                step_seconds = min(step_seconds, remaining)
                if step_seconds <= 0:
                    break
                step_ts = last_step + step_seconds
                mood_snapshot = self._market_mood_snapshot_locked(step_ts)
                self.conn.execute("INSERT INTO prices (token_id, ts, price) VALUES (?, ?, 1.0)", (self.cc_token_id(), step_ts))
                token_id_rows = self._all("SELECT id FROM tokens WHERE symbol!='CC' AND status IN ('active', 'listed') ORDER BY id ASC")
                for id_row in token_id_rows:
                    token_row = self._resolve_token_locked(int(id_row["id"]))
                    if not token_row:
                        continue
                    engine_event = self._simulate_token_step_locked(
                        token_row,
                        step_ts=step_ts,
                        step_seconds=step_seconds,
                        market_mood=float(mood_snapshot.get("mood", 0.0)),
                    )
                    if engine_event:
                        engine_events.append(engine_event)
                launch = self._maybe_bot_launch_locked(step_ts, float(mood_snapshot.get("mood", 0.0)))
                if launch:
                    bot_actions.append(launch)
                bot_limit = 2 if step_seconds <= 10 else (4 if step_seconds <= 60 else 3)
                bot_actions.extend(self._run_bot_activity_locked(step_ts, max_actions=bot_limit))
                block = self._maybe_mine_block_locked(step_ts)
                if block:
                    last_block = block
                last_step = step_ts
                steps += 1
            self._upsert_market_meta_locked("last_step_ts", last_step)
            return {
                "steps": steps,
                "last_step_ts": last_step,
                "downtime_seconds": downtime_seconds,
                "bot_actions": bot_actions[-10:],
                "engine_events": engine_events[-10:],
                "block": last_block,
                "market_mood": mood_snapshot,
            }

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
            recent_pressure_row = self._one(
                """
                SELECT COALESCE(SUM(ABS(delta_cc)), 0) AS v
                FROM transactions
                WHERE user_id=? AND kind='cortisol_exchange' AND ts>=?
                """,
                (user_id, now_ts() - 3600),
            )
            rolling_pressure = float(recent_pressure_row["v"] if recent_pressure_row else 0.0)
            spread = clamp(
                EXCHANGE_BASE_FEE
                + min(0.035, rolling_pressure / 1200.0)
                + max(0.0, (cortisol_before - 1100) / 12000.0),
                EXCHANGE_BASE_FEE,
                0.14,
            )
            delta_cc = 0.0
            if kind == "stress_for_coins":
                delta_cortisol = min(amount, max(0, 5000 - cortisol_before))
                if delta_cortisol <= 0:
                    return None
                rate = 0.028 + (math.sqrt(max(25.0, cortisol_before)) / 520.0)
                gain_cc = math.floor(delta_cortisol * rate * (1.0 - spread))
                if gain_cc <= 0:
                    return None
                cortisol_after = min(5000, cortisol_before + delta_cortisol)
                self._credit_balance_locked(wallet_id, cc_id, float(gain_cc))
                delta_cc = float(gain_cc)
                meta = {
                    "kind": kind,
                    "rate": round(rate, 6),
                    "spread": round(spread, 6),
                    "delta_cortisol": delta_cortisol,
                    "gain_cc": gain_cc,
                    "event_label": "Raised cortisol for CC",
                }
                explorer_side = "buy"
                explorer_amount = float(gain_cc)
            elif kind == "coins_for_calm":
                spend = min(amount, int(cc_before))
                if spend <= 0:
                    return None
                calm_per_coin = 1.55 - min(0.55, cortisol_before / 5200.0)
                calm_delta = math.floor(spend * calm_per_coin * (1.0 - spread))
                if calm_delta <= 0:
                    return None
                cortisol_after = max(0, cortisol_before - calm_delta)
                if not self._debit_balance_locked(wallet_id, cc_id, float(spend)):
                    return None
                delta_cc = -float(spend)
                meta = {
                    "kind": kind,
                    "calm_per_coin": round(calm_per_coin, 6),
                    "spread": round(spread, 6),
                    "coins_spent": spend,
                    "calm_delta": calm_delta,
                    "event_label": "Spent CC for calm",
                }
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
                "spread": round(float(spread), 6),
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
        if sort_key in {"trending", "trend"}:
            return sorted(tokens, key=lambda item: (float(item.get("trend_score", 0.0)), float(item.get("volume_cc", 0.0))), reverse=True)
        if sort_key in {"gainers", "change_desc"}:
            return sorted(tokens, key=lambda item: (float(item.get("change_pct", 0.0)), float(item.get("trend_score", 0.0))), reverse=True)
        if sort_key in {"losers", "change_asc"}:
            return sorted(tokens, key=lambda item: (float(item.get("change_pct", 0.0)), float(item.get("chaos_score", 0.0))))
        if sort_key in {"chaos", "chaos_desc"}:
            return sorted(tokens, key=lambda item: (float(item.get("chaos_score", 0.0)), float(item.get("risk_score", 0.0))), reverse=True)
        if sort_key in {"liquidity", "liquidity_desc"}:
            return sorted(tokens, key=lambda item: (float(item.get("liquidity_value_cc", 0.0)), float(item.get("market_cap_cc", 0.0))), reverse=True)
        if sort_key in {"price_desc", "price_asc"}:
            return sorted(tokens, key=lambda item: (float(item["price"]), item["symbol"]), reverse=reverse)
        if sort_key in {"change_desc", "change_asc"}:
            return sorted(tokens, key=lambda item: (float(item["change_pct"]), item["symbol"]), reverse=reverse)
        if sort_key in {"volume_desc", "volume_asc", "volume", "highest_volume"}:
            return sorted(tokens, key=lambda item: (float(item["volume_cc"]), item["symbol"]), reverse=sort_key not in {"volume_asc"})
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
                       supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
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
                creator_name = str((item.get("creator") or {}).get("display_name") or "")
                creator_username = str((item.get("creator") or {}).get("username") or "")
                if search_l and not any(
                    search_l in str(item.get(key, "")).lower()
                    for key in ("name", "symbol", "slug", "description", "theme", "category", "regime")
                ) and search_l not in creator_name.lower() and search_l not in creator_username.lower():
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
            if not selected_token and tokens:
                token_row = self._resolve_token_locked(tokens[0]["id"])
                if token_row:
                    selected_token = self._token_detail_payload_locked(token_row, wallet_id=int(wallet["id"]))
            mood_row = self._one("SELECT value FROM market_meta WHERE key='market_mood_regime'")
            mood = {
                "value": round(self._market_meta_float_locked("market_mood", 0.08), 6),
                "regime": str(mood_row["value"] if mood_row else "balanced"),
            }
            screener_views = {
                "trending": self._sort_market_tokens_locked(tokens[:], "trending")[:8],
                "newest": self._sort_market_tokens_locked(tokens[:], "newest")[:8],
                "gainers": self._sort_market_tokens_locked(tokens[:], "gainers")[:8],
                "losers": self._sort_market_tokens_locked(tokens[:], "losers")[:8],
                "chaos": self._sort_market_tokens_locked(tokens[:], "chaos")[:8],
            }
            market_activity = self._latest_market_activity_locked(limit=24)
            top_bot_trades = self._latest_market_activity_locked(limit=18, bot_only=True)
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
                    "liquidity_value_cc": round(sum(float(item.get("liquidity_value_cc", 0.0)) for item in tokens if item["symbol"] != "CC"), 6),
                    "market_mood": mood,
                },
                "filters": {
                    "search": search,
                    "sort": sort,
                    "owned_only": bool(owned_only),
                    "category": category,
                    "limit": limit,
                    "token_ref": token_ref,
                },
                "views": screener_views,
                "market_activity": market_activity,
                "top_bot_trades": top_bot_trades,
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
        seed_liquidity_cc: float = MIN_LAUNCH_LIQUIDITY_CC,
        creator_allocation_pct: float = 22.0,
        initial_supply: float = DEFAULT_TOKEN_AIRDROP,
        supply_cap: float = DEFAULT_TOKEN_SUPPLY_CAP,
        launch_price: float = 10.0,
        metadata: Optional[Dict[str, Any]] = None,
        actor_bot_id: Optional[int] = None,
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
            seed_liquidity_cc = max(MIN_LAUNCH_LIQUIDITY_CC, float(seed_liquidity_cc or initial_supply or MIN_LAUNCH_LIQUIDITY_CC))
            creator_allocation_pct = clamp(float(creator_allocation_pct), 8.0, 55.0)
            initial_supply = max(1.0, float(initial_supply))
        except (TypeError, ValueError):
            return None
        if icon_file_id:
            file_row = self.get_file(int(icon_file_id))
            if not file_row or int(file_row["deleted"]) == 1 or not self.can_access_file(user_id, int(icon_file_id)):
                return None
        token_meta = metadata.copy() if isinstance(metadata, dict) else {}
        slug_base = self._normalize_slug(f"{clean_name}-{clean_symbol}", fallback=clean_symbol)
        with self._lock, self.conn:
            wallet = self._wallet_by_id_locked(wallet_id)
            if not wallet or bool(wallet["deleted"]) or int(wallet["user_id"] or 0) != int(user_id):
                return None
            cc_balance = self._wallet_amount_locked(wallet_id, self.cc_token_id())
            if cc_balance + 1e-9 < seed_liquidity_cc:
                return None
            if self._one("SELECT id FROM tokens WHERE symbol=?", (clean_symbol,)):
                return None
            slug = slug_base
            suffix = 2
            while self._one("SELECT id FROM tokens WHERE slug=?", (slug,)):
                slug = f"{slug_base[:43]}-{suffix}"
                suffix += 1
            market_mood = self._market_meta_float_locked("market_mood", 0.08)
            brand_noise = (int(hashlib.sha256(clean_symbol.encode("utf-8")).hexdigest()[:6], 16) / float(0xFFFFFF)) - 0.5
            derived_launch_price = clamp(
                (0.18 + math.log10(seed_liquidity_cc + 10.0) * 0.22 + (brand_noise * 0.12)) * (1.0 + (market_mood * 0.08)),
                0.06,
                5.5,
            )
            pool_tokens = max(18.0, seed_liquidity_cc / max(derived_launch_price, 0.01))
            creator_tokens = max(4.0, pool_tokens * (creator_allocation_pct / max(1.0, 100.0 - creator_allocation_pct)))
            circulating_supply = pool_tokens + creator_tokens
            supply_cap = max(float(supply_cap or 0.0), circulating_supply * (4.0 + abs(brand_noise) * 3.5))
            params = self._default_token_params(
                volatility,
                initial_price=derived_launch_price,
                seed_liquidity_cc=seed_liquidity_cc,
                creator_allocation_pct=creator_allocation_pct,
                category=clean_category,
                market_mood=market_mood,
            )
            params["theme"] = clean_theme
            params["category"] = clean_category
            ts = now_ts()
            token_meta["seed_liquidity_cc"] = round(seed_liquidity_cc, 6)
            token_meta["creator_allocation_pct"] = round(creator_allocation_pct, 4)
            token_meta["creator_allocation_tokens"] = round(creator_tokens, 6)
            token_meta["theme_color"] = str(token_meta.get("theme_color") or "").strip()
            cur = self.conn.execute(
                """
                INSERT INTO tokens (
                    creator_user_id, creator_wallet_id, name, symbol, slug, description, params_json, created_at,
                    category, theme, website_url, icon_file_id, launch_price, volatility_profile,
                    supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
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
                    float(derived_launch_price),
                    (volatility or "medium").lower(),
                    float(supply_cap),
                    float(circulating_supply),
                    json.dumps(token_meta, separators=(",", ":")),
                    float(seed_liquidity_cc),
                    float(pool_tokens),
                ),
            )
            token_id = int(cur.lastrowid)
            self._debit_balance_locked(wallet_id, self.cc_token_id(), float(seed_liquidity_cc))
            self._credit_balance_locked(wallet_id, token_id, float(creator_tokens))
            self._set_liquidity_units_locked(token_id, wallet_id, LIQUIDITY_BOOTSTRAP_UNITS)
            self._record_pool_price_locked(token_id, ts=ts)
            self._insert_transaction_locked(
                user_id,
                wallet_id,
                "token_launch",
                0,
                -float(seed_liquidity_cc),
                {
                    "token_id": token_id,
                    "symbol": clean_symbol,
                    "seed_liquidity_cc": round(seed_liquidity_cc, 6),
                    "creator_allocation_tokens": round(creator_tokens, 6),
                    "launch_price": round(derived_launch_price, 6),
                    "theme": clean_theme,
                },
            )
            explorer_tx_id = self._insert_explorer_transaction_locked(
                tx_kind="token_create",
                user_id=user_id,
                bot_account_id=actor_bot_id,
                wallet_id=wallet_id,
                token_id=token_id,
                side="launch",
                amount=float(creator_tokens),
                price=float(derived_launch_price),
                value_cc=float(seed_liquidity_cc + (creator_tokens * derived_launch_price)),
                memo="token launch",
                meta={
                    "symbol": clean_symbol,
                    "theme": clean_theme,
                    "category": clean_category,
                    "event_label": "Token launch",
                    "seed_liquidity_cc": round(seed_liquidity_cc, 6),
                },
                source_table="tokens",
                source_id=token_id,
                created_at=ts,
            )
            liquidity_tx_id = self._insert_explorer_transaction_locked(
                tx_kind="liquidity_add",
                user_id=user_id,
                bot_account_id=actor_bot_id,
                wallet_id=wallet_id,
                token_id=token_id,
                side="seed",
                amount=float(pool_tokens),
                price=float(derived_launch_price),
                value_cc=float(seed_liquidity_cc),
                memo="seed_liquidity",
                meta={
                    "symbol": clean_symbol,
                    "event_label": "Seed liquidity",
                    "share_units_delta": LIQUIDITY_BOOTSTRAP_UNITS,
                },
                created_at=ts,
            )
            token_row = self._resolve_token_locked(token_id)
            assert token_row is not None
            payload = self._token_detail_payload_locked(token_row, wallet_id=wallet_id)
            payload["seed_liquidity_cc"] = round(float(seed_liquidity_cc), 6)
            payload["creator_allocation_tokens"] = round(float(creator_tokens), 6)
            payload["creator_allocation_pct"] = round(float(creator_allocation_pct), 4)
            payload["explorer_transaction_id"] = explorer_tx_id
            payload["liquidity_transaction_id"] = liquidity_tx_id
            return payload

    def wallets_api_payload(self, user_id: int) -> Dict[str, Any]:
        self.advance_market()
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
        mood_row = self._one("SELECT value FROM market_meta WHERE key='market_mood_regime'")
        return {
            "wallets": wallets,
            "default_wallet_id": wallets[0]["id"] if wallets else None,
            "transactions": transactions,
            "summary": {
                "wallet_count": len(wallets),
                "total_value_cc": round(sum(float(wallet["total_value_cc"]) for wallet in wallets), 6),
                "pending_explorer_transactions": len(self.explorer_transactions(limit=200, status="pending")["transactions"]),
                "market_mood": {
                    "value": round(self._market_meta_float_locked("market_mood", 0.08), 6),
                    "regime": str(mood_row["value"] if mood_row else "balanced"),
                },
            },
            "bots": self.list_bot_accounts(limit=6),
            "recent_blocks": recent_blocks,
            "market_activity": self._latest_market_activity_locked(limit=10),
            "bot_activity": self._latest_market_activity_locked(limit=10, bot_only=True),
        }

    def dashboard_payload(self, user_id: int, wallet_id: Optional[int] = None) -> Dict[str, Any]:
        wallet_payload = self.wallets_api_payload(user_id)
        default_wallet_id = wallet_id or wallet_payload.get("default_wallet_id")
        market = self.market_snapshot(user_id, wallet_id=int(default_wallet_id) if default_wallet_id else None, limit=12)
        selected_wallet = next(
            (wallet for wallet in wallet_payload.get("wallets", []) if int(wallet["id"]) == int(default_wallet_id or 0)),
            (wallet_payload.get("wallets") or [None])[0],
        )
        movers = sorted(market["tokens"], key=lambda item: abs(float(item.get("change_pct", 0.0))), reverse=True)[:6]
        market_cards = [
            {
                "label": "Mood",
                "value": f"{market['summary']['market_mood']['regime']}",
                "detail": f"{market['summary']['market_mood']['value']:+.2f} net bias",
            },
            {
                "label": "Liquidity",
                "value": f"{market['summary']['liquidity_value_cc']:.0f} CC",
                "detail": "Visible pool depth",
            },
            {
                "label": "Pending tx",
                "value": str(wallet_payload["summary"]["pending_explorer_transactions"]),
                "detail": "Awaiting block inclusion",
            },
            {
                "label": "Bots online",
                "value": str(len(wallet_payload.get("bots", []))),
                "detail": "Autonomous actors active",
            },
        ]
        return {
            "me": self.me_payload(user_id),
            "stats": self.get_stats(user_id),
            "wallets_payload": wallet_payload,
            "wallets": wallet_payload.get("wallets", []),
            "selected_wallet": selected_wallet,
            "portfolio_total_cc": wallet_payload["summary"]["total_value_cc"],
            "recent_activity": wallet_payload.get("transactions", [])[:10],
            "top_movers": movers,
            "bot_feed": market.get("top_bot_trades", [])[:8],
            "your_tokens": selected_wallet.get("tokens", []) if selected_wallet else [],
            "market_cards": market_cards,
            "notifications": [],
            "market_stats": {
                "active_tokens": market["summary"]["token_count"],
                "market_cap_cc": market["summary"]["market_cap_cc"],
                "volume_cc": market["summary"]["volume_cc"],
                "liquidity_value_cc": market["summary"]["liquidity_value_cc"],
                "mood": market["summary"]["market_mood"],
            },
            "market": {
                "summary": market["summary"],
                "tokens": market["tokens"][:8],
                "selected_token": market["selected_token"],
                "activity": market.get("market_activity", [])[:10],
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
                WHERE COALESCE(deleted, 0)=0
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
                       supply_cap, circulating_supply, metadata_json, status, liquidity_cc, liquidity_tokens
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
            mood_row = self._one("SELECT value FROM market_meta WHERE key='market_mood_regime'")
            counts = {
                "blocks": int(self._one("SELECT COUNT(*) AS c FROM explorer_blocks")["c"]),
                "transactions": int(self._one("SELECT COUNT(*) AS c FROM explorer_transactions")["c"]),
                "wallets": int(self._one("SELECT COUNT(*) AS c FROM wallets WHERE COALESCE(deleted, 0)=0")["c"]),
                "tokens": int(self._one("SELECT COUNT(*) AS c FROM tokens WHERE status != 'hidden'")["c"]),
                "bots": int(self._one("SELECT COUNT(*) AS c FROM bot_accounts WHERE is_active=1")["c"]),
                "market_mood": {
                    "value": round(self._market_meta_float_locked("market_mood", 0.08), 6),
                    "regime": str(mood_row["value"] if mood_row else "balanced"),
                },
            }
        return {
            "counts": counts,
            "latest_blocks": self.explorer_blocks(limit=limit_blocks)["blocks"],
            "latest_transactions": self.explorer_transactions(limit=limit_transactions)["transactions"],
            "top_tokens": self.explorer_tokens(limit=5, sort="market_cap_desc")["tokens"],
            "top_wallets": self.explorer_wallets(limit=5, sort="value_desc")["wallets"],
            "bots": self.list_bot_accounts(limit=5),
            "market_activity": self._latest_market_activity_locked(limit=12),
        }

    def explorer_search(self, query: str, limit: int = 8) -> Dict[str, Any]:
        q = str(query or "").strip()
        if not q:
            return {"query": "", "wallets": [], "tokens": [], "transactions": [], "blocks": []}
        like = f"%{q.lower()}%"
        with self._lock:
            token_rows = self._all(
                """
                SELECT id
                FROM tokens
                WHERE lower(name) LIKE ? OR lower(symbol) LIKE ? OR lower(slug) LIKE ? OR lower(description) LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (like, like, like, like, max(1, limit)),
            )
            wallet_rows = self._all(
                """
                SELECT id
                FROM wallets
                WHERE lower(address) LIKE ? OR lower(name) LIKE ? OR lower(label) LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (like, like, like, max(1, limit)),
            )
            tx_rows = self._all(
                """
                SELECT *
                FROM explorer_transactions
                WHERE lower(tx_hash) LIKE ? OR lower(memo) LIKE ? OR lower(meta_json) LIKE ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (like, like, like, max(1, limit)),
            )
            block_rows = self._all(
                """
                SELECT *
                FROM explorer_blocks
                WHERE lower(block_hash) LIKE ? OR CAST(height AS TEXT)=?
                ORDER BY height DESC
                LIMIT ?
                """,
                (like, q, max(1, limit)),
            )
            return {
                "query": q,
                "wallets": [self._wallet_list_item_locked(self._wallet_by_id_locked(int(row["id"]))) for row in wallet_rows if self._wallet_by_id_locked(int(row["id"]))],
                "tokens": [self._token_base_payload_locked(self._resolve_token_locked(int(row["id"])), history_limit=20) for row in token_rows if self._resolve_token_locked(int(row["id"]))],
                "transactions": [self._explorer_transaction_payload_from_row_locked(row) for row in tx_rows],
                "blocks": [self.explorer_block(int(row["height"]))["block"] for row in block_rows if self.explorer_block(int(row["height"]))],
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
