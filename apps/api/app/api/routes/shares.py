"""Document share API — create / public get / update document / manage ACL."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from app.api.deps import CurrentUser, OptionalUser
from pydantic import BaseModel, Field

from app.services.i18n.errors import http_error, service_error_http
from app.services.i18n.locale import LocaleDep
from app.services.shares import (
    ShareError,
    create_share,
    get_share,
    update_share_document,
    update_share_meta,
)

router = APIRouter(prefix="/shares", tags=["shares"])

_SHARE_STATUS: dict[str, tuple[int, str]] = {
    "not_found": (404, "share_not_found"),
    "forbidden": (403, "forbidden"),
    "unauthorized": (401, "unauthorized"),
    "document_too_large": (413, "upload_too_large"),
    "invalid_document": (400, "invalid_document"),
    "invalid_permission": (400, "invalid_share_permission"),
    "invalid_owner": (400, "invalid_share_owner"),
}


def _share_http(err: ShareError, locale: str | None = None):
    status, code = _SHARE_STATUS.get(err.code, (400, "request_failed"))
    return service_error_http(code, locale, status=status, message=err.message)


class CreateShareIn(BaseModel):
    name: str = Field(default="Untitled", max_length=255)
    permission: str = Field(default="preview", max_length=16)
    document: dict[str, Any] | None = None
    sourceProjectId: str | None = Field(default=None, max_length=64)
    editorUserIds: list[str] = Field(default_factory=list)
    viewerUserIds: list[str] = Field(default_factory=list)
    linkPublic: bool | None = None


class UpdateShareMetaIn(BaseModel):
    permission: str | None = Field(default=None, max_length=16)
    editorUserIds: list[str] | None = None
    viewerUserIds: list[str] | None = None
    name: str | None = Field(default=None, max_length=255)
    linkEnabled: bool | None = None
    linkPublic: bool | None = None


class UpdateShareDocumentIn(BaseModel):
    document: dict[str, Any]


@router.put("")
def shares_create(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: CreateShareIn,
) -> dict[str, Any]:
    try:
        share = create_share(
            owner_id=current_user.id,
            name=body.name,
            permission=body.permission,
            document=body.document,
            source_project_id=body.sourceProjectId,
            editor_user_ids=body.editorUserIds,
            viewer_user_ids=body.viewerUserIds,
            link_public=body.linkPublic,
        )
    except ShareError as err:
        raise _share_http(err, locale) from err
    return {"share": share}


@router.get("/{share_id}")
def shares_get(
    locale: LocaleDep,
    current_user: OptionalUser,
    share_id: str,
) -> dict[str, Any]:
    share = get_share(share_id, actor_user_id=current_user.id if current_user else None)
    if not share:
        raise http_error(404, "share_not_found", locale)
    return {"share": share}


@router.patch("/{share_id}")
def shares_patch(
    locale: LocaleDep,
    current_user: CurrentUser,
    share_id: str,
    body: UpdateShareMetaIn,
) -> dict[str, Any]:
    try:
        share = update_share_meta(
            share_id,
            actor_user_id=current_user.id,
            permission=body.permission,
            editor_user_ids=body.editorUserIds,
            viewer_user_ids=body.viewerUserIds,
            name=body.name,
            link_enabled=body.linkEnabled,
            link_public=body.linkPublic,
        )
    except ShareError as err:
        raise _share_http(err, locale) from err
    return {"share": share}


@router.put("/{share_id}/document")
def shares_update_document(
    locale: LocaleDep,
    current_user: OptionalUser,
    share_id: str,
    body: UpdateShareDocumentIn,
) -> dict[str, Any]:
    try:
        share = update_share_document(
            share_id,
            body.document,
            actor_user_id=current_user.id if current_user else None,
        )
    except ShareError as err:
        raise _share_http(err, locale) from err
    return {"share": share}
