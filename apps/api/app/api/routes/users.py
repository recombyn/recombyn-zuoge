"""Public authenticated user directory (invite / collaborator lookup)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from app.api.deps import CurrentUser

from app.services.users_directory import get_users_by_ids, search_users

router = APIRouter(prefix="/users", tags=["users"])






@router.get("/search")
def users_search(
    current_user: CurrentUser,
    q: str = Query(default="", max_length=80),
    limit: int = Query(default=12, ge=1, le=20),
) -> dict[str, Any]:
    return search_users(q=q, limit=limit, exclude_user_id=current_user.id)


@router.get("/lookup")
def users_lookup(
    current_user: CurrentUser,
    ids: str = Query(default="", max_length=800),
) -> dict[str, Any]:
    raw_ids = [p.strip() for p in (ids or "").split(",") if p.strip()]
    return {"items": get_users_by_ids(raw_ids[:40])}
