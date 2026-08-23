"""Versioned Pricing Registry — Provider Cost sheets only (not user sell price).

Never overwrite history. Resolve via ``resolve_pricing(...)``.
"""

from __future__ import annotations

from typing import Iterable, Literal

from pydantic import BaseModel, Field

PricingStatus = Literal["draft", "pending_review", "active", "superseded", "rejected"]


class PricingRateSchema(BaseModel):
    """One metered provider rate line (token / image / second / request / …)."""

    metric: str = Field(
        default="",
        description="input_tokens | output_tokens | cached_tokens | image_output | search | …",
    )
    unit: str = Field(
        default="per_1m_tokens",
        description="per_1m_tokens | per_1k_tokens | per_image | per_second | per_request | …",
    )
    amount_micros: int = Field(
        default=0,
        description="Provider price in currency micros per ``unit`` ($1 = 1_000_000)",
    )
    currency: str = "USD"

    model_config = {"extra": "allow"}


# Alias used in architecture docs
PricingRatesSchema = PricingRateSchema


class PricingVersionSchema(BaseModel):
    """Immutable provider price sheet once status=active."""

    pricing_version_id: str = ""
    pricing_id: str = ""
    provider: str = ""
    model_id: str = ""
    currency: str = Field(default="USD", description="Default currency for rates")
    rates: list[PricingRateSchema] = Field(default_factory=list)
    status: PricingStatus | str = "draft"
    effective_from: float | None = Field(
        default=None, description="Unix seconds; inclusive when set"
    )
    effective_to: float | None = Field(
        default=None, description="Unix seconds; exclusive when set"
    )
    source: str = Field(
        default="",
        description="official_sync | manual | import — not a commercial policy",
    )
    notes: str = ""

    model_config = {"extra": "allow"}


class PricingSchema(BaseModel):
    """Logical pricing family (many versions over time).

    Provider Cost chain only::

        ModelCapabilitySchema.pricing_id
            → PricingSchema
            → active_version_id / resolve_pricing(at=…)
            → PricingVersionSchema

    User Credits / margin never live here.
    """

    pricing_id: str = ""
    provider: str = ""
    model_id: str = ""
    label: str = ""
    active_version_id: str = ""
    versions: list[PricingVersionSchema] = Field(default_factory=list)

    model_config = {"extra": "allow"}


def _version_covers(version: PricingVersionSchema, at: float) -> bool:
    start = version.effective_from
    end = version.effective_to
    if start is not None and at < float(start):
        return False
    if end is not None and at >= float(end):
        return False
    return True


def resolve_pricing(
    *,
    catalog: Iterable[PricingSchema | dict] | PricingSchema | None = None,
    versions: Iterable[PricingVersionSchema | dict] | None = None,
    pricing_id: str = "",
    model_id: str = "",
    provider: str = "",
    timestamp: float | None = None,
    prefer_active_id: bool = True,
) -> PricingVersionSchema | None:
    """Resolve the PricingVersion in effect at ``timestamp``.

    Prefer ``pricing_id`` (from Model Registry). Falls back to model_id+provider.
    Does not apply commercial margin — Provider Cost sheet only.
    """
    import time as _time

    at = float(timestamp) if timestamp is not None else _time.time()
    pool: list[PricingVersionSchema] = []

    if versions is not None:
        for raw in versions:
            pool.append(
                raw if isinstance(raw, PricingVersionSchema) else PricingVersionSchema.model_validate(raw)
            )

    families: list[PricingSchema] = []
    if isinstance(catalog, PricingSchema):
        families = [catalog]
    elif catalog is not None:
        for raw in catalog:
            families.append(raw if isinstance(raw, PricingSchema) else PricingSchema.model_validate(raw))

    pid = str(pricing_id or "").strip()
    mid = str(model_id or "").strip()
    prov = str(provider or "").strip().lower()

    matched_family: PricingSchema | None = None
    for fam in families:
        if pid and fam.pricing_id == pid:
            matched_family = fam
            break
    if matched_family is None and (mid or prov):
        for fam in families:
            if mid and fam.model_id and fam.model_id != mid:
                continue
            if prov and fam.provider and fam.provider.strip().lower() != prov:
                continue
            if mid or prov:
                matched_family = fam
                break

    if matched_family is not None:
        for raw in matched_family.versions or []:
            v = raw if isinstance(raw, PricingVersionSchema) else PricingVersionSchema.model_validate(raw)
            pool.append(v)
        if prefer_active_id and matched_family.active_version_id:
            for v in pool:
                if v.pricing_version_id == matched_family.active_version_id and _version_covers(v, at):
                    return v

    # Filter by identity hints then pick latest effective_from covering ``at``
    candidates: list[PricingVersionSchema] = []
    for v in pool:
        if pid and v.pricing_id and v.pricing_id != pid:
            continue
        if mid and v.model_id and v.model_id != mid:
            continue
        if prov and v.provider and v.provider.strip().lower() != prov:
            continue
        if not _version_covers(v, at):
            continue
        if str(v.status or "").strip().lower() not in ("active", "superseded", ""):
            continue
        candidates.append(v)

    if not candidates:
        return None

    def sort_key(v: PricingVersionSchema) -> tuple[float, str]:
        return (float(v.effective_from or 0.0), str(v.pricing_version_id or ""))

    candidates.sort(key=sort_key, reverse=True)
    return candidates[0]
