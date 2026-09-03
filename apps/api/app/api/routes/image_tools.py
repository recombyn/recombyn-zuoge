"""Image toolbar AI tools API — frontend calls these instead of local CV."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from app.api.deps import CurrentUser
from pydantic import BaseModel, Field

from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

from app.services.llm import is_byok_model_ref, uses_user_platform_byok
from app.services.llm.image_tools import (
    IMAGE_PROCESS_KINDS,
    process_image_tool,
    uses_llm_for_kind,
)
from app.services.wallet.billing import DEFAULT_IMAGE_CREDITS, image_model_credit_cost
from app.services.wallet.db import (
    consume_free_vision_quota,
    free_vision_remaining,
    get_user_plan,
    is_wallet_billing_enabled,
    spend_credits,
)

router = APIRouter(prefix="/image", tags=["image-tools"])

# Wallet 积分 for paid vision / LLM image paths.
# MediaKit tools (removeBg / expand / …) stay 0 — free users use freeVision quota.
_KIND_CREDIT_COST: dict[str, int] = {
    "replaceText": 30,
    # Seedream layer_decomposition / WaveSpeed qwen-image/layered
    "editElements": 30,
}


class ImageProcessIn(BaseModel):
    kind: str = Field(..., min_length=1, description="removeBg | upscale | multiAngle | ...")
    image: str = Field(..., min_length=1, description="Source image data URL or https URL")
    meta: dict[str, Any] | None = None
    aspect_ratio: str | None = None
    quality: str | None = None
    resolution: str | None = None
    model: str | None = None


def _charge(user_id: str, amount: int, detail: str, *, locale: str | None = None) -> None:
    if amount <= 0 or not is_wallet_billing_enabled():
        return
    try:
        spend_credits(user_id, amount, detail)
    except ValueError as err:
        if str(err) == "insufficient_credits":
            raise http_error(402, "insufficient_credits", locale) from err
        raise http_error(400, "request_failed", locale) from err


def _require_free_vision_quota(
    user_id: str,
    *,
    cost: int,
    locale: str | None = None,
) -> None:
    """Free plan: lifetime cap on zero-credit vision toolbar tools."""
    if cost > 0 or not is_wallet_billing_enabled():
        return
    if str(get_user_plan(user_id) or "free").strip().lower() != "free":
        return
    if consume_free_vision_quota(user_id):
        return
    raise http_error(402, "free_vision_exhausted", locale)


def credit_cost_for_kind(
    kind: str,
    model: str | None = None,
    *,
    user_id: str | None = None,
) -> int:
    """Platform credits for paid image tools (LLM i2i + Seedream/WaveSpeed layered)."""
    k = (kind or "").strip()
    if not is_wallet_billing_enabled():
        return 0
    if is_byok_model_ref(model) or (user_id and uses_user_platform_byok(user_id, model)):
        return 0
    if k in _KIND_CREDIT_COST:
        return int(_KIND_CREDIT_COST[k])
    if not uses_llm_for_kind(k):
        return 0
    mid = (model or "").strip()
    if mid:
        return image_model_credit_cost(mid)
    return int(DEFAULT_IMAGE_CREDITS)


@router.get("/tools")
def list_image_tools(current_user: CurrentUser) -> dict[str, Any]:
    from app.core.config import settings
    from app.services.llm.image_tools import (
        mediakit_supports,
        seedream_supports,
        wavespeed_supports,
    )
    from app.services.vision.mediakit_client import mediakit_enabled
    from app.services.vision.providers.registry import (
        seedream_enabled,
        wavespeed_enabled,
    )
    from app.services.wallet.db import FREE_VISION_LIMIT

    kinds = sorted(IMAGE_PROCESS_KINDS)
    costs = {k: credit_cost_for_kind(k) for k in kinds}
    mediakit_on = mediakit_enabled()
    wavespeed_on = wavespeed_enabled()
    seedream_on = seedream_enabled()
    dash_on = bool(str(settings.dashscope_api_key or "").strip())
    byte_on = bool(str(settings.byteplus_api_key or "").strip())
    topaz_on = bool(str(settings.topaz_api_key or "").strip())
    plan = str(get_user_plan(current_user.id) or "free").strip().lower()
    vision_remaining = None
    if is_wallet_billing_enabled() and plan == "free":
        vision_remaining = free_vision_remaining(current_user.id)
    return {
        "kinds": kinds,
        "credits": costs,
        "mediakit": {
            "enabled": mediakit_on,
            "supports": mediakit_supports(),
        },
        "vision": {
            "providers": {
                "seedream": {
                    "enabled": seedream_on,
                    "supports": seedream_supports(),
                },
                "wavespeed": {
                    "enabled": wavespeed_on,
                    "supports": wavespeed_supports(),
                },
                "dashscope": {"enabled": dash_on, "supports": []},
                "byteplus": {"enabled": byte_on, "supports": []},
                "topaz": {"enabled": topaz_on, "supports": []},
            },
            "multiAngleProvider": str(settings.vision_multiangle_provider or "wavespeed"),
            "editElementsProvider": str(
                settings.vision_edit_elements_provider or "seedream"
            ),
        },
        # FE mockup is client-side only (no server bake API).
        "mockup": {"enabled": True, "templates": []},
        "freeVision": {
            "limit": FREE_VISION_LIMIT,
            "remaining": vision_remaining,
        },
    }


@router.post("/process")
async def post_image_process(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: ImageProcessIn,
) -> dict[str, Any]:
    kind = body.kind.strip()
    cost = credit_cost_for_kind(kind, body.model, user_id=current_user.id)
    _require_free_vision_quota(current_user.id, cost=cost, locale=locale)
    _charge(current_user.id, cost, f"AI image tool: {kind}", locale=locale)

    try:
        result = await process_image_tool(
            kind=kind,
            image=body.image.strip(),
            meta=body.meta,
            aspect_ratio=body.aspect_ratio,
            quality=body.quality,
            resolution=body.resolution,
            model=body.model,
            user_id=current_user.id,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    except RuntimeError as err:
        msg = str(err)
        if "No Doubao API key" in msg or "No LLM API key" in msg:
            raise http_error(503, "service_unavailable", locale) from err
        raise http_error(502, "service_unavailable", locale) from err

    if isinstance(result, dict):
        result = {**result, "credits": cost}
    return result
