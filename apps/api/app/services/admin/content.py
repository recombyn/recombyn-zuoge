"""Admin content listings — projects, assets, likes, plaza feeds."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema
from app.services.plaza.store import list_feed, _row_to_meta
from app.services.storage import delete_object


def _page_args(page: int = 1, page_size: int = 20, *, max_size: int = 100) -> tuple[int, int, int]:
    page_n = max(1, int(page or 1))
    page_size_n = max(1, min(int(page_size or 20), max_size))
    offset = (page_n - 1) * page_size_n
    return page_n, page_size_n, offset


def _ms(ts: Any) -> int:
    return int(float(ts) * 1000)


def _paged(items: list[Any], *, page_n: int, page_size_n: int, total: int) -> dict[str, Any]:
    return {"items": items, "page": page_n, "pageSize": page_size_n, "total": total}


def _empty_feed(page: int, page_size: int, tab_n: str) -> dict[str, Any]:
    page_n, page_size_n, _ = _page_args(page, page_size)
    return {
        "items": [],
        "page": page_n,
        "pageSize": page_size_n,
        "total": 0,
        "hasMore": False,
        "tab": tab_n,
    }


def list_all_projects(
    *,
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
) -> dict[str, Any]:
    init_schema()
    page_n, page_size_n, offset = _page_args(page, page_size)
    with Session(engine) as session:
        rows, total = crud.list_admin_projects(
            session=session, q=q, offset=offset, limit=page_size_n
        )
    items = [
        {
            "id": proj.id,
            "userId": proj.user_id,
            "userEmail": email,
            "userName": name,
            "name": proj.name,
            "updatedAt": _ms(proj.updated_at),
            "createdAt": _ms(proj.created_at),
        }
        for proj, email, name in rows
    ]
    return _paged(items, page_n=page_n, page_size_n=page_size_n, total=total)


def list_all_assets(
    *,
    page: int = 1,
    page_size: int = 20,
    kind: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    init_schema()
    page_n, page_size_n, offset = _page_args(page, page_size)
    with Session(engine) as session:
        rows, total = crud.list_admin_assets(
            session=session, kind=kind, q=q, offset=offset, limit=page_size_n
        )
    items = [
        {
            "id": asset.id,
            "userId": asset.user_id,
            "userEmail": email,
            "userName": name,
            "kind": asset.kind,
            "url": asset.url,
            "source": asset.source,
            "prompt": asset.prompt,
            "createdAt": _ms(asset.created_at),
        }
        for asset, email, name in rows
    ]
    return _paged(items, page_n=page_n, page_size_n=page_size_n, total=total)


def delete_asset_admin(asset_id: str) -> bool:
    init_schema()
    aid = (asset_id or "").strip()
    if not aid:
        return False
    with Session(engine) as session:
        row = crud.delete_asset(session=session, asset_id=aid)
    if not row:
        return False
    if row.object_key:
        delete_object(row.object_key)
    return True


def list_all_likes(
    *,
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
) -> dict[str, Any]:
    init_schema()
    page_n, page_size_n, offset = _page_args(page, page_size)
    with Session(engine) as session:
        rows, total = crud.list_admin_likes(
            session=session, q=q, offset=offset, limit=page_size_n
        )
    items = [
        {
            "userId": like.user_id,
            "userEmail": user.email if user else None,
            "userName": user.name if user else None,
            "submissionId": like.submission_id,
            "submissionTitle": sub.title if sub else None,
            "authorName": sub.author_name if sub else None,
            "submissionStatus": sub.status if sub else None,
            "createdAt": _ms(like.created_at),
        }
        for like, sub, user in rows
    ]
    return _paged(items, page_n=page_n, page_size_n=page_size_n, total=total)


def delete_like_admin(user_id: str, submission_id: str) -> bool:
    from app.services.plaza.store import sync_like_count

    init_schema()
    uid = (user_id or "").strip()
    sid = (submission_id or "").strip()
    if not uid or not sid:
        return False
    with Session(engine) as session:
        deleted = crud.delete_plaza_like(
            session=session, user_id=uid, submission_id=sid
        )
        if deleted:
            sync_like_count(sid, session=session)
        session.commit()
    return deleted


def _normalize_admin_feed_tab(tab: str | None) -> str:
    tab_n = (tab or "recommended").strip().lower()
    return tab_n if tab_n in ("recommended", "latest", "following") else "recommended"


def list_plaza_feed_admin(
    *,
    tab: str = "recommended",
    page: int = 1,
    page_size: int = 20,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Approved plaza feed: recommended | latest."""
    tab_n = _normalize_admin_feed_tab(tab)
    if tab_n == "following":
        return _empty_feed(page, page_size, tab_n)
    uid = (user_id or "").strip()
    return list_feed(
        page=page,
        page_size=page_size,
        tab=tab_n,
        author_ids=[uid] if uid else None,
        visible_only=False,
    )


def list_plaza_published(
    *,
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
) -> dict[str, Any]:
    """All approved plaza submissions (已发布)."""
    init_schema()
    page_n, page_size_n, offset = _page_args(page, page_size)
    with Session(engine) as session:
        rows, total = crud.list_admin_plaza_published(
            session=session, q=q, offset=offset, limit=page_size_n
        )
    return _paged(
        [_row_to_meta(r.model_dump()) for r in rows],
        page_n=page_n,
        page_size_n=page_size_n,
        total=total,
    )
