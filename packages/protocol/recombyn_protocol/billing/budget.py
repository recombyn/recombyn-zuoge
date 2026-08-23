"""Budget Guard — Agent safety limits (not payment / pack pricing)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

BudgetDecision = Literal["allow", "deny", "degrade"]


class BudgetPolicySchema(BaseModel):
    """Per-task / per-user caps checked before each billable hop."""

    max_credits_per_task: int | None = None
    max_usd_micros_per_task: int | None = Field(
        default=None, description="Max internal cost in currency micros"
    )
    max_model_calls: int | None = None
    max_image_generations: int | None = None
    max_duration_seconds: int | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class BudgetSchema(BaseModel):
    """Live budget counters for an in-flight task (paired with BudgetPolicy)."""

    task_id: str = ""
    user_id: str = ""
    policy: BudgetPolicySchema = Field(default_factory=BudgetPolicySchema)
    credits_reserved: int = 0
    credits_spent: int = 0
    cost_micros_spent: int = 0
    model_calls: int = 0
    image_generations: int = 0
    duration_seconds: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class BudgetCheckSchema(BaseModel):
    """Result of a Budget Guard evaluation."""

    decision: BudgetDecision | str = "allow"
    policy: BudgetPolicySchema = Field(default_factory=BudgetPolicySchema)
    budget: BudgetSchema | None = None
    reason: str = ""
    credits_spent: int = 0
    credits_reserved: int = 0
    cost_micros_spent: int = 0
    model_calls: int = 0
    image_generations: int = 0
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
