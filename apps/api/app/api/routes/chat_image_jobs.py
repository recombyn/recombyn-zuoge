"""Async chat image-generation jobs — Celery + Redis poll (ADR 0005)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.job_store import get_job, normalize_trace_id, save_job
from worker.tasks import run_chat_image_job

router = APIRouter(prefix="/chat/image", tags=["chat-image-jobs"])
_log = logging.getLogger(__name__)
_KIND = "image"


class ImageJobCreateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = None
    aspect_ratio: str | None = None
    quality: str | None = None
    resolution: str | None = None
    n: int | None = None
    images: list[str] | None = None
    trace_id: str | None = None


class ImageJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class ImageJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


async def execute_image_generate(
    user_id: str,
    *,
    prompt: str,
    model_id: str | None,
    aspect_ratio: str | None = None,
    quality: str | None = None,
    resolution: str | None = None,
    images: list[str] | None = None,
    credits_charged: int = 0,
) -> dict[str, Any]:
    """Generate + best-effort rehost. Credits must already be charged."""
    from app.services.assets import create_asset_from_url
    from app.services.llm import reset_byok_user_id, set_byok_user_id
    from app.services.llm.image import generate_image
    from app.services.llm.usage_log import usage_context

    byok_token = set_byok_user_id(user_id)
    try:
        with usage_context(
            user_id=user_id,
            source="image",
            credits_charged=credits_charged,
        ):
            result = await generate_image(
                prompt=prompt.strip(),
                model=model_id,
                aspect_ratio=aspect_ratio,
                quality=quality,
                resolution=resolution,
                images=images,
            )
    finally:
        reset_byok_user_id(byok_token)

    assets_out: list[dict[str, Any]] = []
    for img_url in result.get("images") or []:
        if not isinstance(img_url, str) or not img_url.strip():
            continue
        try:
            asset = create_asset_from_url(
                user_id,
                img_url.strip(),
                kind="image",
                source="ai_image",
                prompt=prompt.strip(),
            )
            assets_out.append(asset)
        except Exception as err:  # noqa: BLE001 — keep raw CDN url when rehost fails
            _log.warning("image rehost failed (%s): %s", type(err).__name__, err)
            continue
    if assets_out:
        return {**result, "assets": assets_out}
    return result


@router.post("/jobs", response_model=ImageJobCreateResponse)
async def create_image_job(
    body: ImageJobCreateRequest,
    request: Request,
    current_user: CurrentUser,
):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="empty prompt")

    from app.api.routes.chat import _charge_image

    model_id, credits_charged = _charge_image(
        current_user.id,
        body.model,
        resolution=body.resolution,
        count=int(body.n or 1),
    )

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
        "model": model_id,
        "requested_model": body.model,
        "aspect_ratio": body.aspect_ratio,
        "quality": body.quality,
        "resolution": body.resolution,
        "images": list(body.images or []),
        "credits_charged": int(credits_charged or 0),
        "result": None,
        "error": None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_chat_image_job.delay(job_id)
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
        "image_job event=enqueued job_id=%s trace_id=%s",
        job_id,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return ImageJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=ImageJobStatusResponse)
def get_image_job(current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id") or "") != str(current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    return ImageJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )
