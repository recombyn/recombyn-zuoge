"""Entitlement — what a plan grants (credits, quotas, feature flags).

List prices and pack SKUs are host-specific; this schema is the portable grant
shape Runtime and wallets understand.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from recombyn_protocol.billing.quota import QuotaSchema


class EntitlementSchema(BaseModel):
    """Subscription / pack grant attached to a user or org."""

    entitlement_id: str = ""
    plan_id: str = Field(
        default="",
        description="Host plan id (portable shape; host defines catalog)",
    )
    credits_grant: int = Field(default=0, ge=0, description="Period credit refill")
    credits_period: str = Field(default="month", description="day | month | lifetime")
    quotas: list[QuotaSchema] = Field(default_factory=list)
    # Feature gates (watermark, max_resolution, priority_queue, brand_memory, api, …)
    features: dict[str, Any] = Field(default_factory=dict)
    model_allowlist: list[str] = Field(
        default_factory=list,
        description="Empty = all non-blocked models; else allow list of model ids",
    )
    model_blocklist: list[str] = Field(default_factory=list)
    priority: int = Field(default=0, description="Higher = better queue priority")
    effective_from: float | None = None
    effective_to: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
