"""Document share API — create / public get / update document / manage ACL."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from app.api.deps import CurrentUser, OptionalUser
from pydantic import BaseModel, Field

from app.services.shares import (
    ShareError,
    create_share,
    get_share,
    update_share_document,
    update_share_meta,
)

router = APIRouter(prefix="/shares", tags=["shares"])






def _share_http(err: ShareError) -> HTTPException:
    status = {
        "not_found": 404,
        "forbidden": 403,
        "unauthorized": 401,
        "document_too_large": 413,
        "invalid_document": 400,
        "invalid_permission": 400,
        "invalid_owner": 400,
    }.get(err.code, 400)
    return HTTPException(status_code=status, detail=err.message)


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
        raise _share_http(err) from err
    return {"share": share}


@router.get("/{share_id}")
def shares_get(
    current_user: OptionalUser,
    share_id: str,
) -> dict[str, Any]:
    share = get_share(share_id, actor_user_id=current_user.id if current_user else None)
    if not share:
        raise HTTPException(status_code=404, detail="Not found")
    return {"share": share}


@router.patch("/{share_id}")
def shares_patch(
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
        raise _share_http(err) from err
    return {"share": share}


@router.put("/{share_id}/document")
def shares_update_document(
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
        raise _share_http(err) from err
    return {"share": share}
