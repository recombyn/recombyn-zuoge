"""Async image toolbar jobs — Celery + Redis poll + SSE progress."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import streaming_media_job_events
from app.api.routes.image_tools import ImageProcessIn, _charge, credit_cost_for_kind
from app.services.job_store import get_job, normalize_trace_id, save_job, update_job
from worker.tasks import run_image_process_job

router = APIRouter(prefix="/image/process", tags=["image-process-jobs"])
_log = logging.getLogger(__name__)
_KIND = "image_process"
_PROGRESS_START = 15
_PROGRESS_CAP = 85
_PROGRESS_DONE = 90


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

    last_pct = _PROGRESS_START

    def _set_progress(pct: int) -> None:
        nonlocal last_pct
        if not job_id:
            return
        pct = max(_PROGRESS_START, min(_PROGRESS_CAP, pct))
        if pct <= last_pct:
            return
        last_pct = pct
        update_job(job_id, kind=_KIND, progress=pct)

    def _on_ilp_progress(pct: int, _stage: str = "") -> None:
        _set_progress(_PROGRESS_START + int(pct * 0.7))

    async def _heartbeat() -> None:
        while last_pct < _PROGRESS_CAP - 1:
            await asyncio.sleep(3)
            _set_progress(last_pct + 4)

    if job_id:
        update_job(job_id, kind=_KIND, progress=_PROGRESS_START)

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
        update_job(job_id, kind=_KIND, progress=_PROGRESS_DONE)

    if not isinstance(result, dict):
        raise RuntimeError(f"image process returned unexpected type: {type(result)!r}")
    image = str(result.get("image") or "").strip()
    if not image:
        raise RuntimeError("image process returned no image")
    return {**result, "credits": credits}


@router.post("/jobs", response_model=ImageProcessJobCreateResponse)
async def create_image_process_job(
    body: ImageProcessJobCreateRequest,
    request: Request,
    current_user: CurrentUser,
):
    tool_kind = body.kind.strip()
    if not tool_kind:
        raise HTTPException(status_code=400, detail="empty kind")
    image = body.image.strip()
    if not image:
        raise HTTPException(status_code=400, detail="image is required")

    cost = credit_cost_for_kind(tool_kind, body.model, user_id=current_user.id)
    _charge(current_user.id, cost, f"AI image tool: {tool_kind}")

    job_id = uuid.uuid4().hex
    header_tid = getattr(request.state, "trace_id", None)
    trace_id = normalize_trace_id(body.trace_id or header_tid)
    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "tool_kind": tool_kind,
        "status": "queued",
        "progress": 0,
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
        run_image_process_job.delay(job_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Job queue unavailable (start Redis + worker). {exc}",
        ) from exc
    try:
        from app.core.metrics import observe_job

        observe_job(_KIND, "enqueued")
    except Exception:
        pass
    _log.info(
        "image_process_job event=enqueued job_id=%s tool_kind=%s trace_id=%s",
        job_id,
        tool_kind,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return ImageProcessJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=ImageProcessJobStatusResponse)
def get_image_process_job(current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id") or "") != str(current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    return ImageProcessJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )


@router.get("/jobs/{job_id}/events")
async def stream_image_process_job_events(current_user: CurrentUser, job_id: str):
    """SSE push for toolbar image job status (progress / done / failed)."""
    return streaming_media_job_events(current_user, job_id, kind=_KIND)
