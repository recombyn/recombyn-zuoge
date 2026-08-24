"""Plaza API — submit to square, public feed, admin review."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar

from fastapi import APIRouter, HTTPException
from app.api.deps import AdminUser, CurrentUser
from pydantic import BaseModel, Field

from app.services.plaza import (
    approve_submission,
    get_submission,
    increment_use_count,
    list_admin,
    list_feed,
    reject_submission,
    submit_to_plaza,
)
from app.services.plaza.store import PlazaError

router = APIRouter(prefix="/plaza", tags=["plaza"])








def _plaza_http(err: PlazaError) -> HTTPException:
    status = {
        "not_found": 404,
        "already_pending": 409,
        "already_published": 409,
        "document_too_large": 413,
        "invalid_project": 400,
        "invalid_document": 400,
        "cover_required": 400,
        "cover_aspect_invalid": 400,
        "artboard_required": 400,
    }.get(err.code, 400)
    return HTTPException(status_code=status, detail=err.message)


_T = TypeVar("_T")


def _plaza_route(handler: Callable[..., _T]) -> Callable[..., _T]:
    @wraps(handler)
    def wrapper(*args: Any, **kwargs: Any) -> _T:
        try:
            return handler(*args, **kwargs)
        except PlazaError as err:
            raise _plaza_http(err) from err

    return wrapper


class SubmitIn(BaseModel):
    projectId: str = Field(..., min_length=1, max_length=128)
    title: str = Field(default="", max_length=120)
    category: str = Field(default="website", max_length=32)
    document: dict[str, Any]
    # Optional project cover URL snapshot (http(s) / site path), or list of up to 4.
    thumbnailUrl: str | list[str] | None = Field(default=None)


class RejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.post("/submit")
@_plaza_route
def plaza_submit(
    current_user: CurrentUser,
    body: SubmitIn,
) -> dict[str, Any]:
    item = submit_to_plaza(
        user_id=current_user.id,
        author_name=current_user.name or current_user.email or "User",
        author_avatar=current_user.avatar,
        project_id=body.projectId,
        title=body.title,
        document=body.document,
        category=body.category,
        thumbnail_url=body.thumbnailUrl,
    )
    return {"item": item}


def _require_public_plaza_item(submission_id: str) -> dict[str, Any]:
    item = get_submission(submission_id, include_document=True)
    if (
        not item
        or item.get("status") != "approved"
        or item.get("isVisible") is False
    ):
        raise HTTPException(status_code=404, detail="Not found")
    return item


@router.get("/feed")
def plaza_feed(
    page: int = 1,
    pageSize: int | None = None,
    limit: int | None = None,
    tab: str = "recommended",
    category: str | None = None,
) -> dict[str, Any]:
    """
    Public plaza feed (no login required).
    tab=recommended|latest
    category=optional category filter (website|mobile|image|poster|video)
    """
    return list_feed(
        limit=limit,
        page=page,
        page_size=pageSize,
        tab=tab,
        category=category,
    )


@router.get("/items/{submission_id}")
def plaza_item(submission_id: str) -> dict[str, Any]:
    return {"item": _require_public_plaza_item(submission_id)}


@router.post("/items/{submission_id}/use")
@_plaza_route
def plaza_item_use(submission_id: str) -> dict[str, Any]:
    """Public (or auth-optional): bump use_count when someone applies a plaza case."""
    use_count = increment_use_count(submission_id)
    return {"ok": True, "useCount": use_count}


@router.get("/admin/list")
def plaza_admin_list(
    current_user: AdminUser,
    status: str | None = None,
) -> dict[str, Any]:
    return {"items": list_admin(status=status)}


@router.post("/admin/{submission_id}/approve")
@_plaza_route
def plaza_admin_approve(
    current_user: AdminUser,
    submission_id: str,
) -> dict[str, Any]:
    item = approve_submission(submission_id, current_user.id)
    return {"item": item}


@router.post("/admin/{submission_id}/reject")
@_plaza_route
def plaza_admin_reject(
    current_user: AdminUser,
    submission_id: str,
    body: RejectIn | None = None,
) -> dict[str, Any]:
    item = reject_submission(
        submission_id,
        current_user.id,
        reason=body.reason if body else None,
    )
    return {"item": item}
