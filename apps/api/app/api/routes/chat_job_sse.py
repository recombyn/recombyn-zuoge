"""Shared SSE endpoint for chat media jobs (image / video / audio)."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.services.i18n.errors import http_error
from app.services.i18n.locale import locale_from_request
from app.services.job_events import stream_media_job_events
from app.services.job_store import get_job

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _require_media_job(
    current_user: CurrentUser,
    job_id: str,
    *,
    kind: str,
    locale: str | None = None,
) -> dict:
    try:
        job = get_job(job_id, kind=kind)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_store_unavailable", locale) from exc
    if not job:
        raise http_error(404, "job_not_found", locale)
    if str(job.get("user_id") or "") != str(current_user.id):
        raise http_error(404, "job_not_found", locale)
    return job


def streaming_media_job_events(
    current_user: CurrentUser,
    job_id: str,
    *,
    kind: str,
    request: Request | None = None,
    locale: str | None = None,
) -> StreamingResponse:
    loc = locale or (locale_from_request(request) if request is not None else None)
    _require_media_job(current_user, job_id, kind=kind, locale=loc)
    return StreamingResponse(
        stream_media_job_events(job_id, kind=kind),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


def get_media_job_or_http(
    current_user: CurrentUser,
    job_id: str,
    *,
    kind: str,
    locale: str | None = None,
) -> dict:
    """Load a media job row or raise localized HTTP errors."""
    return _require_media_job(current_user, job_id, kind=kind, locale=locale)
