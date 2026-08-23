"""Wallet billing — unified 积分 (credits) for chat + images + design tasks.

Product rule (ADR 0026): **1 credit = AI work value unit**, not a token.

Design runs authorize from ``TaskPricingSchema`` (base + steps).
Capture prefers an optional remote quote (``credits_to_charge`` only).
OSS chat/image conversion remains when no quote is available.

BYOK: waive provider credit conversion; still charge Agent orchestration
(CreditPolicySchema.byok_agent_fee_credits).
"""

from __future__ import annotations

import json
import math
import time
from typing import Any

from recombyn_protocol.billing import (
    CreditPolicySchema,
    TaskPricingSchema,
)

from app.services.wallet.db import grant_credits, spend_credits

DEFAULT_MARKUP = 1.2
RULE_MARKUP = "billing.token_markup"
RULE_CREDIT_VALUE = "billing.credit_value_micros"
RULE_BYOK_FEE = "billing.byok_agent_fee_credits"

# How many billed LLM tokens equal 1 wallet 积分 (transitional fallback).
TOKENS_PER_CREDIT = 15_000

# OSS face-value anchor for credit-key / CNY→积分 conversion (Plus list SKU).
PLUS_LIST_PRICE_CNY = 49.0
PLUS_IMAGE_FACE_CREDITS = 340
# Fallback when catalog has no image price.
DEFAULT_IMAGE_CREDITS = 2

# Public credit unit value + Design Agent BYOK orchestration fee defaults.
DEFAULT_CREDIT_VALUE_MICROS = 100_000
DEFAULT_BYOK_AGENT_FEE = 5

# OSS list SKUs when Intelligence is unreachable (aligned with commercial defaults).
_OSS_PLAN_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "planId": "free",
        "priceCny": 0,
        "creditsIncluded": 0,
        "period": "month",
        "dailyRuns": 1,
    },
    {
        "planId": "plus",
        "priceCny": 49,
        "creditsIncluded": 340,
        "period": "month",
    },
    {
        "planId": "pro",
        "priceCny": 149,
        "creditsIncluded": 1030,
        "period": "month",
    },
    {
        "planId": "ultra",
        "priceCny": 499,
        "creditsIncluded": 4000,
        "period": "month",
    },
)
_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None
_CATALOG_TTL_SEC = 60.0


def _plan_id(raw: Any) -> str:
    return str(raw or "").strip().lower()


def _sanitize_plan_row(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pid = _plan_id(raw.get("planId"))
    if pid not in ("free", "plus", "pro", "ultra"):
        return None
    try:
        price = int(raw.get("priceCny") or 0)
    except (TypeError, ValueError):
        price = 0
    try:
        credits = int(raw.get("creditsIncluded") or 0)
    except (TypeError, ValueError):
        credits = 0
    row: dict[str, Any] = {
        "planId": pid,
        "priceCny": max(0, price),
        "creditsIncluded": max(0, credits),
        "period": str(raw.get("period") or "month"),
    }
    try:
        daily = raw.get("dailyRuns")
        if daily is not None:
            row["dailyRuns"] = max(0, int(daily))
    except (TypeError, ValueError):
        pass
    return row


def oss_plan_catalog() -> list[dict[str, Any]]:
    return [dict(x) for x in _OSS_PLAN_CATALOG]


def public_plan_catalog(*, force: bool = False) -> list[dict[str, Any]]:
    """Host list SKUs: Intelligence `/billing/plans`, else OSS fallback."""
    global _catalog_cache
    now = time.time()
    if not force and _catalog_cache and now - _catalog_cache[0] < _CATALOG_TTL_SEC:
        return [dict(x) for x in _catalog_cache[1]]
    rows = oss_plan_catalog()
    try:
        from app.services.design.intelligence_runtime import call_remote_billing

        remote = call_remote_billing("GET", "/billing/plans")
        remote_plans = remote.get("plans") if isinstance(remote, dict) else None
        if isinstance(remote_plans, list):
            parsed = [_sanitize_plan_row(x) for x in remote_plans]
            cleaned = [x for x in parsed if x]
            if cleaned:
                by_id = {x["planId"]: x for x in rows}
                for item in cleaned:
                    by_id[item["planId"]] = item
                rows = list(by_id.values())
    except Exception:
        pass
    _catalog_cache = (now, rows)
    return [dict(x) for x in rows]


def plan_row(plan_id: str) -> dict[str, Any] | None:
    pid = _plan_id(plan_id)
    for row in public_plan_catalog():
        if row.get("planId") == pid:
            return row
    return None


def plan_credit_grant(plan_id: str) -> int:
    row = plan_row(plan_id)
    if row:
        return int(row.get("creditsIncluded") or 0)
    return 0


def _as_float(raw: Any, default: float) -> float:
    try:
        n = float(str(raw or "").strip().split()[0])
        return n if math.isfinite(n) and n > 0 else default
    except (TypeError, ValueError, IndexError):
        return default


def _as_int(raw: Any, default: int, *, minimum: int = 0) -> int:
    try:
        n = int(float(str(raw or "").strip().split()[0]))
    except (TypeError, ValueError, IndexError):
        return default
    return max(minimum, n)


def _rules_map(rules: dict[str, Any] | None = None) -> dict[str, Any]:
    src = rules or {}
    if src:
        return src
    try:
        from app.services.design.admin.admin_store import list_global_rules

        return {r["ruleKey"]: r["ruleValue"] for r in list_global_rules()}
    except Exception:
        return {}


def parse_price_amount(raw: Any) -> float | None:
    """Leading number from catalog price (e.g. '0.25' or '0.25 元/张')."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        n = float(s.split()[0])
    except (TypeError, ValueError, IndexError):
        return None
    return n if math.isfinite(n) and n >= 0 else None


def load_billing_markup(rules: dict[str, Any] | None = None) -> float:
    """Return credit markup multiplier (>= 1)."""
    return _as_float(_rules_map(rules).get(RULE_MARKUP), DEFAULT_MARKUP)



def load_credit_policy(rules: dict[str, Any] | None = None) -> CreditPolicySchema:
    """Public credit unit + BYOK agent fee (no host markup fields)."""
    src = _rules_map(rules)
    return CreditPolicySchema(
        policy_id="runtime_default",
        currency="CNY",
        credit_value_micros=_as_int(
            src.get(RULE_CREDIT_VALUE),
            DEFAULT_CREDIT_VALUE_MICROS,
            minimum=1,
        ),
        byok_agent_fee_credits=_as_int(
            src.get(RULE_BYOK_FEE),
            DEFAULT_BYOK_AGENT_FEE,
            minimum=0,
        ),
        byok_waives_provider_credits=True,
        min_charge_credits=1,
        round_mode="ceil",
    )


def byok_agent_fee_credits(rules: dict[str, Any] | None = None) -> int:
    """Credits charged per BYOK design run for Agent OS cost."""
    return max(0, int(load_credit_policy(rules).byok_agent_fee_credits or 0))


def default_task_pricing_catalog() -> dict[str, TaskPricingSchema]:
    """Product task sheets — authorize ceilings from shared protocol catalog."""
    from recombyn_protocol.billing import default_oss_task_pricing_catalog

    return default_oss_task_pricing_catalog()


def _catalog_from_rules(rules: dict[str, Any] | None) -> dict[str, TaskPricingSchema] | None:
    raw = _rules_map(rules).get("billing.task_pricing_json")
    if not raw:
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, TaskPricingSchema] = {}
    for key, val in data.items():
        if not isinstance(val, dict):
            continue
        try:
            out[str(key)] = TaskPricingSchema.model_validate(val)
        except Exception:
            continue
    return out or None


def resolve_task_pricing(
    mode: str,
    *,
    rules: dict[str, Any] | None = None,
    pipeline: str = "",
) -> TaskPricingSchema:
    """Resolve TaskPricing for a run mode / pipeline."""
    catalog = _catalog_from_rules(rules) or default_task_pricing_catalog()
    pipe = (pipeline or "").strip()
    if pipe and pipe in catalog:
        return catalog[pipe]
    key = (mode or "").strip() or "agent"
    if key in catalog:
        return catalog[key]
    return catalog.get("agent") or TaskPricingSchema(
        task_type="design_agent",
        base_credit=20,
    )


def estimate_design_hold_credits(
    mode: str,
    *,
    rules: dict[str, Any] | None = None,
    pipeline: str = "",
) -> int:
    """Authorize ceiling from TaskPricing (base + steps), not token math."""
    sheet = resolve_task_pricing(mode, rules=rules, pipeline=pipeline)
    return max(1, int(sheet.estimate_credits_high() or 0))


def credits_per_cny() -> float:
    """How many 积分 equal ¥1, from Plus list SKU (catalog, else OSS face)."""
    row = plan_row("plus")
    price = float((row or {}).get("priceCny") or PLUS_LIST_PRICE_CNY)
    credits = float((row or {}).get("creditsIncluded") or PLUS_IMAGE_FACE_CREDITS)
    if price <= 0:
        return float(PLUS_IMAGE_FACE_CREDITS) / PLUS_LIST_PRICE_CNY
    return credits / price


def tokens_to_credits(billed_tokens: int) -> int:
    """Convert billed LLM tokens (after markup) into wallet 积分."""
    n = max(0, int(billed_tokens or 0))
    if n <= 0:
        return 0
    return max(1, int(math.ceil(n / float(TOKENS_PER_CREDIT))))


def charge_from_llm_tokens(
    actual_tokens: int,
    *,
    rules: dict[str, Any] | None = None,
    markup: float | None = None,
) -> int:
    """Convert provider LLM token usage into wallet 积分 (OSS fallback when remote quote unavailable)."""
    tokens = max(0, int(actual_tokens or 0))
    if tokens <= 0:
        return 0
    m = float(markup) if markup is not None else load_billing_markup(rules)
    if not math.isfinite(m) or m <= 0:
        m = DEFAULT_MARKUP
    billed = max(1, int(math.ceil(tokens * m)))
    return tokens_to_credits(billed)


def charge_from_image_cny(
    price_cny: float,
    *,
    count: int = 1,
    rules: dict[str, Any] | None = None,
    markup: float | None = None,
) -> int:
    """Convert vendor CNY/image × count into wallet 积分 (with markup)."""
    n = max(1, int(count or 1))
    cny = float(price_cny or 0) * n
    if not math.isfinite(cny) or cny <= 0:
        return max(1, DEFAULT_IMAGE_CREDITS * n)
    m = float(markup) if markup is not None else load_billing_markup(rules)
    if not math.isfinite(m) or m <= 0:
        m = DEFAULT_MARKUP
    return max(1, int(math.ceil(cny * credits_per_cny() * m)))


def image_model_credit_cost(
    model_id: str | None,
    *,
    count: int = 1,
    resolution: str | None = None,
    rules: dict[str, Any] | None = None,
) -> int:
    """Look up image catalog price (元/张, resolution-aware) → wallet 积分."""
    mid = (model_id or "").strip()
    price_cny: float | None = None
    if mid:
        try:
            from app.services.llm import list_image_models
            from app.services.llm.image_price import resolve_image_unit_cny

            for m in list_image_models():
                if str(m.get("id") or "") == mid:
                    meta = m.get("priceMeta")
                    price_cny = resolve_image_unit_cny(
                        price=m.get("price"),
                        price_meta=meta if isinstance(meta, dict) else None,
                        resolution=resolution,
                        provider=str(m.get("provider") or ""),
                    )
                    break
        except Exception:
            price_cny = None
    if price_cny is None or price_cny <= 0:
        return max(1, DEFAULT_IMAGE_CREDITS * max(1, int(count or 1)))
    return charge_from_image_cny(price_cny, count=count, rules=rules)


def _agent_steps_for_mode(mode: str) -> int:
    key = (mode or "").strip() or "agent"
    if key == "agent":
        return 3
    if key == "partial":
        return 1
    if key == "single_model":
        return 1
    return 1


def resolve_capture_credits(
    *,
    mode: str = "agent",
    actual_tokens: int = 0,
    images_hydrated: int = 0,
    byok: bool = False,
    rules: dict[str, Any] | None = None,
    extra_credits: int = 0,
    meters: dict[str, Any] | None = None,
) -> tuple[int, str]:
    """Decide capture credits for settle.

    Prefer optional remote quote (credits only). Fallbacks:
    BYOK agent fee → OSS TaskPricing/token fallback hybrid.
    Returns ``(credits, source)``.
    """
    imgs = max(0, int(images_hydrated or 0))
    extra_img = max(0, int(extra_credits or 0))
    tokens = max(0, int(actual_tokens or 0))
    run_mode = (mode or "agent").strip() or "agent"
    meter_map = dict(meters) if isinstance(meters, dict) else {}
    if tokens and "llm.tokens_out" not in meter_map:
        meter_map["llm.tokens_out"] = tokens
    if imgs and "image.gen" not in meter_map:
        meter_map["image.gen"] = imgs
    if "agent.steps" not in meter_map:
        meter_map["agent.steps"] = _agent_steps_for_mode(run_mode)

    if byok:
        fee = byok_agent_fee_credits(rules)
        # Platform image hydrate may still bill even when LLM is BYOK.
        return max(0, fee + extra_img), "byok_agent_fee"

    try:
        from app.services.design.intelligence_runtime import quote_remote_task_credits

        quoted = quote_remote_task_credits(
            {
                "mode": run_mode,
                "byok": False,
                "tokens_out": tokens,
                "tokens_total": tokens,
                "image_count": imgs,
                "agent_steps": int(meter_map.get("agent.steps") or _agent_steps_for_mode(run_mode)),
                "meters": meter_map,
            }
        )
        if isinstance(quoted, dict) and quoted.get("credits_to_charge") is not None:
            n = max(0, int(quoted.get("credits_to_charge") or 0))
            # Remote quote already priced image_count — do not double-add.
            return n, str(quoted.get("source") or "remote.quote")
    except Exception:
        pass

    # OSS / Intelligence-down: TaskPricing band + token fallback.
    fallback = charge_from_llm_tokens(tokens, rules=rules) + extra_img
    sheet = resolve_task_pricing(run_mode, rules=rules)
    lo = max(0, int(sheet.base_credit or 0))
    hi = max(lo, int(sheet.estimate_credits_high() or 0))
    if fallback <= 0:
        return max(1, lo or hi or 1), "task_pricing_floor"
    capped = max(lo, min(fallback, max(hi * 3, hi, 1)))
    return capped, "oss_hybrid"


def settle_token_hold(
    user_id: str,
    *,
    hold: int,
    actual_tokens: int,
    detail: str,
    rules: dict[str, Any] | None = None,
    extra_credits: int = 0,
    byok: bool = False,
    mode: str = "agent",
    images_hydrated: int = 0,
    meters: dict[str, Any] | None = None,
    task_id: str = "",
) -> int:
    """
    After a run: adjust authorized hold to capture credits.

    Capture prefers optional remote ``quote.credits_to_charge``.
    BYOK: waive provider LLM conversion; charge agent fee (+ platform images).
    ``hold`` was already spent (authorize). Returns total 积分 charged.
    """
    hold_n = max(0, int(hold or 0))
    imgs = max(0, int(images_hydrated or 0))
    extra_img = max(0, int(extra_credits or 0))
    if extra_img <= 0 and imgs > 0:
        # Caller may pass images_hydrated without precomputed extras.
        mid = ""
        if isinstance(rules, dict):
            mid = str(rules.get("assets.image_default_model") or "").strip()
        extra_img = image_model_credit_cost(mid or None, count=imgs, rules=rules) if imgs else 0

    total, source = resolve_capture_credits(
        mode=mode,
        actual_tokens=actual_tokens,
        images_hydrated=imgs,
        byok=byok,
        rules=rules,
        extra_credits=extra_img,
        meters=meters,
    )
    uid = (user_id or "").strip()
    if not uid or hold_n <= 0:
        if uid and total > 0 and hold_n <= 0:
            try:
                spend_credits(uid, total, detail=f"{(detail or 'design').strip()[:200]}:charge")
            except ValueError:
                pass
        return total

    note = (detail or "design_settle").strip()[:400]
    if total < hold_n:
        refund = hold_n - total
        try:
            grant_credits(uid, refund, detail=f"{note}:refund:{refund}")
        except Exception:
            pass
    elif total > hold_n:
        extra = total - hold_n
        try:
            spend_credits(uid, extra, detail=f"{note}:extra:{extra}")
        except ValueError:
            total = hold_n

    try:
        from app.services.wallet.lifecycle import settle_task_credits

        settle_task_credits(
            user_id=uid,
            reserved=hold_n,
            actual=total,
            task_id=task_id,
            detail=f"{note}:{source}",
            mutate_wallet=False,
        )
    except Exception:
        pass
    return total
