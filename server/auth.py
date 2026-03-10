import hashlib
import hmac
import secrets
from typing import Optional

from aiohttp import web

from util import now_ts


PBKDF2_ROUNDS = 200_000


def hash_password(password: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, digest_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return hmac.compare_digest(digest.hex(), digest_hex)


def extract_token(request: web.Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    header_token = request.headers.get("X-Session-Token", "").strip()
    if header_token:
        return header_token
    query_token = request.query.get("token", "").strip()
    if query_token:
        return query_token
    cookie_token = request.cookies.get("session_token")
    return cookie_token.strip() if cookie_token else None


def require_user(request: web.Request) -> dict:
    user = request.get("user")
    if not user:
        raise web.HTTPUnauthorized(text='{"error":"auth_required"}', content_type="application/json")
    return user


@web.middleware
async def auth_middleware(request: web.Request, handler):
    db = request.app["db"]
    request["user"] = None
    token = extract_token(request)
    if token:
        user = db.get_user_by_session(token, now_ts())
        if user:
            request["user"] = user
            request["session_token"] = token
    return await handler(request)

