"""Product notices — announcements & notifications for account inbox."""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema

VALID_KINDS = frozenset({"announcement", "notification"})
VALID_STATUSES = frozenset({"draft", "published"})

_SEED = (
    {
        "id": "ann-welcome-v1",
        "kind": "announcement",
        "title": "欢迎使用 recombyn",
        "body": "用对话驱动设计：描述需求，Agent 会帮你完成画板与排版。免费档每天可体验 1 次 Auto 执行。",
        "status": "published",
        "published_at": 1751328000.0,  # 2026-07-01
    },
    {
        "id": "ann-plans-v1",
        "kind": "announcement",
        "title": "会员与卡密兑换说明",
        "body": "支持套餐卡密与 Token 卡密。兑换后会员权益与额度立即生效；可在「兑换」中输入卡密。",
        "status": "published",
        "published_at": 1752969600.0,  # 2026-07-20
    },
)


def _row_to_item(row: Any) -> dict[str, Any]:
    def _get(key: str) -> Any:
        return getattr(row, key) if hasattr(row, key) else row[key]

    published = _get("published_at")
    return {
        "id": str(_get("id")),
        "kind": str(_get("kind") or "announcement"),
        "title": str(_get("title") or ""),
        "body": str(_get("body") or ""),
        "status": str(_get("status") or "draft"),
        "publishedAt": float(published) if published is not None else None,
        "createdAt": float(_get("created_at") or 0),
        "updatedAt": float(_get("updated_at") or 0),
    }


def ensure_notices_ready() -> None:
    init_schema()
    with Session(engine) as session:
        if crud.count_notices(session=session) > 0:
            return
        now = time.time()
        for item in _SEED:
            crud.insert_notice_seed(
                session=session,
                notice_id=item["id"],
                kind=item["kind"],
                title=item["title"],
                body=item["body"],
                status=item["status"],
                published_at=float(item["published_at"]),
                created_at=float(item["published_at"]),
                updated_at=now,
            )
        session.commit()


def list_notices_admin(
    *,
    kind: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    ensure_notices_ready()
    kind_f = kind if kind and kind in VALID_KINDS else None
    status_f = status if status and status in VALID_STATUSES else None
    with Session(engine) as session:
        rows = crud.list_notices(session=session, kind=kind_f, status=status_f)
    return [_row_to_item(r) for r in rows]


def list_notices_public(*, kind: str | None = None) -> list[dict[str, Any]]:
    """Published notices for the account inbox."""
    ensure_notices_ready()
    kind_f = kind if kind and kind in VALID_KINDS else None
    with Session(engine) as session:
        rows = crud.list_notices(
            session=session, kind=kind_f, status="published"
        )
    return [_row_to_item(r) for r in rows]


def get_notice(notice_id: str) -> dict[str, Any] | None:
    ensure_notices_ready()
    nid = (notice_id or "").strip()
    if not nid:
        return None
    with Session(engine) as session:
        row = crud.get_notice(session=session, notice_id=nid)
    return _row_to_item(row) if row else None


def upsert_notice(
    *,
    notice_id: str | None,
    kind: str,
    title: str,
    body: str,
    status: str,
    published_at: float | None = None,
) -> dict[str, Any]:
    ensure_notices_ready()
    k = (kind or "").strip().lower()
    if k not in VALID_KINDS:
        raise ValueError("invalid_kind")
    st = (status or "").strip().lower()
    if st not in VALID_STATUSES:
        raise ValueError("invalid_status")
    title_s = (title or "").strip()
    body_s = (body or "").strip()
    if not title_s:
        raise ValueError("title_required")
    if not body_s:
        raise ValueError("body_required")

    now = time.time()
    nid = (notice_id or "").strip() or f"n-{uuid.uuid4().hex[:12]}"
    existing = get_notice(nid)

    pub = published_at
    if st == "published":
        if pub is None:
            pub = (
                float(existing["publishedAt"])
                if existing and existing.get("publishedAt")
                else now
            )
    else:
        pub = None

    with Session(engine) as session:
        row = crud.upsert_notice_row(
            session=session,
            notice_id=nid,
            kind=k,
            title=title_s,
            body=body_s,
            status=st,
            published_at=pub,
            created_at=now,
            updated_at=now,
        )
    return _row_to_item(row)


def delete_notice(notice_id: str) -> bool:
    ensure_notices_ready()
    nid = (notice_id or "").strip()
    if not nid:
        return False
    with Session(engine) as session:
        return crud.delete_notice(session=session, notice_id=nid)
