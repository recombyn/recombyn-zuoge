"""Shared SSE endpoint for chat media jobs (image / video / audio)."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.services.job_events import stream_media_job_events
from app.services.job_store import get_job

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _require_media_job(current_user: CurrentUser, job_id: str, *, kind: str) -> dict:
    try:
        job = get_job(job_id, kind=kind)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id") or "") != str(current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def streaming_media_job_events(
    current_user: CurrentUser,
    job_id: str,
    *,
    kind: str,
) -> StreamingResponse:
    _require_media_job(current_user, job_id, kind=kind)
    return StreamingResponse(
        stream_media_job_events(job_id, kind=kind),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
