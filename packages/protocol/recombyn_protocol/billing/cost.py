"""Cost breakdown + task-level rollup.

Layers (protocol owns 1–2 + credit fields; host commercial policy is separate)::

    Provider Cost + Agent/Platform Cost
          → Internal Cost (CostBreakdown)
          → Host maps to credits via CreditPolicy (out of protocol)
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class CostBreakdownSchema(BaseModel):
    """Auditable cost components — amounts in currency **micros**.

    Design OS cost is not token-only: include orchestration, research, eval,
    storage, GPU, concurrency — either as first-class fields or ``components_micros``.
    """

    provider_cost_micros: int | None = None
    infrastructure_cost_micros: int | None = None
    storage_cost_micros: int | None = None
    network_cost_micros: int | None = None
    risk_reserve_micros: int | None = None
    # Design-agent / platform additives (still public cost truth, not margin).
    agent_orchestration_cost_micros: int | None = None
    research_cost_micros: int | None = None
    evaluation_cost_micros: int | None = None
    gpu_cost_micros: int | None = None
    concurrency_cost_micros: int | None = None
    internal_cost_micros: int | None = Field(
        default=None,
        description="Sum of provider + platform additives (host maps to credits)",
    )
    total_cost_micros: int | None = Field(
        default=None,
        description="Usually equals internal_cost_micros for a settled call",
    )
    currency: str = "USD"
    components_micros: dict[str, int] = Field(
        default_factory=dict,
        description="meter_key / metric → micros contribution",
    )

    model_config = {"extra": "allow"}

    @model_validator(mode="after")
    def _fill_internal_total(self) -> CostBreakdownSchema:
        parts = [
            int(self.provider_cost_micros or 0),
            int(self.infrastructure_cost_micros or 0),
            int(self.storage_cost_micros or 0),
            int(self.network_cost_micros or 0),
            int(self.risk_reserve_micros or 0),
            int(self.agent_orchestration_cost_micros or 0),
            int(self.research_cost_micros or 0),
            int(self.evaluation_cost_micros or 0),
            int(self.gpu_cost_micros or 0),
            int(self.concurrency_cost_micros or 0),
        ]
        if self.internal_cost_micros is None and any(parts):
            self.internal_cost_micros = sum(parts)
        if self.total_cost_micros is None and self.internal_cost_micros is not None:
            self.total_cost_micros = int(self.internal_cost_micros)
        return self


class TaskCostSchema(BaseModel):
    """One design task rollup — product unit users buy (not a single model call).

    Credits are wallet integers. Hosts map usage to credits via CreditPolicy
    and optional remote quote; that mapping is outside this schema.
    """

    task_id: str = ""
    user_id: str = ""
    task_type: str = ""
    pipeline: str = ""
    task_pricing_id: str = ""
    usage_event_ids: list[str] = Field(default_factory=list)
    estimated_cost_micros: int | None = None
    actual_cost_micros: int | None = None
    currency: str = "USD"
    credits_estimated_low: int | None = None
    credits_estimated_high: int | None = None
    credits_reserved: int = 0
    credits_charged: int = 0
    credits_refunded: int = 0
    credits_released: int = 0
    pricing_version_ids: list[str] = Field(default_factory=list)
    step_credits: dict[str, int] = Field(
        default_factory=dict,
        description="step name → credits attributed at settle",
    )
    breakdown: CostBreakdownSchema = Field(default_factory=CostBreakdownSchema)
    status: str = Field(
        default="open",
        description="open | reserved | settling | settled | cancelled",
    )
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
