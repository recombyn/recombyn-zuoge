"""Async chat lottie-generation jobs — Celery + Redis + SSE (ADR 0005)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import streaming_media_job_events
from app.services.job_store import get_job, normalize_trace_id, save_job
from worker.tasks import run_chat_lottie_job

router = APIRouter(prefix="/chat/lottie", tags=["chat-lottie-jobs"])
_log = logging.getLogger(__name__)
_KIND = "lottie"


class LottieJobCreateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    width: int = Field(default=200, ge=32, le=2048)
    height: int = Field(default=200, ge=32, le=2048)
    duration_sec: float = Field(default=3.0, ge=0.5, le=30.0)
    model: str | None = None
    images: list[str] | None = Field(default=None, max_length=8)
    trace_id: str | None = None


class LottieJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class LottieJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


async def execute_lottie_generate(
    user_id: str,
    *,
    prompt: str,
    width: int = 200,
    height: int = 200,
    duration_sec: float = 3.0,
    model_id: str | None = None,
    images: list[str] | None = None,
    credits_charged: int = 0,
) -> dict[str, Any]:
    """Generate Bodymovin JSON + optional asset row."""
    from app.services.assets import create_asset_from_bytes
    from app.services.design.ops.lottie_hydrate import generate_lottie_animation

    _ = credits_charged  # reserved for future wallet billing
    animation = await generate_lottie_animation(
        prompt=prompt.strip(),
        width=int(width),
        height=int(height),
        duration_sec=float(duration_sec),
        model=model_id,
        images=images,
    )
    raw = json.dumps(animation, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    asset = create_asset_from_bytes(
        user_id,
        raw,
        kind="lottie",
        mime="application/json",
        source="ai_lottie",
        prompt=prompt.strip()[:500] or None,
        filename_ext="json",
        width=int(animation.get("w") or width or 0) or None,
        height=int(animation.get("h") or height or 0) or None,
    )
    stored_url = str(asset.get("url") or "").strip()
    if not stored_url:
        raise RuntimeError("lottie asset storage incomplete")
    return {
        "animationData": animation,
        "w": animation.get("w"),
        "h": animation.get("h"),
        "asset": asset,
        "assets": [asset],
    }


@router.post("/jobs", response_model=LottieJobCreateResponse)
async def create_lottie_job(
    body: LottieJobCreateRequest,
    request: Request,
    current_user: CurrentUser,
):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="empty prompt")

    job_id = uuid.uuid4().hex
    header_tid = getattr(request.state, "trace_id", None)
    trace_id = normalize_trace_id(body.trace_id or header_tid)
    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "status": "queued",
        "progress": 0,
        "user_id": current_user.id,
        "prompt": prompt,
        "model": body.model,
        "width": int(body.width),
        "height": int(body.height),
        "duration_sec": float(body.duration_sec),
        "images": list(body.images or []),
        "credits_charged": 0,
        "result": None,
        "error": None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_chat_lottie_job.delay(job_id)
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
        "lottie_job event=enqueued job_id=%s trace_id=%s",
        job_id,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return LottieJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=LottieJobStatusResponse)
def get_lottie_job(current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id") or "") != str(current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    return LottieJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )


@router.get("/jobs/{job_id}/events")
async def stream_lottie_job_events(current_user: CurrentUser, job_id: str):
    """SSE push for job status (progress / done / failed)."""
    return streaming_media_job_events(current_user, job_id, kind=_KIND)
