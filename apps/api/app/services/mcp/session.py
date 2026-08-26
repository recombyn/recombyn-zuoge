"""Live editor session tracking for MCP (avoid double-apply headless + FE)."""
from __future__ import annotations

import time

from app.services.mcp.tool_registry import live_session_ttl_sec


def _redis():
    from app.core.config import settings
    import redis

    return redis.from_url(settings.redis_url, decode_responses=True)


def _live_key(project_id: str) -> str:
    return f"mcp:live:{str(project_id or '').strip()}"


def touch_live_session(project_id: str, *, user_id: str | None = None) -> None:
    pid = str(project_id or "").strip()
    if not pid:
        return
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return
        client = _redis()
        payload = str(user_id or "anon")
        client.setex(_live_key(pid), max(5, live_session_ttl_sec()), payload)
    except Exception:
        pass


def has_live_session(project_id: str) -> bool:
    pid = str(project_id or "").strip()
    if not pid:
        return False
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return False
        return bool(_redis().exists(_live_key(pid)))
    except Exception:
        return False


def live_session_age_ms(project_id: str) -> int | None:
    pid = str(project_id or "").strip()
    if not pid:
        return None
    try:
        ttl = _redis().ttl(_live_key(pid))
        if ttl is None or ttl < 0:
            return None
        return int((live_session_ttl_sec() - ttl) * 1000)
    except Exception:
        return None
