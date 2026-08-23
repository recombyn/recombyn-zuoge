"""Builders for Usage / Billing / Credit protocol events."""

from __future__ import annotations

import time
import uuid
from typing import Any

from recombyn_protocol.billing import (
    BillingEventKind,
    BillingEventSchema,
    CostBreakdownSchema,
    CreditTransactionSchema,
    ProviderUsageSchema,
    TaskCostSchema,
    UsageEventSchema,
    UsageStatus,
)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def build_usage_event(
    *,
    task_id: str = "",
    user_id: str = "",
    provider: str = "",
    model_id: str = "",
    api_model: str = "",
    pricing_version_id: str = "",
    usage: ProviderUsageSchema | dict[str, Any] | None = None,
    cost: CostBreakdownSchema | dict[str, Any] | None = None,
    credits: int | None = None,
    source: str = "",
    status: UsageStatus | str = "ok",
    latency_ms: int | None = None,
    provider_request_id: str = "",
    turn_id: str = "",
    error: str = "",
    meta: dict[str, Any] | None = None,
    event_id: str = "",
    timestamp: float | None = None,
) -> UsageEventSchema:
    usage_obj: ProviderUsageSchema
    if isinstance(usage, ProviderUsageSchema):
        usage_obj = usage
    elif isinstance(usage, dict):
        usage_obj = ProviderUsageSchema.model_validate(usage)
    else:
        usage_obj = ProviderUsageSchema()

    cost_obj: CostBreakdownSchema
    if isinstance(cost, CostBreakdownSchema):
        cost_obj = cost
    elif isinstance(cost, dict):
        cost_obj = CostBreakdownSchema.model_validate(cost)
    else:
        cost_obj = CostBreakdownSchema()

    return UsageEventSchema(
        event_id=event_id or _id("usage"),
        task_id=str(task_id or ""),
        user_id=str(user_id or ""),
        turn_id=str(turn_id or ""),
        source=str(source or ""),
        provider=str(provider or ""),
        model_id=str(model_id or ""),
        api_model=str(api_model or ""),
        status=status,
        latency_ms=latency_ms,
        usage=usage_obj,
        cost=cost_obj,
        credits=credits,
        pricing_version_id=str(pricing_version_id or ""),
        provider_request_id=str(provider_request_id or ""),
        timestamp=float(timestamp) if timestamp is not None else time.time(),
        error=str(error or ""),
        meta=dict(meta or {}),
    )


def build_billing_event(
    *,
    kind: BillingEventKind | str = "charge",
    user_id: str = "",
    task_id: str = "",
    credits_delta: int = 0,
    credits_reserved: int | None = None,
    credits_charged: int | None = None,
    credits_released: int | None = None,
    estimate_low: int | None = None,
    estimate_high: int | None = None,
    pricing_version_ids: list[str] | None = None,
    usage_event_ids: list[str] | None = None,
    meta: dict[str, Any] | None = None,
    event_id: str = "",
    timestamp: float | None = None,
) -> BillingEventSchema:
    return BillingEventSchema(
        event_id=event_id or _id("bill"),
        kind=kind,
        user_id=str(user_id or ""),
        task_id=str(task_id or ""),
        credits_delta=int(credits_delta or 0),
        credits_reserved=credits_reserved,
        credits_charged=credits_charged,
        credits_released=credits_released,
        estimate_low=estimate_low,
        estimate_high=estimate_high,
        pricing_version_ids=list(pricing_version_ids or []),
        usage_event_ids=list(usage_event_ids or []),
        timestamp=float(timestamp) if timestamp is not None else time.time(),
        meta=dict(meta or {}),
    )


def build_credit_transaction(
    *,
    user_id: str = "",
    kind: BillingEventKind | str = "charge",
    amount: int = 0,
    balance_after: int | None = None,
    ref_type: str = "",
    ref_id: str = "",
    billing_event_id: str = "",
    meta: dict[str, Any] | None = None,
    transaction_id: str = "",
    timestamp: float | None = None,
) -> CreditTransactionSchema:
    return CreditTransactionSchema(
        transaction_id=transaction_id or _id("ctx"),
        user_id=str(user_id or ""),
        kind=kind,
        amount=int(amount or 0),
        balance_after=balance_after,
        ref_type=str(ref_type or ""),
        ref_id=str(ref_id or ""),
        billing_event_id=str(billing_event_id or ""),
        timestamp=float(timestamp) if timestamp is not None else time.time(),
        meta=dict(meta or {}),
    )


def build_task_cost(
    *,
    task_id: str = "",
    user_id: str = "",
    usage_event_ids: list[str] | None = None,
    estimated_cost_micros: int | None = None,
    actual_cost_micros: int | None = None,
    credits_estimated_low: int | None = None,
    credits_estimated_high: int | None = None,
    credits_reserved: int = 0,
    credits_charged: int = 0,
    credits_refunded: int = 0,
    credits_released: int = 0,
    pricing_version_ids: list[str] | None = None,
    breakdown: CostBreakdownSchema | dict[str, Any] | None = None,
    status: str = "open",
    meta: dict[str, Any] | None = None,
) -> TaskCostSchema:
    cost_obj: CostBreakdownSchema
    if isinstance(breakdown, CostBreakdownSchema):
        cost_obj = breakdown
    elif isinstance(breakdown, dict):
        cost_obj = CostBreakdownSchema.model_validate(breakdown)
    else:
        cost_obj = CostBreakdownSchema()
    return TaskCostSchema(
        task_id=str(task_id or ""),
        user_id=str(user_id or ""),
        usage_event_ids=list(usage_event_ids or []),
        estimated_cost_micros=estimated_cost_micros,
        actual_cost_micros=actual_cost_micros,
        credits_estimated_low=credits_estimated_low,
        credits_estimated_high=credits_estimated_high,
        credits_reserved=int(credits_reserved or 0),
        credits_charged=int(credits_charged or 0),
        credits_refunded=int(credits_refunded or 0),
        credits_released=int(credits_released or 0),
        pricing_version_ids=list(pricing_version_ids or []),
        breakdown=cost_obj,
        status=str(status or "open"),
        meta=dict(meta or {}),
    )
