"""Collab room-token minting — ACL check then HMAC token for apps/collab."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from app.api.deps import CurrentUser
from pydantic import BaseModel, Field

from app.services import projects as project_store
from app.services.collab_tokens import mint_room_token
from app.services.i18n.errors import http_error
from app.services.i18n.locale import LocaleDep
from app.services.shares import get_share

router = APIRouter(prefix="/collab", tags=["collab"])


class RoomTokenIn(BaseModel):
    projectId: str | None = Field(default=None, max_length=64)
    shareId: str | None = Field(default=None, max_length=64)


@router.post("/room-token")
def collab_room_token(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: RoomTokenIn,
) -> dict[str, Any]:
    project_id = (body.projectId or "").strip()
    share_id = (body.shareId or "").strip()

    if bool(project_id) == bool(share_id):
        raise http_error(400, "collab_project_or_share_required", locale)

    if project_id:
        row = project_store.get_project(current_user.id, project_id)
        if not row:
            raise http_error(404, "project_not_found", locale)
        return mint_room_token(
            room_id=project_id,
            user_id=current_user.id,
            role="edit",
            name=current_user.name or current_user.email or "",
        )

    share = get_share(share_id, actor_user_id=current_user.id)
    if not share:
        raise http_error(404, "share_not_found", locale)
    if not share.get("viewerCanView"):
        raise http_error(403, "forbidden", locale)

    role = "edit" if share.get("viewerCanEdit") else "view"
    source_project_id = str(share.get("sourceProjectId") or "").strip()
    room_id = source_project_id or share_id
    return mint_room_token(
        room_id=room_id,
        user_id=current_user.id,
        role=role,
        name=current_user.name or current_user.email or "",
    )
