"""Org membership store — multi-tenant roles + pending invites."""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlmodel import Session, col, or_, select

from app.core import db as core_db
from app.models import Org, OrgInvite, OrgMember


def _invite_out(
    row: OrgInvite,
    *,
    org_name: str | None = None,
    email_sent: bool | None = None,
) -> dict[str, Any]:
    out = {
        "id": row.id,
        "orgId": row.org_id,
        "orgName": org_name,
        "email": row.email,
        "userId": row.user_id,
        "role": row.role,
        "status": row.status,
        "invitedBy": row.invited_by,
        "createdAt": int(float(row.created_at or 0) * 1000),
        "respondedAt": (
            int(float(row.responded_at) * 1000) if row.responded_at else None
        ),
    }
    if email_sent is not None:
        out["emailSent"] = bool(email_sent)
    return out


def _actor_display_name(*, session: Session, user_id: str) -> str:
    from app import crud

    user = crud.get_user_by_id(session=session, user_id=user_id)
    if not user:
        return "A teammate"
    name = str(getattr(user, "name", None) or "").strip()
    if name:
        return name
    email = str(getattr(user, "email", None) or "").strip()
    if email and "@" in email:
        return email.split("@", 1)[0]
    return "A teammate"


def _notify_org_invite_email(
    *,
    to_email: str | None,
    org_name: str | None,
    inviter_name: str,
) -> bool:
    """Best-effort SES notify. Never raises to the invite API."""
    import logging

    em = (to_email or "").strip().lower()
    if not em or "@" not in em:
        return False
    try:
        from app.services.auth.ses_mail import (
            send_org_invite_email,
            ses_configured,
        )

        if not ses_configured():
            return False
        send_org_invite_email(
            to_email=em,
            org_name=org_name or "a team",
            inviter_name=inviter_name,
        )
        return True
    except Exception:
        logging.getLogger(__name__).exception(
            "org invite email failed to=%s org=%s", em, org_name
        )
        return False


def create_org(*, name: str, owner_user_id: str) -> dict[str, Any]:
    org_id = f"org_{uuid.uuid4().hex[:16]}"
    now = time.time()
    with Session(core_db.engine) as session:
        session.add(
            Org(
                id=org_id,
                name=(name or "Untitled org").strip()[:120] or "Untitled org",
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            OrgMember(
                org_id=org_id,
                user_id=owner_user_id,
                role="owner",
                created_at=now,
            )
        )
        session.commit()
    return {"id": org_id, "name": name, "role": "owner"}


def get_org_member_role(*, org_id: str, user_id: str) -> str | None:
    oid = (org_id or "").strip()
    uid = (user_id or "").strip()
    if not oid or not uid:
        return None
    with Session(core_db.engine) as session:
        row = session.exec(
            select(OrgMember).where(
                OrgMember.org_id == oid,
                OrgMember.user_id == uid,
            )
        ).first()
        if not row:
            return None
        return str(row.role or "").lower() or None


def upsert_org_member(
    *,
    org_id: str,
    user_id: str,
    role: str,
) -> dict[str, Any]:
    oid = (org_id or "").strip()
    uid = (user_id or "").strip()
    r = (role or "member").strip().lower()
    if r not in {"owner", "admin", "member"}:
        raise ValueError("invalid_org_role")
    if not oid or not uid:
        raise ValueError("org_id_and_user_required")
    now = time.time()
    with Session(core_db.engine) as session:
        row = session.exec(
            select(OrgMember).where(
                OrgMember.org_id == oid,
                OrgMember.user_id == uid,
            )
        ).first()
        if row:
            row.role = r
            session.add(row)
        else:
            session.add(
                OrgMember(org_id=oid, user_id=uid, role=r, created_at=now)
            )
        session.commit()
    return {"org_id": oid, "user_id": uid, "role": r}


def list_org_members(*, org_id: str) -> list[dict[str, Any]]:
    oid = (org_id or "").strip()
    if not oid:
        return []
    with Session(core_db.engine) as session:
        rows = session.exec(select(OrgMember).where(OrgMember.org_id == oid)).all()
        return [
            {"org_id": r.org_id, "user_id": r.user_id, "role": r.role, "created_at": r.created_at}
            for r in rows
        ]


def list_orgs_for_user(*, user_id: str) -> list[dict[str, Any]]:
    uid = (user_id or "").strip()
    if not uid:
        return []
    with Session(core_db.engine) as session:
        rows = session.exec(
            select(OrgMember, Org)
            .join(Org, Org.id == OrgMember.org_id)
            .where(OrgMember.user_id == uid)
        ).all()
        out: list[dict[str, Any]] = []
        for mem, org in rows:
            out.append(
                {
                    "id": org.id,
                    "name": org.name,
                    "role": mem.role,
                    "createdAt": int(float(org.created_at or 0) * 1000),
                    "updatedAt": int(float(org.updated_at or 0) * 1000),
                }
            )
        return out


def get_org(*, org_id: str) -> dict[str, Any] | None:
    oid = (org_id or "").strip()
    if not oid:
        return None
    with Session(core_db.engine) as session:
        row = session.get(Org, oid)
        if not row:
            return None
        return {
            "id": row.id,
            "name": row.name,
            "createdAt": int(float(row.created_at or 0) * 1000),
            "updatedAt": int(float(row.updated_at or 0) * 1000),
        }


def create_org_invite(
    *,
    org_id: str,
    actor_user_id: str,
    user_id: str | None = None,
    email: str | None = None,
    role: str = "member",
) -> dict[str, Any]:
    """Create a pending invite (does not add membership until accept)."""
    from app import crud

    oid = (org_id or "").strip()
    uid = (user_id or "").strip() or None
    em = (email or "").strip().lower() or None
    r = (role or "member").strip().lower()
    if r not in {"admin", "member"}:
        # Invites cannot create a second owner via invite.
        if r == "owner":
            raise ValueError("invalid_invite_role")
        raise ValueError("invalid_org_role")
    if not oid:
        raise ValueError("org_id_required")
    if not uid and not em:
        raise ValueError("user_id_or_email_required")

    with Session(core_db.engine) as session:
        if not session.get(Org, oid):
            raise LookupError("org_not_found")

        if not uid and em:
            user = crud.get_user_by_email(session=session, email=em)
            if user:
                uid = str(user.id)
                em = str(user.email or em).lower()
        elif uid and not em:
            user = crud.get_user_by_id(session=session, user_id=uid)
            if not user:
                raise LookupError("user_not_found")
            em = str(user.email or "").lower() or None

        if uid and get_org_member_role(org_id=oid, user_id=uid):
            raise ValueError("already_member")

        # Reuse existing pending invite for same target.
        pending_q = select(OrgInvite).where(
            OrgInvite.org_id == oid,
            OrgInvite.status == "pending",
        )
        if uid:
            pending_q = pending_q.where(OrgInvite.user_id == uid)
        elif em:
            pending_q = pending_q.where(col(OrgInvite.email) == em)
        existing = session.exec(pending_q).first()
        if existing:
            existing.role = r
            existing.invited_by = actor_user_id
            if uid:
                existing.user_id = uid
            if em:
                existing.email = em
            session.add(existing)
            session.commit()
            session.refresh(existing)
            org = session.get(Org, oid)
            inviter = _actor_display_name(session=session, user_id=actor_user_id)
            sent = _notify_org_invite_email(
                to_email=em or existing.email,
                org_name=org.name if org else None,
                inviter_name=inviter,
            )
            return _invite_out(
                existing, org_name=org.name if org else None, email_sent=sent
            )

        now = time.time()
        invite_id = f"oinv_{uuid.uuid4().hex[:16]}"
        row = OrgInvite(
            id=invite_id,
            org_id=oid,
            email=em,
            user_id=uid,
            role=r,
            status="pending",
            invited_by=actor_user_id,
            created_at=now,
            responded_at=None,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        org = session.get(Org, oid)
        inviter = _actor_display_name(session=session, user_id=actor_user_id)
        sent = _notify_org_invite_email(
            to_email=em,
            org_name=org.name if org else None,
            inviter_name=inviter,
        )
        return _invite_out(row, org_name=org.name if org else None, email_sent=sent)


def list_org_invites(*, org_id: str, status: str = "pending") -> list[dict[str, Any]]:
    oid = (org_id or "").strip()
    st = (status or "pending").strip().lower() or "pending"
    if not oid:
        return []
    with Session(core_db.engine) as session:
        org = session.get(Org, oid)
        rows = session.exec(
            select(OrgInvite)
            .where(OrgInvite.org_id == oid, OrgInvite.status == st)
            .order_by(col(OrgInvite.created_at).desc())
        ).all()
        name = org.name if org else None
        return [_invite_out(r, org_name=name) for r in rows]


def list_pending_invites_for_user(*, user_id: str, email: str | None) -> list[dict[str, Any]]:
    uid = (user_id or "").strip()
    em = (email or "").strip().lower() or None
    if not uid and not em:
        return []
    with Session(core_db.engine) as session:
        clauses = []
        if uid:
            clauses.append(OrgInvite.user_id == uid)
        if em:
            clauses.append(col(OrgInvite.email) == em)
        rows = session.exec(
            select(OrgInvite, Org)
            .join(Org, Org.id == OrgInvite.org_id)
            .where(OrgInvite.status == "pending", or_(*clauses))
            .order_by(col(OrgInvite.created_at).desc())
        ).all()
        return [_invite_out(inv, org_name=org.name) for inv, org in rows]


def accept_org_invite(*, invite_id: str, user_id: str, email: str | None) -> dict[str, Any]:
    iid = (invite_id or "").strip()
    uid = (user_id or "").strip()
    em = (email or "").strip().lower() or None
    if not iid or not uid:
        raise ValueError("invite_and_user_required")

    with Session(core_db.engine) as session:
        row = session.get(OrgInvite, iid)
        if not row or str(row.status or "") != "pending":
            raise LookupError("invite_not_found")
        target_uid = str(row.user_id or "").strip()
        target_em = str(row.email or "").strip().lower()
        ok = (target_uid and target_uid == uid) or (target_em and em and target_em == em)
        if not ok:
            raise PermissionError("invite_not_for_user")

        now = time.time()
        row.status = "accepted"
        row.responded_at = now
        row.user_id = uid
        if em:
            row.email = em
        session.add(row)
        session.commit()
        role = str(row.role or "member")
        org_id = str(row.org_id)

    member = upsert_org_member(org_id=org_id, user_id=uid, role=role)
    return {"inviteId": iid, "member": member, "orgId": org_id}


def decline_org_invite(*, invite_id: str, user_id: str, email: str | None) -> dict[str, Any]:
    iid = (invite_id or "").strip()
    uid = (user_id or "").strip()
    em = (email or "").strip().lower() or None
    if not iid or not uid:
        raise ValueError("invite_and_user_required")

    with Session(core_db.engine) as session:
        row = session.get(OrgInvite, iid)
        if not row or str(row.status or "") != "pending":
            raise LookupError("invite_not_found")
        target_uid = str(row.user_id or "").strip()
        target_em = str(row.email or "").strip().lower()
        ok = (target_uid and target_uid == uid) or (target_em and em and target_em == em)
        if not ok:
            raise PermissionError("invite_not_for_user")
        row.status = "declined"
        row.responded_at = time.time()
        row.user_id = uid
        session.add(row)
        session.commit()
        return {"inviteId": iid, "status": "declined"}


def rename_org(*, org_id: str, name: str) -> dict[str, Any]:
    oid = (org_id or "").strip()
    name_n = (name or "").strip()[:120] or "Untitled org"
    if not oid:
        raise ValueError("org_id_required")
    with Session(core_db.engine) as session:
        row = session.get(Org, oid)
        if not row:
            raise LookupError("org_not_found")
        row.name = name_n
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return {
            "id": row.id,
            "name": row.name,
            "createdAt": int(float(row.created_at or 0) * 1000),
            "updatedAt": int(float(row.updated_at or 0) * 1000),
        }


def remove_org_member(*, org_id: str, user_id: str, actor_user_id: str) -> dict[str, Any]:
    """Remove a member. Cannot remove the last owner or demote yourself if sole owner."""
    oid = (org_id or "").strip()
    uid = (user_id or "").strip()
    if not oid or not uid:
        raise ValueError("org_id_and_user_required")
    with Session(core_db.engine) as session:
        target = session.exec(
            select(OrgMember).where(
                OrgMember.org_id == oid,
                OrgMember.user_id == uid,
            )
        ).first()
        if not target:
            raise LookupError("member_not_found")
        if str(target.role or "").lower() == "owner":
            owners = session.exec(
                select(OrgMember).where(
                    OrgMember.org_id == oid,
                    OrgMember.role == "owner",
                )
            ).all()
            if len(owners) <= 1:
                raise ValueError("cannot_remove_last_owner")
        session.delete(target)
        session.commit()
    return {"orgId": oid, "userId": uid, "removed": True}
