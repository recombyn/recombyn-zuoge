"""Me — liked Plaza submissions (server-side)."""

from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema
from app.services.plaza.store import _parse_cover, _row_to_meta, sync_like_count


def list_liked(
    user_id: str,
    *,
    page: int = 1,
    page_size: int = 24,
) -> dict[str, Any]:
    init_schema()
    page_n = max(1, int(page or 1))
    size = max(1, min(int(page_size or 24), 50))
    offset = (page_n - 1) * size
    with Session(engine) as session:
        rows, total = crud.list_plaza_liked_page(
            session=session, user_id=user_id, offset=offset, limit=size
        )

    items = []
    for sub, liked_raw in rows:
        dumped = sub.model_dump()
        meta = _row_to_meta(dumped)
        try:
            liked_f = float(liked_raw) if liked_raw is not None else 0.0
            # created_at is unix seconds; tolerate accidental ms values.
            meta["likedAt"] = int(liked_f if liked_f > 1e12 else liked_f * 1000) or int(
                time.time() * 1000
            )
        except (TypeError, ValueError):
            meta["likedAt"] = int(time.time() * 1000)
        if meta.get("coverDocument") is None:
            meta["coverDocument"] = _parse_cover(dumped)
        items.append(meta)

    return {
        "items": items,
        "page": page_n,
        "pageSize": size,
        "total": total,
        "hasMore": offset + len(items) < total,
    }


def list_liked_ids(user_id: str) -> list[str]:
    init_schema()
    with Session(engine) as session:
        return crud.list_plaza_liked_ids(session=session, user_id=user_id)


def like_submission(user_id: str, submission_id: str) -> dict[str, Any]:
    init_schema()
    sid = (submission_id or "").strip()
    if not sid:
        raise ValueError("submission_id required")
    now = time.time()
    with Session(engine) as session:
        row = crud.get_visible_approved_submission(session=session, submission_id=sid)
        if not row:
            raise LookupError("not_found")
        crud.upsert_plaza_like(
            session=session, user_id=user_id, submission_id=sid, created_at=now
        )
        like_count = sync_like_count(sid, session=session)
        session.commit()
    return {"ok": True, "liked": True, "id": sid, "likeCount": like_count}


def unlike_submission(user_id: str, submission_id: str) -> dict[str, Any]:
    init_schema()
    sid = (submission_id or "").strip()
    with Session(engine) as session:
        if sid:
            crud.delete_plaza_like(
                session=session, user_id=user_id, submission_id=sid
            )
            like_count = sync_like_count(sid, session=session)
        else:
            like_count = 0
        session.commit()
    return {"ok": True, "liked": False, "id": sid, "likeCount": like_count}


def sync_likes(user_id: str, submission_ids: list[str]) -> dict[str, Any]:
    """Upsert a batch of likes (migrate from client localStorage)."""
    init_schema()
    ids = [str(x).strip() for x in submission_ids if str(x).strip()][:200]
    now = time.time()
    with Session(engine) as session:
        for sid in ids:
            exists = crud.get_visible_approved_submission(
                session=session, submission_id=sid
            )
            if not exists:
                continue
            crud.upsert_plaza_like(
                session=session, user_id=user_id, submission_id=sid, created_at=now
            )
            sync_like_count(sid, session=session)
        session.commit()
    return {"ok": True, "ids": list_liked_ids(user_id)}
