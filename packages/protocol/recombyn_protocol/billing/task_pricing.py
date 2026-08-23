"""Task Pricing — users buy completed design work, not raw tokens.

Model PricingVersion remains the provider cost floor. TaskPricing maps a
product pipeline (design_agent / image / …) onto credit estimates and step
meters. Hosts may further map usage to credits via CreditPolicy / quote.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

TaskType = Literal[
    "design_agent",
    "image",
    "chat",
    "import",
    "review_only",
    "other",
]


class TaskStepPricingSchema(BaseModel):
    """One billable step inside a product task (research / paint / review / …)."""

    name: str = Field(description="Stable step id: research | strategy | image | review | …")
    credits: int = Field(default=0, ge=0, description="Nominal credit weight for this step")
    optional: bool = False
    meter_keys: list[str] = Field(
        default_factory=list,
        description="BillingMeterSchema.meter_key values this step may emit",
    )
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class TaskPricingSchema(BaseModel):
    """Product-facing price sheet for a task type / pipeline.

    ``base_credit`` is the list estimate floor (not provider token math).
    Actual capture still follows estimate → authorize → capture/release.
    """

    task_pricing_id: str = ""
    task_type: TaskType | str = "design_agent"
    pipeline: str = Field(
        default="",
        description="e.g. poster_v2 | landing_page | dashboard_ui",
    )
    base_credit: int = Field(default=0, ge=0)
    steps: list[TaskStepPricingSchema] = Field(default_factory=list)
    currency: str = "CNY"
    status: str = Field(default="active", description="draft | active | retired")
    notes: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}

    def estimate_credits_high(self) -> int:
        """Sum of base + all step credits (authorization ceiling helper)."""
        step_sum = sum(max(0, int(s.credits or 0)) for s in self.steps)
        return max(0, int(self.base_credit or 0)) + step_sum


def default_oss_task_pricing_catalog() -> dict[str, TaskPricingSchema]:
    """Shared OSS authorize floors — Runtime + host quote must stay aligned.

    Hosts may override via rules / commercial config; this is the public floor.
    """
    return {
        "agent": TaskPricingSchema(
            task_pricing_id="tp_design_agent_default",
            task_type="design_agent",
            pipeline="agent",
            base_credit=20,
            steps=[
                TaskStepPricingSchema(
                    name="research",
                    credits=3,
                    meter_keys=["agent.research"],
                ),
                TaskStepPricingSchema(
                    name="paint",
                    credits=5,
                    meter_keys=["agent.paint", "image.gen"],
                ),
                TaskStepPricingSchema(
                    name="review",
                    credits=2,
                    meter_keys=["agent.review"],
                ),
            ],
            notes="Default Design Agent authorize band (base+steps=30)",
        ),
        "single_model": TaskPricingSchema(
            task_pricing_id="tp_design_single_default",
            task_type="design_agent",
            pipeline="single_model",
            base_credit=20,
            steps=[],
            notes="Single-model design authorize floor",
        ),
        "partial": TaskPricingSchema(
            task_pricing_id="tp_design_partial_default",
            task_type="design_agent",
            pipeline="partial",
            base_credit=10,
            steps=[],
            notes="Partial / in-place edit authorize floor",
        ),
        "image": TaskPricingSchema(
            task_pricing_id="tp_image_default",
            task_type="image",
            pipeline="image",
            base_credit=2,
            steps=[],
        ),
        "chat": TaskPricingSchema(
            task_pricing_id="tp_chat_default",
            task_type="chat",
            pipeline="chat",
            base_credit=1,
            steps=[],
        ),
    }
