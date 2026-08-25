"""Chat LLM API — SSE message streaming."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from app.api.deps import CurrentUser, OptionalUser
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.llm import (
    is_byok_model_ref,
    list_audio_models,
    list_image_models,
    list_llm_models,
    list_video_models,
    reset_byok_user_id,
    get_llm_endpoint,
    set_byok_user_id,
    user_byok_platforms,
    uses_user_platform_byok,
)
from app.core.config import is_desktop_local
from app.services.llm.agent import stream_agent_turn, stream_official_agent
from app.services.llm.chat import stream_chat
from app.services.llm.design_tools import design_tool_definitions
from app.services.llm.usage_log import bind_usage_context
from app.services.wallet.db import (
    consume_free_daily_quota,
    get_user_plan,
    get_user_credits,
    is_wallet_billing_enabled,
    spend_credits,
)

from app.services.wallet.billing import DEFAULT_IMAGE_CREDITS, image_model_credit_cost

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# Unified 积分 (flat per call; 10× display scale).
_AGENT_CREDIT_COST = 10
_MESSAGE_CREDIT_COST = 10
# Free plan: image gen locked to Seedream 5.0 Lite (same as FE FREE_IMAGE_MODEL_ID;
# shares daily free run with Auto design).
_FREE_IMAGE_MODEL = "doubao-seedream-5-0-lite"


class ChatMessageIn(BaseModel):
    message: str = Field(..., min_length=1)
    model: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list)
    # Enable DeepSeek thinking when the model supports it (default: auto).
    thinking: bool | None = None


class AgentTurnIn(BaseModel):
    """One agent LLM turn (may return tool_calls)."""

    messages: list[dict] = Field(default_factory=list)
    model: str | None = None
    tools: list[dict] | None = None
    # turn = bind_tools + client canvas (default); react = official create_agent loop
    mode: str | None = Field(
        default="turn",
        description="turn | react — react uses LangChain create_agent (server tools)",
    )


class ImageGenerateIn(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = None
    aspect_ratio: str | None = None
    quality: str | None = None
    resolution: str | None = None
    n: int | None = None
    images: list[str] | None = None


class VideoGenerateIn(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = None
    aspect_ratio: str | None = None
    resolution: str | None = None
    duration: int | None = None
    images: list[str] | None = None


class AudioGenerateIn(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = None
    voice: str | None = None
    response_format: str | None = None
    speed: float | None = None


def _charge(user_id: str, amount: int, detail: str) -> None:
    if amount <= 0 or not is_wallet_billing_enabled():
        return
    try:
        spend_credits(user_id, amount, detail)
    except ValueError as err:
        if str(err) == "insufficient_credits":
            raise HTTPException(status_code=402, detail="Insufficient credits") from err
        raise HTTPException(status_code=400, detail=str(err)) from err


def _charge_image(
    user_id: str,
    requested_model: str | None,
    *,
    resolution: str | None = None,
    count: int = 1,
) -> tuple[str, int]:
    """
    Charge image gen from 积分 balance (厂商按张 / 按分辨率估算).
    Free plan: force Seedream 5.0 Lite; use 积分 or today's free daily run.
    Returns (model id to call, credits actually charged).
    """
    if is_desktop_local() or is_byok_model_ref(requested_model) or uses_user_platform_byok(
        user_id, requested_model
    ):
        # BYOK / platform key uses the user's own quota — never platform credits.
        mid = (requested_model or "").strip() or None
        return mid, 0
    n = max(1, min(4, int(count or 1)))
    plan = get_user_plan(user_id)
    if plan == "free":
        mid = _FREE_IMAGE_MODEL
        cost = image_model_credit_cost(mid, count=n, resolution=resolution)
        bal = get_user_credits(user_id)
        if bal >= cost:
            _charge(user_id, cost, "AI image generation")
            return mid, cost
        if consume_free_daily_quota(user_id):
            return mid, 0
        raise HTTPException(
            status_code=402,
            detail="free_daily_exhausted",
        )
    mid = (requested_model or "").strip() or None
    cost = (
        image_model_credit_cost(mid, count=n, resolution=resolution)
        if mid
        else DEFAULT_IMAGE_CREDITS * n
    )
    _charge(user_id, cost, "AI image generation")
    return mid, cost


def _charge_video(
    user_id: str,
    requested_model: str | None,
    *,
    resolution: str | None = None,
) -> tuple[str | None, int]:
    """Charge video gen from 积分 (reuses image-credit balance for now)."""
    requested = (requested_model or "").strip() or None
    if is_desktop_local() or uses_user_platform_byok(user_id, requested):
        return requested, 0
    cost = (
        image_model_credit_cost(requested, count=1, resolution=resolution)
        if requested
        else DEFAULT_IMAGE_CREDITS
    )
    cost = max(DEFAULT_IMAGE_CREDITS, int(cost or DEFAULT_IMAGE_CREDITS))
    _charge(user_id, cost, "AI video generation")
    return requested, cost


def _charge_audio(user_id: str, requested_model: str | None) -> tuple[str | None, int]:
    """Charge audio/TTS from 积分 (flat default for now)."""
    requested = (requested_model or "").strip() or None
    if is_desktop_local() or uses_user_platform_byok(user_id, requested):
        return requested, 0
    cost = max(DEFAULT_IMAGE_CREDITS, int(DEFAULT_IMAGE_CREDITS or 1))
    _charge(user_id, cost, "AI audio generation")
    return requested, cost


@router.get("/models")
def get_models(
    request: Request,
    current_user: OptionalUser,
) -> dict[str, Any]:
    # Keep text/chat and image catalogs separate — FE merges with dedupe.
    # Do not use list_all_models() here or image ids appear twice under models + imageModels.
    from app.services.llm.byok_presets import list_byok_platforms

    uid = str(getattr(current_user, "id", "") or "").strip() or None
    platforms = user_byok_platforms(uid)
    platforms_payload = list_byok_platforms()

    # Local desktop: no platform catalog (even if machine .env has provider keys).
    # End users add OpenAI-style BYOK in Agent settings; FE merges vault models.
    if is_desktop_local():
        return {
            "models": [],
            "available": True,
            "imageModels": [],
            "videoModels": [],
            "audioModels": [],
            "clientRegion": "local",
            "openrouterAvailable": False,
            "byokPlatforms": platforms_payload,
        }

    from app.services.geoip import (
        filter_catalog_models_for_region,
        openrouter_allowed_for_country,
        resolve_client_country,
    )

    country = resolve_client_country(request)
    or_ok = openrouter_allowed_for_country(country) or "openrouter" in platforms
    items = filter_catalog_models_for_region(
        list_llm_models(byok_platforms=platforms), country=country
    )
    image_models = filter_catalog_models_for_region(
        list_image_models(byok_platforms=platforms), country=country
    )
    video_models = filter_catalog_models_for_region(
        list_video_models(byok_platforms=platforms), country=country
    )
    audio_models = filter_catalog_models_for_region(
        list_audio_models(byok_platforms=platforms), country=country
    )
    available = True
    try:
        get_llm_endpoint()
    except Exception:
        available = False
    return {
        "models": items,
        "available": available,
        "imageModels": image_models,
        "videoModels": video_models,
        "audioModels": audio_models,
        "clientRegion": country,
        "openrouterAvailable": or_ok,
        "byokPlatforms": platforms_payload,
    }

@router.post("/message")
async def post_message(
    current_user: CurrentUser,
    body: ChatMessageIn,
):
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="empty message")

    # Image models should use /image, not text stream.
    image_ids = {m["id"] for m in list_image_models()}
    if body.model and body.model in image_ids:
        raise HTTPException(
            status_code=400,
            detail="Selected model is an image model. Use POST /api/v1/chat/image instead.",
        )

    # BYOK / local / wallet-off → no platform credits (upstream uses user's key).
    msg_cost = (
        0
        if (not is_wallet_billing_enabled())
        or uses_user_platform_byok(current_user.id, body.model)
        else _MESSAGE_CREDIT_COST
    )

    _charge(current_user.id, msg_cost, "AI chat message")
    bind_usage_context(
        user_id=current_user.id,
        source="chat",
        credits_charged=msg_cost,
    )


    async def event_gen():
        byok_token = set_byok_user_id(current_user.id)
        try:
            get_llm_endpoint(body.model)
            yield f"data: {json.dumps({'type': 'start', 'model': body.model}, ensure_ascii=False)}\n\n"
            async for kind, text in stream_chat(
                message=body.message.strip(),
                history=body.history,
                model=body.model,
                thinking=body.thinking,
            ):
                event_type = "thinking" if kind == "thinking" else "token"
                yield f"data: {json.dumps({'type': event_type, 'text': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as err:
            yield f"data: {json.dumps({'type': 'error', 'message': str(err)}, ensure_ascii=False)}\n\n"
        finally:
            reset_byok_user_id(byok_token)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/agent/tools")
def get_agent_tools() -> dict[str, Any]:
    return {"tools": design_tool_definitions()}


@router.post("/agent")
async def post_agent_turn(
    current_user: CurrentUser,
    body: AgentTurnIn,
):
    """
    Stream agent turn.

    - mode=turn (default): bind_tools; canvas tools for the frontend.
    - mode=react: official LangChain create_agent (server tools loop).
    """
    if not body.messages:
        raise HTTPException(status_code=400, detail="empty messages")

    mode = (body.mode or "turn").strip().lower()
    if mode not in ("turn", "react"):
        raise HTTPException(status_code=400, detail="mode must be turn|react")

    agent_cost = (
        0
        if (not is_wallet_billing_enabled())
        or uses_user_platform_byok(current_user.id, body.model)
        else _AGENT_CREDIT_COST
    )

    _charge(current_user.id, agent_cost, "AI agent turn")
    bind_usage_context(
        user_id=current_user.id,
        source="agent",
        credits_charged=agent_cost,
    )


    async def event_gen():
        byok_token = set_byok_user_id(current_user.id)
        try:
            get_llm_endpoint(body.model)
            yield f"data: {json.dumps({'type': 'start', 'model': body.model, 'mode': mode}, ensure_ascii=False)}\n\n"
            stream = (
                stream_official_agent(
                    messages=body.messages,
                    model=body.model,
                )
                if mode == "react"
                else stream_agent_turn(
                    messages=body.messages,
                    model=body.model,
                    tools=body.tools,
                )
            )
            async for kind, payload in stream:
                if kind == "thinking":
                    yield f"data: {json.dumps({'type': 'thinking', 'text': payload}, ensure_ascii=False)}\n\n"
                elif kind == "token":
                    yield f"data: {json.dumps({'type': 'token', 'text': payload}, ensure_ascii=False)}\n\n"
                elif kind == "tool_call":
                    yield f"data: {json.dumps({'type': 'tool_call', 'toolCall': payload}, ensure_ascii=False)}\n\n"
                elif kind == "tool_result":
                    yield f"data: {json.dumps({'type': 'tool_result', 'toolResult': payload}, ensure_ascii=False)}\n\n"
                elif kind == "message":
                    yield f"data: {json.dumps({'type': 'message', 'message': payload}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as err:
            yield f"data: {json.dumps({'type': 'error', 'message': str(err)}, ensure_ascii=False)}\n\n"
        finally:
            reset_byok_user_id(byok_token)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/image")
async def post_image(
    current_user: CurrentUser,
    body: ImageGenerateIn,
) -> dict[str, Any]:
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="empty prompt")

    model_id, credits_charged = _charge_image(
        current_user.id,
        body.model,
        resolution=body.resolution,
        count=int(body.n or 1),
    )

    from app.api.routes.chat_image_jobs import execute_image_generate

    try:
        return await execute_image_generate(
            current_user.id,
            prompt=body.prompt.strip(),
            model_id=model_id,
            aspect_ratio=body.aspect_ratio,
            quality=body.quality,
            resolution=body.resolution,
            images=body.images,
            credits_charged=credits_charged,
        )
    except RuntimeError as err:
        msg = str(err)
        if "No LLM API key" in msg:
            raise HTTPException(status_code=503, detail=msg) from err
        raise HTTPException(status_code=502, detail=msg) from err


@router.post("/video")
async def post_video(
    current_user: CurrentUser,
    body: VideoGenerateIn,
) -> dict[str, Any]:
    """Sync convenience. Editor uses POST /chat/video/jobs (ADR 0005)."""
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="empty prompt")

    model_id, credits_charged = _charge_video(
        current_user.id,
        body.model,
        resolution=body.resolution,
    )

    from app.api.routes.chat_video_jobs import execute_video_generate

    try:
        return await execute_video_generate(
            current_user.id,
            prompt=body.prompt.strip(),
            model_id=model_id,
            aspect_ratio=body.aspect_ratio,
            resolution=body.resolution,
            duration=body.duration,
            images=body.images,
            credits_charged=credits_charged,
        )
    except RuntimeError as err:
        msg = str(err)
        if "No LLM API key" in msg or "No OpenRouter" in msg:
            raise HTTPException(status_code=503, detail=msg) from err
        raise HTTPException(status_code=502, detail=msg) from err


@router.post("/audio")
async def post_audio(
    current_user: CurrentUser,
    body: AudioGenerateIn,
) -> dict[str, Any]:
    """Sync convenience. Editor uses POST /chat/audio/jobs (ADR 0005)."""
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="empty prompt")

    model_id, credits_charged = _charge_audio(current_user.id, body.model)

    from app.api.routes.chat_audio_jobs import execute_audio_generate

    try:
        return await execute_audio_generate(
            current_user.id,
            prompt=body.prompt.strip(),
            model_id=model_id,
            voice=body.voice,
            response_format=body.response_format,
            speed=body.speed,
            credits_charged=credits_charged,
        )
    except RuntimeError as err:
        msg = str(err)
        if "No LLM API key" in msg or "No OpenRouter" in msg:
            raise HTTPException(status_code=503, detail=msg) from err
        raise HTTPException(status_code=502, detail=msg) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
