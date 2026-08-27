"""Org membership HTTP API (create / list / pending invites)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, SessionUser, require_org_permission
from app.services.auth import orgs as org_store
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

router = APIRouter(prefix="/orgs", tags=["orgs"])


class CreateOrgIn(BaseModel):
    name: str = Field(default="Untitled org", max_length=120)


class RenameOrgIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class InviteMemberIn(BaseModel):
    userId: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=320)
    role: str = Field(default="member", max_length=16)


@router.post("")
def create_org(current_user: CurrentUser, body: CreateOrgIn) -> dict[str, Any]:
    row = org_store.create_org(name=body.name, owner_user_id=current_user.id)
    return {"org": row}


@router.get("/mine")
def list_my_orgs(current_user: CurrentUser) -> dict[str, Any]:
    return {"orgs": org_store.list_orgs_for_user(user_id=current_user.id)}


@router.get("/invites/mine")
def list_my_pending_invites(current_user: CurrentUser) -> dict[str, Any]:
    return {
        "invites": org_store.list_pending_invites_for_user(
            user_id=current_user.id,
            email=getattr(current_user, "email", None),
        )
    }


@router.post("/invites/{invite_id}/accept")
def accept_invite(locale: LocaleDep, current_user: CurrentUser, invite_id: str) -> dict[str, Any]:
    try:
        row = org_store.accept_org_invite(
            invite_id=invite_id,
            user_id=current_user.id,
            email=getattr(current_user, "email", None),
        )
    except LookupError:
        raise http_error(404, "invite_not_found", locale) from None
    except PermissionError:
        raise http_error(403, "invite_not_for_user", locale) from None
    except ValueError as exc:
        raise value_error_http(exc, locale) from exc
    return row


@router.post("/invites/{invite_id}/decline")
def decline_invite(locale: LocaleDep, current_user: CurrentUser, invite_id: str) -> dict[str, Any]:
    try:
        row = org_store.decline_org_invite(
            invite_id=invite_id,
            user_id=current_user.id,
            email=getattr(current_user, "email", None),
        )
    except LookupError:
        raise http_error(404, "invite_not_found", locale) from None
    except PermissionError:
        raise http_error(403, "invite_not_for_user", locale) from None
    except ValueError as exc:
        raise value_error_http(exc, locale) from exc
    return row


@router.get("/{org_id}")
def get_org(
    locale: LocaleDep,
    org_id: str,
    current_user: SessionUser = Depends(require_org_permission("org:project:read")),
) -> dict[str, Any]:
    _ = current_user
    row = org_store.get_org(org_id=org_id)
    if not row:
        raise http_error(404, "org_not_found", locale)
    return {"org": row}


@router.patch("/{org_id}")
def rename_org(
    locale: LocaleDep,
    org_id: str,
    body: RenameOrgIn,
    current_user: SessionUser = Depends(require_org_permission("org:settings:write")),
) -> dict[str, Any]:
    _ = current_user
    try:
        row = org_store.rename_org(org_id=org_id, name=body.name)
    except LookupError:
        raise http_error(404, "org_not_found", locale) from None
    except ValueError as exc:
        raise value_error_http(exc, locale) from exc
    return {"org": row}


@router.get("/{org_id}/members")
def list_members(
    org_id: str,
    current_user: SessionUser = Depends(require_org_permission("org:project:read")),
) -> dict[str, Any]:
    _ = current_user
    return {"members": org_store.list_org_members(org_id=org_id)}


@router.delete("/{org_id}/members/{user_id}")
def remove_member(
    locale: LocaleDep,
    org_id: str,
    user_id: str,
    current_user: SessionUser = Depends(require_org_permission("org:members:write")),
) -> dict[str, Any]:
    try:
        return org_store.remove_org_member(
            org_id=org_id,
            user_id=user_id,
            actor_user_id=current_user.id,
        )
    except LookupError:
        raise http_error(404, "member_not_found", locale) from None
    except ValueError as exc:
        raise value_error_http(exc, locale) from exc


@router.get("/{org_id}/invites")
def list_org_pending_invites(
    org_id: str,
    current_user: SessionUser = Depends(require_org_permission("org:members:write")),
) -> dict[str, Any]:
    _ = current_user
    return {"invites": org_store.list_org_invites(org_id=org_id, status="pending")}


@router.post("/{org_id}/members")
def invite_member(
    locale: LocaleDep,
    org_id: str,
    body: InviteMemberIn,
    current_user: SessionUser = Depends(require_org_permission("org:members:write")),
) -> dict[str, Any]:
    """Create a pending invite (membership starts after accept)."""
    try:
        row = org_store.create_org_invite(
            org_id=org_id,
            actor_user_id=current_user.id,
            user_id=body.userId,
            email=body.email,
            role=body.role,
        )
    except LookupError as exc:
        code = str(exc) or "org_not_found"
        mapped = code if code in ("org_not_found", "member_not_found", "invite_not_found") else "org_not_found"
        raise http_error(404, mapped, locale) from None
    except ValueError as exc:
        raise value_error_http(exc, locale) from exc
    return {"invite": row}
