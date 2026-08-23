"""Credit policy — public definition of the credit unit.

Credits are **AI work value units**, not token counters.

Hosts may map internal accounting to credits using ``credit_value_micros`` and
``credits_from_sell_cost_micros``. How a host chooses sell amounts is outside
this protocol.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CreditPolicySchema(BaseModel):
    """How one credit is valued and how BYOK / free tiers interact.

    Do **not** put host markup factors or provider list costs here.
    """

    policy_id: str = ""
    currency: str = "CNY"
    # List value of 1 credit in micros of ``currency`` (e.g. ¥0.1 → 100_000).
    credit_value_micros: int = Field(
        default=100_000,
        ge=1,
        description="1 credit list value in currency micros (default ¥0.1)",
    )
    # Platform / Agent orchestration fee when user brings own model keys.
    byok_agent_fee_credits: int = Field(
        default=1,
        ge=0,
        description="Credits charged per BYOK design step/task for Agent OS cost",
    )
    byok_waives_provider_credits: bool = Field(
        default=True,
        description="When True, provider model $ is not converted to credits (user pays vendor)",
    )
    min_charge_credits: int = Field(default=1, ge=0)
    round_mode: str = Field(
        default="ceil",
        description="ceil | floor | nearest — how sell_cost maps to credits",
    )
    notes: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
