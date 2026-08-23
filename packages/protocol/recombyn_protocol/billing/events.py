"""Wallet lifecycle events + credit ledger (audit trail, not a single balance field)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

BillingEventKind = Literal[
    "estimate",
    "authorize",
    "reserve",
    "capture",
    "charge",
    "release",
    "refund",
    "topup",
    "adjust",
    "settle",
]


class BillingEventSchema(BaseModel):
    """Wallet lifecycle around a task or pack.

    Typical settle (Stripe-shaped)::

        authorize 100 → actual 70 → capture 70 + release 30
    """

    event_id: str = ""
    kind: BillingEventKind | str = "capture"
    user_id: str = ""
    task_id: str = ""
    credits_delta: int = 0
    credits_reserved: int | None = None
    credits_charged: int | None = None
    credits_released: int | None = None
    estimate_low: int | None = None
    estimate_high: int | None = None
    currency: str = "CREDITS"
    pricing_version_ids: list[str] = Field(default_factory=list)
    usage_event_ids: list[str] = Field(default_factory=list)
    task_pricing_id: str = ""
    task_cost_id: str = ""
    timestamp: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class CreditTransactionSchema(BaseModel):
    """Immutable ledger line — balance is derived from the ledger, not overwritten."""

    transaction_id: str = ""
    user_id: str = ""
    kind: BillingEventKind | str = "charge"
    amount: int = 0
    balance_after: int | None = None
    ref_type: str = Field(default="", description="task | pack | admin | card_key | …")
    ref_id: str = ""
    billing_event_id: str = ""
    timestamp: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class CreditLedgerSchema(BaseModel):
    """Ordered credit transactions for a user / window."""

    user_id: str = ""
    currency: str = "CREDITS"
    opening_balance: int | None = None
    closing_balance: int | None = None
    transactions: list[CreditTransactionSchema] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
