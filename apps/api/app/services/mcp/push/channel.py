"""Notify open editors / pending MCP tool_ops queue."""
from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Any

_log = logging.getLogger(__name__)


def _redis():
    from app.core.config import settings
    import redis

    return redis.from_url(settings.redis_url, decode_responses=True)


def publish_project_revision(project_id: str, revision: int, *, reason: str = "mcp") -> None:
    pid = str(project_id or "").strip()
    if not pid:
        return
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return
        payload = json.dumps(
            {"projectId": pid, "revision": int(revision), "reason": reason, "ts": time.time()},
            ensure_ascii=False,
        )
        _redis().publish(f"mcp:canvas:{pid}", payload)
    except Exception:
        _log.debug("mcp publish_project_revision skipped", exc_info=True)


def publish_pending_ops(project_id: str, ops: list[dict[str, Any]]) -> str:
    """Queue validated ops for live editor apply. Returns batch id."""
    pid = str(project_id or "").strip()
    batch_id = secrets.token_hex(8)
    if not pid or not ops:
        return batch_id
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return batch_id
        client = _redis()
        key = f"mcp:pending:{pid}"
        payload = json.dumps(
            {"batchId": batch_id, "ops": ops, "ts": time.time()},
            ensure_ascii=False,
        )
        client.rpush(key, payload)
        client.expire(key, 600)
    except Exception:
        _log.debug("mcp publish_pending_ops skipped", exc_info=True)
    return batch_id


def fetch_pending_batches(project_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    pid = str(project_id or "").strip()
    if not pid:
        return []
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return []
        client = _redis()
        key = f"mcp:pending:{pid}"
        raw_items = client.lrange(key, 0, max(0, limit - 1))
        out: list[dict[str, Any]] = []
        for raw in raw_items or []:
            try:
                item = json.loads(raw)
                if isinstance(item, dict) and item.get("ops"):
                    out.append(item)
            except json.JSONDecodeError:
                continue
        return out
    except Exception:
        return []


def ack_pending_batches(project_id: str, batch_ids: list[str]) -> int:
    """Remove acknowledged batches from the pending queue."""
    pid = str(project_id or "").strip()
    if not pid or not batch_ids:
        return 0
    want = {str(b).strip() for b in batch_ids if str(b or "").strip()}
    if not want:
        return 0
    try:
        from app.core.config import settings

        if not settings.mcp_canvas_enabled:
            return 0
        client = _redis()
        key = f"mcp:pending:{pid}"
        items = client.lrange(key, 0, -1)
        if not items:
            return 0
        kept: list[str] = []
        removed = 0
        for raw in items:
            try:
                item = json.loads(raw)
                bid = str(item.get("batchId") or "").strip()
                if bid and bid in want:
                    removed += 1
                    continue
            except json.JSONDecodeError:
                pass
            kept.append(raw)
        pipe = client.pipeline()
        pipe.delete(key)
        if kept:
            pipe.rpush(key, *kept)
            pipe.expire(key, 600)
        pipe.execute()
        return removed
    except Exception:
        return 0
