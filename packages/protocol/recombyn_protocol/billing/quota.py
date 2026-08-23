"""Quota — rate limits and allowance windows (not payment)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

QuotaWindow = Literal["day", "week", "month", "lifetime", "concurrent"]


class QuotaSchema(BaseModel):
    """Numeric allowance for a meter or task class."""

    quota_id: str = ""
    meter_key: str = Field(
        default="",
        description="BillingMeterSchema.meter_key or synthetic 'credits' / 'design_runs'",
    )
    window: QuotaWindow | str = "month"
    limit: int | None = Field(
        default=None,
        description="Hard cap; None = unlimited within entitlement",
    )
    soft_limit: int | None = None
    burst: int | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
