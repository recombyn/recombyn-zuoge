"""Notices API — published announcements / notifications for account inbox."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from app.api.deps import CurrentUser

from app.services.notices import list_notices_public

router = APIRouter(prefix="/notices", tags=["notices"])






@router.get("")
def notices_list(
    current_user: CurrentUser,
    kind: str | None = Query(default=None),
) -> dict[str, Any]:
    items = list_notices_public(kind=kind)
    return {
        "items": [
            {
                "id": it["id"],
                "kind": it["kind"],
                "title": it["title"],
                "body": it["body"],
                "createdAt": it["publishedAt"] or it["createdAt"],
            }
            for it in items
        ]
    }
