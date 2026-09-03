"""Async image toolbar jobs — Celery + Redis poll + SSE progress."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import streaming_media_job_events
from app.api.routes.image_tools import ImageProcessIn, _charge, credit_cost_for_kind
from app.services.i18n.errors import http_error
from app.services.i18n.locale import LocaleDep
from app.services.job_store import get_job, normalize_trace_id, save_job, update_job
from worker.tasks import run_image_process_job

router = APIRouter(prefix="/image/process", tags=["image-process-jobs"])
_log = logging.getLogger(__name__)
_KIND = "image_process"
# Smooth 0→100 curve owned by execute_image_process (Celery must not stomp mid-flight).
_PROGRESS_FLOOR = 5
_PROGRESS_CAP = 95
_PROGRESS_DONE = 100


def _celery_workers_online() -> bool:
    try:
        from worker.celery_app import celery

        ping = celery.control.inspect(timeout=1.5).ping()
        return bool(ping)
    except Exception:
        return False


def _run_image_process_job_inline(job_id: str) -> None:
    """Run the Celery task body in-process when no worker is listening."""
    try:
        run_image_process_job.apply(args=[job_id])
    except Exception:
        _log.exception(
            "image_process_job event=inline_failed job_id=%s",
            job_id,
            extra={"job_id": job_id, "event": "inline_failed"},
        )


async def _enqueue_image_process_job(job_id: str) -> str:
    """Prefer Celery worker; fall back to in-process apply so UI does not stick at 5%."""
    if _celery_workers_online():
        run_image_process_job.delay(job_id)
        return "celery"
    _log.warning(
        "image_process_job event=inline_fallback job_id=%s (no celery worker)",
        job_id,
        extra={"job_id": job_id, "event": "inline_fallback"},
    )
    asyncio.create_task(asyncio.to_thread(_run_image_process_job_inline, job_id))
    return "inline"


class ImageProcessJobCreateRequest(ImageProcessIn):
    trace_id: str | None = None


class ImageProcessJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class ImageProcessJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


async def execute_image_process(job: dict[str, Any]) -> dict[str, Any]:
    """Run toolbar image tool; credits must already be charged."""
    from app.services.llm.image_tools import process_image_tool

    job_id = str(job.get("job_id") or "")
    tool_kind = str(job.get("tool_kind") or "").strip()
    user_id = str(job.get("user_id") or "").strip() or None
    image = str(job.get("image") or "").strip()
    credits = int(job.get("credits_charged") or 0)

    last_pct = max(_PROGRESS_FLOOR, int(job.get("progress") or 0))

    def _set_progress(pct: int, *, final: bool = False) -> None:
        nonlocal last_pct
        if not job_id:
            return
        next_pct = _PROGRESS_DONE if final else max(last_pct, min(_PROGRESS_CAP, int(pct)))
        if next_pct <= last_pct:
            return
        last_pct = next_pct
        update_job(job_id, kind=_KIND, progress=next_pct)

    def _on_ilp_progress(pct: int, _stage: str = "") -> None:
        span = _PROGRESS_CAP - _PROGRESS_FLOOR
        mapped = _PROGRESS_FLOOR + int(max(0, min(100, int(pct))) * span / 100)
        _set_progress(mapped)

    async def _heartbeat() -> None:
        """Slow crawl for tools without real progress callbacks (抠图 / 放大 / …)."""
        while last_pct < _PROGRESS_CAP - 2:
            await asyncio.sleep(2.5)
            gap = _PROGRESS_CAP - last_pct
            step = max(1, min(3, gap // 6))
            _set_progress(last_pct + step)

    if job_id:
        _set_progress(max(last_pct, 8))

    heartbeat = asyncio.create_task(_heartbeat())
    try:
        result = await process_image_tool(
            kind=tool_kind,
            image=image,
            meta=job.get("meta") if isinstance(job.get("meta"), dict) else None,
            aspect_ratio=job.get("aspect_ratio"),
            quality=job.get("quality"),
            resolution=job.get("resolution"),
            model=job.get("model"),
            user_id=user_id,
            on_progress=_on_ilp_progress if tool_kind == "editElements" else None,
        )
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat

    if job_id:
        _set_progress(_PROGRESS_DONE, final=True)
    if not isinstance(result, dict):
        raise RuntimeError(f"image process returned unexpected type: {type(result)!r}")
    out_image = str(result.get("image") or "").strip()
    out_svg = str(result.get("svg") or "").strip()
    layers = result.get("layers")
    has_layers = isinstance(layers, list) and len(layers) > 0
    if not out_image and not out_svg and not has_layers:
        raise RuntimeError("image process returned no image/svg")
    return {**result, "credits": credits}


@router.post("/jobs", response_model=ImageProcessJobCreateResponse)
async def create_image_process_job(
    body: ImageProcessJobCreateRequest,
    request: Request,
    locale: LocaleDep,
    current_user: CurrentUser,
):
    tool_kind = body.kind.strip()
    if not tool_kind:
        raise http_error(400, "empty_kind", locale)
    image = body.image.strip()
    if not image:
        raise http_error(400, "image_required", locale)

    cost = credit_cost_for_kind(tool_kind, body.model, user_id=current_user.id)
    _charge(current_user.id, cost, f"AI image tool: {tool_kind}", locale=locale)

    job_id = uuid.uuid4().hex
    header_tid = getattr(request.state, "trace_id", None)
    trace_id = normalize_trace_id(body.trace_id or header_tid)
    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "tool_kind": tool_kind,
        "status": "queued",
        "progress": 5,
        "user_id": current_user.id,
        "image": image,
        "meta": body.meta,
        "aspect_ratio": body.aspect_ratio,
        "quality": body.quality,
        "resolution": body.resolution,
        "model": body.model,
        "credits_charged": int(cost or 0),
        "result": None,
        "error": None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        enqueue_via = await _enqueue_image_process_job(job_id)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_queue_unavailable", locale) from exc
    try:
        from app.core.metrics import observe_job

        observe_job(_KIND, "enqueued")
    except Exception:
        pass
    _log.info(
        "image_process_job event=enqueued job_id=%s tool_kind=%s via=%s trace_id=%s",
        job_id,
        tool_kind,
        enqueue_via,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return ImageProcessJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=ImageProcessJobStatusResponse)
def get_image_process_job(locale: LocaleDep, current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_store_unavailable", locale) from exc
    if not job:
        raise http_error(404, "job_not_found", locale)
    if str(job.get("user_id") or "") != str(current_user.id):
        raise http_error(404, "job_not_found", locale)
    return ImageProcessJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )


@router.get("/jobs/{job_id}/events")
async def stream_image_process_job_events(
    request: Request,
    current_user: CurrentUser,
    job_id: str,
):
    """SSE push for toolbar image job status (progress / done / failed)."""
    return streaming_media_job_events(current_user, job_id, kind=_KIND, request=request)
