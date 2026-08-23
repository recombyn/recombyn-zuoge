"""CRUD helpers — keyword-only args after ``*``; always take ``session: Session``."""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import case, delete, or_, text, update as sa_update
from sqlmodel import Session, col, func, select

from app.models import (
    AgentEpisode,
    AgentKgTriple,
    AgentLongMemory,
    AgentSessionSnapshot,
    AppMigration,
    Asset,
    AuthSession,
    CardKey,
    ChatMessage,
    ChatSession,
    DesignCanvasTool,
    DesignColdBlob,
    DesignDict,
    DesignExecuteFlow,
    DesignGlobalRule,
    DesignLayerLock,
    DesignOptimizePatch,
    DesignPromptPack,
    DesignSkill,
    DesignSkillGroup,
    DesignSkillRevision,
    DesignStageReview,
    DesignSystemPrompt,
    DesignTask,
    DesignTokenPack,
    DesignUserSkillPref,
    DocumentShare,
    EmailActivateToken,
    EmailCode,
    EmailTicket,
    Font,
    LlmModel,
    LlmModelRemoved,
    ModelUsage,
    Notice,
    PlazaLike,
    PlazaSubmission,
    Project,
    User,
    UserBalance,
    UserByokProvider,
    WalletLedger,
)


def get_user_by_email(*, session: Session, email: str) -> User | None:
    email_n = (email or "").strip().lower()
    if not email_n:
        return None
    statement = select(User).where(func.lower(User.email) == email_n)
    return session.exec(statement).first()


def get_user_by_id(*, session: Session, user_id: str) -> User | None:
    uid = (user_id or "").strip()
    if not uid:
        return None
    return session.get(User, uid)


def get_user_by_google_sub(*, session: Session, google_sub: str) -> User | None:
    sub = (google_sub or "").strip()
    if not sub:
        return None
    return session.exec(select(User).where(User.google_sub == sub)).first()


def create_user(*, session: Session, user: User) -> User:
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update_user_oauth(
    *,
    session: Session,
    user: User,
    email: str,
    provider: str,
    google_sub: str | None,
    default_avatar: str | None,
) -> User:
    user.email = email
    user.provider = provider
    if google_sub:
        user.google_sub = google_sub
    user.default_avatar = default_avatar
    user.updated_at = time.time()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update_user_profile(
    *,
    session: Session,
    user: User,
    name: str | None = None,
    bio: str | None = None,
    avatar: str | None = None,
) -> User:
    if name is not None:
        user.name = name
    if bio is not None:
        user.bio = bio
    if avatar is not None:
        user.avatar = avatar
    user.updated_at = time.time()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def set_user_password(
    *,
    session: Session,
    user: User,
    password_hash: str,
    password_salt: str,
) -> User:
    user.password_hash = password_hash
    user.password_salt = password_salt
    user.provider = "email"
    user.updated_at = time.time()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_auth_session(*, session: Session, token: str) -> AuthSession | None:
    return session.get(AuthSession, token)


def delete_auth_session(*, session: Session, token: str) -> bool:
    row = session.get(AuthSession, token)
    if not row:
        return False
    session.delete(row)
    session.commit()
    return True


def create_auth_session(
    *,
    session: Session,
    token: str,
    user_id: str,
    ttl_seconds: int,
) -> AuthSession:
    now = time.time()
    row = AuthSession(
        token=token,
        user_id=user_id,
        expires_at=now + float(ttl_seconds),
        created_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def count_projects_for_user(*, session: Session, user_id: str) -> int:
    return int(
        session.exec(
            select(func.count()).select_from(Project).where(Project.user_id == user_id)
        ).one()
        or 0
    )


def list_projects_for_user(
    *,
    session: Session,
    user_id: str,
    offset: int = 0,
    limit: int = 24,
) -> list[Project]:
    statement = (
        select(Project)
        .where(Project.user_id == user_id)
        .order_by(col(Project.updated_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    return list(session.exec(statement).all())


def _org_ids_for_user(*, session: Session, user_id: str) -> list[str]:
    from app.models import OrgMember

    rows = session.exec(
        select(OrgMember.org_id).where(OrgMember.user_id == user_id)
    ).all()
    return [str(x) for x in rows if x]


def _projects_access_clause(*, user_id: str, org_ids: list[str], org_id: str | None):
    filter_oid = (org_id or "").strip() or None
    if filter_oid:
        if filter_oid not in org_ids:
            return None
        return Project.org_id == filter_oid
    owned = Project.user_id == user_id
    if not org_ids:
        return owned
    return or_(owned, Project.org_id.in_(org_ids))


def count_projects_accessible(
    *,
    session: Session,
    user_id: str,
    org_id: str | None = None,
) -> int:
    org_ids = _org_ids_for_user(session=session, user_id=user_id)
    clause = _projects_access_clause(user_id=user_id, org_ids=org_ids, org_id=org_id)
    if clause is None:
        return 0
    return int(
        session.exec(select(func.count()).select_from(Project).where(clause)).one() or 0
    )


def list_projects_accessible(
    *,
    session: Session,
    user_id: str,
    offset: int = 0,
    limit: int = 24,
    org_id: str | None = None,
) -> list[Project]:
    org_ids = _org_ids_for_user(session=session, user_id=user_id)
    clause = _projects_access_clause(user_id=user_id, org_ids=org_ids, org_id=org_id)
    if clause is None:
        return []
    statement = (
        select(Project)
        .where(clause)
        .order_by(col(Project.updated_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    return list(session.exec(statement).all())


def get_project_for_user(
    *,
    session: Session,
    user_id: str,
    project_id: str,
) -> Project | None:
    statement = select(Project).where(
        Project.id == project_id,
        Project.user_id == user_id,
    )
    return session.exec(statement).first()


def get_project_accessible(
    *,
    session: Session,
    user_id: str,
    project_id: str,
) -> Project | None:
    """Owner or org member may access the project row."""
    from app.models import OrgMember

    row = session.get(Project, project_id)
    if not row:
        return None
    if str(row.user_id or "") == str(user_id or ""):
        return row
    oid = str(getattr(row, "org_id", None) or "").strip()
    if not oid:
        return None
    mem = session.exec(
        select(OrgMember).where(
            OrgMember.org_id == oid,
            OrgMember.user_id == user_id,
        )
    ).first()
    return row if mem else None


def update_project_if_revision_accessible(
    *,
    session: Session,
    project_id: str,
    expected_revision: int,
    values: dict[str, Any],
) -> bool:
    """Optimistic lock by project id only (caller already authorized)."""
    stmt = (
        sa_update(Project)
        .where(
            Project.id == project_id,
            Project.revision == expected_revision,
        )
        .values(**values)
    )
    result = session.execute(stmt)
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0) > 0


def create_project(*, session: Session, project: Project) -> Project:
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def update_project_if_revision(
    *,
    session: Session,
    user_id: str,
    project_id: str,
    expected_revision: int,
    values: dict[str, Any],
) -> bool:
    """Optimistic lock UPDATE … WHERE revision = expected. Returns False on conflict."""
    stmt = (
        sa_update(Project)
        .where(
            Project.id == project_id,
            Project.user_id == user_id,
            Project.revision == expected_revision,
        )
        .values(**values)
    )
    result = session.execute(stmt)
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0) > 0


def update_project_covers(
    *,
    session: Session,
    user_id: str,
    project_id: str,
    thumbnail_key: str | None,
    thumbnail_custom: bool,
    updated_at: float,
) -> bool:
    """Update cover tiles only — does not bump document revision."""
    stmt = (
        sa_update(Project)
        .where(Project.id == project_id, Project.user_id == user_id)
        .values(
            thumbnail_key=thumbnail_key,
            thumbnail_custom=1 if thumbnail_custom else 0,
            updated_at=updated_at,
        )
    )
    result = session.execute(stmt)
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0) > 0


def update_project_covers_by_id(
    *,
    session: Session,
    project_id: str,
    thumbnail_key: str | None,
    thumbnail_custom: bool,
    updated_at: float,
) -> bool:
    """Cover update by id (caller already authorized for org/shared access)."""
    stmt = (
        sa_update(Project)
        .where(Project.id == project_id)
        .values(
            thumbnail_key=thumbnail_key,
            thumbnail_custom=1 if thumbnail_custom else 0,
            updated_at=updated_at,
        )
    )
    result = session.execute(stmt)
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0) > 0


def delete_project_for_user(
    *,
    session: Session,
    user_id: str,
    project_id: str,
) -> dict[str, Any] | None:
    """Delete project; return ``{document_key, thumbnail_key}`` for COS cleanup."""
    row = get_project_for_user(session=session, user_id=user_id, project_id=project_id)
    if not row:
        return None
    meta = {
        "document_key": row.document_key,
        "thumbnail_key": row.thumbnail_key,
    }
    session.delete(row)
    session.commit()
    return meta


def get_user_balance(*, session: Session, user_id: str) -> UserBalance | None:
    return session.get(UserBalance, user_id)


def get_user_balance_for_update(*, session: Session, user_id: str) -> UserBalance | None:
    """Row lock on MySQL/Postgres; SQLite ignores FOR UPDATE."""
    stmt = select(UserBalance).where(UserBalance.user_id == user_id).with_for_update()
    return session.exec(stmt).first()


def ensure_user_balance_row(
    *,
    session: Session,
    user_id: str,
    starting_credits: int = 0,
) -> UserBalance:
    uid = (user_id or "").strip()
    row = session.get(UserBalance, uid) if uid else None
    if row:
        return row
    now = time.time()
    row = UserBalance(
        user_id=uid,
        credits=int(starting_credits),
        plan_id="free",
        plan_expires_at=None,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def add_wallet_ledger(
    *,
    session: Session,
    user_id: str,
    kind: str,
    amount: int,
    balance_after: int,
    detail: str = "",
    commit: bool = False,
) -> WalletLedger:
    row = WalletLedger(
        user_id=user_id,
        kind=kind,
        amount=int(amount),
        balance_after=int(balance_after),
        detail=(detail or "")[:500] or None,
        card_key_id=None,
        created_at=time.time(),
    )
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    return row


def list_wallet_ledger(
    *,
    session: Session,
    user_id: str,
    offset: int = 0,
    limit: int = 20,
    kinds: list[str] | None = None,
) -> tuple[list[WalletLedger], int]:
    where = [WalletLedger.user_id == user_id]
    if kinds:
        where.append(col(WalletLedger.kind).in_(kinds))
    count_stmt = select(func.count()).select_from(WalletLedger)
    for clause in where:
        count_stmt = count_stmt.where(clause)
    total = int(session.exec(count_stmt).one() or 0)
    stmt = (
        select(WalletLedger)
        .where(*where)
        .order_by(col(WalletLedger.created_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    rows = list(session.exec(stmt).all())
    return rows, total


def list_plaza_mine(*, session: Session, user_id: str) -> list[PlazaSubmission]:
    """Latest submission per project for a user (in-Python dedupe by updated_at desc)."""
    rows = list(
        session.exec(
            select(PlazaSubmission)
            .where(PlazaSubmission.user_id == user_id)
            .order_by(col(PlazaSubmission.updated_at).desc())
        ).all()
    )
    best: dict[str, PlazaSubmission] = {}
    for row in rows:
        if row.project_id not in best:
            best[row.project_id] = row
    return list(best.values())


def get_plaza_submission(*, session: Session, submission_id: str) -> PlazaSubmission | None:
    sid = (submission_id or "").strip()
    if not sid:
        return None
    return session.get(PlazaSubmission, sid)


def get_active_plaza_for_project(
    *,
    session: Session,
    user_id: str,
    project_id: str,
) -> PlazaSubmission | None:
    return session.exec(
        select(PlazaSubmission)
        .where(PlazaSubmission.user_id == user_id)
        .where(PlazaSubmission.project_id == project_id)
        .where(col(PlazaSubmission.status).in_(["pending", "approved"]))
        .order_by(col(PlazaSubmission.updated_at).desc())
        .limit(1)
    ).first()


def create_plaza_submission(
    *,
    session: Session,
    submission_id: str,
    project_id: str,
    user_id: str,
    author_name: str,
    author_avatar: str | None,
    title: str,
    category: str,
    document_json: str,
    cover_json: str | None,
    cover_image_url: str | None,
    created_at: float,
) -> PlazaSubmission:
    row = PlazaSubmission(
        id=submission_id,
        project_id=project_id,
        user_id=user_id,
        author_name=author_name,
        author_avatar=author_avatar,
        title=title,
        category=category,
        document_json=document_json,
        cover_json=cover_json,
        cover_image_url=cover_image_url,
        status="pending",
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_plaza_admin(
    *,
    session: Session,
    status: str | None = None,
    limit: int = 200,
) -> list[PlazaSubmission]:
    lim = max(1, min(int(limit), 500))
    st = (status or "").strip().lower()
    if st in ("pending", "approved", "rejected"):
        return list(
            session.exec(
                select(PlazaSubmission)
                .where(PlazaSubmission.status == st)
                .order_by(col(PlazaSubmission.updated_at).desc())
                .limit(lim)
            ).all()
        )
    from sqlalchemy import case

    rank = case(
        (PlazaSubmission.status == "pending", 0),
        (PlazaSubmission.status == "approved", 1),
        else_=2,
    )
    return list(
        session.exec(
            select(PlazaSubmission)
            .order_by(rank, col(PlazaSubmission.updated_at).desc())
            .limit(lim)
        ).all()
    )


def list_plaza_feed(
    *,
    session: Session,
    tab: str,
    author_ids: list[str] | None,
    category: str | None,
    visible_only: bool,
    offset: int,
    limit: int,
    categories: frozenset[str] | set[str],
) -> tuple[list[PlazaSubmission], int] | None:
    """Approved feed page. Returns None when following has no author ids."""
    ids = [str(x).strip() for x in (author_ids or []) if str(x).strip()]
    if not ids and tab == "following":
        return None

    where: list[Any] = [PlazaSubmission.status == "approved"]
    if visible_only:
        where.append(func.coalesce(PlazaSubmission.is_visible, 1) == 1)
    if ids:
        where.append(col(PlazaSubmission.user_id).in_(ids))
    cat = (category or "").strip().lower()
    if cat and cat in categories:
        where.append(func.lower(PlazaSubmission.category) == cat)

    count_stmt = select(func.count()).select_from(PlazaSubmission).where(*where)
    total = int(session.exec(count_stmt).one() or 0)

    if tab == "latest":
        order = (
            col(PlazaSubmission.created_at).desc(),
            col(PlazaSubmission.updated_at).desc(),
        )
    else:
        order = (
            col(PlazaSubmission.reviewed_at).desc(),
            col(PlazaSubmission.updated_at).desc(),
            col(PlazaSubmission.created_at).desc(),
        )

    rows = list(
        session.exec(
            select(PlazaSubmission)
            .where(*where)
            .order_by(*order)
            .offset(max(0, offset))
            .limit(max(1, limit))
        ).all()
    )
    return rows, total


def delete_plaza_submission(*, session: Session, submission_id: str) -> bool:
    from sqlalchemy import text

    row = get_plaza_submission(session=session, submission_id=submission_id)
    if not row:
        return False
    try:
        session.execute(
            text("DELETE FROM plaza_likes WHERE submission_id = :sid"),
            {"sid": submission_id},
        )
    except Exception:
        pass
    session.delete(row)
    session.commit()
    return True


def count_plaza_likes(*, session: Session, submission_id: str) -> int:
    sid = (submission_id or "").strip()
    if not sid:
        return 0
    n = session.exec(
        select(func.count())
        .select_from(PlazaLike)
        .where(PlazaLike.submission_id == sid)
    ).one()
    return max(0, int(n or 0))


def sync_plaza_like_count(*, session: Session, submission_id: str) -> int:
    count = count_plaza_likes(session=session, submission_id=submission_id)
    row = get_plaza_submission(session=session, submission_id=submission_id)
    if row:
        row.like_count = count
        session.add(row)
    return count


def get_plaza_like(
    *, session: Session, user_id: str, submission_id: str
) -> PlazaLike | None:
    return session.get(PlazaLike, (user_id, submission_id))


def upsert_plaza_like(
    *,
    session: Session,
    user_id: str,
    submission_id: str,
    created_at: float,
) -> PlazaLike:
    from sqlalchemy.exc import IntegrityError

    row = get_plaza_like(
        session=session, user_id=user_id, submission_id=submission_id
    )
    if row:
        return row
    row = PlazaLike(
        user_id=user_id, submission_id=submission_id, created_at=created_at
    )
    try:
        with session.begin_nested():
            session.add(row)
            session.flush()
        return row
    except IntegrityError:
        existing = get_plaza_like(
            session=session, user_id=user_id, submission_id=submission_id
        )
        if existing:
            return existing
        raise


def delete_plaza_like(
    *, session: Session, user_id: str, submission_id: str
) -> bool:
    row = get_plaza_like(
        session=session, user_id=user_id, submission_id=submission_id
    )
    if not row:
        return False
    session.delete(row)
    return True


def _liked_visible_approved_where(user_id: str) -> list[Any]:
    return [
        PlazaLike.user_id == user_id,
        PlazaSubmission.status == "approved",
        func.coalesce(PlazaSubmission.is_visible, 1) == 1,
    ]


def list_plaza_liked_page(
    *,
    session: Session,
    user_id: str,
    offset: int = 0,
    limit: int = 24,
) -> tuple[list[tuple[PlazaSubmission, float]], int]:
    where = _liked_visible_approved_where(user_id)
    count_stmt = (
        select(func.count())
        .select_from(PlazaLike)
        .join(PlazaSubmission, PlazaSubmission.id == PlazaLike.submission_id)
        .where(*where)
    )
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(
        session.exec(
            select(PlazaSubmission, PlazaLike.created_at)
            .join(PlazaLike, PlazaLike.submission_id == PlazaSubmission.id)
            .where(*where)
            .order_by(col(PlazaLike.created_at).desc())
            .offset(max(0, offset))
            .limit(max(1, limit))
        ).all()
    )
    return rows, total


def list_plaza_liked_ids(*, session: Session, user_id: str) -> list[str]:
    where = _liked_visible_approved_where(user_id)
    rows = list(
        session.exec(
            select(PlazaLike.submission_id)
            .join(PlazaSubmission, PlazaSubmission.id == PlazaLike.submission_id)
            .where(*where)
            .order_by(col(PlazaLike.created_at).desc())
        ).all()
    )
    return [str(sid) for sid in rows]


def get_visible_approved_submission(
    *, session: Session, submission_id: str
) -> PlazaSubmission | None:
    sid = (submission_id or "").strip()
    if not sid:
        return None
    return session.exec(
        select(PlazaSubmission)
        .where(PlazaSubmission.id == sid)
        .where(PlazaSubmission.status == "approved")
        .where(func.coalesce(PlazaSubmission.is_visible, 1) == 1)
    ).first()


def count_wallet_ledger_detail_prefix(
    *, session: Session, user_id: str, detail_prefix: str
) -> int:
    n = session.exec(
        select(func.count())
        .select_from(WalletLedger)
        .where(WalletLedger.user_id == user_id)
        .where(col(WalletLedger.detail).like(f"{detail_prefix}%"))
    ).one()
    return int(n or 0)


def load_user_avatar_map(*, session: Session, user_ids: list[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    avatar_by_user: dict[str, str] = {}
    try:
        rows = list(
            session.exec(select(User).where(col(User.id).in_(user_ids))).all()
        )
    except Exception:
        return {}
    for ur in rows:
        custom = (ur.avatar or "").strip()
        default = (ur.default_avatar or "").strip()
        av = custom or default
        if av:
            avatar_by_user[str(ur.id)] = av
    return avatar_by_user


def create_card_key(
    *,
    session: Session,
    key_hash: str,
    credits: int,
    kind: str,
    plan_id: str | None,
    expires_at: float | None,
    created_at: float,
    commit: bool = True,
) -> CardKey | None:
    from sqlalchemy.exc import IntegrityError

    row = CardKey(
        key_hash=key_hash,
        credits=int(credits),
        kind=kind,
        plan_id=plan_id,
        status="unused",
        expires_at=expires_at,
        created_at=created_at,
    )
    try:
        if commit:
            session.add(row)
            session.commit()
            session.refresh(row)
        else:
            with session.begin_nested():
                session.add(row)
                session.flush()
        return row
    except IntegrityError:
        if commit:
            session.rollback()
        return None


def list_card_keys(
    *,
    session: Session,
    status: str | None = None,
    limit: int = 200,
) -> list[CardKey]:
    lim = max(1, min(int(limit or 200), 500))
    stmt = select(CardKey)
    if status in ("unused", "used", "revoked"):
        stmt = stmt.where(CardKey.status == status)
    stmt = stmt.order_by(col(CardKey.created_at).desc(), col(CardKey.id).desc()).limit(
        lim
    )
    return list(session.exec(stmt).all())


def revoke_unused_card_keys(*, session: Session, ids: list[int]) -> int:
    revoked = 0
    for kid in ids:
        row = session.get(CardKey, kid)
        if not row or row.status != "unused":
            continue
        row.status = "revoked"
        session.add(row)
        revoked += 1
    session.commit()
    return revoked


def get_email_code(*, session: Session, email: str) -> EmailCode | None:
    email_n = (email or "").strip().lower()
    if not email_n:
        return None
    return session.exec(
        select(EmailCode).where(func.lower(EmailCode.email) == email_n)
    ).first()


def upsert_email_code(
    *,
    session: Session,
    email: str,
    code_hash: str,
    expires_at: int,
    sent_at: int,
) -> EmailCode:
    email_n = email.strip().lower()
    row = get_email_code(session=session, email=email_n)
    if row:
        row.code_hash = code_hash
        row.expires_at = int(expires_at)
        row.sent_at = int(sent_at)
        row.attempts = 0
    else:
        row = EmailCode(
            email=email_n,
            code_hash=code_hash,
            expires_at=int(expires_at),
            sent_at=int(sent_at),
            attempts=0,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_email_code(*, session: Session, email: str) -> None:
    row = get_email_code(session=session, email=email)
    if row:
        session.delete(row)
        session.commit()


def create_email_ticket(
    *,
    session: Session,
    ticket: str,
    email: str,
    expires_at: int,
) -> EmailTicket:
    row = EmailTicket(
        ticket=ticket, email=email.strip().lower(), expires_at=int(expires_at)
    )
    session.add(row)
    session.commit()
    return row


def get_email_ticket(*, session: Session, ticket: str) -> EmailTicket | None:
    return session.get(EmailTicket, ticket)


def delete_email_ticket(*, session: Session, ticket: str) -> None:
    row = session.get(EmailTicket, ticket)
    if row:
        session.delete(row)
        session.commit()


def latest_activate_token_created_at(*, session: Session, email: str) -> int | None:
    email_n = (email or "").strip().lower()
    row = session.exec(
        select(EmailActivateToken)
        .where(func.lower(EmailActivateToken.email) == email_n)
        .order_by(col(EmailActivateToken.created_at).desc())
        .limit(1)
    ).first()
    return int(row.created_at) if row else None


def replace_activate_token(
    *,
    session: Session,
    email: str,
    token_id: str,
    expires_at: int,
    created_at: int,
) -> EmailActivateToken:
    email_n = email.strip().lower()
    old = list(
        session.exec(
            select(EmailActivateToken).where(
                func.lower(EmailActivateToken.email) == email_n
            )
        ).all()
    )
    for item in old:
        session.delete(item)
    row = EmailActivateToken(
        token_id=token_id,
        email=email_n,
        expires_at=int(expires_at),
        created_at=int(created_at),
    )
    session.add(row)
    session.commit()
    return row


def get_activate_token(*, session: Session, token_id: str) -> EmailActivateToken | None:
    return session.get(EmailActivateToken, token_id)


def delete_activate_token(*, session: Session, token_id: str) -> None:
    row = session.get(EmailActivateToken, token_id)
    if row:
        session.delete(row)
        session.commit()


def get_card_key_by_hash_for_update(*, session: Session, key_hash: str) -> CardKey | None:
    return session.exec(
        select(CardKey).where(CardKey.key_hash == key_hash).with_for_update()
    ).first()


def list_admin_projects(
    *,
    session: Session,
    q: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[tuple[Project, str | None, str | None]], int]:
    where: list[Any] = []
    raw = (q or "").strip()
    if raw:
        like = f"%{raw}%"
        where.append(
            (col(Project.name).like(like))
            | (col(Project.user_id).like(like))
            | (col(User.email).like(like))
            | (col(User.name).like(like))
        )
    count_stmt = select(func.count()).select_from(Project).outerjoin(
        User, User.id == Project.user_id
    )
    stmt = (
        select(Project, User.email, User.name)
        .outerjoin(User, User.id == Project.user_id)
        .order_by(col(Project.updated_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    if where:
        count_stmt = count_stmt.where(*where)
        stmt = stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(session.exec(stmt).all())
    return rows, total


def list_admin_assets(
    *,
    session: Session,
    kind: str | None = None,
    q: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[tuple[Asset, str | None, str | None]], int]:
    where: list[Any] = []
    kind_n = (kind or "").strip().lower()
    if kind_n in ("image", "video", "audio", "font", "lottie"):
        where.append(Asset.kind == kind_n)
    raw = (q or "").strip()
    if raw:
        like = f"%{raw}%"
        where.append(
            (col(Asset.user_id).like(like))
            | (col(Asset.prompt).like(like))
            | (col(User.email).like(like))
        )
    count_stmt = select(func.count()).select_from(Asset).outerjoin(
        User, User.id == Asset.user_id
    )
    stmt = (
        select(Asset, User.email, User.name)
        .outerjoin(User, User.id == Asset.user_id)
        .order_by(col(Asset.created_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    if where:
        count_stmt = count_stmt.where(*where)
        stmt = stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(session.exec(stmt).all())
    return rows, total


def get_asset(*, session: Session, asset_id: str) -> Asset | None:
    aid = (asset_id or "").strip()
    if not aid:
        return None
    return session.get(Asset, aid)


def delete_asset(*, session: Session, asset_id: str) -> Asset | None:
    row = get_asset(session=session, asset_id=asset_id)
    if not row:
        return None
    session.delete(row)
    session.commit()
    return row


def count_user_assets(
    *,
    session: Session,
    user_id: str,
    kind: str | None = None,
    sources: tuple[str, ...] | list[str] | None = None,
) -> int:
    where: list[Any] = [Asset.user_id == user_id]
    if kind:
        where.append(Asset.kind == kind)
    if sources:
        where.append(col(Asset.source).in_(list(sources)))
    return int(
        session.exec(select(func.count()).select_from(Asset).where(*where)).one()
        or 0
    )


def list_user_assets(
    *,
    session: Session,
    user_id: str,
    kind: str | None = None,
    sources: tuple[str, ...] | list[str] | None = None,
    offset: int = 0,
    limit: int = 24,
) -> list[Asset]:
    where: list[Any] = [Asset.user_id == user_id]
    if kind:
        where.append(Asset.kind == kind)
    if sources:
        where.append(col(Asset.source).in_(list(sources)))
    return list(
        session.exec(
            select(Asset)
            .where(*where)
            .order_by(col(Asset.created_at).desc())
            .offset(max(0, offset))
            .limit(max(1, limit))
        ).all()
    )


def get_user_asset(
    *, session: Session, user_id: str, asset_id: str
) -> Asset | None:
    return session.exec(
        select(Asset)
        .where(Asset.id == asset_id)
        .where(Asset.user_id == user_id)
        .limit(1)
    ).first()


def create_asset(
    *,
    session: Session,
    asset_id: str,
    user_id: str,
    kind: str,
    object_key: str,
    url: str,
    mime: str | None,
    width: int | None,
    height: int | None,
    source: str,
    prompt: str | None,
    created_at: float,
    meta_json: str | None = None,
) -> Asset:
    row = Asset(
        id=asset_id,
        user_id=user_id,
        kind=kind,
        object_key=object_key,
        url=url,
        mime=mime,
        width=width,
        height=height,
        source=source,
        prompt=prompt,
        meta_json=meta_json,
        created_at=created_at,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_asset_meta_json(
    *,
    session: Session,
    user_id: str,
    asset_id: str,
    meta_json: str,
) -> Asset | None:
    row = get_user_asset(session=session, user_id=user_id, asset_id=asset_id)
    if not row:
        return None
    row.meta_json = meta_json
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_user_asset(
    *, session: Session, user_id: str, asset_id: str
) -> Asset | None:
    row = get_user_asset(session=session, user_id=user_id, asset_id=asset_id)
    if not row:
        return None
    session.delete(row)
    session.commit()
    return row


def list_enabled_design_skills_catalog(*, session: Session) -> list[DesignSkill]:
    return list(
        session.exec(
            select(DesignSkill)
            .where(DesignSkill.enabled == 1)
            .order_by(col(DesignSkill.sort_weight).desc(), col(DesignSkill.id).asc())
        ).all()
    )


def list_enabled_design_skill_groups(*, session: Session) -> list[DesignSkillGroup]:
    return list(
        session.exec(
            select(DesignSkillGroup)
            .where(DesignSkillGroup.enabled == 1)
            .order_by(
                col(DesignSkillGroup.priority).desc(), col(DesignSkillGroup.id).asc()
            )
        ).all()
    )


def get_enabled_design_execute_flow(
    *, session: Session, scene: str
) -> DesignExecuteFlow | None:
    return session.exec(
        select(DesignExecuteFlow)
        .where(DesignExecuteFlow.scene == scene)
        .where(DesignExecuteFlow.enabled == 1)
        .limit(1)
    ).first()


def list_enabled_design_global_rules(
    *, session: Session
) -> list[tuple[str, str]]:
    try:
        rows = session.exec(
            select(DesignGlobalRule.rule_key, DesignGlobalRule.rule_value).where(
                DesignGlobalRule.enabled == 1
            )
        ).all()
    except Exception:
        rows = session.exec(
            select(DesignGlobalRule.rule_key, DesignGlobalRule.rule_value)
        ).all()
    return [(str(k or ""), str(v or "")) for k, v in rows]


def list_enabled_refine_skills(*, session: Session) -> list[DesignSkill]:
    return list(
        session.exec(
            select(DesignSkill)
            .where(DesignSkill.category == "refine")
            .where(DesignSkill.enabled == 1)
            .order_by(col(DesignSkill.sort_weight).desc(), col(DesignSkill.id).desc())
        ).all()
    )


def list_admin_likes(
    *,
    session: Session,
    q: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[tuple[PlazaLike, PlazaSubmission | None, User | None]], int]:
    where: list[Any] = []
    raw = (q or "").strip()
    if raw:
        like = f"%{raw}%"
        where.append(
            (col(PlazaLike.user_id).like(like))
            | (col(PlazaLike.submission_id).like(like))
            | (col(PlazaSubmission.title).like(like))
            | (col(User.email).like(like))
        )
    count_stmt = (
        select(func.count())
        .select_from(PlazaLike)
        .outerjoin(PlazaSubmission, PlazaSubmission.id == PlazaLike.submission_id)
        .outerjoin(User, User.id == PlazaLike.user_id)
    )
    stmt = (
        select(PlazaLike, PlazaSubmission, User)
        .outerjoin(PlazaSubmission, PlazaSubmission.id == PlazaLike.submission_id)
        .outerjoin(User, User.id == PlazaLike.user_id)
        .order_by(col(PlazaLike.created_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    if where:
        count_stmt = count_stmt.where(*where)
        stmt = stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(session.exec(stmt).all())
    return rows, total


def list_admin_plaza_published(
    *,
    session: Session,
    q: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[PlazaSubmission], int]:
    where: list[Any] = [PlazaSubmission.status == "approved"]
    raw = (q or "").strip()
    if raw:
        like = f"%{raw}%"
        where.append(
            (col(PlazaSubmission.title).like(like))
            | (col(PlazaSubmission.author_name).like(like))
            | (col(PlazaSubmission.user_id).like(like))
        )
    count_stmt = select(func.count()).select_from(PlazaSubmission).where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(
        session.exec(
            select(PlazaSubmission)
            .where(*where)
            .order_by(
                col(PlazaSubmission.reviewed_at).desc(),
                col(PlazaSubmission.updated_at).desc(),
            )
            .offset(max(0, offset))
            .limit(max(1, limit))
        ).all()
    )
    return rows, total


def list_admin_users(
    *,
    session: Session,
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[tuple[User, UserBalance | None]], int]:
    where: list[Any] = []
    if q and q.strip():
        like = f"%{q.strip()}%"
        where.append(
            (col(User.email).like(like))
            | (col(User.name).like(like))
            | (col(User.id).like(like))
        )
    if role and role.strip() and role.strip().lower() != "all":
        where.append(User.role == role.strip().lower())
    if status and status.strip() and status.strip().lower() != "all":
        where.append(User.status == status.strip().lower())

    count_stmt = select(func.count()).select_from(User)
    stmt = (
        select(User, UserBalance)
        .outerjoin(UserBalance, UserBalance.user_id == User.id)
        .order_by(col(User.created_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    if where:
        count_stmt = count_stmt.where(*where)
        stmt = stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(session.exec(stmt).all())
    return rows, total


def get_admin_user(
    *, session: Session, user_id: str
) -> tuple[User, UserBalance | None] | None:
    uid = (user_id or "").strip()
    if not uid:
        return None
    return session.exec(
        select(User, UserBalance)
        .outerjoin(UserBalance, UserBalance.user_id == User.id)
        .where(User.id == uid)
    ).first()


def update_admin_user(
    *,
    session: Session,
    user_id: str,
    role: str | None = None,
    status: str | None = None,
    name: str | None = None,
) -> User | None:
    uid = (user_id or "").strip()
    row = session.get(User, uid) if uid else None
    if not row:
        return None
    if role is not None:
        role_n = role.strip().lower()
        if role_n not in ("user", "admin"):
            raise ValueError("invalid_role")
        row.role = role_n
    if status is not None:
        status_n = status.strip().lower()
        if status_n not in ("active", "disabled"):
            raise ValueError("invalid_status")
        row.status = status_n
    if name is not None:
        row.name = name.strip()[:80] or "User"
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def ensure_super_admin_role(*, session: Session) -> None:
    now = time.time()
    rows = list(
        session.exec(
            select(User).where(
                (User.id == "user_super_admin")
                | (func.lower(User.email) == "admin@recombyn.com")
            )
        ).all()
    )
    for row in rows:
        row.role = "admin"
        row.status = "active"
        row.updated_at = now
        session.add(row)
    session.commit()


def create_stage_review(
    *,
    session: Session,
    task_id: str,
    user_id: str,
    scene: str | None,
    skill_index: int,
    skill_id: int | None,
    skill_name: str | None,
    skill_category: str | None,
    rating: int,
    verdict: str,
    comment: str | None,
    preview_svg: str | None,
    tokens: int,
    model_actual: str | None,
    created_at: float,
) -> DesignStageReview:
    row = DesignStageReview(
        task_id=task_id,
        user_id=user_id,
        scene=scene,
        skill_index=skill_index,
        skill_id=skill_id,
        skill_name=skill_name,
        skill_category=skill_category,
        rating=rating,
        verdict=verdict,
        comment=comment,
        preview_svg=preview_svg,
        tokens=tokens,
        model_actual=model_actual,
        created_at=created_at,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_stage_reviews(
    *,
    session: Session,
    skill_id: int | None = None,
    min_rating: int | None = None,
    max_rating: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[DesignStageReview], int]:
    where: list[Any] = []
    if skill_id is not None:
        where.append(DesignStageReview.skill_id == int(skill_id))
    if min_rating is not None:
        where.append(DesignStageReview.rating >= int(min_rating))
    if max_rating is not None:
        where.append(DesignStageReview.rating <= int(max_rating))
    count_stmt = select(func.count()).select_from(DesignStageReview)
    stmt = (
        select(DesignStageReview)
        .order_by(col(DesignStageReview.created_at).desc())
        .offset(max(0, offset))
        .limit(max(1, limit))
    )
    if where:
        count_stmt = count_stmt.where(*where)
        stmt = stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    rows = list(session.exec(stmt).all())
    return rows, total


def list_design_dicts(
    *,
    session: Session,
    dict_type: str | None = None,
    enabled: bool | None = True,
    exclude_type: str | None = None,
) -> list[DesignDict]:
    where: list[Any] = []
    if exclude_type is not None:
        where.append(DesignDict.dict_type != exclude_type)
    if dict_type:
        where.append(DesignDict.dict_type == dict_type.strip())
    if enabled is True:
        where.append(DesignDict.enabled == 1)
    elif enabled is False:
        where.append(DesignDict.enabled == 0)
    stmt = select(DesignDict).order_by(
        col(DesignDict.dict_type).asc(),
        col(DesignDict.sort_order).asc(),
        col(DesignDict.id).asc(),
    )
    if where:
        stmt = stmt.where(*where)
    return list(session.exec(stmt).all())


def get_design_dict(*, session: Session, item_id: int) -> DesignDict | None:
    return session.get(DesignDict, int(item_id))


def get_design_dict_by_type_code(
    *, session: Session, dict_type: str, code: str
) -> DesignDict | None:
    return session.exec(
        select(DesignDict)
        .where(DesignDict.dict_type == dict_type)
        .where(DesignDict.code == code)
    ).first()


def insert_design_layer_locks(
    *,
    session: Session,
    canvas_id: str,
    target_layer_id: str,
    all_layer_ids: list[str],
    now: float | None = None,
) -> None:
    import json as _json

    ts = float(now if now is not None else time.time())
    for lid in all_layer_ids:
        locked = 0 if lid == target_layer_id else 1
        allowed = _json.dumps(["layer_partial"]) if lid == target_layer_id else _json.dumps([])
        forbidden = (
            _json.dumps([])
            if lid == target_layer_id
            else _json.dumps(["position", "size", "structure", "color"])
        )
        session.add(
            DesignLayerLock(
                canvas_id=canvas_id,
                layer_id=lid,
                locked=locked,
                allowed_skills=allowed,
                forbidden_attrs=forbidden,
                created_at=ts,
                updated_at=ts,
            )
        )
    session.commit()


def count_design_token_packs(*, session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(DesignTokenPack)).one() or 0)


def insert_design_token_pack_seed(
    *,
    session: Session,
    name: str,
    scenes: str,
    tokens_json: str,
    is_default: int,
    sort_order: int,
    note: str,
    created_at: float,
) -> DesignTokenPack:
    row = DesignTokenPack(
        name=name,
        scenes=scenes,
        tokens_json=tokens_json,
        is_default=is_default,
        sort_order=sort_order,
        enabled=1,
        note=note,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    return row


def list_design_token_packs(
    *, session: Session, enabled: bool | None = True
) -> list[DesignTokenPack]:
    where: list[Any] = []
    if enabled is not None:
        where.append(DesignTokenPack.enabled == (1 if enabled else 0))
    stmt = select(DesignTokenPack).order_by(
        col(DesignTokenPack.sort_order).asc(), col(DesignTokenPack.id).asc()
    )
    if where:
        stmt = stmt.where(*where)
    return list(session.exec(stmt).all())


def get_design_token_pack(*, session: Session, item_id: int) -> DesignTokenPack | None:
    return session.get(DesignTokenPack, int(item_id))


def upsert_design_token_pack(
    *,
    session: Session,
    item_id: int | None,
    name: str,
    scenes: str,
    tokens_json: str,
    is_default: int,
    sort_order: int,
    enabled: int,
    note: str,
) -> DesignTokenPack:
    now = time.time()
    row = get_design_token_pack(session=session, item_id=item_id) if item_id else None
    if row:
        row.name = name
        row.scenes = scenes
        row.tokens_json = tokens_json
        row.is_default = is_default
        row.sort_order = sort_order
        row.enabled = enabled
        row.note = note
        row.updated_at = now
    else:
        row = DesignTokenPack(
            name=name,
            scenes=scenes,
            tokens_json=tokens_json,
            is_default=is_default,
            sort_order=sort_order,
            enabled=enabled,
            note=note,
            created_at=now,
            updated_at=now,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def soft_delete_design_token_pack(*, session: Session, item_id: int) -> bool:
    row = get_design_token_pack(session=session, item_id=item_id)
    if not row:
        return False
    row.enabled = 0
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    return True


def list_design_system_prompt_keys(*, session: Session) -> set[str]:
    rows = session.exec(select(DesignSystemPrompt.prompt_key)).all()
    return {str(k or "") for k in rows}


def insert_design_system_prompt_seed(
    *,
    session: Session,
    prompt_key: str,
    label: str,
    description: str,
    body: str,
    group_key: str,
    selectable: int,
    sort_order: int,
    created_at: float,
) -> DesignSystemPrompt:
    row = DesignSystemPrompt(
        prompt_key=prompt_key,
        label=label,
        description=description,
        body=body,
        group_key=group_key,
        selectable=selectable,
        sort_order=sort_order,
        enabled=1,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    return row


def get_design_system_prompt(
    *, session: Session, prompt_key: str
) -> DesignSystemPrompt | None:
    return session.exec(
        select(DesignSystemPrompt).where(
            DesignSystemPrompt.prompt_key == str(prompt_key)
        )
    ).first()


def list_design_system_prompts(
    *,
    session: Session,
    group: str | None = None,
    selectable: bool | None = None,
    enabled: bool | None = True,
) -> list[DesignSystemPrompt]:
    where: list[Any] = []
    if enabled is not None:
        where.append(DesignSystemPrompt.enabled == (1 if enabled else 0))
    if group:
        where.append(DesignSystemPrompt.group_key == str(group).strip())
    if selectable is not None:
        where.append(DesignSystemPrompt.selectable == (1 if selectable else 0))
    stmt = select(DesignSystemPrompt).order_by(
        col(DesignSystemPrompt.group_key).asc(),
        col(DesignSystemPrompt.sort_order).asc(),
        col(DesignSystemPrompt.prompt_key).asc(),
    )
    if where:
        stmt = stmt.where(*where)
    return list(session.exec(stmt).all())


def list_enabled_design_system_prompt_bodies(
    *, session: Session
) -> list[tuple[str, str]]:
    rows = session.exec(
        select(DesignSystemPrompt.prompt_key, DesignSystemPrompt.body).where(
            DesignSystemPrompt.enabled == 1
        )
    ).all()
    return [(str(k or ""), str(b or "")) for k, b in rows]


def upsert_design_system_prompt(
    *,
    session: Session,
    prompt_key: str,
    body: str,
    label: str,
    description: str,
    group_key: str,
    selectable: int,
    sort_order: int,
    enabled: int,
) -> DesignSystemPrompt:
    now = time.time()
    row = get_design_system_prompt(session=session, prompt_key=prompt_key)
    if row:
        row.body = body
        row.label = label
        row.description = description
        row.group_key = group_key
        row.selectable = selectable
        row.sort_order = sort_order
        row.enabled = enabled
        row.updated_at = now
    else:
        row = DesignSystemPrompt(
            prompt_key=prompt_key,
            label=label,
            description=description,
            body=body,
            group_key=group_key,
            selectable=selectable,
            sort_order=sort_order,
            enabled=enabled,
            created_at=now,
            updated_at=now,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def patch_design_system_prompt_seed_meta(
    *,
    session: Session,
    prompt_key: str,
    label: str,
    description: str,
    group_key: str,
    selectable: int,
    sort_order: int,
) -> None:
    row = get_design_system_prompt(session=session, prompt_key=prompt_key)
    if not row:
        return
    if not (row.label or "").strip() or row.label == row.prompt_key:
        if label:
            row.label = label
    row.group_key = group_key
    row.selectable = selectable
    row.sort_order = sort_order
    if not (row.description or "").strip() and description:
        row.description = description
    session.add(row)


def get_design_prompt_pack_body(
    *, session: Session, kind: str
) -> str:
    row = session.exec(
        select(DesignPromptPack.body)
        .where(DesignPromptPack.kind == kind)
        .where(DesignPromptPack.enabled == 1)
        .order_by(col(DesignPromptPack.id).asc())
        .limit(1)
    ).first()
    return str(row or "").strip()


def list_design_prompt_pack_kinds(*, session: Session) -> set[str]:
    rows = session.exec(select(DesignPromptPack.kind)).all()
    return {str(k or "").strip() for k in rows if str(k or "").strip()}


def list_enabled_design_prompt_pack_bodies(
    *, session: Session
) -> list[tuple[str, str]]:
    rows = session.exec(
        select(DesignPromptPack.kind, DesignPromptPack.body).where(
            DesignPromptPack.enabled == 1
        )
    ).all()
    return [(str(k or "").strip(), str(b or "")) for k, b in rows]


def list_design_prompt_packs(
    *,
    session: Session,
    kind: str | None = None,
    pack_type: str | None = None,
    enabled: bool | None = True,
) -> list[DesignPromptPack]:
    where: list[Any] = []
    if kind:
        where.append(DesignPromptPack.kind == kind)
    if pack_type:
        where.append(DesignPromptPack.pack_type == pack_type)
    if enabled is not None:
        where.append(DesignPromptPack.enabled == (1 if enabled else 0))
    stmt = select(DesignPromptPack).order_by(
        col(DesignPromptPack.sort_order).asc(), col(DesignPromptPack.id).asc()
    )
    if where:
        stmt = stmt.where(*where)
    return list(session.exec(stmt).all())


def get_design_prompt_pack(*, session: Session, item_id: int) -> DesignPromptPack | None:
    return session.get(DesignPromptPack, int(item_id))


def upsert_design_prompt_pack(
    *,
    session: Session,
    item_id: int | None,
    kind: str,
    pack_type: str,
    title: str,
    body: str,
    when_to_use: str,
    scenes: str,
    used_by: str,
    sort_order: int,
    enabled: int,
) -> DesignPromptPack:
    now = time.time()
    row = get_design_prompt_pack(session=session, item_id=item_id) if item_id else None
    if row:
        row.kind = kind
        row.pack_type = pack_type
        row.title = title
        row.body = body
        row.when_to_use = when_to_use
        row.scenes = scenes
        row.used_by = used_by
        row.sort_order = sort_order
        row.enabled = enabled
        row.updated_at = now
    else:
        row = DesignPromptPack(
            kind=kind,
            pack_type=pack_type,
            title=title,
            body=body,
            when_to_use=when_to_use,
            scenes=scenes,
            used_by=used_by,
            sort_order=sort_order,
            enabled=enabled,
            created_at=now,
            updated_at=now,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_design_prompt_pack(*, session: Session, item_id: int) -> bool:
    row = get_design_prompt_pack(session=session, item_id=item_id)
    if not row:
        return False
    session.delete(row)
    session.commit()
    return True


def list_design_skill_keys_enabled(*, session: Session) -> list[tuple[str, str]]:
    rows = session.exec(
        select(DesignSkill.skill_key, DesignSkill.namespace)
        .where(DesignSkill.enabled == 1)
        .where(col(DesignSkill.skill_key).is_not(None))
        .where(func.trim(DesignSkill.skill_key) != "")
    ).all()
    return [(str(k or ""), str(ns or "")) for k, ns in rows]


def list_design_skills_runtime(
    *, session: Session, enabled_only: bool = True
) -> list[DesignSkill]:
    where: list[Any] = [
        col(DesignSkill.skill_key).is_not(None),
        func.trim(DesignSkill.skill_key) != "",
    ]
    if enabled_only:
        where.append(DesignSkill.enabled == 1)
    return list(
        session.exec(
            select(DesignSkill)
            .where(*where)
            .order_by(col(DesignSkill.sort_weight).desc(), col(DesignSkill.id).asc())
        ).all()
    )


def get_design_skill(*, session: Session, item_id: int) -> DesignSkill | None:
    return session.get(DesignSkill, int(item_id))


def get_design_skill_by_key(
    *, session: Session, skill_key: str
) -> DesignSkill | None:
    return session.exec(
        select(DesignSkill)
        .where(DesignSkill.skill_key == skill_key)
        .limit(1)
    ).first()


def list_design_skills_by_owner(
    *, session: Session, owner_user_id: str, namespace: str
) -> list[DesignSkill]:
    return list(
        session.exec(
            select(DesignSkill)
            .where(DesignSkill.owner_user_id == owner_user_id)
            .where(DesignSkill.namespace == namespace)
            .order_by(
                col(DesignSkill.updated_at).desc(), col(DesignSkill.id).desc()
            )
        ).all()
    )


def get_owned_design_skill_by_key(
    *, session: Session, owner_user_id: str, skill_key: str
) -> DesignSkill | None:
    return session.exec(
        select(DesignSkill)
        .where(DesignSkill.owner_user_id == owner_user_id)
        .where(DesignSkill.skill_key == skill_key)
        .limit(1)
    ).first()


def get_owned_design_skill_by_name_lower(
    *, session: Session, owner_user_id: str, name_lower: str
) -> DesignSkill | None:
    return session.exec(
        select(DesignSkill)
        .where(DesignSkill.owner_user_id == owner_user_id)
        .where(func.lower(DesignSkill.name) == name_lower)
        .order_by(col(DesignSkill.updated_at).desc(), col(DesignSkill.id).desc())
        .limit(1)
    ).first()


def list_user_skill_prefs(
    *, session: Session, user_id: str
) -> list[DesignUserSkillPref]:
    return list(
        session.exec(
            select(DesignUserSkillPref).where(
                DesignUserSkillPref.user_id == user_id
            )
        ).all()
    )


def get_user_skill_pref(
    *, session: Session, user_id: str, skill_key: str
) -> DesignUserSkillPref | None:
    return session.exec(
        select(DesignUserSkillPref)
        .where(DesignUserSkillPref.user_id == user_id)
        .where(DesignUserSkillPref.skill_key == skill_key)
        .limit(1)
    ).first()


def upsert_user_skill_pref(
    *,
    session: Session,
    user_id: str,
    skill_key: str,
    enabled: int,
    commit: bool = True,
) -> DesignUserSkillPref:
    now = time.time()
    row = get_user_skill_pref(
        session=session, user_id=user_id, skill_key=skill_key
    )
    if row:
        row.enabled = enabled
        row.updated_at = now
    else:
        row = DesignUserSkillPref(
            user_id=user_id,
            skill_key=skill_key,
            enabled=enabled,
            updated_at=now,
        )
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    return row


def get_design_skill_revision_snapshot(
    *,
    session: Session,
    skill_key: str,
    version: int | None = None,
    pack_version: str | None = None,
) -> str | None:
    if version is not None:
        row = session.exec(
            select(DesignSkillRevision.snapshot)
            .where(DesignSkillRevision.skill_key == skill_key)
            .where(DesignSkillRevision.version == int(version))
            .order_by(col(DesignSkillRevision.id).desc())
            .limit(1)
        ).first()
    elif pack_version:
        row = session.exec(
            select(DesignSkillRevision.snapshot)
            .where(DesignSkillRevision.skill_key == skill_key)
            .where(DesignSkillRevision.pack_version == str(pack_version))
            .order_by(col(DesignSkillRevision.id).desc())
            .limit(1)
        ).first()
    else:
        return None
    return str(row) if row is not None else None


def insert_design_skill_revision(
    *,
    session: Session,
    skill_id: int,
    skill_key: str,
    namespace: str,
    version: int,
    pack_version: str | None,
    snapshot: str,
    source: str,
    created_at: float,
    commit: bool = False,
) -> None:
    session.add(
        DesignSkillRevision(
            skill_id=skill_id,
            skill_key=skill_key,
            namespace=namespace,
            version=version,
            pack_version=pack_version,
            snapshot=snapshot,
            source=source,
            created_at=created_at,
        )
    )
    if commit:
        session.commit()


def update_design_skill_enabled(
    *,
    session: Session,
    item_id: int,
    owner_user_id: str,
    enabled: int,
    commit: bool = True,
) -> None:
    row = get_design_skill(session=session, item_id=item_id)
    if not row or str(row.owner_user_id or "") != owner_user_id:
        return
    row.enabled = enabled
    row.updated_at = time.time()
    session.add(row)
    if commit:
        session.commit()


def update_end_user_design_skill(
    *,
    session: Session,
    item_id: int,
    owner_user_id: str,
    name: str,
    category: str,
    prompt_positive: str,
    prompt_negative: str | None,
    when_to_use: str | None,
    description: str | None,
    logo: str | None,
    triggers_json: str,
    version: int,
    enabled: int,
) -> DesignSkill | None:
    row = get_design_skill(session=session, item_id=item_id)
    if not row or str(row.owner_user_id or "") != owner_user_id:
        return None
    row.name = name
    row.category = category
    row.prompt_positive = prompt_positive
    row.prompt_negative = prompt_negative
    row.when_to_use = when_to_use
    row.description = description
    row.logo = logo
    row.triggers = triggers_json
    row.version = version
    row.enabled = enabled
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def insert_end_user_design_skill(
    *,
    session: Session,
    skill_key: str,
    name: str,
    category: str,
    prompt_positive: str,
    prompt_negative: str | None,
    when_to_use: str | None,
    triggers_json: str,
    source: str,
    namespace: str,
    owner_user_id: str,
    description: str | None,
    logo: str | None,
    enabled: int,
) -> DesignSkill:
    now = time.time()
    row = DesignSkill(
        skill_key=skill_key,
        name=name,
        category=category,
        prompt_positive=prompt_positive,
        prompt_negative=prompt_negative,
        when_to_use=when_to_use,
        preferred_tools="[]",
        allowed_resources='["tools"]',
        triggers=triggers_json,
        version=1,
        source=source,
        namespace=namespace,
        owner_user_id=owner_user_id,
        description=description,
        logo=logo,
        locales="{}",
        sort_weight=0,
        scenes="all",
        default_model="doubao",
        max_retries=2,
        enabled=enabled,
        output_format="json",
        allow_user_model_override=0,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_owned_design_skill(
    *, session: Session, item_id: int, owner_user_id: str
) -> bool:
    row = get_design_skill(session=session, item_id=item_id)
    if not row or str(row.owner_user_id or "") != owner_user_id:
        return False
    session.delete(row)
    session.commit()
    return True


def update_design_skill_pack_version(
    *,
    session: Session,
    item_id: int,
    owner_user_id: str,
    pack_version: str,
) -> None:
    row = get_design_skill(session=session, item_id=item_id)
    if not row or str(row.owner_user_id or "") != owner_user_id:
        return
    row.pack_version = pack_version
    session.add(row)
    session.commit()


def delete_design_prompt_packs_by_kinds(
    *, session: Session, kinds: list[str] | set[str]
) -> None:
    keys = [str(k).strip() for k in kinds if str(k).strip()]
    if not keys:
        return
    rows = list(
        session.exec(
            select(DesignPromptPack).where(col(DesignPromptPack.kind).in_(keys))
        ).all()
    )
    for row in rows:
        session.delete(row)


def list_design_prompt_packs_by_kind(
    *, session: Session, kind: str
) -> list[DesignPromptPack]:
    return list(
        session.exec(
            select(DesignPromptPack)
            .where(DesignPromptPack.kind == kind)
            .order_by(col(DesignPromptPack.id).asc())
        ).all()
    )


def list_all_design_prompt_packs(*, session: Session) -> list[DesignPromptPack]:
    return list(session.exec(select(DesignPromptPack)).all())


def list_all_design_system_prompts(*, session: Session) -> list[DesignSystemPrompt]:
    return list(session.exec(select(DesignSystemPrompt)).all())


def get_design_task_for_update(
    *, session: Session, task_id: str
) -> DesignTask | None:
    """Load task row with ``FOR UPDATE`` when the dialect supports it."""
    tid = (task_id or "").strip()
    if not tid:
        return None
    stmt = select(DesignTask).where(DesignTask.id == tid)
    try:
        stmt = stmt.with_for_update()
        return session.exec(stmt).first()
    except Exception:
        return session.get(DesignTask, tid)


def ensure_app_migrations_table(*, session: Session) -> None:
    """No-op: ``app_migrations`` is created by Alembic via ``init_schema()``."""
    del session


def app_migration_applied(*, session: Session, migration_id: str) -> bool:
    return session.get(AppMigration, migration_id) is not None


def mark_app_migration(
    *, session: Session, migration_id: str, applied_at: float, commit: bool = True
) -> None:
    session.add(AppMigration(id=migration_id, applied_at=applied_at))
    if commit:
        session.commit()


def delete_all_card_keys(*, session: Session) -> int:
    result = session.execute(delete(CardKey))
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0)


def search_users_directory(
    *,
    session: Session,
    query: str,
    limit: int,
    exclude_user_id: str | None = None,
) -> list[User]:
    like = f"%{query}%"
    where: list[Any] = [
        (col(User.email).like(like))
        | (col(User.name).like(like))
        | (col(User.id).like(like)),
        func.coalesce(User.status, "active") == "active",
    ]
    if exclude_user_id:
        where.append(User.id != exclude_user_id)
    rank = case(
        (User.id == query, 0),
        (User.email == query, 1),
        (User.name == query, 2),
        else_=3,
    )
    return list(
        session.exec(
            select(User)
            .where(*where)
            .order_by(rank.asc(), col(User.created_at).desc())
            .limit(max(1, limit))
        ).all()
    )


def list_users_by_ids(*, session: Session, user_ids: list[str]) -> list[User]:
    if not user_ids:
        return []
    return list(session.exec(select(User).where(col(User.id).in_(user_ids))).all())


def list_decision_log_page(
    *,
    session: Session,
    page: int,
    page_size: int,
    route: str | None = None,
    intent: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> tuple[list[Any], int]:
    """Light decision-log list using JSON extract."""
    where = [
        "meta_json IS NOT NULL",
        "TRIM(meta_json) != ''",
        "json_extract(meta_json, '$.decision_log') IS NOT NULL",
    ]
    params: dict[str, Any] = {}
    n = 0

    def _bind(val: Any) -> str:
        nonlocal n
        key = f"p{n}"
        n += 1
        params[key] = val
        return f":{key}"

    if status and status.strip():
        where.append(f"status = {_bind(status.strip())}")
    if q and q.strip():
        like = f"%{q.strip()}%"
        b1, b2, b3, b4 = (
            _bind(like),
            _bind(like),
            _bind(like),
            _bind(like),
        )
        where.append(
            f"(id LIKE {b1} OR user_id LIKE {b2} OR prompt LIKE {b3} OR "
            f"coalesce(json_extract(meta_json, '$.decision_log.trace_id'), '') LIKE {b4})"
        )
    route_filter = (route or "").strip().lower()
    if route_filter:
        b1 = _bind(route_filter)
        b2 = _bind(route_filter + "%")
        where.append(
            "("
            f"lower(coalesce(json_extract(meta_json, '$.decision_log.route'), '')) = {b1} OR "
            f"lower(coalesce(json_extract(meta_json, '$.decision_log.route'), '')) LIKE {b2}"
            ")"
        )
    intent_filter = (intent or "").strip().lower()
    if intent_filter:
        where.append(
            "lower(coalesce(json_extract(meta_json, '$.decision_log.intent'), '')) = "
            + _bind(intent_filter)
        )

    sql_where = " AND ".join(where)
    count_sql = text(f"SELECT COUNT(*) AS c FROM design_task WHERE {sql_where}")
    total = int(session.execute(count_sql, params).mappings().one().get("c") or 0)

    lim = _bind(max(1, page_size))
    off = _bind(max(0, (max(1, page) - 1) * max(1, page_size)))
    list_sql = text(
        f"""
        SELECT
          id, user_id, scene, status, prompt, error_message, created_at, updated_at,
          json_extract(meta_json, '$.control') AS control,
          json_extract(meta_json, '$.flow_id') AS flow_id,
          json_extract(meta_json, '$.flow_version') AS flow_version,
          json_extract(meta_json, '$.decision_log.trace_id') AS dl_trace,
          json_extract(meta_json, '$.decision_log.route') AS dl_route,
          json_extract(meta_json, '$.decision_log.intent') AS dl_intent,
          json_extract(meta_json, '$.execution_log.ops_count') AS ops_count,
          json_extract(meta_json, '$.execution_log.total_tokens') AS total_tokens,
          json_extract(meta_json, '$.execution_log.total_duration_ms') AS total_duration_ms,
          json_extract(meta_json, '$.execution_log.painted') AS painted,
          json_extract(meta_json, '$.execution_log.task_tier') AS task_tier,
          json_extract(meta_json, '$.execution_log.vision_used') AS vision_used,
          json_extract(meta_json, '$.execution_log.model') AS model,
          json_extract(meta_json, '$.execution_log.skills_loaded') AS el_skills
        FROM design_task
        WHERE {sql_where}
        ORDER BY created_at DESC
        LIMIT {lim} OFFSET {off}
        """
    )
    rows = list(session.execute(list_sql, params).mappings().all())
    return rows, total


def list_all_user_balances(*, session: Session) -> list[UserBalance]:
    return list(session.exec(select(UserBalance)).all())


def scale_positive_user_balances(
    *, session: Session, factor: int, updated_at: float
) -> None:
    rows = list(
        session.exec(select(UserBalance).where(UserBalance.credits > 0)).all()
    )
    for row in rows:
        row.credits = int(row.credits or 0) * int(factor)
        row.updated_at = updated_at
        session.add(row)


def count_fonts(*, session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(Font)).one() or 0)


def list_fonts_page(
    *, session: Session, offset: int, limit: int
) -> list[Font]:
    return list(
        session.exec(
            select(Font)
            .order_by(col(Font.sort_order).asc(), col(Font.family).asc())
            .offset(max(0, offset))
            .limit(max(1, limit))
        ).all()
    )


def get_font_by_family(*, session: Session, family: str) -> Font | None:
    return session.exec(
        select(Font).where(Font.family == family).limit(1)
    ).first()


def get_font(*, session: Session, font_id: str) -> Font | None:
    return session.get(Font, font_id)


def upsert_font_row(
    *,
    session: Session,
    family: str,
    display_name: str,
    faces_json: str,
    sort_order: int | None,
    new_id: str,
    created_at: float,
) -> Font:
    row = get_font_by_family(session=session, family=family)
    if row:
        row.display_name = display_name
        row.faces_json = faces_json
        if sort_order is not None:
            row.sort_order = int(sort_order)
        session.add(row)
    else:
        row = Font(
            id=new_id,
            family=family,
            display_name=display_name,
            faces_json=faces_json,
            sort_order=int(sort_order) if sort_order is not None else 9999,
            created_at=created_at,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_font_by_family(*, session: Session, family: str) -> bool:
    row = get_font_by_family(session=session, family=family)
    if not row:
        return False
    session.delete(row)
    session.commit()
    return True


def count_notices(*, session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(Notice)).one() or 0)


def insert_notice_seed(
    *,
    session: Session,
    notice_id: str,
    kind: str,
    title: str,
    body: str,
    status: str,
    published_at: float,
    created_at: float,
    updated_at: float,
) -> None:
    session.add(
        Notice(
            id=notice_id,
            kind=kind,
            title=title,
            body=body,
            status=status,
            published_at=published_at,
            created_at=created_at,
            updated_at=updated_at,
        )
    )


def list_notices(
    *,
    session: Session,
    kind: str | None = None,
    status: str | None = None,
) -> list[Notice]:
    where: list[Any] = []
    if kind:
        where.append(Notice.kind == kind)
    if status:
        where.append(Notice.status == status)
    stmt = select(Notice).order_by(
        func.coalesce(Notice.published_at, Notice.created_at).desc(),
        col(Notice.created_at).desc(),
    )
    if where:
        stmt = stmt.where(*where)
    return list(session.exec(stmt).all())


def get_notice(*, session: Session, notice_id: str) -> Notice | None:
    return session.get(Notice, notice_id)


def upsert_notice_row(
    *,
    session: Session,
    notice_id: str,
    kind: str,
    title: str,
    body: str,
    status: str,
    published_at: float | None,
    created_at: float,
    updated_at: float,
) -> Notice:
    row = get_notice(session=session, notice_id=notice_id)
    if row:
        row.kind = kind
        row.title = title
        row.body = body
        row.status = status
        row.published_at = published_at
        row.updated_at = updated_at
    else:
        row = Notice(
            id=notice_id,
            kind=kind,
            title=title,
            body=body,
            status=status,
            published_at=published_at,
            created_at=created_at,
            updated_at=updated_at,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_notice(*, session: Session, notice_id: str) -> bool:
    row = get_notice(session=session, notice_id=notice_id)
    if not row:
        return False
    session.delete(row)
    session.commit()
    return True


def get_document_share(*, session: Session, share_id: str) -> DocumentShare | None:
    return session.get(DocumentShare, share_id)


def find_document_share_by_project(
    *, session: Session, owner_id: str, source_project_id: str
) -> DocumentShare | None:
    return session.exec(
        select(DocumentShare)
        .where(DocumentShare.owner_id == owner_id)
        .where(DocumentShare.source_project_id == source_project_id)
        .order_by(col(DocumentShare.updated_at).desc())
        .limit(1)
    ).first()


def upsert_document_share(
    *,
    session: Session,
    share_id: str | None,
    owner_id: str,
    name: str,
    permission: str,
    document_json: str,
    source_project_id: str | None,
    editor_user_ids: str,
    viewer_user_ids: str,
    link_enabled: int,
    link_public: int,
    created_at: float | None = None,
) -> DocumentShare:
    now = time.time()
    row = get_document_share(session=session, share_id=share_id) if share_id else None
    if row:
        row.name = name
        row.permission = permission
        row.document_json = document_json
        row.editor_user_ids = editor_user_ids
        row.viewer_user_ids = viewer_user_ids
        row.link_enabled = link_enabled
        row.link_public = link_public
        row.updated_at = now
    else:
        sid = share_id or ""
        row = DocumentShare(
            id=sid,
            owner_id=owner_id,
            name=name,
            permission=permission,
            document_json=document_json,
            source_project_id=source_project_id,
            editor_user_ids=editor_user_ids,
            viewer_user_ids=viewer_user_ids,
            link_enabled=link_enabled,
            link_public=link_public,
            created_at=created_at if created_at is not None else now,
            updated_at=now,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_document_share_fields(
    *, session: Session, share_id: str, fields: dict[str, Any]
) -> DocumentShare | None:
    row = get_document_share(session=session, share_id=share_id)
    if not row:
        return None
    for key, value in fields.items():
        if hasattr(row, key):
            setattr(row, key, value)
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def sync_document_shares_for_project(
    *,
    session: Session,
    owner_id: str,
    project_id: str,
    document_json: str,
) -> int:
    rows = list(
        session.exec(
            select(DocumentShare)
            .where(DocumentShare.owner_id == owner_id)
            .where(DocumentShare.source_project_id == project_id)
        ).all()
    )
    now = time.time()
    for row in rows:
        row.document_json = document_json
        row.updated_at = now
        session.add(row)
    session.commit()
    return len(rows)


def list_chat_sessions(
    *, session: Session, user_id: str, project_id: str, limit: int
) -> list[ChatSession]:
    return list(
        session.exec(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .where(ChatSession.project_id == project_id)
            .order_by(col(ChatSession.updated_at).desc())
            .limit(max(1, limit))
        ).all()
    )


def list_chat_messages(
    *, session: Session, session_id: str, limit: int
) -> list[ChatMessage]:
    return list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(
                col(ChatMessage.sort_order).asc(), col(ChatMessage.created_at).asc()
            )
            .limit(max(1, limit))
        ).all()
    )


def get_chat_session_owned(
    *, session: Session, session_id: str, user_id: str
) -> ChatSession | None:
    return session.exec(
        select(ChatSession)
        .where(ChatSession.id == session_id)
        .where(ChatSession.user_id == user_id)
        .limit(1)
    ).first()


def upsert_chat_session_with_messages(
    *,
    session: Session,
    user_id: str,
    project_id: str,
    session_id: str,
    title: str,
    updated_at: float,
    created_at: float,
    meta_json: str | None,
    messages: list[dict[str, Any]],
    max_sessions: int,
) -> ChatSession:
    existing = get_chat_session_owned(
        session=session, session_id=session_id, user_id=user_id
    )
    if existing:
        existing.project_id = project_id
        existing.title = title
        existing.updated_at = updated_at
        if meta_json is not None:
            existing.meta_json = meta_json
        session.add(existing)
        for old in list_chat_messages(
            session=session, session_id=session_id, limit=10_000
        ):
            session.delete(old)
        session.flush()
        row = existing
    else:
        row = ChatSession(
            id=session_id,
            user_id=user_id,
            project_id=project_id,
            title=title,
            updated_at=updated_at,
            created_at=created_at,
            meta_json=meta_json,
        )
        session.add(row)
        session.flush()

    for i, m in enumerate(messages):
        session.add(
            ChatMessage(
                id=str(m["id"]),
                session_id=session_id,
                role=str(m["role"]),
                content=str(m.get("content") or ""),
                thinking=m.get("thinking"),
                meta_json=m.get("meta_json"),
                created_at=float(m["created_at"]),
                sort_order=int(m["sort_order"]),
            )
        )

    keep = list_chat_sessions(
        session=session,
        user_id=user_id,
        project_id=project_id,
        limit=max_sessions,
    )
    keep_ids = {str(r.id) for r in keep}
    all_rows = list(
        session.exec(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .where(ChatSession.project_id == project_id)
        ).all()
    )
    for r in all_rows:
        if str(r.id) in keep_ids:
            continue
        for msg in list_chat_messages(
            session=session, session_id=str(r.id), limit=10_000
        ):
            session.delete(msg)
        session.delete(r)

    session.commit()
    session.refresh(row)
    return row


def delete_chat_session_owned(
    *, session: Session, session_id: str, user_id: str
) -> bool:
    row = get_chat_session_owned(
        session=session, session_id=session_id, user_id=user_id
    )
    if not row:
        return False
    for msg in list_chat_messages(
        session=session, session_id=session_id, limit=10_000
    ):
        session.delete(msg)
    session.delete(row)
    session.commit()
    return True


def get_design_canvas_tool(
    *, session: Session, op_key: str
) -> DesignCanvasTool | None:
    return session.exec(
        select(DesignCanvasTool)
        .where(DesignCanvasTool.op_key == op_key)
        .limit(1)
    ).first()


def list_design_canvas_tools(
    *, session: Session, enabled_only: bool = True
) -> list[DesignCanvasTool]:
    stmt = select(DesignCanvasTool).order_by(
        col(DesignCanvasTool.sort_order).asc(), col(DesignCanvasTool.op_key).asc()
    )
    if enabled_only:
        stmt = stmt.where(DesignCanvasTool.enabled == 1)
    return list(session.exec(stmt).all())


def insert_design_canvas_tool(
    *,
    session: Session,
    op_key: str,
    kind: str,
    label: str,
    model_hint: str,
    args_schema: str | None,
    sort_order: int,
    created_at: float,
) -> DesignCanvasTool:
    row = DesignCanvasTool(
        op_key=op_key,
        kind=kind,
        label=label,
        model_hint=model_hint,
        args_schema=args_schema,
        enabled=1,
        sort_order=sort_order,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    return row


def update_design_canvas_tool_fields(
    *,
    session: Session,
    op_key: str,
    fields: dict[str, Any],
    updated_at: float,
) -> DesignCanvasTool | None:
    row = get_design_canvas_tool(session=session, op_key=op_key)
    if not row:
        return None
    for key, value in fields.items():
        if hasattr(row, key):
            setattr(row, key, value)
    row.updated_at = updated_at
    session.add(row)
    return row


def get_design_global_rule_value(
    *, session: Session, rule_key: str
) -> str | None:
    row = session.exec(
        select(DesignGlobalRule).where(DesignGlobalRule.rule_key == rule_key).limit(1)
    ).first()
    if not row:
        return None
    return str(row.rule_value or "")


def upsert_design_global_rule_value(
    *,
    session: Session,
    rule_key: str,
    rule_value: str,
    updated_at: float,
) -> None:
    row = session.exec(
        select(DesignGlobalRule).where(DesignGlobalRule.rule_key == rule_key).limit(1)
    ).first()
    if row:
        row.rule_value = rule_value
        row.updated_at = updated_at
        session.add(row)
    else:
        session.add(
            DesignGlobalRule(
                rule_key=rule_key,
                rule_value=rule_value,
                updated_at=updated_at,
            )
        )


def count_design_skills(*, session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(DesignSkill)).one() or 0)


def count_design_execute_flows(*, session: Session) -> int:
    return int(
        session.exec(select(func.count()).select_from(DesignExecuteFlow)).one() or 0
    )


def update_chat_session_meta_json(
    *,
    session: Session,
    session_id: str,
    user_id: str,
    meta_json: str,
    updated_at: float,
) -> bool:
    row = get_chat_session_owned(
        session=session, session_id=session_id, user_id=user_id
    )
    if not row:
        return False
    row.meta_json = meta_json
    row.updated_at = updated_at
    session.add(row)
    session.commit()
    return True


def upsert_agent_session_snapshot(
    *,
    session: Session,
    session_id: str,
    user_id: str,
    project_id: str,
    task_state_json: str,
    updated_at: float,
    created_at: float,
) -> AgentSessionSnapshot:
    row = session.get(AgentSessionSnapshot, session_id)
    if row:
        row.user_id = user_id
        row.project_id = project_id
        row.task_state_json = task_state_json
        row.updated_at = updated_at
        session.add(row)
    else:
        row = AgentSessionSnapshot(
            session_id=session_id,
            user_id=user_id,
            project_id=project_id,
            task_state_json=task_state_json,
            updated_at=updated_at,
            created_at=created_at,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_latest_agent_session_snapshot_for_project(
    *,
    session: Session,
    user_id: str,
    project_id: str,
    exclude_session_id: str = "",
) -> AgentSessionSnapshot | None:
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if not uid or not pid or pid == "__none__":
        return None
    stmt = (
        select(AgentSessionSnapshot)
        .where(AgentSessionSnapshot.user_id == uid)
        .where(AgentSessionSnapshot.project_id == pid)
    )
    skip = str(exclude_session_id or "").strip()
    if skip:
        stmt = stmt.where(AgentSessionSnapshot.session_id != skip)
    stmt = stmt.order_by(col(AgentSessionSnapshot.updated_at).desc()).limit(1)
    return session.exec(stmt).first()


def list_chat_message_role_content(
    *, session: Session, session_id: str
) -> list[ChatMessage]:
    return list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(
                col(ChatMessage.sort_order).asc(), col(ChatMessage.created_at).asc()
            )
        ).all()
    )


def get_agent_episode(*, session: Session, episode_id: str) -> AgentEpisode | None:
    return session.get(AgentEpisode, episode_id)


def insert_agent_episode(*, session: Session, row: AgentEpisode) -> AgentEpisode:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_agent_episode_embed(
    *,
    session: Session,
    episode_id: str,
    emb: bytes | None = None,
    emb_dim: int = 0,
    emb_model: str = "",
    embed_status: str,
    updated_at: float,
) -> bool:
    row = session.get(AgentEpisode, episode_id)
    if not row:
        return False
    row.emb = emb
    row.emb_dim = int(emb_dim)
    row.emb_model = emb_model
    row.embed_status = embed_status
    row.updated_at = updated_at
    session.add(row)
    session.commit()
    return True


def list_agent_episodes_recent(
    *, session: Session, user_id: str, limit: int
) -> list[AgentEpisode]:
    return list(
        session.exec(
            select(AgentEpisode)
            .where(AgentEpisode.user_id == user_id)
            .where(AgentEpisode.status == "active")
            .order_by(col(AgentEpisode.created_at).desc())
            .limit(max(1, limit))
        ).all()
    )


def get_agent_long_memory(
    *, session: Session, memory_id: str
) -> AgentLongMemory | None:
    return session.get(AgentLongMemory, memory_id)


def insert_agent_long_memory(
    *, session: Session, row: AgentLongMemory
) -> AgentLongMemory:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_agent_long_memory_embed(
    *,
    session: Session,
    memory_id: str,
    emb: bytes | None = None,
    emb_dim: int = 0,
    emb_model: str = "",
    embed_status: str,
    score: float | None = None,
    updated_at: float,
) -> bool:
    row = session.get(AgentLongMemory, memory_id)
    if not row:
        return False
    row.emb = emb
    row.emb_dim = int(emb_dim)
    row.emb_model = emb_model
    row.embed_status = embed_status
    if score is not None:
        row.score = float(score)
    row.updated_at = updated_at
    session.add(row)
    session.commit()
    return True


def list_agent_long_memory_recent(
    *, session: Session, user_id: str, limit: int
) -> list[AgentLongMemory]:
    return list(
        session.exec(
            select(AgentLongMemory)
            .where(AgentLongMemory.user_id == user_id)
            .where(AgentLongMemory.status == "active")
            .order_by(
                col(AgentLongMemory.pinned).desc(),
                col(AgentLongMemory.updated_at).desc(),
            )
            .limit(max(1, limit))
        ).all()
    )


def find_agent_kg_triple_active(
    *,
    session: Session,
    user_id: str,
    subject: str,
    predicate: str,
    object_: str,
) -> AgentKgTriple | None:
    return session.exec(
        select(AgentKgTriple)
        .where(AgentKgTriple.user_id == user_id)
        .where(AgentKgTriple.subject == subject)
        .where(AgentKgTriple.predicate == predicate)
        .where(AgentKgTriple.object == object_)
        .where(AgentKgTriple.status == "active")
        .limit(1)
    ).first()


def upsert_agent_kg_triple_weight(
    *,
    session: Session,
    user_id: str,
    subject: str,
    predicate: str,
    object_: str,
    weight_delta: float,
    source: str,
    now: float,
) -> str:
    row = find_agent_kg_triple_active(
        session=session,
        user_id=user_id,
        subject=subject,
        predicate=predicate,
        object_=object_,
    )
    if row:
        w = float(row.weight or 1.0) + float(weight_delta)
        row.weight = min(w, 99.0)
        row.source = source[:32]
        row.updated_at = now
        session.add(row)
        session.commit()
        return str(row.id)

    tid = f"kg_{uuid.uuid4().hex[:18]}"
    session.add(
        AgentKgTriple(
            id=tid,
            user_id=user_id,
            subject=subject,
            predicate=predicate,
            object=object_,
            weight=max(0.1, float(weight_delta)),
            source=source[:32],
            status="active",
            created_at=now,
            updated_at=now,
        )
    )
    session.commit()
    return tid


def list_agent_kg_triples_for_retrieve(
    *, session: Session, user_id: str, limit: int = 300
) -> list[AgentKgTriple]:
    return list(
        session.exec(
            select(AgentKgTriple)
            .where(AgentKgTriple.user_id == user_id)
            .where(AgentKgTriple.status == "active")
            .order_by(
                col(AgentKgTriple.weight).desc(),
                col(AgentKgTriple.updated_at).desc(),
            )
            .limit(max(1, limit))
        ).all()
    )


def count_agent_kg_triples_active(
    *, session: Session, user_id: str | None = None
) -> int:
    stmt = select(func.count()).select_from(AgentKgTriple).where(
        AgentKgTriple.status == "active"
    )
    if user_id:
        stmt = stmt.where(AgentKgTriple.user_id == user_id)
    return int(session.exec(stmt).one() or 0)


def list_agent_kg_triples_admin(
    *,
    session: Session,
    user_id: str | None,
    limit: int,
    offset: int,
) -> list[AgentKgTriple]:
    stmt = select(AgentKgTriple).where(AgentKgTriple.status == "active")
    if user_id:
        stmt = stmt.where(AgentKgTriple.user_id == user_id)
    return list(
        session.exec(
            stmt.order_by(col(AgentKgTriple.updated_at).desc())
            .limit(max(1, limit))
            .offset(max(0, offset))
        ).all()
    )


def soft_delete_agent_kg_triple(
    *, session: Session, triple_id: str, updated_at: float
) -> bool:
    row = session.get(AgentKgTriple, triple_id)
    if not row or str(row.status or "") != "active":
        return False
    row.status = "revoked"
    row.updated_at = updated_at
    session.add(row)
    session.commit()
    return True


def list_admin_design_skills(
    *,
    session: Session,
    q: str | None = None,
    enabled: bool | None = None,
    source: str | None = None,
) -> list[DesignSkill]:
    stmt = select(DesignSkill)
    if source is not None and str(source).strip():
        stmt = stmt.where(DesignSkill.source == str(source).strip().lower())
    if enabled is True:
        stmt = stmt.where(DesignSkill.enabled == 1)
    elif enabled is False:
        stmt = stmt.where(DesignSkill.enabled == 0)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (col(DesignSkill.name).like(like))
            | (col(DesignSkill.category).like(like))
            | (col(DesignSkill.scenes).like(like))
            | (col(DesignSkill.skill_key).like(like))
        )
    return list(
        session.exec(
            stmt.order_by(
                col(DesignSkill.sort_weight).desc(), col(DesignSkill.id).asc()
            )
        ).all()
    )


def delete_admin_design_skill(*, session: Session, skill_id: int) -> DesignSkill | None:
    row = get_design_skill(session=session, item_id=int(skill_id))
    if not row:
        return None
    session.delete(row)
    session.commit()
    return row


def insert_admin_design_skill(
    *, session: Session, row: DesignSkill
) -> DesignSkill:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_admin_design_skill(
    *,
    session: Session,
    skill_id: int,
    fields: dict[str, Any],
    updated_at: float,
) -> DesignSkill | None:
    row = get_design_skill(session=session, item_id=int(skill_id))
    if not row:
        return None
    for key, value in fields.items():
        if hasattr(row, key):
            setattr(row, key, value)
    row.updated_at = updated_at
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_all_design_global_rules(*, session: Session) -> list[DesignGlobalRule]:
    return list(
        session.exec(
            select(DesignGlobalRule).order_by(col(DesignGlobalRule.rule_key).asc())
        ).all()
    )


def get_design_global_rule(
    *, session: Session, rule_key: str
) -> DesignGlobalRule | None:
    return session.exec(
        select(DesignGlobalRule)
        .where(DesignGlobalRule.rule_key == rule_key)
        .limit(1)
    ).first()


def upsert_design_global_rule(
    *,
    session: Session,
    rule_key: str,
    rule_value: str,
    description: str,
    enabled: int,
    updated_at: float,
) -> DesignGlobalRule:
    row = get_design_global_rule(session=session, rule_key=rule_key)
    if row:
        row.rule_value = rule_value
        row.description = description
        row.enabled = enabled
        row.updated_at = updated_at
        session.add(row)
    else:
        row = DesignGlobalRule(
            rule_key=rule_key,
            rule_value=rule_value,
            description=description,
            enabled=enabled,
            updated_at=updated_at,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_all_design_execute_flows(*, session: Session) -> list[DesignExecuteFlow]:
    return list(
        session.exec(
            select(DesignExecuteFlow).order_by(col(DesignExecuteFlow.scene).asc())
        ).all()
    )


def filter_existing_design_skill_ids(
    *, session: Session, skill_ids: list[int]
) -> list[int]:
    if not skill_ids:
        return []
    found = set(
        session.exec(
            select(DesignSkill.id).where(col(DesignSkill.id).in_(skill_ids))
        ).all()
    )
    return [i for i in skill_ids if i in found]


def upsert_design_execute_flow(
    *,
    session: Session,
    scene: str,
    skill_ids_json: str,
    force_validate_flags: str,
    step_token_caps: str,
    fail_strategy: str,
    enabled: int,
    now: float,
) -> DesignExecuteFlow:
    row = session.exec(
        select(DesignExecuteFlow).where(DesignExecuteFlow.scene == scene).limit(1)
    ).first()
    if row:
        row.skill_ids = skill_ids_json
        row.force_validate_flags = force_validate_flags
        row.step_token_caps = step_token_caps
        row.fail_strategy = fail_strategy
        row.enabled = enabled
        row.updated_at = now
        session.add(row)
    else:
        row = DesignExecuteFlow(
            scene=scene,
            skill_ids=skill_ids_json,
            force_validate_flags=force_validate_flags,
            step_token_caps=step_token_caps,
            fail_strategy=fail_strategy,
            enabled=enabled,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def upsert_design_canvas_tool(
    *,
    session: Session,
    op_key: str,
    kind: str,
    label: str,
    model_hint: str,
    args_schema: str | None,
    enabled: int,
    sort_order: int,
    now: float,
) -> DesignCanvasTool:
    row = get_design_canvas_tool(session=session, op_key=op_key)
    if row:
        row.kind = kind
        row.label = label
        row.model_hint = model_hint
        if args_schema is not None:
            row.args_schema = args_schema
        row.enabled = enabled
        row.sort_order = sort_order
        row.updated_at = now
        session.add(row)
    else:
        row = DesignCanvasTool(
            op_key=op_key,
            kind=kind,
            label=label,
            model_hint=model_hint,
            args_schema=args_schema,
            enabled=enabled,
            sort_order=sort_order,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_llm_models(
    *,
    session: Session,
    kind: str | None = None,
    enabled_only: bool = False,
    q: str | None = None,
) -> list[LlmModel]:
    stmt = select(LlmModel)
    k = (kind or "").strip().lower()
    if k in ("text", "image", "video", "audio"):
        stmt = stmt.where(LlmModel.kind == k)
    if enabled_only:
        stmt = stmt.where(LlmModel.enabled == 1)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (col(LlmModel.id).like(like))
            | (col(LlmModel.label).like(like))
            | (col(LlmModel.api_model).like(like))
            | (col(LlmModel.provider).like(like))
        )
    return list(
        session.exec(
            stmt.order_by(
                col(LlmModel.sort_order).asc(), col(LlmModel.updated_at).desc()
            )
        ).all()
    )


def get_llm_model(*, session: Session, model_id: str) -> LlmModel | None:
    mid = (model_id or "").strip()
    if not mid:
        return None
    return session.get(LlmModel, mid)


def upsert_llm_model(*, session: Session, row: LlmModel) -> LlmModel:
    existing = session.get(LlmModel, row.id)
    if existing:
        for name in (
            "label",
            "description",
            "provider",
            "kind",
            "api_model",
            "icon_key",
            "icon_url",
            "price",
            "max_attachments",
            "thinking",
            "enabled",
            "sort_order",
            "reference_types",
            "image_limits",
            "price_meta",
            "pricing_id",
            "updated_at",
        ):
            setattr(existing, name, getattr(row, name))
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def clear_llm_model_removed(*, session: Session, model_id: str) -> None:
    row = session.get(LlmModelRemoved, model_id)
    if row:
        session.delete(row)
        session.commit()


def delete_llm_model(
    *, session: Session, model_id: str, removed_at: float
) -> bool:
    mid = (model_id or "").strip()
    if not mid:
        return False
    row = session.get(LlmModel, mid)
    deleted = False
    if row:
        session.delete(row)
        deleted = True
    tomb = session.get(LlmModelRemoved, mid)
    if tomb:
        tomb.removed_at = removed_at
        session.add(tomb)
    else:
        session.add(LlmModelRemoved(id=mid, removed_at=removed_at))
    session.commit()
    return deleted


def insert_model_usage(*, session: Session, row: ModelUsage) -> ModelUsage:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_model_usage_rows(
    *,
    session: Session,
    page: int,
    page_size: int,
    source: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    user_id: str | None = None,
    status: str | None = None,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> tuple[list[ModelUsage], int]:
    where: list[Any] = []
    if source:
        where.append(ModelUsage.source == source)
    if provider:
        where.append(ModelUsage.provider == provider)
    if model:
        where.append(
            (ModelUsage.catalog_model_id == model)
            | (ModelUsage.api_model == model)
            | (col(ModelUsage.api_model).like(f"%{model}%"))
        )
    if user_id:
        where.append(ModelUsage.user_id == user_id)
    if status:
        where.append(ModelUsage.status == status)
    if ts_from is not None:
        where.append(ModelUsage.created_at >= float(ts_from))
    if ts_to is not None:
        where.append(ModelUsage.created_at <= float(ts_to))

    count_stmt = select(func.count()).select_from(ModelUsage)
    list_stmt = select(ModelUsage)
    if where:
        count_stmt = count_stmt.where(*where)
        list_stmt = list_stmt.where(*where)
    total = int(session.exec(count_stmt).one() or 0)
    offset = (max(1, page) - 1) * max(1, page_size)
    rows = list(
        session.exec(
            list_stmt.order_by(col(ModelUsage.created_at).desc())
            .limit(max(1, page_size))
            .offset(max(0, offset))
        ).all()
    )
    return rows, total


def list_model_usage_for_task_rows(
    *, session: Session, task_id: str, limit: int
) -> list[ModelUsage]:
    return list(
        session.exec(
            select(ModelUsage)
            .where(ModelUsage.task_id == task_id)
            .order_by(col(ModelUsage.created_at).asc())
            .limit(max(1, limit))
        ).all()
    )


def count_design_tasks(*, session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(DesignTask)).one() or 0)


def count_design_tasks_by_status(
    *, session: Session, statuses: list[str]
) -> int:
    if not statuses:
        return 0
    return int(
        session.exec(
            select(func.count())
            .select_from(DesignTask)
            .where(col(DesignTask.status).in_(statuses))
        ).one()
        or 0
    )


def sum_design_task_total_tokens(*, session: Session) -> int:
    return int(
        session.exec(select(func.coalesce(func.sum(DesignTask.total_tokens), 0))).one()
        or 0
    )


def sum_design_task_charged_credits(*, session: Session) -> int:
    return int(
        session.exec(
            select(func.coalesce(func.sum(DesignTask.charged_credits), 0))
        ).one()
        or 0
    )


def list_recent_design_tasks(
    *, session: Session, limit: int = 500
) -> list[DesignTask]:
    return list(
        session.exec(
            select(DesignTask)
            .order_by(col(DesignTask.created_at).desc())
            .limit(max(1, limit))
        ).all()
    )


def list_design_tasks_with_meta(*, session: Session) -> list[DesignTask]:
    return list(
        session.exec(
            select(DesignTask).where(
                col(DesignTask.meta_json).is_not(None),
                func.trim(DesignTask.meta_json) != "",
            )
        ).all()
    )


def update_design_task_meta_json(
    *,
    session: Session,
    task_id: str,
    meta_json: str,
    updated_at: float,
) -> None:
    row = session.get(DesignTask, task_id)
    if not row:
        return
    row.meta_json = meta_json
    row.updated_at = updated_at
    session.add(row)


def list_design_global_rule_keys(*, session: Session) -> set[str]:
    return {
        str(k)
        for k in session.exec(select(DesignGlobalRule.rule_key)).all()
        if k
    }


def insert_design_global_rule_if_missing(
    *,
    session: Session,
    rule_key: str,
    rule_value: str,
    description: str,
    updated_at: float,
) -> bool:
    existing = get_design_global_rule(session=session, rule_key=rule_key)
    if existing:
        return False
    session.add(
        DesignGlobalRule(
            rule_key=rule_key,
            rule_value=rule_value,
            description=description,
            enabled=1,
            updated_at=updated_at,
        )
    )
    return True


def fill_empty_design_global_rule_descriptions(
    *, session: Session, descriptions: dict[str, str]
) -> None:
    for key, desc in descriptions.items():
        if not desc:
            continue
        row = get_design_global_rule(session=session, rule_key=key)
        if not row:
            continue
        if row.description:
            continue
        row.description = desc
        session.add(row)


def list_optimize_patches(
    *, session: Session, status: str | None = None, limit: int = 100
) -> list[DesignOptimizePatch]:
    stmt = select(DesignOptimizePatch)
    if status:
        stmt = stmt.where(DesignOptimizePatch.status == status)
    return list(
        session.exec(
            stmt.order_by(col(DesignOptimizePatch.id).desc()).limit(max(1, limit))
        ).all()
    )


def get_optimize_patch(
    *, session: Session, patch_id: int
) -> DesignOptimizePatch | None:
    return session.get(DesignOptimizePatch, int(patch_id))


def find_pending_optimize_patch_by_fingerprint(
    *, session: Session, fingerprint: str
) -> DesignOptimizePatch | None:
    return session.exec(
        select(DesignOptimizePatch)
        .where(DesignOptimizePatch.fingerprint == fingerprint)
        .where(DesignOptimizePatch.status == "pending")
        .limit(1)
    ).first()


def insert_optimize_patch(
    *, session: Session, row: DesignOptimizePatch
) -> DesignOptimizePatch:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_optimize_patch_status(
    *,
    session: Session,
    patch_id: int,
    status: str,
    updated_at: float,
    applied_at: float | None = None,
) -> DesignOptimizePatch | None:
    row = get_optimize_patch(session=session, patch_id=patch_id)
    if not row:
        return None
    row.status = status
    row.updated_at = updated_at
    if applied_at is not None:
        row.applied_at = applied_at
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def summarize_model_usage_rows(
    *,
    session: Session,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> dict[str, Any]:
    where: list[Any] = []
    if ts_from is not None:
        where.append(ModelUsage.created_at >= float(ts_from))
    if ts_to is not None:
        where.append(ModelUsage.created_at <= float(ts_to))

    ok_case = func.sum(case((ModelUsage.status == "ok", 1), else_=0))
    fail_case = func.sum(case((ModelUsage.status != "ok", 1), else_=0))

    totals_stmt = select(
        func.count().label("calls"),
        func.coalesce(ok_case, 0).label("ok"),
        func.coalesce(fail_case, 0).label("failed"),
        func.coalesce(func.sum(ModelUsage.prompt_tokens), 0).label("prompt_tokens"),
        func.coalesce(func.sum(ModelUsage.completion_tokens), 0).label(
            "completion_tokens"
        ),
        func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("total_tokens"),
        func.coalesce(func.sum(ModelUsage.image_count), 0).label("images"),
        func.coalesce(func.sum(ModelUsage.credits_charged), 0).label("credits"),
        func.coalesce(func.sum(ModelUsage.cost_cny), 0).label("cost_cny"),
        func.coalesce(func.avg(ModelUsage.latency_ms), 0).label("avg_latency_ms"),
    )
    if where:
        totals_stmt = totals_stmt.where(*where)
    totals = session.exec(totals_stmt).one()

    model_key = func.coalesce(
        func.nullif(ModelUsage.catalog_model_id, ""),
        ModelUsage.api_model,
        "unknown",
    )
    by_model_stmt = (
        select(
            model_key.label("model"),
            func.coalesce(ModelUsage.provider, "").label("provider"),
            func.count().label("calls"),
            func.coalesce(fail_case, 0).label("failed"),
            func.coalesce(func.sum(ModelUsage.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(ModelUsage.completion_tokens), 0).label(
                "completion_tokens"
            ),
            func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(ModelUsage.image_count), 0).label("images"),
            func.coalesce(func.sum(ModelUsage.credits_charged), 0).label("credits"),
            func.coalesce(func.sum(ModelUsage.cost_cny), 0).label("cost_cny"),
            func.coalesce(func.avg(ModelUsage.latency_ms), 0).label("avg_latency_ms"),
        )
        .group_by(model_key, func.coalesce(ModelUsage.provider, ""))
        .order_by(
            func.coalesce(func.sum(ModelUsage.total_tokens), 0).desc(),
            func.count().desc(),
        )
        .limit(100)
    )
    if where:
        by_model_stmt = by_model_stmt.where(*where)

    by_source_stmt = (
        select(
            func.coalesce(ModelUsage.source, "unknown").label("source"),
            func.count().label("calls"),
            func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(ModelUsage.image_count), 0).label("images"),
            func.coalesce(func.sum(ModelUsage.credits_charged), 0).label("credits"),
            func.coalesce(func.sum(ModelUsage.cost_cny), 0).label("cost_cny"),
        )
        .group_by(func.coalesce(ModelUsage.source, "unknown"))
        .order_by(func.count().desc())
    )
    if where:
        by_source_stmt = by_source_stmt.where(*where)

    provider_key = func.coalesce(func.nullif(ModelUsage.provider, ""), "unknown")
    by_provider_stmt = (
        select(
            provider_key.label("provider"),
            func.count().label("calls"),
            func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(ModelUsage.cost_cny), 0).label("cost_cny"),
            func.coalesce(func.sum(ModelUsage.credits_charged), 0).label("credits"),
        )
        .group_by(provider_key)
        .order_by(func.count().desc())
    )
    if where:
        by_provider_stmt = by_provider_stmt.where(*where)

    return {
        "totals": totals,
        "by_model": list(session.exec(by_model_stmt).all()),
        "by_source": list(session.exec(by_source_stmt).all()),
        "by_provider": list(session.exec(by_provider_stmt).all()),
    }


def _model_usage_meta_json_path_sql(key: str) -> str:
    """Dialect-aware SQL for a string field inside model_usage.meta_json."""
    from app.services.db import dialect

    safe = "".join(ch for ch in str(key or "") if ch.isalnum() or ch == "_")
    if not safe:
        safe = "via"
    path = f"$.{safe}"
    if dialect() == "mysql":
        return f"JSON_UNQUOTE(JSON_EXTRACT(meta_json, '{path}'))"
    return f"json_extract(meta_json, '{path}')"


def list_model_usage_rows_json_meta(
    *,
    session: Session,
    page: int,
    page_size: int,
    source: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    user_id: str | None = None,
    status: str | None = None,
    via: str | None = None,
    kind: str | None = None,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> tuple[list[Any], int]:
    """List model_usage with optional via/kind JSON meta filters."""
    where: list[str] = []
    params: dict[str, Any] = {}
    n = 0

    def _bind(val: Any) -> str:
        nonlocal n
        key = f"p{n}"
        n += 1
        params[key] = val
        return f":{key}"

    if source:
        where.append(f"source = {_bind(source)}")
    if provider:
        where.append(f"provider = {_bind(provider)}")
    if model:
        b1, b2, b3 = _bind(model), _bind(model), _bind(f"%{model}%")
        where.append(f"(catalog_model_id = {b1} OR api_model = {b2} OR api_model LIKE {b3})")
    if user_id:
        where.append(f"user_id = {_bind(user_id)}")
    if status:
        where.append(f"status = {_bind(status)}")
    if via:
        via_expr = _model_usage_meta_json_path_sql("via")
        where.append(f"COALESCE(NULLIF({via_expr}, ''), 'unknown') = {_bind(via)}")
    if kind:
        kind_expr = _model_usage_meta_json_path_sql("kind")
        where.append(f"COALESCE(NULLIF({kind_expr}, ''), 'unknown') = {_bind(kind)}")
    if ts_from is not None:
        where.append(f"created_at >= {_bind(float(ts_from))}")
    if ts_to is not None:
        where.append(f"created_at <= {_bind(float(ts_to))}")

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = int(
        session.execute(text(f"SELECT COUNT(*) AS c FROM model_usage{clause}"), params)
        .mappings()
        .one()
        .get("c")
        or 0
    )
    lim = _bind(max(1, page_size))
    off = _bind(max(0, (max(1, page) - 1) * max(1, page_size)))
    rows = list(
        session.execute(
            text(
                f"""
                SELECT id, created_at, user_id, task_id, source, provider,
                       catalog_model_id, api_model, status, latency_ms,
                       prompt_tokens, completion_tokens, total_tokens,
                       cached_tokens, reasoning_tokens, image_count,
                       credits_charged, cost_cny, provider_request_id,
                       usage_json, meta_json, error
                FROM model_usage
                {clause}
                ORDER BY created_at DESC
                LIMIT {lim} OFFSET {off}
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    return rows, total


def summarize_model_usage_by_via_kind(
    *,
    session: Session,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> dict[str, list[Any]]:
    where: list[str] = []
    params: dict[str, Any] = {}
    n = 0

    def _bind(val: Any) -> str:
        nonlocal n
        key = f"p{n}"
        n += 1
        params[key] = val
        return f":{key}"

    if ts_from is not None:
        where.append(f"created_at >= {_bind(float(ts_from))}")
    if ts_to is not None:
        where.append(f"created_at <= {_bind(float(ts_to))}")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    via_expr = _model_usage_meta_json_path_sql("via")
    kind_expr = _model_usage_meta_json_path_sql("kind")
    via_group = f"COALESCE(NULLIF({via_expr}, ''), 'unknown')"
    kind_group = f"COALESCE(NULLIF({kind_expr}, ''), 'unknown')"
    by_via = list(
        session.execute(
            text(
                f"""
                SELECT
                  {via_group} AS via,
                  COUNT(*) AS calls,
                  COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS failed,
                  COALESCE(SUM(total_tokens), 0) AS total_tokens,
                  COALESCE(SUM(credits_charged), 0) AS credits,
                  COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
                FROM model_usage
                {clause}
                GROUP BY {via_group}
                ORDER BY calls DESC
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    by_kind = list(
        session.execute(
            text(
                f"""
                SELECT
                  {kind_group} AS kind,
                  COUNT(*) AS calls,
                  COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS failed,
                  COALESCE(SUM(total_tokens), 0) AS total_tokens,
                  COALESCE(SUM(credits_charged), 0) AS credits,
                  COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
                FROM model_usage
                {clause}
                GROUP BY {kind_group}
                ORDER BY calls DESC
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    return {"by_via": by_via, "by_kind": by_kind}


def list_tasks_for_svg_cold_archive(
    *, session: Session, cutoff: float, take: int
) -> list[DesignTask]:
    return list(
        session.exec(
            select(DesignTask)
            .where(DesignTask.created_at < float(cutoff))
            .where(col(DesignTask.result_svg).is_not(None))
            .where(func.length(DesignTask.result_svg) > 200)
            .order_by(col(DesignTask.created_at).asc())
            .limit(max(1, take))
        ).all()
    )


def list_messages_for_thinking_cold_archive(
    *, session: Session, cutoff: float, take: int
) -> list[ChatMessage]:
    return list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.created_at < float(cutoff))
            .where(col(ChatMessage.thinking).is_not(None))
            .where(func.length(ChatMessage.thinking) > 400)
            .order_by(col(ChatMessage.created_at).asc())
            .limit(max(1, take))
        ).all()
    )


def insert_design_cold_blob(*, session: Session, row: DesignColdBlob) -> DesignColdBlob:
    session.add(row)
    return row


def clear_design_task_result_svg(
    *, session: Session, task_id: str, updated_at: float
) -> None:
    task = session.get(DesignTask, task_id)
    if not task:
        return
    task.result_svg = None
    task.updated_at = updated_at
    session.add(task)


def clear_chat_message_thinking(*, session: Session, message_id: str) -> None:
    msg = session.get(ChatMessage, message_id)
    if not msg:
        return
    msg.thinking = None
    session.add(msg)



def delete_design_global_rules_by_keys(
    *, session: Session, keys: list[str]
) -> None:
    for key in keys:
        row = get_design_global_rule(session=session, rule_key=key)
        if row is not None:
            session.delete(row)


def list_byok_providers_for_user(
    *, session: Session, user_id: str
) -> list[UserByokProvider]:
    return list(
        session.exec(
            select(UserByokProvider)
            .where(UserByokProvider.user_id == user_id)
            .order_by(col(UserByokProvider.updated_at).desc())
        ).all()
    )


def get_byok_provider(
    *, session: Session, user_id: str, provider_id: str
) -> UserByokProvider | None:
    row = session.get(UserByokProvider, provider_id)
    if not row or row.user_id != user_id:
        return None
    return row


def upsert_byok_provider_row(
    *, session: Session, row: UserByokProvider
) -> UserByokProvider:
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def delete_byok_provider_row(
    *, session: Session, user_id: str, provider_id: str
) -> bool:
    result = session.execute(
        delete(UserByokProvider).where(
            UserByokProvider.id == provider_id,
            UserByokProvider.user_id == user_id,
        )
    )
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0) > 0


def heal_official_plaza_avatars(
    *, session: Session, user_id: str, avatar: str
) -> int:
    rows = list(
        session.exec(
            select(PlazaSubmission)
            .where(PlazaSubmission.user_id == user_id)
            .where(
                (col(PlazaSubmission.author_avatar).is_(None))
                | (PlazaSubmission.author_avatar == "")
            )
        ).all()
    )
    for row in rows:
        row.author_avatar = avatar
        session.add(row)
    session.commit()
    return len(rows)


def list_all_plaza_submissions_for_cover_heal(
    *, session: Session
) -> list[PlazaSubmission]:
    return list(session.exec(select(PlazaSubmission)).all())


def update_plaza_submission_document_cover(
    *,
    session: Session,
    submission_id: str,
    document_json: str,
    cover_json: str,
) -> None:
    row = session.get(PlazaSubmission, submission_id)
    if not row:
        return
    row.document_json = document_json
    row.cover_json = cover_json
    session.add(row)
