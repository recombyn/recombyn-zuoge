"""Task credit quotes for open Runtime — credits only, no margin leak."""

from __future__ import annotations

import uuid
from typing import Any

from recombyn_protocol.billing import default_oss_task_pricing_catalog

from recombyn_intelligence_service.billing.commercial import (
    get_credit_policy,
    get_margin_factor,
    get_provider_rate_sheet,
    get_task_pricing_override,
)
from recombyn_intelligence_service.billing.cost import estimate_internal_cost_micros
from recombyn_intelligence_service.billing.margin import credits_from_internal
from recombyn_intelligence_service.billing.vision_pricing import (
    default_vision_task_pricing_catalog,
    vision_credit_floor,
)


def _task_sheets() -> dict[str, Any]:
    """Prefer commercial override catalog; else shared protocol OSS floors."""
    raw = get_task_pricing_override()
    if isinstance(raw, dict) and raw:
        from recombyn_protocol.billing import TaskPricingSchema

        out: dict[str, Any] = {}
        for key, val in raw.items():
            if isinstance(val, dict):
                try:
                    out[str(key)] = TaskPricingSchema.model_validate(val)
                except Exception:
                    continue
        if out:
            merged = dict(default_oss_task_pricing_catalog())
            merged.update(default_vision_task_pricing_catalog())
            merged.update(out)
            return merged
    merged = dict(default_oss_task_pricing_catalog())
    merged.update(default_vision_task_pricing_catalog())
    return merged


def quote_task_credits(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return Runtime-safe quote: credits + authorize band, no cost/margin fields.

    Body keys (optional)::
      mode, pipeline, byok, meters, usage, tokens_in, tokens_out,
      image_count, agent_steps, rates / pricing_rates
    """
    req = body if isinstance(body, dict) else {}
    mode = str(req.get("mode") or "agent").strip() or "agent"
    vision_floor = vision_credit_floor(mode)
    if vision_floor is not None:
        charged = max(1, vision_floor)
        return {
            "quote_id": f"q_{uuid.uuid4().hex[:16]}",
            "credits_to_charge": charged,
            "authorize_low": charged,
            "authorize_high": charged,
            "byok": False,
            "task_pricing_id": f"tp_vision_{mode.replace('-', '_')}",
            "source": "intelligence.vision",
        }

    byok = bool(req.get("byok"))
    cfg_policy = get_credit_policy()
    byok_fee = max(0, int(cfg_policy.get("byok_agent_fee_credits") or 5))

    if byok:
        return {
            "quote_id": f"q_{uuid.uuid4().hex[:16]}",
            "credits_to_charge": byok_fee,
            "authorize_low": byok_fee,
            "authorize_high": byok_fee,
            "byok": True,
            "source": "byok_agent_fee",
        }

    sheets = _task_sheets()
    sheet = sheets.get(mode) or sheets.get("agent")
    authorize_low = max(0, int(getattr(sheet, "base_credit", 0) or 0))
    authorize_high = max(
        authorize_low,
        int(sheet.estimate_credits_high() if hasattr(sheet, "estimate_credits_high") else authorize_low),
    )

    rate_sheet = get_provider_rate_sheet()
    body_rates = req.get("rates") if isinstance(req.get("rates"), list) else None
    if body_rates is None:
        body_rates = req.get("pricing_rates") if isinstance(req.get("pricing_rates"), list) else None
    rates = body_rates if body_rates is not None else rate_sheet

    breakdown = estimate_internal_cost_micros(
        meters=req.get("meters") if isinstance(req.get("meters"), dict) else None,
        usage=req.get("usage") if isinstance(req.get("usage"), dict) else None,
        tokens_in=int(req.get("tokens_in") or 0),
        tokens_out=int(
            req.get("tokens_out")
            or req.get("tokens_total")
            or 0
        ),
        image_count=int(req.get("image_count") or 0),
        agent_steps=int(req.get("agent_steps") or 0),
        rates=rates if isinstance(rates, list) else None,
    )
    internal = int(breakdown.get("internal_cost_micros") or 0)
    mapped = credits_from_internal(
        internal,
        margin_factor=get_margin_factor(),
        credit_value_micros=int(cfg_policy.get("credit_value_micros") or 100_000),
        min_charge_credits=int(cfg_policy.get("min_charge_credits") or 1),
        round_mode=str(cfg_policy.get("round_mode") or "ceil"),
    )
    has_meters = bool(
        req.get("meters")
        or req.get("usage")
        or req.get("tokens_in")
        or req.get("tokens_out")
        or req.get("tokens_total")
        or req.get("image_count")
        or req.get("agent_steps")
    )
    charged = int(mapped["credits"]) if has_meters and mapped["credits"] > 0 else authorize_high
    charged = max(authorize_low, min(max(charged, 1), max(authorize_high * 3, authorize_high)))

    return {
        "quote_id": f"q_{uuid.uuid4().hex[:16]}",
        "credits_to_charge": charged,
        "authorize_low": authorize_low,
        "authorize_high": authorize_high,
        "byok": False,
        "task_pricing_id": getattr(sheet, "task_pricing_id", "") or "",
        "source": "intelligence.quote",
    }
