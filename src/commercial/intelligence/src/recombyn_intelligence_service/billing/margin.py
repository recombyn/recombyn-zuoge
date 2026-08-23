"""Margin Engine — internal_cost → sell_cost → credits.

Private commercial policy. Never expose margin_factor on open Runtime quotes.
"""

from __future__ import annotations

import math
from typing import Any

from recombyn_protocol.billing import credits_from_sell_cost_micros


def apply_margin(
    internal_cost_micros: int,
    *,
    margin_factor: float,
) -> int:
    """sell_cost_micros = ceil(internal × margin_factor)."""
    factor = float(margin_factor)
    if not math.isfinite(factor) or factor <= 0:
        factor = 1.0
    return max(0, int(math.ceil(max(0, int(internal_cost_micros or 0)) * factor)))


def credits_from_internal(
    internal_cost_micros: int,
    *,
    margin_factor: float,
    credit_value_micros: int,
    min_charge_credits: int = 1,
    round_mode: str = "ceil",
) -> dict[str, Any]:
    """Full private mapping. Callers that leave this service must strip internals."""
    sell = apply_margin(internal_cost_micros, margin_factor=margin_factor)
    credits = credits_from_sell_cost_micros(
        sell,
        credit_value_micros=max(1, int(credit_value_micros or 1)),
        min_charge_credits=min_charge_credits,
        round_mode=round_mode,
    )
    return {
        "internal_cost_micros": max(0, int(internal_cost_micros or 0)),
        "sell_cost_micros": sell,
        "margin_factor": float(margin_factor),
        "credits": credits,
    }
