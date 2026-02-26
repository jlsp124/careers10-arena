import json
import os
import secrets
import socket
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "web"
UPLOAD_ROOT = Path(__file__).resolve().parent / "uploads"
DATA_ROOT = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_ROOT / "careers10_arena.sqlite3"


def ensure_dirs() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def now_ts() -> int:
    return int(time.time())


def now_ms() -> int:
    return int(time.time() * 1000)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def random_token(nbytes: int = 24) -> str:
    return secrets.token_urlsafe(nbytes)


def random_hex(nbytes: int = 16) -> str:
    return secrets.token_hex(nbytes)


def parse_bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def get_env_config() -> Dict[str, Any]:
    max_upload_mb = safe_int(os.getenv("MAX_UPLOAD_MB"), 200)
    max_total_storage_gb = safe_int(os.getenv("MAX_TOTAL_STORAGE_GB"), 10)
    retention_hours = safe_int(os.getenv("RETENTION_HOURS"), 24)
    allowlist = os.getenv("UPLOAD_ALLOWLIST_MIME", "").strip()
    admin_bootstrap_secret = os.getenv("ADMIN_BOOTSTRAP_SECRET", "").strip()
    return {
        "MAX_UPLOAD_MB": max_upload_mb,
        "MAX_UPLOAD_BYTES": max_upload_mb * 1024 * 1024,
        "MAX_TOTAL_STORAGE_GB": max_total_storage_gb,
        "MAX_TOTAL_STORAGE_BYTES": max_total_storage_gb * 1024 * 1024 * 1024,
        "RETENTION_HOURS": retention_hours,
        "RETENTION_SECONDS": retention_hours * 3600,
        "UPLOAD_ALLOWLIST_MIME": [x.strip() for x in allowlist.split(",") if x.strip()],
        "ADMIN_BOOTSTRAP_SECRET": admin_bootstrap_secret,
        "TEACHER_SAFE_MODE_DEFAULT": parse_bool_env("TEACHER_SAFE_MODE_DEFAULT", True),
    }


def local_ips() -> List[str]:
    ips = {"127.0.0.1"}
    host = socket.gethostname()
    try:
        for info in socket.getaddrinfo(host, None, family=socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("169.254."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


def json_dumps(data: Any) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=True)


def json_loads(text: str) -> Any:
    return json.loads(text)


def cortisol_tier(cortisol: int) -> str:
    if cortisol <= 300:
        return "Zen"
    if cortisol <= 700:
        return "Calm"
    if cortisol <= 1200:
        return "Stable"
    return "Cooked"


def summarize_online(users: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for u in users:
        out.append(
            {
                "id": u["id"],
                "username": u["username"],
                "display_name": u.get("display_name") or u["username"],
                "is_admin": bool(u.get("is_admin", 0)),
            }
        )
    return out

