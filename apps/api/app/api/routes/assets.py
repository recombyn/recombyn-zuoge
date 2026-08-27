"""User assets API — AI-generated images/videos/audio/lottie."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.api.deps import CurrentUser

from app.services import assets as asset_store
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

router = APIRouter(prefix="/assets", tags=["assets"])


class RegisterAssetIn(BaseModel):
    """Register an already-uploaded media object into the Assets dock."""

    kind: str = Field(..., min_length=1, max_length=16)
    url: str = Field(..., min_length=1, max_length=4000)
    objectKey: str | None = Field(default=None, max_length=512)
    mime: str | None = Field(default=None, max_length=128)
    prompt: str | None = Field(default=None, max_length=500)
    width: int | None = None
    height: int | None = None
    source: str | None = Field(default=None, max_length=32)


@router.get("")
def list_my_assets(
    current_user: CurrentUser,
    page: int = 1,
    pageSize: int = 24,
    kind: str | None = None,
) -> dict[str, Any]:
    return asset_store.list_assets(
        current_user.id,
        kind=kind,
        page=page,
        page_size=pageSize,
    )


@router.post("/register")
def register_my_asset(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: RegisterAssetIn,
) -> dict[str, Any]:
    kind = (body.kind or "").strip().lower()
    if kind not in ("image", "video", "audio", "lottie"):
        raise http_error(400, "invalid_asset_kind", locale)
    source = (body.source or "").strip().lower()
    if not source.startswith("ai_"):
        raise http_error(400, "assets_ai_only", locale)
    try:
        return asset_store.create_asset_from_stored(
            current_user.id,
            kind=kind,
            url=body.url.strip(),
            object_key=(body.objectKey or None),
            mime=body.mime,
            source=source,
            prompt=(body.prompt or None),
            width=body.width,
            height=body.height,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err


@router.delete("/{asset_id}")
def delete_my_asset(
    locale: LocaleDep,
    current_user: CurrentUser,
    asset_id: str,
) -> dict[str, Any]:
    ok = asset_store.delete_asset(current_user.id, asset_id)
    if not ok:
        raise http_error(404, "not_found", locale)
    return {"ok": True}
