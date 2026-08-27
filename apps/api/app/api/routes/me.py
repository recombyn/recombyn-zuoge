"""Me API — liked Plaza items + BYOK provider vault for the current user."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.models import IdsOut, ItemOut, ItemsOut, OkOut
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep
from app.services.me import likes as likes_store
from app.services.security import (
    delete_byok_provider,
    list_byok_providers,
    upsert_byok_provider,
)

router = APIRouter(prefix="/me", tags=["me"])


class SyncLikedIn(BaseModel):
    ids: list[str] = Field(default_factory=list)


class ByokProviderIn(BaseModel):
    id: str | None = None
    name: str = ""
    website: str = ""
    baseUrl: str = ""
    apiModel: str = ""
    modelKind: str = "text"
    apiKey: str | None = None


@router.get("/liked")
def me_liked_list(
    current_user: CurrentUser,
    page: int = 1,
    pageSize: int = 24,
) -> dict[str, Any]:
    return likes_store.list_liked(current_user.id, page=page, page_size=pageSize)


@router.get("/liked/ids", response_model=IdsOut)
def me_liked_ids(current_user: CurrentUser) -> dict[str, Any]:
    return {"ids": likes_store.list_liked_ids(current_user.id)}


@router.put("/liked/{submission_id}")
def me_like(
    locale: LocaleDep,
    current_user: CurrentUser,
    submission_id: str,
) -> dict[str, Any]:
    try:
        return likes_store.like_submission(current_user.id, submission_id)
    except LookupError:
        raise http_error(404, "submission_not_found", locale) from None
    except ValueError as err:
        raise value_error_http(err, locale) from err


@router.delete("/liked/{submission_id}")
def me_unlike(
    current_user: CurrentUser,
    submission_id: str,
) -> dict[str, Any]:
    return likes_store.unlike_submission(current_user.id, submission_id)


@router.post("/liked/sync")
def me_liked_sync(
    current_user: CurrentUser,
    body: SyncLikedIn,
) -> dict[str, Any]:
    """One-shot migrate from client-local like ids."""
    return likes_store.sync_likes(current_user.id, body.ids or [])


@router.get("/byok/providers", response_model=ItemsOut)
def me_byok_list(current_user: CurrentUser) -> dict[str, Any]:
    """List BYOK providers — never returns plaintext apiKey."""
    return {"items": list_byok_providers(current_user.id)}


@router.put("/byok/providers", response_model=ItemOut)
def me_byok_upsert(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: ByokProviderIn,
) -> dict[str, Any]:
    try:
        item = upsert_byok_provider(
            current_user.id,
            provider_id=body.id,
            name=body.name,
            website=body.website,
            base_url=body.baseUrl,
            model_kind=body.modelKind,
            api_key=body.apiKey,
            api_model=body.apiModel,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.delete("/byok/providers/{provider_id}", response_model=OkOut)
def me_byok_delete(
    locale: LocaleDep,
    current_user: CurrentUser,
    provider_id: str,
) -> dict[str, Any]:
    ok = delete_byok_provider(current_user.id, provider_id)
    if not ok:
        raise http_error(404, "provider_not_found", locale)
    return {"ok": True}
