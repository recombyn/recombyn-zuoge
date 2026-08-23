"""Admin routes — catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403
from app.core.config import settings

router = APIRouter()

@router.get("/models/image-limit-presets")
def admin_list_image_limit_presets(
    _admin: AdminUser,
) -> dict[str, Any]:
    from app.services.llm.catalog_store import list_image_limit_presets

    return {"items": list_image_limit_presets()}

@router.post("/models/sync-prices")
def admin_sync_model_prices(
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
        raise HTTPException(status_code=400, detail="Unsupported price sync provider")
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Price sync failed: {e}") from e

@router.get("/models")
def admin_list_models(
    _admin: AdminUser,
    kind: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    return {"items": list_admin_models(kind=kind, q=q)}

@router.put("/models")
def admin_upsert_model(
    _admin: AdminUser,
    body: ModelUpsertIn,
) -> dict[str, Any]:
    try:
        item = upsert_model(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.delete("/models/{model_id}")
def admin_delete_model(
    _admin: AdminUser,
    model_id: str,
) -> dict[str, Any]:
    ok = delete_model(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
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

