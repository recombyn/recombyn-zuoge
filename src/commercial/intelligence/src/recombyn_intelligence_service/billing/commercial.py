"""Commercial config store — margin, plans, credit policy knobs.

Persists to a local JSON file (Cloud Intelligence volume / local data dir).
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

_lock = threading.Lock()

DEFAULT_MARGIN_FACTOR = 2.5
DEFAULT_CREDIT_VALUE_MICROS = 100_000
DEFAULT_BYOK_AGENT_FEE = 5


def default_plan_entitlements() -> list[dict[str, Any]]:
    return [
        {
            "plan_id": "free",
            "display_name": "Free",
            "list_price_cny": 0,
            "credits_grant": 0,
            "credits_period": "month",
            "features": {"watermark": True, "daily_runs": 1},
        },
        {
            "plan_id": "plus",
            "display_name": "Creator",
            "list_price_cny": 49,
            "credits_grant": 340,
            "credits_period": "month",
            "features": {"watermark": False, "priority_queue": False},
        },
        {
            "plan_id": "pro",
            "display_name": "Pro",
            "list_price_cny": 149,
            "credits_grant": 1030,
            "credits_period": "month",
            "features": {"watermark": False, "priority_queue": True, "brand_memory": True},
        },
        {
            "plan_id": "ultra",
            "display_name": "Ultra",
            "list_price_cny": 499,
            "credits_grant": 4000,
            "credits_period": "month",
            "features": {
                "watermark": False,
                "priority_queue": True,
                "brand_memory": True,
                "api": True,
                "team_seats": 5,
            },
        },
    ]


def _config_path() -> Path:
    raw = str(os.environ.get("INTELLIGENCE_COMMERCIAL_PATH") or "").strip()
    if raw:
        return Path(raw)
    data_dir = str(os.environ.get("INTELLIGENCE_DATA_DIR") or "").strip()
    base = Path(data_dir) if data_dir else Path.cwd() / "data"
    return base / "commercial_config.json"


def _default_config() -> dict[str, Any]:
    return {
        "marginFactor": DEFAULT_MARGIN_FACTOR,
        "creditPolicy": {
            "policy_id": "intelligence_default",
            "currency": "CNY",
            "credit_value_micros": DEFAULT_CREDIT_VALUE_MICROS,
            "byok_agent_fee_credits": DEFAULT_BYOK_AGENT_FEE,
            "byok_waives_provider_credits": True,
            "min_charge_credits": 1,
            "round_mode": "ceil",
        },
        "planEntitlements": default_plan_entitlements(),
        "providerRates": [],
        "taskPricingCatalog": None,
        "updatedAt": None,
    }


def _read_raw() -> dict[str, Any]:
    path = _config_path()
    if not path.is_file():
        return _default_config()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            base = _default_config()
            base.update(data)
            if not isinstance(base.get("creditPolicy"), dict):
                base["creditPolicy"] = _default_config()["creditPolicy"]
            if not isinstance(base.get("planEntitlements"), list):
                base["planEntitlements"] = default_plan_entitlements()
            return base
    except Exception:
        pass
    return _default_config()


def _write_raw(data: dict[str, Any]) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def get_margin_factor() -> float:
    cfg = _read_raw()
    try:
        n = float(cfg.get("marginFactor") or DEFAULT_MARGIN_FACTOR)
        return n if n > 0 else DEFAULT_MARGIN_FACTOR
    except (TypeError, ValueError):
        return DEFAULT_MARGIN_FACTOR


def get_credit_policy() -> dict[str, Any]:
    cfg = _read_raw()
    policy = cfg.get("creditPolicy")
    return dict(policy) if isinstance(policy, dict) else dict(_default_config()["creditPolicy"])


def get_task_pricing_override() -> dict[str, Any] | None:
    cfg = _read_raw()
    raw = cfg.get("taskPricingCatalog")
    return raw if isinstance(raw, dict) else None


def get_provider_rate_sheet() -> list[dict[str, Any]]:
    """Optional provider PricingRate rows used by CostEngine when request omits rates."""
    cfg = _read_raw()
    raw = cfg.get("providerRates")
    if not isinstance(raw, list):
        return []
    return [x for x in raw if isinstance(x, dict)]


def get_public_plan_catalog() -> dict[str, Any]:
    """List prices + credit grants only — no margin / internal cost."""
    cfg = _read_raw()
    plans: list[dict[str, Any]] = []
    for row in cfg.get("planEntitlements") or []:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("plan_id") or "").strip().lower()
        if pid not in ("free", "plus", "pro", "ultra"):
            continue
        feats = row.get("features") if isinstance(row.get("features"), dict) else {}
        item: dict[str, Any] = {
            "planId": pid,
            "priceCny": int(row.get("list_price_cny") or 0),
            "creditsIncluded": int(row.get("credits_grant") or 0),
            "period": str(row.get("credits_period") or "month"),
        }
        daily = feats.get("daily_runs")
        if daily is not None:
            try:
                item["dailyRuns"] = max(0, int(daily))
            except (TypeError, ValueError):
                pass
        plans.append(item)
    return {"plans": plans, "source": "intelligence.commercial"}


def get_commercial_config() -> dict[str, Any]:
    """Admin-facing config including private margin_factor + preview."""
    from recombyn_intelligence_service.billing.margin import credits_from_internal

    cfg = _read_raw()
    factor = get_margin_factor()
    policy = cfg.get("creditPolicy") if isinstance(cfg.get("creditPolicy"), dict) else {}
    credit_value = int(policy.get("credit_value_micros") or DEFAULT_CREDIT_VALUE_MICROS)
    sample_internal = 100_000
    mapped = credits_from_internal(
        sample_internal,
        margin_factor=factor,
        credit_value_micros=credit_value,
        min_charge_credits=int(policy.get("min_charge_credits") or 1),
        round_mode=str(policy.get("round_mode") or "ceil"),
    )
    return {
        "marginFactor": factor,
        "creditPolicy": policy,
        "planEntitlements": list(cfg.get("planEntitlements") or []),
        "providerRates": get_provider_rate_sheet(),
        "taskPricingCatalog": cfg.get("taskPricingCatalog"),
        "preview": {
            "internalCostMicros": sample_internal,
            "sellCostMicros": mapped["sell_cost_micros"],
            "credits": mapped["credits"],
            "note": "Private MarginEngine preview (Admin only)",
        },
        "updatedAt": cfg.get("updatedAt"),
        "source": "intelligence.commercial",
    }


def put_commercial_config(body: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        cfg = _read_raw()
        if "marginFactor" in body and body["marginFactor"] is not None:
            try:
                factor = float(body["marginFactor"])
            except (TypeError, ValueError) as e:
                raise ValueError("invalid marginFactor") from e
            if factor <= 0:
                raise ValueError("marginFactor must be > 0")
            cfg["marginFactor"] = factor

        if "planEntitlements" in body and body["planEntitlements"] is not None:
            plans = body["planEntitlements"]
            if not isinstance(plans, list):
                raise ValueError("planEntitlements must be a list")
            cfg["planEntitlements"] = [x for x in plans if isinstance(x, dict)]

        if "providerRates" in body and body["providerRates"] is not None:
            rates = body["providerRates"]
            if not isinstance(rates, list):
                raise ValueError("providerRates must be a list")
            cfg["providerRates"] = [x for x in rates if isinstance(x, dict)]

        if "taskPricingCatalog" in body:
            catalog = body["taskPricingCatalog"]
            if catalog is None:
                cfg["taskPricingCatalog"] = None
            elif isinstance(catalog, dict):
                cfg["taskPricingCatalog"] = catalog
            else:
                raise ValueError("taskPricingCatalog must be an object or null")

        policy_in = body.get("creditPolicy")
        if isinstance(policy_in, dict):
            policy = dict(cfg.get("creditPolicy") or {})
            if "credit_value_micros" in policy_in:
                policy["credit_value_micros"] = int(policy_in.get("credit_value_micros"))
            if "byok_agent_fee_credits" in policy_in:
                policy["byok_agent_fee_credits"] = int(policy_in.get("byok_agent_fee_credits"))
            cfg["creditPolicy"] = policy

        cfg["updatedAt"] = time.time()
        _write_raw(cfg)
    return get_commercial_config()
