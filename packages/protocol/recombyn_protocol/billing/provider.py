"""Open Billing Provider adapter — Runtime asks Registry/adapter, never hard-codes prices."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from recombyn_protocol.billing.budget import BudgetCheckSchema, BudgetPolicySchema
from recombyn_protocol.billing.cost import TaskCostSchema
from recombyn_protocol.billing.events import BillingEventSchema
from recombyn_protocol.billing.pricing import PricingVersionSchema
from recombyn_protocol.billing.usage import ProviderUsageSchema, UsageEventSchema


class ProviderSchema(BaseModel):
    """Upstream model/vendor identity for billing adapters."""

    provider_id: str = ""
    label: str = ""
    status: str = "active"
    supports: list[str] = Field(
        default_factory=list,
        description="text | image | video | audio | embedding | …",
    )
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


@runtime_checkable
class ProviderBillingAdapter(Protocol):
    """Third-party / host billing adapter surface.

    Maps Provider Usage → Cost via PricingVersion; does **not** implement
    host commercial policy (markup / packs / fraud).
    """

    def resolve_pricing_version(
        self,
        *,
        model_id: str,
        pricing_id: str = "",
        at: float | None = None,
    ) -> PricingVersionSchema | None: ...

    def record_usage(self, event: UsageEventSchema) -> UsageEventSchema: ...

    def estimate_task(
        self,
        *,
        task_id: str,
        user_id: str,
        hints: dict[str, Any] | None = None,
    ) -> TaskCostSchema: ...

    def reserve(self, event: BillingEventSchema) -> BillingEventSchema: ...

    def settle(self, task_cost: TaskCostSchema) -> list[BillingEventSchema]: ...

    def check_budget(
        self,
        *,
        task_id: str,
        policy: BudgetPolicySchema,
        usage: ProviderUsageSchema | None = None,
    ) -> BudgetCheckSchema: ...
