"""Admin routes — catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

router = APIRouter()


@router.get("/models/image-limit-presets")
def admin_list_image_limit_presets(
    _admin: AdminUser,
) -> dict[str, Any]:
    from app.services.llm.catalog_store import list_image_limit_presets

    return {"items": list_image_limit_presets()}


@router.post("/models/sync-prices")
def admin_sync_model_prices(
    locale: LocaleDep,
    _admin: AdminUser,
    body: SyncPricesIn,
) -> dict[str, Any]:
    """Pull list prices: OpenRouter live API, or curated Ark docs snapshot."""
    try:
        if body.provider == "openrouter":
            from app.services.llm.price_sync import sync_openrouter_catalog_prices

            return sync_openrouter_catalog_prices(only_empty=bool(body.onlyEmpty))
        if body.provider == "ark":
            from app.services.llm.price_sync import sync_ark_catalog_prices

            return sync_ark_catalog_prices()
        raise http_error(400, "unsupported_price_sync_provider", locale)
    except HTTPException:
        raise
    except RuntimeError as err:
        raise value_error_http(err, locale) from err
    except Exception as err:
        raise http_error(502, "price_sync_failed", locale, reason=str(err)) from err


@router.get("/models")
def admin_list_models(
    _admin: AdminUser,
    kind: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    return {"items": list_admin_models(kind=kind, q=q)}


@router.put("/models")
def admin_upsert_model(
    locale: LocaleDep,
    _admin: AdminUser,
    body: ModelUpsertIn,
) -> dict[str, Any]:
    try:
        item = upsert_model(body.model_dump())
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.delete("/models/{model_id}")
def admin_delete_model(
    locale: LocaleDep,
    _admin: AdminUser,
    model_id: str,
) -> dict[str, Any]:
    ok = delete_model(model_id)
    if not ok:
        raise http_error(404, "not_found", locale)
    return {"ok": True}


@router.get("/model-usage/summary")
def admin_model_usage_summary(
    _admin: AdminUser,
    fromTs: float | None = Query(default=None),
    toTs: float | None = Query(default=None),
) -> dict[str, Any]:
    from app.services.llm.usage_log import summarize_model_usage

    return summarize_model_usage(ts_from=fromTs, ts_to=toTs)


@router.get("/model-usage")
def admin_model_usage_list(
    _admin: AdminUser,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=50, ge=1, le=200),
    source: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    model: str | None = Query(default=None),
    userId: str | None = Query(default=None),
    status: str | None = Query(default=None),
    via: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    fromTs: float | None = Query(default=None),
    toTs: float | None = Query(default=None),
) -> dict[str, Any]:
    from app.services.llm.usage_log import list_model_usage

    return list_model_usage(
        page=page,
        page_size=pageSize,
        source=source,
        provider=provider,
        model=model,
        user_id=userId,
        status=status,
        via=via,
        kind=kind,
        ts_from=fromTs,
        ts_to=toTs,
    )
