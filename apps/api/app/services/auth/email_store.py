"""Email/password users + verification codes — MySQL / PostgreSQL."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.services.db import init_schema

_PBKDF2_ROUNDS = 260_000
_CODE_TTL_SECONDS = 5 * 60
_TICKET_TTL_SECONDS = 15 * 60
_CODE_COOLDOWN_SECONDS = 55
_ACTIVATE_TTL_SECONDS = 48 * 60 * 60
_ACTIVATE_COOLDOWN_SECONDS = 55


def init_auth_db() -> None:
    init_schema()


def _hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        _PBKDF2_ROUNDS,
    )
    return digest.hex()


def hash_code(email: str, code: str) -> str:
    material = f"{email.strip().lower()}|{code.strip()}|{(settings.card_key_salt or 'ses-code')}".encode()
    return hashlib.sha256(material).hexdigest()


_USER_COLS = (
    "id, email, name, avatar, default_avatar, bio, provider, role, status"
)


@dataclass
class EmailUser:
    id: str
    email: str
    name: str
    """Effective display URL: custom upload, else OAuth/default."""
    avatar: str | None = None
    avatar_custom: str | None = None
    default_avatar: str | None = None
    bio: str | None = None
    provider: str = "email"
    role: str = "user"
    status: str = "active"


def _row_get(row: Any, key: str, default: Any = None) -> Any:
    try:
        if key not in row.keys():
            return default
    except Exception:
        return default
    val = row[key]
    return default if val is None else val


def _effective_avatar(custom: Any, default: Any) -> str | None:
    c = str(custom or "").strip()
    if c:
        return c
    d = str(default or "").strip()
    return d or None


def _user_from_row(row: Any) -> EmailUser:
    custom = _row_get(row, "avatar")
    default = _row_get(row, "default_avatar")
    return EmailUser(
        id=row["id"],
        email=row["email"],
        name=row["name"],
        avatar=_effective_avatar(custom, default),
        avatar_custom=str(custom).strip() if custom else None,
        default_avatar=str(default).strip() if default else None,
        bio=_row_get(row, "bio"),
        provider=(_row_get(row, "provider") or "email"),
        role=(_row_get(row, "role") or "user"),
        status=(_row_get(row, "status") or "active"),
    )


def _user_from_model(user: Any) -> EmailUser:
    custom = getattr(user, "avatar", None)
    default = getattr(user, "default_avatar", None)
    return EmailUser(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar=_effective_avatar(custom, default),
        avatar_custom=str(custom).strip() if custom else None,
        default_avatar=str(default).strip() if default else None,
        bio=getattr(user, "bio", None),
        provider=getattr(user, "provider", None) or "email",
        role=getattr(user, "role", None) or "user",
        status=getattr(user, "status", None) or "active",
    )


def get_user_by_email(email: str) -> EmailUser | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_email(session=session, email=email)
    if not row:
        return None
    return _user_from_model(row)


def get_user_by_id(user_id: str) -> EmailUser | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_id(session=session, user_id=user_id)
    if not row:
        return None
    return _user_from_model(row)


def verify_password(email: str, password: str) -> EmailUser | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_email(session=session, email=email)
        if not row or not row.password_hash or not row.password_salt:
            return None
        expected = row.password_hash
        salt = row.password_salt
        actual = _hash_password(password, salt)
        if not hmac.compare_digest(expected, actual):
            return None
        return _user_from_model(row)


def update_password(user_id: str, password: str) -> EmailUser | None:
    """Set a new password hash for an existing user. Returns None if missing."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    salt = secrets.token_hex(16)
    pw_hash = _hash_password(password, salt)
    with Session(engine) as session:
        row = crud.get_user_by_id(session=session, user_id=user_id)
        if not row:
            return None
        crud.set_user_password(
            session=session,
            user=row,
            password_hash=pw_hash,
            password_salt=salt,
        )
        return _user_from_model(row)


def change_password(user_id: str, current_password: str, new_password: str) -> EmailUser:
    """Verify current password then set a new one. Raises ValueError on failure."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_id(session=session, user_id=user_id)
        if not row or not row.password_hash or not row.password_salt:
            raise ValueError("no_password")
        actual = _hash_password(current_password, row.password_salt)
        if not hmac.compare_digest(row.password_hash, actual):
            raise ValueError("bad_current")
    updated = update_password(user_id, new_password)
    if not updated:
        raise ValueError("not_found")
    return updated


def reset_password_by_email(email: str, password: str) -> EmailUser | None:
    """Update password for an existing email user (after ticket consume)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_email(session=session, email=email)
        if not row:
            return None
        uid = row.id
    return update_password(uid, password)


def upsert_user(*, email: str, password: str, name: str) -> EmailUser:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import User

    init_auth_db()
    email_n = email.strip().lower()
    name_n = (name or "").strip() or email_n.split("@")[0]
    salt = secrets.token_hex(16)
    pw_hash = _hash_password(password, salt)
    now = time.time()
    with Session(engine) as session:
        existing = crud.get_user_by_email(session=session, email=email_n)
        if existing:
            existing.name = name_n
            crud.set_user_password(
                session=session,
                user=existing,
                password_hash=pw_hash,
                password_salt=salt,
            )
            return EmailUser(
                id=existing.id, email=email_n, name=name_n, provider="email"
            )
        uid = str(uuid.uuid4())
        crud.create_user(
            session=session,
            user=User(
                id=uid,
                email=email_n,
                name=name_n,
                provider="email",
                password_hash=pw_hash,
                password_salt=salt,
                created_at=now,
                updated_at=now,
            ),
        )
    return EmailUser(id=uid, email=email_n, name=name_n, provider="email")



def ensure_email_user(*, email: str) -> EmailUser:
    """Find or create a passwordless email user (verification-code login)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import User
    from app.services.auth.admin import SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID

    init_auth_db()
    email_n = email.strip().lower()
    is_super = bool(SUPER_ADMIN_EMAIL) and email_n == SUPER_ADMIN_EMAIL.strip().lower()
    name_n = (
        "Super Admin"
        if is_super
        else (email_n.split("@")[0] if "@" in email_n else email_n)
    )
    now = time.time()
    with Session(engine) as session:
        existing = crud.get_user_by_email(session=session, email=email_n)
        if is_super and existing is None and SUPER_ADMIN_ID:
            # Prefer stable bootstrap id so password / OTP share one admin row.
            existing = crud.get_user_by_id(session=session, user_id=SUPER_ADMIN_ID)
            if existing is not None and (existing.email or "").strip().lower() not in (
                "",
                email_n,
            ):
                # Bootstrap id already used by another email — fall through to create.
                existing = None
        if existing:
            dirty = False
            if is_super:
                if (existing.role or "").strip().lower() != "admin":
                    existing.role = "admin"
                    dirty = True
                if (existing.status or "").strip().lower() != "active":
                    existing.status = "active"
                    dirty = True
                if not (existing.name or "").strip():
                    existing.name = name_n
                    dirty = True
                if (existing.email or "").strip().lower() != email_n:
                    existing.email = email_n
                    dirty = True
            if dirty:
                existing.updated_at = now
                session.add(existing)
                session.commit()
                session.refresh(existing)
            return _user_from_model(existing)
        uid = SUPER_ADMIN_ID if is_super and SUPER_ADMIN_ID else str(uuid.uuid4())
        session.add(
            User(
                id=uid,
                email=email_n,
                name=name_n,
                provider="email",
                role="admin" if is_super else "user",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()
    return EmailUser(
        id=uid,
        email=email_n,
        name=name_n,
        provider="email",
        role="admin" if is_super else "user",
        status="active",
    )


def _is_oauth_placeholder_avatar(url: str | None) -> bool:
    low = (url or "").strip().lower()
    if not low:
        return True
    if "googleusercontent.com" in low and "/a/default" in low:
        return True
    if "ggpht.com" in low and "/a/default" in low:
        return True
    return False


def _is_hosted_avatar_url(url: str | None) -> bool:
    """True when URL is already on our upload/COS avatar path."""
    raw = (url or "").strip().lower()
    if not raw:
        return False
    if "/avatars/" not in raw and not raw.startswith("avatars/"):
        return False
    return (
        raw.startswith("avatars/")
        or "/api/v1/uploads/files/avatars/" in raw
        or "myqcloud.com" in raw
        or "amazonaws.com" in raw
        or "cos." in raw
    )


def _rehost_remote_avatar(
    user_id: str, url: str, *, prev_avatar: str | None = None
) -> str | None:
    """Download a remote avatar and store under avatars/{user_id}/."""
    raw = (url or "").strip()
    if not raw.startswith("http://") and not raw.startswith("https://"):
        return None
    if _is_oauth_placeholder_avatar(raw):
        return None
    if _is_hosted_avatar_url(raw):
        return raw[:2048]
    try:
        import httpx

        from app.services.storage import get_storage, put_bytes

        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            resp = client.get(
                raw,
                headers={"User-Agent": "RecombynAvatarBot/1.0"},
            )
            if resp.status_code >= 400:
                return None
            blob = resp.content or b""
            if not blob or len(blob) > 2_500_000:
                return None
            ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
            if ctype and not ctype.startswith("image/"):
                return None
            if "webp" in ctype or raw.lower().endswith(".webp"):
                ext, content_type = "webp", "image/webp"
            elif "png" in ctype or raw.lower().endswith(".png"):
                ext, content_type = "png", "image/png"
            elif "gif" in ctype or raw.lower().endswith(".gif"):
                ext, content_type = "gif", "image/gif"
            else:
                ext, content_type = "jpg", "image/jpeg"
        stamp = int(time.time() * 1000)
        key = f"avatars/{user_id}/default-{stamp}.{ext}"
        put_bytes(
            key,
            blob,
            content_type=content_type,
            cache_control="public, max-age=31536000, immutable",
        )
        storage = get_storage()
        out = storage.url_for(key)
        if not storage.enabled_remote():
            out = f"/api/v1/uploads/files/{key}"
        if prev_avatar and prev_avatar != out and _is_hosted_avatar_url(prev_avatar):
            _maybe_delete_avatar_object(prev_avatar)
        return out
    except Exception:
        return None


def upsert_oauth_user(
    *,
    user_id: str,
    email: str,
    name: str,
    avatar: str | None,
    provider: str,
    google_sub: str | None = None,
) -> EmailUser:
    """
    Create or refresh a Google (or other OAuth) user row.

    - ``avatar`` column = user-uploaded custom photo (never overwritten by OAuth)
    - ``default_avatar`` = OAuth/Google picture (rehosted to our storage when possible)
    Display uses custom first, else default.
    """
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import User

    init_auth_db()
    email_n = (email or "").strip().lower() or f"{user_id}@oauth.local"
    name_n = (name or "").strip() or email_n.split("@")[0]
    now = time.time()
    oauth_pic = (avatar or "").strip() or None
    if oauth_pic and _is_oauth_placeholder_avatar(oauth_pic):
        oauth_pic = None

    with Session(engine) as session:
        by_id = crud.get_user_by_id(session=session, user_id=user_id)
        by_sub = (
            crud.get_user_by_google_sub(session=session, google_sub=google_sub)
            if google_sub
            else None
        )
        by_email = crud.get_user_by_email(session=session, email=email_n)
        row = by_id or by_sub or by_email
        if row:
            uid = str(row.id)
            custom = row.avatar
            prev_default = row.default_avatar
            next_default = prev_default
            needs_default = (
                not prev_default
                or _is_oauth_placeholder_avatar(str(prev_default))
                or (
                    str(prev_default).startswith("http")
                    and not _is_hosted_avatar_url(str(prev_default))
                )
            )
            if oauth_pic and needs_default:
                hosted = _rehost_remote_avatar(
                    uid, oauth_pic, prev_avatar=str(prev_default or "") or None
                )
                next_default = hosted or oauth_pic
            elif oauth_pic and not prev_default:
                hosted = _rehost_remote_avatar(uid, oauth_pic, prev_avatar=None)
                next_default = hosted or oauth_pic

            crud.update_user_oauth(
                session=session,
                user=row,
                email=email_n,
                provider=provider,
                google_sub=google_sub,
                default_avatar=next_default,
            )
            return EmailUser(
                id=uid,
                email=email_n,
                name=row.name or name_n,
                avatar=_effective_avatar(custom, next_default),
                avatar_custom=str(custom).strip() if custom else None,
                default_avatar=str(next_default).strip() if next_default else None,
                bio=row.bio,
                provider=provider or (row.provider or "email"),
                role=(row.role or "user"),
                status=(row.status or "active"),
            )

        uid = user_id
        next_default = None
        if oauth_pic:
            next_default = _rehost_remote_avatar(uid, oauth_pic, prev_avatar=None) or oauth_pic
        crud.create_user(
            session=session,
            user=User(
                id=uid,
                email=email_n,
                name=name_n,
                avatar=None,
                default_avatar=next_default,
                provider=provider,
                google_sub=google_sub,
                created_at=now,
                updated_at=now,
            ),
        )
    return EmailUser(
        id=uid,
        email=email_n,
        name=name_n,
        avatar=next_default,
        avatar_custom=None,
        default_avatar=next_default,
        provider=provider,
    )


def update_profile(
    user_id: str, *, name: str | None = None, bio: str | None = None, avatar: str | None = None
) -> EmailUser | None:
    """Update profile. ``avatar`` only changes the custom upload field."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_user_by_id(session=session, user_id=user_id)
        if not row:
            return None
        next_name = name if name is not None else row.name
        next_bio = bio if bio is not None else row.bio
        if avatar is None:
            next_custom = row.avatar
        else:
            next_custom = _persist_avatar(user_id, avatar, prev_avatar=row.avatar)
        row.name = next_name
        row.bio = next_bio
        if avatar is not None:
            row.avatar = next_custom
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return _user_from_model(row)


def _persist_avatar(user_id: str, avatar: str, *, prev_avatar: str | None) -> str | None:
    """Store custom avatar as COS/local URL — never keep raw data: URLs in users.avatar."""
    raw = (avatar or "").strip()
    if not raw:
        _maybe_delete_avatar_object(prev_avatar)
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        if _is_hosted_avatar_url(raw):
            return raw[:2048]
        # Treat remote URL as a custom upload source — rehost into avatars/.
        hosted = _rehost_remote_avatar(user_id, raw, prev_avatar=prev_avatar)
        return hosted or raw[:2048]
    if raw.startswith("/api/"):
        return raw[:2048]
    if not raw.startswith("data:image/"):
        return prev_avatar

    try:
        import base64

        from app.services.storage import get_storage, put_bytes

        header, b64 = raw.split(",", 1)
        h = header.lower()
        if "webp" in h:
            ext, content_type = "webp", "image/webp"
        elif "png" in h:
            ext, content_type = "png", "image/png"
        elif "gif" in h:
            ext, content_type = "gif", "image/gif"
        else:
            ext, content_type = "jpg", "image/jpeg"
        blob = base64.b64decode(b64, validate=False)
        if len(blob) > 2_500_000:
            raise ValueError("avatar too large")
        stamp = int(time.time() * 1000)
        key = f"avatars/{user_id}/avatar-{stamp}.{ext}"
        put_bytes(
            key,
            blob,
            content_type=content_type,
            cache_control="public, max-age=31536000, immutable",
        )
        storage = get_storage()
        url = storage.url_for(key)
        if not storage.enabled_remote():
            url = f"/api/v1/uploads/files/{key}"
        _maybe_delete_avatar_object(prev_avatar)
        return url
    except Exception:
        return prev_avatar


def _maybe_delete_avatar_object(url: str | None) -> None:
    raw = (url or "").strip()
    if not raw:
        return
    key = ""
    marker = "/avatars/"
    if marker in raw:
        key = "avatars/" + raw.split(marker, 1)[1].split("?", 1)[0]
    elif raw.startswith("avatars/"):
        key = raw.split("?", 1)[0]
    elif "/api/v1/uploads/files/avatars/" in raw:
        key = raw.split("/api/v1/uploads/files/", 1)[1].split("?", 1)[0]
    if not key.startswith("avatars/"):
        return
    try:
        from app.services.storage import delete_object

        delete_object(key)
    except Exception:
        pass


def heal_avatar_if_data_url(user: EmailUser) -> EmailUser:
    """One-shot move base64 custom avatars out of the users table."""
    raw = (user.avatar_custom or user.avatar or "").strip()
    if not raw.startswith("data:image/"):
        return user
    updated = update_profile(user.id, avatar=raw)
    return updated or user


def can_send_code(email: str) -> tuple[bool, float]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        row = crud.get_email_code(session=session, email=email)
    if not row:
        return True, 0
    elapsed = time.time() - float(row.sent_at)
    if elapsed >= _CODE_COOLDOWN_SECONDS:
        return True, 0
    return False, max(1.0, _CODE_COOLDOWN_SECONDS - elapsed)


def store_code(email: str, code: str) -> None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    email_n = email.strip().lower()
    now = int(time.time())
    with Session(engine) as session:
        crud.upsert_email_code(
            session=session,
            email=email_n,
            code_hash=hash_code(email_n, code),
            expires_at=now + int(_CODE_TTL_SECONDS),
            sent_at=now,
        )


def verify_and_issue_ticket(email: str, code: str) -> str:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    email_n = email.strip().lower()
    code_n = code.strip()
    with Session(engine) as session:
        row = crud.get_email_code(session=session, email=email_n)
        if not row:
            raise ValueError("code_missing")
        if int(row.expires_at) < int(time.time()):
            session.delete(row)
            session.commit()
            raise ValueError("code_expired")
        attempts = int(row.attempts or 0)
        if attempts >= 8:
            raise ValueError("code_locked")
        ok = hmac.compare_digest(row.code_hash, hash_code(email_n, code_n))
        if not ok:
            row.attempts = attempts + 1
            session.add(row)
            session.commit()
            raise ValueError("code_invalid")
        session.delete(row)
        ticket = secrets.token_urlsafe(24)
        crud.create_email_ticket(
            session=session,
            ticket=ticket,
            email=email_n,
            expires_at=int(time.time()) + int(_TICKET_TTL_SECONDS),
        )
        return ticket


def consume_ticket(email: str, ticket: str) -> bool:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    email_n = email.strip().lower()
    with Session(engine) as session:
        row = crud.get_email_ticket(session=session, ticket=ticket)
        if not row:
            return False
        session.delete(row)
        session.commit()
        if int(row.expires_at) < int(time.time()):
            return False
        return str(row.email).lower() == email_n


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def display_name_for_email(email: str) -> str:
    """Greeting for SES {{username}} — profile name, else local-part."""
    email_n = email.strip().lower()
    user = get_user_by_email(email_n)
    name = (user.name or "").strip() if user else ""
    if name and "@" not in name:
        return name
    local = email_n.split("@", 1)[0].strip()
    return local or "there"


def can_send_activate_link(email: str) -> tuple[bool, float]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    with Session(engine) as session:
        created = crud.latest_activate_token_created_at(session=session, email=email)
    if created is None:
        return True, 0
    elapsed = time.time() - float(created)
    if elapsed >= _ACTIVATE_COOLDOWN_SECONDS:
        return True, 0
    return False, max(1.0, _ACTIVATE_COOLDOWN_SECONDS - elapsed)


def create_activate_token(email: str) -> str:
    """One-time login token for SES template {{id}} (48h)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    email_n = email.strip().lower()
    now = int(time.time())
    token_id = secrets.token_urlsafe(24)
    with Session(engine) as session:
        crud.replace_activate_token(
            session=session,
            email=email_n,
            token_id=token_id,
            expires_at=now + int(_ACTIVATE_TTL_SECONDS),
            created_at=now,
        )
    return token_id


def consume_activate_token(token_id: str) -> str:
    """Consume one-time link. Returns email or raises ValueError."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_auth_db()
    tid = (token_id or "").strip()
    if not tid:
        raise ValueError("link_invalid")
    with Session(engine) as session:
        row = crud.get_activate_token(session=session, token_id=tid)
        if not row:
            raise ValueError("link_invalid")
        email = str(row.email).strip().lower()
        expired = int(row.expires_at) < int(time.time())
        session.delete(row)
        session.commit()
        if expired:
            raise ValueError("link_expired")
        return email
