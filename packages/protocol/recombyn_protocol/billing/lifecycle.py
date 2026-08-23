"""Billing lifecycle — estimate → authorize → execute → capture/release."""

from __future__ import annotations

BILLING_LIFECYCLE_STAGES: tuple[str, ...] = (
    "estimate",
    "authorize",
    "execute",
    "settle",
)

BILLING_SETTLE_ACTIONS: tuple[str, ...] = (
    "capture",
    "release",
    "refund",
)

BILLING_LIFECYCLE_DOC = """
ESTIMATE          (TaskPricing + meters → credit band)
   ↓
AUTHORIZE         (hold estimate_high credits)
   ↓
EXECUTE           (Agent Runtime emits UsageEvents / meters)
   ↓
ACTUAL USAGE      (host accounting → credits_to_charge)
   ↓
SETTLE
   ├── CAPTURE    (credits_charged = actual)
   ├── RELEASE    (reserved - charged)
   └── REFUND     (post-settle clawback)
""".strip()
