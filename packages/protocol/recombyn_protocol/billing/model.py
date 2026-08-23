"""Model Registry identity — capabilities only; prices live on PricingSchema.

Chain::

    ModelIdentity → ModelCapability.pricing_id → PricingSchema → PricingVersion
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ModelKind = Literal["text", "image", "video", "audio", "embedding", "other"]


class ModelIdentitySchema(BaseModel):
    """Stable model identity (no capabilities, no price)."""

    model_id: str = ""
    provider: str = ""
    api_model: str = ""
    kind: ModelKind | str = "text"
    label: str = ""
    status: str = "active"

    model_config = {"extra": "allow"}


class ModelCapabilitySchema(ModelIdentitySchema):
    """Model Registry row — identity + capabilities + pricing family link.

    Do **not** add ``user_price`` / ``credits_per_token`` here.
    User sell price is host commercial policy (out of protocol).
    """

    capabilities: list[str] = Field(default_factory=list)
    context_window: int | None = None
    max_output_tokens: int | None = None
    pricing_id: str = Field(
        default="",
        description="Logical pricing family id → PricingSchema.pricing_id",
    )

    model_config = {"extra": "allow"}
