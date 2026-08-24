"""Me — liked Plaza submissions (server-side)."""

from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema
from app.services.plaza.store import sync_like_count


def list_liked_ids(user_id: str) -> list[str]:
    init_schema()
    with Session(engine) as session:
        return crud.list_plaza_liked_ids(session=session, user_id=user_id)


def _set_like(user_id: str, submission_id: str, *, liked: bool) -> dict[str, Any]:
    init_schema()
    sid = (submission_id or "").strip()
    if liked and not sid:
        raise ValueError("submission_id required")

    with Session(engine) as session:
        if liked:
            row = crud.get_visible_approved_submission(session=session, submission_id=sid)
            if not row:
                raise LookupError("not_found")
            crud.upsert_plaza_like(
                session=session,
                user_id=user_id,
                submission_id=sid,
                created_at=time.time(),
            )
        elif sid:
            crud.delete_plaza_like(session=session, user_id=user_id, submission_id=sid)

        like_count = sync_like_count(sid, session=session) if sid else 0
        session.commit()

    return {"ok": True, "liked": liked, "id": sid, "likeCount": like_count}


def like_submission(user_id: str, submission_id: str) -> dict[str, Any]:
    return _set_like(user_id, submission_id, liked=True)


def unlike_submission(user_id: str, submission_id: str) -> dict[str, Any]:
    return _set_like(user_id, submission_id, liked=False)
