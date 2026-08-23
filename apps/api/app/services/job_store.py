"""Redis-backed async job status store (import, hydrate, …)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import redis

from app.core.config import settings

_DEFAULT_KIND = "import"


def new_trace_id() -> str:
    return uuid.uuid4().hex


def normalize_trace_id(raw: str | None) -> str:
    """Safe correlation id for logs / job payloads (ADR 0007)."""
    t = str(raw or "").strip()
    if not t:
        return new_trace_id()
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "" for ch in t)[:64]
    return cleaned or new_trace_id()


def _normalize_kind(kind: str | None) -> str:
    k = str(kind or _DEFAULT_KIND).strip().lower() or _DEFAULT_KIND
    # Keep Redis key segment safe.
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in k)[:32]


def job_key(job_id: str, *, kind: str = _DEFAULT_KIND) -> str:
    return f"{_normalize_kind(kind)}_job:{job_id}"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def save_job(job_id: str, payload: dict[str, Any], *, kind: str = _DEFAULT_KIND) -> None:
    client = _client()
    client.set(
        job_key(job_id, kind=kind),
        json.dumps(payload, ensure_ascii=False),
        ex=settings.job_ttl_seconds,
    )


def get_job(job_id: str, *, kind: str = _DEFAULT_KIND) -> dict[str, Any] | None:
    raw = _client().get(job_key(job_id, kind=kind))
    if not raw:
        return None
    return json.loads(raw)


def update_job(job_id: str, *, kind: str = _DEFAULT_KIND, **fields: Any) -> dict[str, Any] | None:
    current = get_job(job_id, kind=kind)
    if current is None:
        return None
    current.update(fields)
    save_job(job_id, current, kind=kind)
    return current


_DLQ_MAX = 500
_DLQ_KINDS = ("hydrate", "export")


def _dlq_key(kind: str) -> str:
    k = _normalize_kind(kind)
    if k not in _DLQ_KINDS:
        raise ValueError(f"unknown dlq kind: {kind}")
    return f"recombyn:dlq:{k}"


def push_dlq(kind: str, entry: dict[str, Any]) -> None:
    """Append a terminal job failure for ops replay. Best-effort (never raise)."""
    try:
        client = _client()
        key = _dlq_key(kind)
        payload = json.dumps(entry, ensure_ascii=False)
        client.lpush(key, payload)
        client.ltrim(key, 0, _DLQ_MAX - 1)
        client.expire(key, max(settings.job_ttl_seconds, 7 * 86400))
    except Exception:
        import logging

        logging.getLogger(__name__).warning(
            "%s DLQ push failed job_id=%s",
            kind,
            entry.get("job_id"),
            exc_info=True,
        )


def list_dlq(kind: str, *, limit: int = 50) -> list[dict[str, Any]]:
    raw = _client().lrange(_dlq_key(kind), 0, max(0, limit - 1))
    out: list[dict[str, Any]] = []
    for item in raw or []:
        try:
            out.append(json.loads(item))
        except Exception:
            out.append({"_raw": str(item)[:200]})
    return out


def dlq_depth(kind: str) -> int:
    try:
        return int(_client().llen(_dlq_key(kind)) or 0)
    except Exception:
        return 0


def remove_dlq_job(kind: str, job_id: str) -> int:
    jid = str(job_id or "").strip()
    if not jid:
        return 0
    client = _client()
    key = _dlq_key(kind)
    raw = client.lrange(key, 0, -1) or []
    removed = 0
    for item in raw:
        try:
            entry = json.loads(item)
        except Exception:
            continue
        if str(entry.get("job_id") or "") != jid:
            continue
        removed += int(client.lrem(key, 0, item) or 0)
    return removed
