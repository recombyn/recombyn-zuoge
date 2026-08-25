"""Admin user listing / status / role / balance adjustments."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import User, UserBalance
from app.services.db import init_schema
from app.services.wallet.db import (
    grant_credits,
    get_wallet,
    list_ledger_page,
    normalize_plan,
    plan_is_active,
    spend_credits,
)


def list_users(
    *,
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    init_schema()
    page_n = max(1, int(page or 1))
    page_size_n = max(1, min(int(page_size or 20), 100))
    offset = (page_n - 1) * page_size_n
    with Session(engine) as session:
        rows, total = crud.list_admin_users(
            session=session,
            q=q,
            role=role,
            status=status,
            offset=offset,
            limit=page_size_n,
        )
    items = [_user_to_out(user, bal) for user, bal in rows]
    return {
        "items": items,
        "page": page_n,
        "pageSize": page_size_n,
        "total": total,
    }


def get_user(user_id: str) -> dict[str, Any] | None:
    init_schema()
    with Session(engine) as session:
        row = crud.get_admin_user(session=session, user_id=user_id)
    if not row:
        return None
    user, bal = row
    return _user_to_out(user, bal)


def update_user(
    user_id: str,
    *,
    role: str | None = None,
    status: str | None = None,
    name: str | None = None,
) -> dict[str, Any] | None:
    init_schema()
    uid = (user_id or "").strip()
    if not uid:
        return None
    if role is None and status is None and name is None:
        return get_user(uid)
    with Session(engine) as session:
        updated = crud.update_admin_user(
            session=session, user_id=uid, role=role, status=status, name=name
        )
        if not updated:
            return None
    return get_user(uid)


def adjust_credits(user_id: str, amount: int, detail: str = "") -> dict[str, Any]:
    """Positive amount credits; negative spends (absolute)."""
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    amt = int(amount)
    if amt == 0:
        raise ValueError("amount must be non-zero")
    note = (detail or "admin adjust").strip()[:500]
    if amt > 0:
        balance = grant_credits(uid, amt, detail=note)
    else:
        balance = spend_credits(uid, abs(amt), detail=note, force=True)

    return {"userId": uid, "credits": balance, "amount": amt}


def user_ledger(
    user_id: str,
    *,
    page: int = 1,
    page_size: int = 20,
    kind: str = "all",
) -> dict[str, Any]:
    snap = get_wallet(user_id)
    expires = snap.get("planExpiresAt")
    return {
        "credits": int(snap.get("credits") or 0),
        "planId": snap.get("planId") or "free",
        "planStored": snap.get("planStored") or "free",
        "planExpiresAt": int(float(expires) * 1000) if expires is not None else None,
        "planLocked": bool(snap.get("planLocked")),
        **list_ledger_page(user_id, page=page, page_size=page_size, kind=kind),
    }


def ensure_super_admin_role() -> None:
    """Make sure SUPER_ADMIN_EMAIL / SUPER_ADMIN_ID rows have role=admin and Pro plan."""
    init_schema()
    from app.services.auth.admin import SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID
    from app.services.wallet.db import ensure_super_admin_pro_plan

    with Session(engine) as session:
        crud.ensure_super_admin_role(session=session)
        admin_email = (SUPER_ADMIN_EMAIL or "").strip().lower()
        admin_id = (SUPER_ADMIN_ID or "").strip()
        ids: list[str] = []
        if admin_id:
            ids.append(admin_id)
        if admin_email:
            row = crud.get_user_by_email(session=session, email=admin_email)
            if row is not None:
                ids.append(str(row.id))
    seen: set[str] = set()
    for uid in ids:
        if not uid or uid in seen:
            continue
        seen.add(uid)
        ensure_super_admin_pro_plan(uid)


def _user_to_out(user: User, bal: UserBalance | None) -> dict[str, Any]:
    custom = (user.avatar or "").strip()
    default = (user.default_avatar or "").strip()
    effective = custom or default or None

    stored = normalize_plan(bal.plan_id if bal else "free")
    expires_raw = bal.plan_expires_at if bal else None
    expires_at = float(expires_raw) if expires_raw is not None else None
    active = plan_is_active(stored, expires_at)
    plan_id = stored if (stored == "free" or active) else "free"

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        # Effective display URL (custom upload wins over OAuth default).
        "avatar": effective,
        "avatarCustom": custom or None,
        "defaultAvatar": default or None,
        "bio": user.bio,
        "provider": user.provider or "email",
        "role": user.role or "user",
        "status": user.status or "active",
        "credits": int(bal.credits or 0) if bal else 0,
        "planId": plan_id,
        "planStored": stored,
        "planExpiresAt": int(expires_at * 1000) if expires_at is not None else None,
        "planLocked": active,
        "createdAt": int(float(user.created_at) * 1000) if user.created_at else None,
        "updatedAt": int(float(user.updated_at) * 1000) if user.updated_at else None,
    }
