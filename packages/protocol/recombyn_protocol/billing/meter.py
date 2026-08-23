"""Billing meters — what Runtime is allowed to count.

Meters feed TaskCost / usage accounting; they are not user-facing prices.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MeterUnit = Literal[
    "token",
    "image",
    "step",
    "second",
    "byte",
    "request",
    "credit",
    "other",
]


class BillingMeterSchema(BaseModel):
    """One countable dimension of platform work."""

    meter_key: str = Field(
        description="Stable id: llm.input_tokens | llm.output_tokens | image.gen | "
        "agent.step | research.call | memory.write | storage.bytes | eval.run | …"
    )
    unit: MeterUnit | str = "other"
    description: str = ""
    # Optional link back to PricingVersion rate metric name
    pricing_metric: str = ""
    aggregates_into: str = Field(
        default="",
        description="Parent meter_key for rollups (optional)",
    )
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


# Suggested open meter keys (not exhaustive — operators may add).
STANDARD_METER_KEYS: tuple[str, ...] = (
    "llm.input_tokens",
    "llm.output_tokens",
    "image.gen",
    "agent.step",
    "agent.orchestration",
    "research.call",
    "reference.analyze",
    "memory.read",
    "memory.write",
    "review.call",
    "eval.run",
    "storage.bytes",
    "gpu.second",
    "queue.wait_second",
)
