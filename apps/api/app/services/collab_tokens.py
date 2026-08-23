"""HMAC room tokens for the Yjs collab WebSocket server.

Shared secret: COLLAB_TOKEN_SECRET (must match apps/collab).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Literal


CollabRole = Literal["edit", "view"]

_DEFAULT_TTL_SEC = 60 * 60 * 6  # 6 hours


def _secret() -> bytes:
    raw = (os.getenv("COLLAB_TOKEN_SECRET") or "").strip()
    if not raw:
        # Dev fallback — production must set COLLAB_TOKEN_SECRET.
        raw = "dev-collab-token-secret-change-me"
    return raw.encode("utf-8")


def public_ws_url() -> str:
    return (os.getenv("COLLAB_PUBLIC_WS_URL") or "ws://127.0.0.1:1234").rstrip("/")


def mint_room_token(
    *,
    room_id: str,
    user_id: str,
    role: CollabRole,
    name: str = "",
    ttl_sec: int = _DEFAULT_TTL_SEC,
) -> dict[str, Any]:
    exp = int(time.time()) + max(60, int(ttl_sec))
    payload = {
        "roomId": str(room_id),
        "userId": str(user_id),
        "role": role,
        "name": str(name or "")[:64],
        "exp": exp,
    }
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).decode("ascii").rstrip("=")
    sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    token = f"{body}.{sig_b64}"
    return {
        "token": token,
        "roomId": payload["roomId"],
        "wsUrl": public_ws_url(),
        "role": role,
        "expiresAt": exp * 1000,
    }


def verify_room_token(token: str) -> dict[str, Any] | None:
    """Return payload dict or None when invalid / expired."""
    raw = (token or "").strip()
    if not raw or "." not in raw:
        return None
    body, _, sig_b64 = raw.partition(".")
    if not body or not sig_b64:
        return None
    try:
        pad = "=" * (-len(sig_b64) % 4)
        sig = base64.urlsafe_b64decode(sig_b64 + pad)
    except Exception:
        return None
    expect = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        pad = "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body + pad).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    exp = int(payload.get("exp") or 0)
    if exp < int(time.time()):
        return None
    room_id = str(payload.get("roomId") or "").strip()
    user_id = str(payload.get("userId") or "").strip()
    role = str(payload.get("role") or "").strip()
    if not room_id or not user_id or role not in ("edit", "view"):
        return None
    return {
        "roomId": room_id,
        "userId": user_id,
        "role": role,
        "name": str(payload.get("name") or ""),
        "exp": exp,
    }
