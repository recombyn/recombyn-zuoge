"""Job store: Redis if available, else JSON files under workspace/jobs."""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from recombyn_intelligence_service.vision.config import settings

_KIND = "pipeline"
_file_lock = threading.Lock()


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


def _file_path(job_id: str) -> Path:
    d = settings.workspace / "jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{job_id}.json"


def _redis():
    try:
        import redis

        return redis.Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        return None


def save_job(job_id: str, payload: dict[str, Any]) -> None:
    payload = {**payload, "updated_at": time.time()}
    raw = json.dumps(payload, ensure_ascii=False)
    client = _redis()
    if client is not None:
        try:
            client.set(f"{_KIND}_job:{job_id}", raw, ex=settings.job_ttl_seconds)
        except Exception:
            pass
    with _file_lock:
        _file_path(job_id).write_text(raw, encoding="utf-8")


def get_job(job_id: str) -> dict[str, Any] | None:
    client = _redis()
    if client is not None:
        try:
            raw = client.get(f"{_KIND}_job:{job_id}")
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    p = _file_path(job_id)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def update_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    cur = get_job(job_id)
    if cur is None:
        return None
    cur.update(fields)
    save_job(job_id, cur)
    return cur


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    d = settings.workspace / "jobs"
    if not d.exists():
        return []
    files = sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    out: list[dict[str, Any]] = []
    for f in files[:limit]:
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def redis_ping() -> bool:
    client = _redis()
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False
