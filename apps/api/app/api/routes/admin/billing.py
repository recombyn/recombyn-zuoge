"""Admin routes — provider Pricing Versions + open TaskPricing / quote surfaces."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import AdminUser
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

router = APIRouter()


class PricingVersionIn(BaseModel):
    pricingVersionId: str | None = None
    pricingId: str | None = None
    provider: str | None = None
    modelId: str | None = None
    currency: str = "USD"
    rates: list[dict[str, Any]] = Field(default_factory=list)
    status: str | None = "draft"
    effectiveFrom: float | None = None
    effectiveTo: float | None = None
    source: str | None = None
    notes: str | None = None


class RejectIn(BaseModel):
    notes: str = ""


@router.get("/pricing-versions")
def admin_list_pricing_versions(
    _admin: AdminUser,
    status: str | None = Query(default=None),
    pricingId: str | None = Query(default=None),
    modelId: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import list_pricing_versions

    return {
        "items": list_pricing_versions(
            status=status,
            pricing_id=pricingId,
            model_id=modelId,
            provider=provider,
            limit=limit,
        )
    }


@router.get("/pricing-versions/{pricing_version_id}")
def admin_get_pricing_version(
    locale: LocaleDep,
    _admin: AdminUser,
    pricing_version_id: str,
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import get_pricing_version

    item = get_pricing_version(pricing_version_id)
    if not item:
        raise http_error(404, "not_found", locale)
    return {"item": item}


@router.put("/pricing-versions")
def admin_upsert_pricing_version(
    locale: LocaleDep,
    _admin: AdminUser,
    body: PricingVersionIn,
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import upsert_pricing_version

    try:
        item = upsert_pricing_version(body.model_dump(exclude_none=True))
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.post("/pricing-versions/{pricing_version_id}/submit")
def admin_submit_pricing_version(
    locale: LocaleDep,
    _admin: AdminUser,
    pricing_version_id: str,
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import submit_pricing_version

    try:
        item = submit_pricing_version(pricing_version_id)
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.post("/pricing-versions/{pricing_version_id}/approve")
def admin_approve_pricing_version(
    locale: LocaleDep,
    _admin: AdminUser,
    pricing_version_id: str,
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import approve_pricing_version

    try:
        item = approve_pricing_version(pricing_version_id)
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.post("/pricing-versions/{pricing_version_id}/reject")
def admin_reject_pricing_version(
    locale: LocaleDep,
    _admin: AdminUser,
    pricing_version_id: str,
    body: RejectIn | None = None,
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import reject_pricing_version

    try:
        item = reject_pricing_version(
            pricing_version_id, notes=(body.notes if body else "") or ""
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.get("/margin/summary")
def admin_margin_summary(
    _admin: AdminUser,
    fromTs: float | None = Query(default=None),
    toTs: float | None = Query(default=None),
) -> dict[str, Any]:
    from app.services.llm.pricing_registry import margin_summary

    return margin_summary(from_ts=fromTs, to_ts=toTs)


@router.post("/billing/quote")
def admin_billing_quote(
    _admin: AdminUser,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Optional remote credit quote (credits only); else OSS TaskPricing authorize."""
    from app.services.design.intelligence_runtime import quote_remote_task_credits
    from app.services.wallet.lifecycle import estimate_from_task_pricing

    remote = quote_remote_task_credits(body or {})
    if remote:
        return remote
    mode = str((body or {}).get("mode") or "agent")
    byok = bool((body or {}).get("byok"))
    return estimate_from_task_pricing(mode=mode, byok=byok)


@router.get("/task-pricing")
def admin_list_task_pricing(_admin: AdminUser) -> dict[str, Any]:
    from app.services.wallet.billing import default_task_pricing_catalog

    items = [v.model_dump() for v in default_task_pricing_catalog().values()]
    return {"items": items}
