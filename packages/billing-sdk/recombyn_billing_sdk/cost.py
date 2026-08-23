"""Open cost helpers — provider cost from usage × pricing version rates (micros).

Does not apply margin, sell price, or credit packs (private commercial policy).
"""

from __future__ import annotations

from typing import Any

from recombyn_protocol.billing import (
    CostBreakdownSchema,
    PricingRateSchema,
    PricingVersionSchema,
    ProviderUsageSchema,
)


def _scale_for_unit(unit: str) -> float:
    u = (unit or "per_1m_tokens").strip().lower()
    if u in ("per_1m_tokens", "per_million", "1m"):
        return 1_000_000.0
    if u in ("per_1k_tokens", "per_thousand", "1k"):
        return 1_000.0
    return 1.0


_USAGE_METRIC_GETTERS: dict[str, str] = {
    "input_tokens": "input_tokens",
    "input": "input_tokens",
    "output_tokens": "output_tokens",
    "output": "output_tokens",
    "cached_tokens": "cached_tokens",
    "cached_input": "cached_tokens",
    "image_count": "image_count",
    "image_output": "image_output_units",
    "image_input": "image_input_units",
    "audio_input": "audio_input_units",
    "audio_output": "audio_output_units",
    "search": "search_units",
    "tool": "tool_units",
    "duration_seconds": "duration_seconds",
    "request": "request_count",
    "request_count": "request_count",
}


def _quantity_for_metric(usage: ProviderUsageSchema, metric: str) -> float:
    key = (metric or "").strip().lower()
    if key in usage.metrics:
        try:
            return float(usage.metrics[key])
        except (TypeError, ValueError):
            return 0.0
    attr = _USAGE_METRIC_GETTERS.get(key)
    if attr:
        raw = getattr(usage, attr, None)
        if raw is None and attr == "image_output_units":
            raw = usage.image_count
        try:
            return float(raw) if raw is not None else 0.0
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def pricing_version_is_active(
    version: PricingVersionSchema | dict[str, Any],
    *,
    now: float | None = None,
) -> bool:
    """True when status is active and now is inside [effective_from, effective_to)."""
    if isinstance(version, dict):
        version = PricingVersionSchema.model_validate(version)
    status = str(version.status or "").strip().lower()
    if status != "active":
        return False
    if now is None:
        return True
    start = version.effective_from
    end = version.effective_to
    if start is not None and now < float(start):
        return False
    if end is not None and now >= float(end):
        return False
    return True


def estimate_provider_cost(
    usage: ProviderUsageSchema | dict[str, Any],
    version: PricingVersionSchema | dict[str, Any],
    *,
    infrastructure_cost_micros: int = 0,
    storage_cost_micros: int = 0,
    network_cost_micros: int = 0,
    risk_reserve_micros: int = 0,
) -> CostBreakdownSchema:
    """Σ(units × rate_micros / unit_scale) + infra… — open Cost Engine floor."""
    if isinstance(usage, dict):
        usage = ProviderUsageSchema.model_validate(usage)
    if isinstance(version, dict):
        version = PricingVersionSchema.model_validate(version)

    components: dict[str, int] = {}
    for raw in version.rates or []:
        rate = raw if isinstance(raw, PricingRateSchema) else PricingRateSchema.model_validate(raw)
        qty = _quantity_for_metric(usage, rate.metric)
        if qty <= 0:
            continue
        amount = int(rate.amount_micros or 0)
        if amount == 0:
            continue
        denom = _scale_for_unit(rate.unit)
        if denom <= 0:
            denom = 1.0
        # qty * amount_micros / denom → micros (amount already in micros)
        micros = int(round((qty * amount) / denom))
        if micros == 0:
            continue
        name = str(rate.metric or "metric")
        components[name] = int(components.get(name, 0)) + micros

    provider = int(sum(components.values()))
    infra = int(infrastructure_cost_micros or 0)
    storage = int(storage_cost_micros or 0)
    network = int(network_cost_micros or 0)
    risk = int(risk_reserve_micros or 0)
    total = provider + infra + storage + network + risk

    return CostBreakdownSchema(
        provider_cost_micros=provider,
        infrastructure_cost_micros=infra or None,
        storage_cost_micros=storage or None,
        network_cost_micros=network or None,
        risk_reserve_micros=risk or None,
        total_cost_micros=total,
        currency=str(version.currency or "USD"),
        components_micros=components,
    )
