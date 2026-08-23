"""Private billing brain — Cost / Margin / Quote (not part of open protocol).

Open Runtime may call ``POST /billing/quote`` and receive only credit numbers.
Margin factors, internal cost math, and list-price strategy stay here.
"""

from __future__ import annotations

from recombyn_intelligence_service.billing.commercial import (
    get_commercial_config,
    get_public_plan_catalog,
    put_commercial_config,
)
from recombyn_intelligence_service.billing.cost import estimate_internal_cost_micros
from recombyn_intelligence_service.billing.margin import (
    apply_margin,
    credits_from_internal,
)
from recombyn_intelligence_service.billing.quote import quote_task_credits

__all__ = [
    "apply_margin",
    "credits_from_internal",
    "estimate_internal_cost_micros",
    "get_commercial_config",
    "get_public_plan_catalog",
    "put_commercial_config",
    "quote_task_credits",
]
