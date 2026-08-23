"""Money schemas — integer micros as open financial precision.

$1.00 → 1_000_000 micros. Credits stay plain ``int`` (commercial unit).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from pydantic import BaseModel, Field

MICROS_PER_UNIT = 1_000_000


class CurrencySchema(BaseModel):
    """ISO-ish currency descriptor for cost sheets."""

    code: str = Field(default="USD", description="USD | CNY | CREDITS | …")
    micros_per_unit: int = MICROS_PER_UNIT

    model_config = {"extra": "allow"}


class MoneySchema(BaseModel):
    """Currency amount as integer micros (never float ledger truth)."""

    amount_micros: int = 0
    currency: str = "USD"

    model_config = {"extra": "allow"}

    @classmethod
    def from_units(cls, amount: float | int | str | Decimal | None, currency: str = "USD") -> MoneySchema:
        return cls(amount_micros=money_to_micros(amount), currency=currency)


def money_to_micros(amount: float | int | str | Decimal | None) -> int:
    """Convert a currency amount to integer micros (half-up)."""
    if amount is None:
        return 0
    try:
        d = Decimal(str(amount))
    except (InvalidOperation, ValueError):
        return 0
    scaled = (d * MICROS_PER_UNIT).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(scaled)


def micros_to_money(micros: int | None) -> Decimal:
    """Micros → Decimal currency amount."""
    n = int(micros or 0)
    return (Decimal(n) / MICROS_PER_UNIT).quantize(Decimal("0.000001"))


def credits_from_sell_cost_micros(
    sell_cost_micros: int,
    *,
    credit_value_micros: int,
    min_charge_credits: int = 1,
    round_mode: str = "ceil",
) -> int:
    """Map a sell amount (micros) → credits (ceil by default).

    ``sell_cost_micros`` is host-defined. This helper is open so wallets / SDKs
    share one rounding rule with CreditPolicySchema.
    """
    sell = max(0, int(sell_cost_micros or 0))
    value = max(1, int(credit_value_micros or 1))
    if sell <= 0:
        return 0
    mode = str(round_mode or "ceil").strip().lower()
    if mode == "floor":
        n = sell // value
    elif mode == "nearest":
        n = int(Decimal(sell) / Decimal(value) + Decimal("0.5"))
    else:
        n = (sell + value - 1) // value
    return max(int(min_charge_credits or 0), n) if n > 0 else 0
