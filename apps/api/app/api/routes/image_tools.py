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
from app.services.wallet.db import is_wallet_billing_enabled, spend_credits

router = APIRouter(prefix="/image", tags=["image-tools"])

# Wallet 积分 charged per LLM image tool when not tied to a Seedream catalog price.
# Local CV kinds (removeBg / editText / editElements) are always 0.
_KIND_CREDIT_COST: dict[str, int] = {
    "upscale": 0,
    "removeBg": 0,
    "eraser": 0,
    "multiAngle": 30,
    "expand": 30,
    "editText": 0,
    "editElements": 0,
    "detectRegions": 0,
    "replaceText": 30,
    "vector": 0,  # local vtracer, no LLM
    "adjust": 0,  # FE uses CSS filters; API adjust is unused
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


def credit_cost_for_kind(
    kind: str,
    model: str | None = None,
    *,
    user_id: str | None = None,
) -> int:
    """Platform credits only when an LLM image path runs on the platform key."""
    k = (kind or "").strip()
    # No LLM call (intelligence vision / CSS adjust) → never charge.
    if not uses_llm_for_kind(k):
        return 0
    if not is_wallet_billing_enabled():
        return 0
    # User's own key / platform BYOK → upstream billed to them, not our wallet.
    if is_byok_model_ref(model) or (user_id and uses_user_platform_byok(user_id, model)):
        return 0
    mid = (model or "").strip()
    if mid:
        return image_model_credit_cost(mid)
    return int(_KIND_CREDIT_COST.get(k, DEFAULT_IMAGE_CREDITS))


@router.get("/tools")
def list_image_tools() -> dict[str, Any]:
    from app.services.llm.image_tools import ilp_supports
    from app.services.mockup.mockup_client import mockup_enabled
    from app.services.vision.ilp_client import ilp_enabled

    kinds = sorted(IMAGE_PROCESS_KINDS)
    costs = {k: credit_cost_for_kind(k) for k in kinds}
    ilp_on = ilp_enabled()
    mockup_on = mockup_enabled()
    mockup_block: dict[str, Any] = {"enabled": mockup_on}
    if mockup_on:
        mockup_block["templates"] = [
            {
                "id": "demo-cylinder",
                "name": "Demo cylinder mug",
                "kind": "builtin",
                "width": 720,
                "height": 960,
            }
        ]
    return {
        "kinds": kinds,
        "credits": costs,
        "ilp": {
            "enabled": ilp_on,
            "supports": ilp_supports(),
        },
        "mockup": mockup_block,
    }


@router.post("/process")
async def post_image_process(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: ImageProcessIn,
) -> dict[str, Any]:
    kind = body.kind.strip()
    cost = credit_cost_for_kind(kind, body.model, user_id=current_user.id)
    # Charge before the model call so insufficient balance fails fast.
    # cost is 0 when no LLM / BYOK / wallet billing off.
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

