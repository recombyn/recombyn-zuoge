"""Task billing lifecycle helpers — estimate → authorize → capture/release.

Wraps wallet spend/credit at the **credit** layer (design holds). Emits Billing
Protocol event shapes. Commercial packs / margin stay private.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from recombyn_billing_sdk import build_billing_event, build_task_cost
from recombyn_protocol.billing import BILLING_LIFECYCLE_STAGES

_log = logging.getLogger("wallet.lifecycle")


def estimate_task_credits(
    *,
    low: int,
    high: int,
    task_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    """Build estimate BillingEvent + TaskCost (no wallet mutation)."""
    lo = max(0, int(low or 0))
    hi = max(lo, int(high or 0))
    task = build_task_cost(
        task_id=task_id,
        user_id=user_id,
        credits_estimated_low=lo,
        credits_estimated_high=hi,
        status="open",
    )
    ev = build_billing_event(
        kind="estimate",
        user_id=user_id,
        task_id=task_id,
        estimate_low=lo,
        estimate_high=hi,
        credits_delta=0,
    )
    return {
        "lifecycle": list(BILLING_LIFECYCLE_STAGES),
        "taskCost": task.model_dump(),
        "billingEvent": ev.model_dump(),
    }


def estimate_from_task_pricing(
    *,
    mode: str,
    task_id: str = "",
    user_id: str = "",
    rules: dict[str, Any] | None = None,
    pipeline: str = "",
    byok: bool = False,
) -> dict[str, Any]:
    """Estimate credit band from TaskPricing (or BYOK agent fee)."""
    from app.services.wallet.billing import (
        byok_agent_fee_credits,
        estimate_design_hold_credits,
        resolve_task_pricing,
    )

    if byok:
        fee = byok_agent_fee_credits(rules)
        out = estimate_task_credits(
            low=fee, high=fee, task_id=task_id, user_id=user_id
        )
        out["source"] = "byok_agent_fee"
        out["byokAgentFeeCredits"] = fee
        return out

    sheet = resolve_task_pricing(mode, rules=rules, pipeline=pipeline)
    lo = max(0, int(sheet.base_credit or 0))
    hi = max(lo, int(estimate_design_hold_credits(mode, rules=rules, pipeline=pipeline)))
    out = estimate_task_credits(low=lo, high=hi, task_id=task_id, user_id=user_id)
    out["source"] = "task_pricing"
    out["taskPricing"] = sheet.model_dump()
    return out


def reserve_task_credits(
    *,
    user_id: str,
    credits: int,
    task_id: str = "",
    detail: str = "",
) -> dict[str, Any]:
    """Reserve (= spend hold) credits via wallet; return BillingEvent reserve."""
    from app.services.wallet.db import spend_credits

    n = max(0, int(credits or 0))
    if n > 0:
        spend_credits(
            user_id,
            n,
            detail=detail or f"design_hold:{task_id or 'task'}",
        )
    ev = build_billing_event(
        kind="reserve",
        user_id=user_id,
        task_id=task_id,
        credits_reserved=n,
        credits_delta=-n,
    )
    task = build_task_cost(
        task_id=task_id,
        user_id=user_id,
        credits_reserved=n,
        credits_estimated_high=n,
        status="reserved",
    )
    return {"billingEvent": ev.model_dump(), "taskCost": task.model_dump(), "reserved": n}


def settle_task_credits(
    *,
    user_id: str,
    reserved: int,
    actual: int,
    task_id: str = "",
    detail: str = "",
    pricing_version_ids: list[str] | None = None,
    usage_event_ids: list[str] | None = None,
    mutate_wallet: bool = True,
) -> dict[str, Any]:
    """Charge ``actual`` credits; release unused reserved amount.

    When ``mutate_wallet`` is False, only emit BillingEvent / TaskCost envelopes
    (caller already adjusted the ledger — e.g. ``settle_token_hold``).
    """
    from app.services.wallet.db import grant_credits, spend_credits

    hold = max(0, int(reserved or 0))
    used = max(0, int(actual or 0))
    note = (detail or f"design_settle:{task_id or 'task'}").strip()[:400]
    uid = (user_id or "").strip()
    if mutate_wallet and uid:
        if used < hold:
            try:
                grant_credits(uid, hold - used, detail=f"{note}:release")
            except Exception:
                _log.exception("release unused hold failed")
        elif used > hold:
            try:
                spend_credits(uid, used - hold, detail=f"{note}:extra")
            except ValueError:
                used = hold
    released = max(0, hold - used)
    charged = used
    events = [
        build_billing_event(
            kind="charge",
            user_id=user_id,
            task_id=task_id,
            credits_charged=charged,
            credits_delta=-charged,
            pricing_version_ids=list(pricing_version_ids or []),
            usage_event_ids=list(usage_event_ids or []),
        ).model_dump(),
    ]
    if released:
        events.append(
            build_billing_event(
                kind="release",
                user_id=user_id,
                task_id=task_id,
                credits_released=released,
                credits_delta=released,
                pricing_version_ids=list(pricing_version_ids or []),
            ).model_dump()
        )
    task = build_task_cost(
        task_id=task_id,
        user_id=user_id,
        credits_reserved=hold,
        credits_charged=charged,
        credits_released=released,
        pricing_version_ids=list(pricing_version_ids or []),
        usage_event_ids=list(usage_event_ids or []),
        status="settled",
    )
    return {
        "billingEvents": events,
        "taskCost": task.model_dump(),
        "charged": charged,
        "released": released,
        "settledAt": time.time(),
    }
