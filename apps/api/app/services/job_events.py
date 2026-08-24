"""SSE helpers for async media jobs (ADR 0005 optional push layer)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from app.services.job_store import get_job

TERMINAL_STATUSES = frozenset({"done", "failed"})


def media_job_to_event_payload(job_id: str, job: dict[str, Any]) -> dict[str, Any]:
    result = job.get("result")
    return {
        "job_id": job_id,
        "status": str(job.get("status") or "queued"),
        "progress": int(job.get("progress") or 0),
        "result": result if isinstance(result, dict) else None,
        "error": job.get("error"),
        "trace_id": job.get("trace_id"),
    }


async def stream_media_job_events(
    job_id: str,
    *,
    kind: str,
    poll_interval: float = 0.5,
) -> AsyncIterator[str]:
    """Poll Redis and emit SSE only when job state changes."""
    last_sig: str | None = None
    while True:
        job = get_job(job_id, kind=kind)
        if job is None:
            yield _sse("error", {"job_id": job_id, "error": "Job not found"})
            break

        payload = media_job_to_event_payload(job_id, job)
        sig = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        if sig != last_sig:
            yield _sse("job", payload)
            last_sig = sig

        if payload["status"] in TERMINAL_STATUSES:
            break

        await asyncio.sleep(poll_interval)


def _sse(event: str, data: dict[str, Any]) -> str:
    body = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n"
