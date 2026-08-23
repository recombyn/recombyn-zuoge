"""Authenticated user directory search (invite collaborators — limited fields)."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema


def _row_public(row: Any) -> dict[str, Any]:
    custom = str(getattr(row, "avatar", None) or "").strip()
    default = str(getattr(row, "default_avatar", None) or "").strip()
    return {
        "id": row.id,
        "name": row.name or "User",
        "email": row.email or "",
        # Prefer user upload; fall back to OAuth/default.
        "avatar": custom or default or None,
    }


def search_users(*, q: str, limit: int = 12, exclude_user_id: str | None = None) -> dict[str, Any]:
    init_schema()
    query = (q or "").strip()
    if len(query) < 1:
        return {"items": []}
    lim = max(1, min(int(limit or 12), 20))
    with Session(engine) as session:
        rows = crud.search_users_directory(
            session=session,
            query=query,
            limit=lim,
            exclude_user_id=(exclude_user_id or "").strip() or None,
        )
    return {"items": [_row_public(r) for r in rows]}


def get_users_by_ids(user_ids: list[str]) -> list[dict[str, Any]]:
    init_schema()
    ids = []
    seen: set[str] = set()
    for raw in user_ids or []:
        uid = str(raw or "").strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        ids.append(uid)
    if not ids:
        return []
    with Session(engine) as session:
        rows = crud.list_users_by_ids(session=session, user_ids=ids)
    by_id = {str(r.id): _row_public(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]
