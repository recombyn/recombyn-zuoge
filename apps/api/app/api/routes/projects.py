"""User projects API — metadata in DB, large docs in COS when enabled."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.models import BatchDeleteOut, OkOut, ProjectListOut, ProjectOneOut
from app.services import projects as project_store
from app.services.i18n.errors import api_error_detail, http_error
from app.services.i18n.locale import LocaleDep
from app.services.projects import (
    ProjectConflictError,
    ProjectForbiddenError,
    ProjectNotFoundError,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _parse_if_match(if_match: str | None) -> int | None:
    """Parse If-Match into a revision int. ``*`` / empty → no lock."""
    if not if_match:
        return None
    s = str(if_match).strip()
    if not s or s == "*":
        return None
    if s.upper().startswith("W/"):
        s = s[2:].strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1]
    try:
        return int(s)
    except ValueError:
        return None


def _conflict_http(exc: ProjectConflictError, locale: str | None = None) -> HTTPException:
    detail = api_error_detail("project_revision_conflict", locale)
    detail.update(
        {
            "id": exc.project_id,
            "revision": exc.revision,
            "updatedAt": exc.updated_at_ms,
        }
    )
    return HTTPException(status_code=412, detail=detail)


def _forbidden_http(exc: ProjectForbiddenError, locale: str | None = None) -> HTTPException:
    detail = api_error_detail("forbidden", locale)
    detail["code"] = str(exc.code or detail["code"])
    detail["id"] = exc.project_id
    return HTTPException(status_code=403, detail=detail)


class UpsertProjectIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(default="Untitled", max_length=255)
    document: dict[str, Any] | None = None
    thumbnailUrls: list[str] | None = None
    """True when the client is uploading a user-chosen cover (protect from auto thumbs)."""
    thumbnailCustom: bool | None = None
    """Client's last known revision — must match server or 412."""
    baseRevision: int | None = None
    """Optional team org — requires org:project:write on create."""
    orgId: str | None = Field(default=None, max_length=64)


class PatchProjectIn(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    baseRevision: int | None = None
    thumbnailUrls: list[str] | None = None
    thumbnailCustom: bool | None = None
    upsertNodes: dict[str, Any] | None = None
    removeNodeIds: list[str] | None = None
    pageChildren: list[str] | None = None
    frames: list[Any] | None = None
    activeFrameId: str | None = None
    canvas: dict[str, Any] | None = None


class BatchDeleteIn(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=100)


@router.get("", response_model=ProjectListOut)
def list_my_projects(
    current_user: CurrentUser,
    page: int = 1,
    pageSize: int = 24,
    orgId: str | None = None,
) -> dict[str, Any]:
    return project_store.list_projects(
        current_user.id, page=page, page_size=pageSize, org_id=orgId
    )


@router.post("/batch-delete", response_model=BatchDeleteOut)
def batch_remove(
    current_user: CurrentUser,
    body: BatchDeleteIn,
) -> dict[str, Any]:
    deleted = project_store.delete_projects(current_user.id, body.ids)
    return {"ok": True, "deleted": deleted}


@router.get("/{project_id}", response_model=ProjectOneOut)
def get_one(
    locale: LocaleDep,
    current_user: CurrentUser,
    project_id: str,
) -> dict[str, Any]:
    row = project_store.get_project(current_user.id, project_id)
    if not row:
        raise http_error(404, "not_found", locale)
    return {"project": row}


@router.put("", response_model=ProjectOneOut)
def upsert(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: UpsertProjectIn,
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict[str, Any]:
    base_rev = body.baseRevision
    if base_rev is None:
        base_rev = _parse_if_match(if_match)
    try:
        row = project_store.upsert_project(
            current_user.id,
            project_id=body.id,
            name=body.name,
            document=body.document,
            thumbnail_urls=body.thumbnailUrls,
            thumbnail_custom=body.thumbnailCustom,
            base_revision=base_rev,
            org_id=body.orgId,
        )
    except ProjectConflictError as exc:
        raise _conflict_http(exc, locale) from exc
    except ProjectForbiddenError as exc:
        raise _forbidden_http(exc, locale) from exc
    return {"project": row}


@router.patch("/{project_id}", response_model=ProjectOneOut)
def patch_one(
    locale: LocaleDep,
    current_user: CurrentUser,
    project_id: str,
    body: PatchProjectIn,
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict[str, Any]:
    base_rev = body.baseRevision
    if base_rev is None:
        base_rev = _parse_if_match(if_match)
    patch: dict[str, Any] = {}
    if body.upsertNodes is not None:
        patch["upsertNodes"] = body.upsertNodes
    if body.removeNodeIds is not None:
        patch["removeNodeIds"] = body.removeNodeIds
    if body.pageChildren is not None:
        patch["pageChildren"] = body.pageChildren
    if body.frames is not None:
        patch["frames"] = body.frames
    # Distinguish omitted vs explicit null for activeFrameId.
    if "activeFrameId" in body.model_fields_set:
        patch["activeFrameId"] = body.activeFrameId
    if body.canvas is not None:
        patch["canvas"] = body.canvas
    # Allow thumbnail-only / rename-only patches (no node delta).
    has_thumb = bool(body.thumbnailUrls or body.thumbnailCustom is not None)
    has_name = body.name is not None
    if not patch and not has_thumb and not has_name:
        raise http_error(400, "empty_patch", locale)
    if not patch:
        patch = {}
    try:
        row = project_store.patch_project(
            current_user.id,
            project_id,
            name=body.name,
            patch=patch,
            thumbnail_urls=body.thumbnailUrls,
            thumbnail_custom=body.thumbnailCustom,
            base_revision=base_rev,
        )
    except ProjectNotFoundError as exc:
        raise http_error(404, "not_found", locale) from exc
    except ProjectForbiddenError as exc:
        raise _forbidden_http(exc, locale) from exc
    except ProjectConflictError as exc:
        raise _conflict_http(exc, locale) from exc
    return {"project": row}


class SetProjectOrgIn(BaseModel):
    """Attach project to an org, or null to detach (owner only)."""

    orgId: str | None = Field(default=None, max_length=64)


@router.patch("/{project_id}/org", response_model=ProjectOneOut)
def set_project_org(
    locale: LocaleDep,
    current_user: CurrentUser,
    project_id: str,
    body: SetProjectOrgIn,
) -> dict[str, Any]:
    try:
        row = project_store.set_project_org(
            current_user.id,
            project_id,
            org_id=body.orgId,
        )
    except ProjectNotFoundError as exc:
        raise http_error(404, "not_found", locale) from exc
    except ProjectForbiddenError as exc:
        raise _forbidden_http(exc, locale) from exc
    return {"project": row}


@router.delete("/{project_id}", response_model=OkOut)
def remove(
    locale: LocaleDep,
    current_user: CurrentUser,
    project_id: str,
) -> dict[str, Any]:
    ok = project_store.delete_project(current_user.id, project_id)
    if not ok:
        raise http_error(404, "not_found", locale)
    return {"ok": True}
