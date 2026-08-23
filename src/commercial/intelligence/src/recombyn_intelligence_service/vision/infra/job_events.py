"""SSE helpers for pipeline job status."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from recombyn_intelligence_service.vision.infra.job_store import get_job

TERMINAL_STATUSES = frozenset({"needs_review", "done", "failed"})


def job_to_event_payload(job_id: str, job: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "status": job.get("status", "queued"),
        "progress": int(job.get("progress") or 0),
        "urls": job.get("urls"),
        "layers": job.get("layers"),
        "meta": job.get("meta"),
        "error": job.get("error"),
    }


async def stream_job_events(
    job_id: str,
    *,
    poll_interval: float = 1.0,
) -> AsyncIterator[str]:
    last_sig: str | None = None
    while True:
        job = get_job(job_id)
        if job is None:
            yield _sse("error", {"job_id": job_id, "error": "Job not found"})
            break

        payload = job_to_event_payload(job_id, job)
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
