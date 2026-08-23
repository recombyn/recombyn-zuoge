"""Provider meter + per-call Usage Event (financial truth atom)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from recombyn_protocol.billing.cost import CostBreakdownSchema

UsageStatus = Literal["ok", "error", "cancelled", "timeout"]


class ProviderUsageSchema(BaseModel):
    """Normalized provider meter (tokens / images / tools / seconds)."""

    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cached_tokens: int | None = None
    reasoning_tokens: int | None = None
    image_count: int | None = None
    image_input_units: float | None = None
    image_output_units: float | None = None
    audio_input_units: float | None = None
    audio_output_units: float | None = None
    search_units: float | None = None
    tool_units: float | None = None
    duration_seconds: float | None = None
    request_count: int | None = None
    metrics: dict[str, float] = Field(
        default_factory=dict,
        description="Extra metric → quantity map keyed like PricingRateSchema.metric",
    )
    raw: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class UsageEventSchema(BaseModel):
    """One provider call (or fused sub-call).

    Settled billable events must set ``pricing_version_id`` so invoices never
    reprice against a later sheet.
    """

    event_id: str = ""
    task_id: str = ""
    user_id: str = ""
    turn_id: str = ""
    source: str = Field(default="", description="design_agent | chat | image | video | …")
    provider: str = ""
    model_id: str = ""
    api_model: str = ""
    status: UsageStatus | str = "ok"
    latency_ms: int | None = None
    usage: ProviderUsageSchema = Field(default_factory=ProviderUsageSchema)
    cost: CostBreakdownSchema = Field(default_factory=CostBreakdownSchema)
    credits: int | None = Field(default=None, description="Credits attributed to this call")
    pricing_version_id: str = Field(
        default="",
        description="Required for settled billable events; empty only while estimating",
    )
    provider_request_id: str = ""
    timestamp: float | None = Field(default=None, description="Unix seconds")
    error: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
