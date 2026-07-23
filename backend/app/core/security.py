import hmac
import hashlib
import base64
import json
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Header
from app.core.config import get_settings

settings = get_settings()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def create_token(payload: dict, expires_minutes: int = 480) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload = {**payload, "exp": exp.isoformat()}
    header = _b64(json.dumps({"alg": "HS256"}).encode())
    body = _b64(json.dumps(payload).encode())
    sig = hmac.new(settings.secret_key.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64(sig)}"


def verify_token(token: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, body, sig = parts
        expected = _b64(hmac.new(settings.secret_key.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=="))
        if datetime.fromisoformat(payload["exp"]) < datetime.now(timezone.utc):
            return None
        return payload
    except Exception:
        return None


async def get_current_user(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def require_roles(*roles: str):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user.get("role") not in roles and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail=f"Requires role: {', '.join(roles)}")
        return user
    return checker


def require_exact_roles(*roles: str, message: str | None = None):
    """Like require_roles but WITHOUT the implicit admin bypass. Used for vendor
    compliance decisions — the business rule states admin must not approve/reject
    financial or compliance actions, only the Compliance Reviewer may."""
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user.get("role") not in roles:
            raise HTTPException(status_code=403, detail=message or f"Requires role: {', '.join(roles)}")
        return user
    return checker


def deny_roles(*blocked: str, message: str = "Your role has no vendor access"):
    """Allow any authenticated user EXCEPT the listed roles. Used for vendor read
    access — the business rule states Requesters have no vendor access at all."""
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") in blocked:
            raise HTTPException(status_code=403, detail=message)
        return user
    return checker
