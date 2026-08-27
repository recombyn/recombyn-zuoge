"""Async chat audio-generation jobs — Celery + Redis poll (ADR 0005)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import get_media_job_or_http, streaming_media_job_events
from app.services.i18n.errors import http_error
from app.services.i18n.locale import LocaleDep
from app.services.job_store import normalize_trace_id, save_job
from worker.tasks import run_chat_audio_job

router = APIRouter(prefix="/chat/audio", tags=["chat-audio-jobs"])
_log = logging.getLogger(__name__)
_KIND = "audio"


class AudioJobCreateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = None
    voice: str | None = None
    response_format: str | None = None
    speed: float | None = None
    trace_id: str | None = None


class AudioJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class AudioJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


async def execute_audio_generate(
    user_id: str,
    *,
    prompt: str,
    model_id: str | None,
    voice: str | None = None,
    response_format: str | None = None,
    speed: float | None = None,
    credits_charged: int = 0,
) -> dict[str, Any]:
    """TTS + persist bytes to assets. Credits must already be charged.

    Never returns raw ``bytes`` (job store is JSON).
    """
    from app.services.assets import create_asset_from_bytes
    from app.services.llm import reset_byok_user_id, set_byok_user_id
    from app.services.llm.audio import generate_audio
    from app.services.llm.usage_log import usage_context

    byok_token = set_byok_user_id(user_id)
    try:
        with usage_context(
            user_id=user_id,
            source="audio",
            credits_charged=credits_charged,
        ):
            result = await generate_audio(
                prompt=prompt.strip(),
                model=model_id,
                voice=voice,
                response_format=response_format,
                speed=speed,
            )
    finally:
        reset_byok_user_id(byok_token)

    raw = result.pop("bytes", None)
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise RuntimeError("audio generation returned no bytes")
    mime = str(result.get("mime") or "audio/mpeg")
    ext = "mp3"
    if "wav" in mime:
        ext = "wav"
    elif "ogg" in mime:
        ext = "ogg"
    asset = create_asset_from_bytes(
        user_id,
        bytes(raw),
        kind="audio",
        mime=mime,
        source="ai_audio",
        prompt=prompt.strip()[:500] or None,
        filename_ext=ext,
    )
    stored_url = str(asset.get("url") or "").strip()
    if not stored_url:
        raise RuntimeError("audio asset storage incomplete")
    return {**result, "audios": [stored_url], "assets": [asset]}


@router.post("/jobs", response_model=AudioJobCreateResponse)
async def create_audio_job(
    body: AudioJobCreateRequest,
    request: Request,
    locale: LocaleDep,
    current_user: CurrentUser,
):
    prompt = body.prompt.strip()
    if not prompt:
        raise http_error(400, "empty_prompt", locale)

    from app.api.routes.chat import _charge_audio

    model_id, credits_charged = _charge_audio(
        current_user.id, body.model, locale=locale
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
        "voice": body.voice,
        "response_format": body.response_format,
        "speed": body.speed,
        "credits_charged": int(credits_charged or 0),
        "result": None,
        "error": None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_chat_audio_job.delay(job_id)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_queue_unavailable", locale) from exc
    try:
        from app.core.metrics import observe_job

        observe_job(_KIND, "enqueued")
    except Exception:
        pass
    _log.info(
        "audio_job event=enqueued job_id=%s trace_id=%s",
        job_id,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return AudioJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=AudioJobStatusResponse)
def get_audio_job(locale: LocaleDep, current_user: CurrentUser, job_id: str):
    job = get_media_job_or_http(current_user, job_id, kind=_KIND, locale=locale)
    return AudioJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )


@router.get("/jobs/{job_id}/events")
async def stream_audio_job_events(request: Request, current_user: CurrentUser, job_id: str):
    """SSE push for job status (progress / done / failed)."""
    return streaming_media_job_events(current_user, job_id, kind=_KIND, request=request)
