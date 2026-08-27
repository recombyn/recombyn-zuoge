"""Cost Engine — meters / usage / optional PricingRates → CostBreakdownSchema.

Private. Do not ship this module in the open Runtime.
"""

from __future__ import annotations

from typing import Any

from recombyn_protocol.billing import CostBreakdownSchema, PricingRateSchema

# Fallback transitional rates (USD micros) when no PricingVersion rates provided.
_FALLBACK_RATES: dict[str, tuple[str, int]] = {
    # metric → (unit, micros_per_unit)
    "input_tokens": ("1k_tokens", 150),
    "output_tokens": ("1k_tokens", 600),
    "image": ("image", 25_000),
    "agent_step": ("request", 5_000),
    "storage": ("request", 500),
}


def _rate_micros(rates: list[PricingRateSchema], metric: str, quantity: float) -> int:
    """Apply first matching PricingRate; quantity is raw units (tokens / images)."""
    q = max(0.0, float(quantity or 0))
    if q <= 0:
        return 0
    for rate in rates:
        if str(rate.metric or "") != metric:
            continue
        unit = str(rate.unit or "").strip().lower()
        micros = int(rate.amount_micros or 0)
        if unit in ("per_1m_tokens", "1m_tokens"):
            return int((q * micros) // 1_000_000)
        if unit in ("1k_tokens", "per_1k_tokens", "tokens_1k"):
            return int((q * micros) // 1000)
        if unit in ("token", "tokens", "per_token"):
            return int(q * micros)
        if unit in ("per_image", "image"):
            return int(q * micros)
        if unit in ("per_request", "request", "per_second", "second"):
            return int(q * micros)
        return int(q * micros)
    fb = _FALLBACK_RATES.get(metric)
    if not fb:
        return 0
    unit, micros = fb
    if unit == "1k_tokens":
        return int((q * micros) // 1000)
    return int(q * micros)


def _parse_rates(raw: Any) -> list[PricingRateSchema]:
    if not isinstance(raw, list):
        return []
    out: list[PricingRateSchema] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            out.append(PricingRateSchema.model_validate(item))
        except Exception:
            continue
    return out


def estimate_internal_cost_micros(
    *,
    meters: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    image_count: int = 0,
    agent_steps: int = 0,
    rates: list[dict[str, Any]] | None = None,
    pricing_rates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a validated CostBreakdownSchema dict (internal only; no margin)."""
    m = meters if isinstance(meters, dict) else {}
    u = usage if isinstance(usage, dict) else {}
    rate_list = _parse_rates(rates if rates is not None else pricing_rates)

    tin = max(
        0,
        int(tokens_in or m.get("llm.tokens_in") or u.get("tokens_in") or u.get("input_tokens") or 0),
    )
    tout = max(
        0,
        int(
            tokens_out
            or m.get("llm.tokens_out")
            or u.get("tokens_out")
            or u.get("output_tokens")
            or 0
        ),
    )
    images = max(
        0,
        int(image_count or m.get("image.gen") or u.get("image_count") or 0),
    )
    steps = max(
        0,
        int(agent_steps or m.get("agent.steps") or u.get("agent_steps") or 0),
    )

    llm_in = _rate_micros(rate_list, "input_tokens", tin)
    llm_out = _rate_micros(rate_list, "output_tokens", tout)
    img_cost = _rate_micros(rate_list, "image", images)
    agent = _rate_micros(rate_list, "agent_step", steps)
    storage = _rate_micros(rate_list, "storage", 1 if (tin or tout or images or steps) else 0)
    provider = llm_in + llm_out + img_cost

    breakdown = CostBreakdownSchema(
        provider_cost_micros=provider,
        agent_orchestration_cost_micros=agent,
        storage_cost_micros=storage,
        currency="USD",
        components_micros={
            "llm.tokens_in": llm_in,
            "llm.tokens_out": llm_out,
            "image.gen": img_cost,
            "agent.steps": agent,
            "storage": storage,
        },
    )
    data = breakdown.model_dump()
    data["meta"] = {
        "engine": "intelligence.cost.v1",
        "rates_source": "pricing_rates" if rate_list else "fallback_sheet",
        "rates_count": len(rate_list),
    }
    return data
