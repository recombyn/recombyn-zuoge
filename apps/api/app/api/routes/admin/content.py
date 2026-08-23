"""Admin routes — content."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403
from app.core.config import settings

router = APIRouter()

@router.get("/plaza")
def admin_plaza_list(
    _admin: AdminUser,
    status: str | None = None,
) -> dict[str, Any]:
    return {"items": list_admin(status=status)}

@router.post("/plaza/{submission_id}/approve")
def admin_plaza_approve(
    admin: AdminUser,
    submission_id: str,
) -> dict[str, Any]:
    try:
        item = approve_submission(submission_id, admin.id)
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"item": item}

@router.post("/plaza/{submission_id}/reject")
def admin_plaza_reject(
    admin: AdminUser,
    submission_id: str,
    body: RejectIn | None = None,
) -> dict[str, Any]:
    try:
        item = reject_submission(
            submission_id,
            admin.id,
            reason=(body.reason if body else None),
        )
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"item": item}

@router.post("/plaza/{submission_id}/visibility")
def admin_plaza_visibility(
    _admin: AdminUser,
    submission_id: str,
    body: PlazaVisibilityIn,
) -> dict[str, Any]:
    """Toggle whether an approved plaza item shows on C-end."""
    try:
        item = set_submission_visible(submission_id, body.visible)
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"item": item}

@router.post("/plaza/{submission_id}/cover")
def admin_plaza_cover(
    _admin: AdminUser,
    submission_id: str,
    body: PlazaCoverIn,
) -> dict[str, Any]:
    """Upload / replace / clear custom plaza list cover (raster URL)."""
    try:
        item = set_cover_image(submission_id, body.url)
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"item": item}

@router.post("/plaza/{submission_id}/title")
def admin_plaza_title(
    _admin: AdminUser,
    submission_id: str,
    body: PlazaTitleIn,
) -> dict[str, Any]:
    """Rename plaza listing title (snapshot only; does not touch live project)."""
    try:
        item = update_submission_title(submission_id, body.title)
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"item": item}

@router.delete("/plaza/{submission_id}")
def admin_plaza_delete(
    _admin: AdminUser,
    submission_id: str,
) -> dict[str, Any]:
    """Permanently remove a plaza submission (and its likes)."""
    try:
        delete_submission(submission_id)
    except PlazaError as err:
        raise _plaza_http(err) from err
    return {"ok": True}

@router.get("/plaza/feed")
def admin_plaza_feed(
    _admin: AdminUser,
    tab: str = Query("recommended"),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    userId: str | None = None,
) -> dict[str, Any]:
    """Same shape as C-end /plaza/feed — tab=recommended|latest|following."""
    return list_plaza_feed_admin(
        tab=tab,
        page=page,
        page_size=pageSize,
        user_id=userId,
    )

@router.get("/plaza/published")
def admin_plaza_published(
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    q: str | None = None,
) -> dict[str, Any]:
    return list_plaza_published(page=page, page_size=pageSize, q=q)

@router.get("/plaza/{submission_id}")
def admin_plaza_detail(
    _admin: AdminUser,
    submission_id: str,
) -> dict[str, Any]:
    """Full submission including document — for admin canvas preview."""
    item = get_submission(submission_id, include_document=True)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return {"item": item}

@router.get("/likes")
def admin_list_likes(
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    q: str | None = None,
) -> dict[str, Any]:
    return list_all_likes(page=page, page_size=pageSize, q=q)

@router.delete("/likes")
def admin_delete_like(
    _admin: AdminUser,
    userId: str = Query(...),
    submissionId: str = Query(...),
) -> dict[str, Any]:
    ok = delete_like_admin(userId, submissionId)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.get("/projects")
def admin_list_projects(
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    q: str | None = None,
) -> dict[str, Any]:
    return list_all_projects(page=page, page_size=pageSize, q=q)

@router.get("/assets")
def admin_list_assets(
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    kind: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    return list_all_assets(page=page, page_size=pageSize, kind=kind, q=q)

@router.delete("/assets/{asset_id}")
def admin_delete_asset(
    _admin: AdminUser,
    asset_id: str,
) -> dict[str, Any]:
    ok = delete_asset_admin(asset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

