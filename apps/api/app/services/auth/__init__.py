"""Persistent auth sessions via SQLModel + ``app.crud``."""

from __future__ import annotations

import secrets
import time

from sqlmodel import Session

from app import crud
from app.services.auth.email_store import get_user_by_id, heal_avatar_if_data_url, upsert_oauth_user
from app.services.db import init_schema
from app.services.wallet.db import ensure_user_balance

_TTL_SECONDS = 60 * 60 * 24 * 14  # 14 days


class SessionUser:
    """API-facing session principal (stable for routes; backed by SQLModel ``User``)."""

    __slots__ = ("id", "email", "name", "avatar", "provider", "bio", "role", "status")

    def __init__(
        self,
        id: str,
        email: str,
        name: str,
        avatar: str | None,
        provider: str,
        bio: str | None = None,
        role: str = "user",
        status: str = "active",
    ) -> None:
        self.id = id
        self.email = email
        self.name = name
        self.avatar = avatar
        self.provider = provider
        self.bio = bio
        self.role = role
        self.status = status


def create_session(user: SessionUser) -> tuple[SessionUser, str]:
    """Persist user (OAuth upsert preserves in-app profile) and return (session user, token)."""
    from app.core.db import engine

    init_schema()
    sub = user.id.replace("google:", "", 1) if user.id.startswith("google:") else None
    persisted = upsert_oauth_user(
        user_id=user.id,
        email=user.email,
        name=user.name,
        avatar=user.avatar,
        provider=user.provider,
        google_sub=sub if user.provider == "google" else None,
    )
    ensure_user_balance(persisted.id, starting_credits=0)
    token = secrets.token_urlsafe(32)
    with Session(engine) as session:
        crud.create_auth_session(
            session=session,
            token=token,
            user_id=persisted.id,
            ttl_seconds=_TTL_SECONDS,
        )
    fresh = get_user_by_id(persisted.id) or persisted
    return (
        SessionUser(
            id=fresh.id,
            email=fresh.email,
            name=fresh.name,
            avatar=fresh.avatar,
            provider=fresh.provider,
            bio=fresh.bio,
            role=getattr(fresh, "role", None) or "user",
            status=getattr(fresh, "status", None) or "active",
        ),
        token,
    )


def get_session(token: str | None, *, db: Session | None = None) -> SessionUser | None:
    if not token:
        return None
    from app.core.db import engine

    init_schema()
    now = time.time()
    own = db is None
    session = db if db is not None else Session(engine)
    try:
        row = crud.get_auth_session(session=session, token=token)
        if not row:
            return None
        if float(row.expires_at) < now:
            session.delete(row)
            session.commit()
            return None
        user = crud.get_user_by_id(session=session, user_id=row.user_id)
        if not user:
            return None
        status = (user.status or "active").strip().lower()
        if status == "disabled":
            return None
        email_user = get_user_by_id(user.id)
        if email_user:
            email_user = heal_avatar_if_data_url(email_user)
            return SessionUser(
                id=email_user.id,
                email=email_user.email,
                name=email_user.name,
                avatar=email_user.avatar,
                provider=email_user.provider,
                bio=email_user.bio,
                role=getattr(email_user, "role", None) or "user",
                status=getattr(email_user, "status", None) or "active",
            )
        return SessionUser(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar=user.avatar,
            provider=user.provider,
            bio=user.bio,
            role=user.role or "user",
            status=user.status or "active",
        )
    finally:
        if own:
            session.close()


def revoke_session(token: str | None, *, db: Session | None = None) -> None:
    if not token:
        return
    from app.core.db import engine

    init_schema()
    own = db is None
    session = db if db is not None else Session(engine)
    try:
        crud.delete_auth_session(session=session, token=token)
    finally:
        if own:
            session.close()
