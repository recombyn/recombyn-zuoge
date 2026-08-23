"""Returning Google logins must not clobber in-app custom avatar / name."""

from __future__ import annotations

from pathlib import Path

from tests.conftest import restore_default_sqlite_engine


def _use_tmp_db(tmp_path: Path, monkeypatch, name: str) -> None:
    db = tmp_path / name
    monkeypatch.setenv("SQLITE_DB_PATH", str(db))
    monkeypatch.setenv("DATABASE_URL", "")
    from app.core.config import settings as settings_mod
    from app.core.db import reset_engine
    from app.services import db as db_mod

    settings_mod.sqlite_db_path = str(db)
    settings_mod.database_url = ""
    # init_schema is process-global; reset so each temp DB gets tables.
    db_mod._SCHEMA_READY = False
    reset_engine()


def test_upsert_oauth_preserves_custom_profile(tmp_path: Path, monkeypatch):
    _use_tmp_db(tmp_path, monkeypatch, "oauth-profile.db")

    from app.services.auth.email_store import update_profile, upsert_oauth_user
    from app.services.db import init_schema

    try:
        init_schema()

        # Skip network rehost in unit tests ? keep remote URL in default_avatar.
        monkeypatch.setattr(
            "app.services.auth.email_store._rehost_remote_avatar",
            lambda *a, **k: None,
        )

        first = upsert_oauth_user(
            user_id="google:sub-1",
            email="user@example.com",
            name="Google Name",
            avatar="https://lh3.googleusercontent.com/a/REALPHOTO",
            provider="google",
            google_sub="sub-1",
        )
        assert first.name == "Google Name"
        assert first.avatar_custom is None
        assert first.default_avatar and "googleusercontent" in first.default_avatar
        assert first.avatar == first.default_avatar

        # User uploaded a custom avatar (data URL ? local upload path when storage works).
        updated = update_profile(
            first.id,
            name="???",
            avatar="data:image/png;base64,iVBORw0KGgo=",
        )
        assert updated is not None
        assert updated.name == "???"
        assert updated.avatar_custom  # custom field set
        assert updated.avatar == updated.avatar_custom  # display prefers custom

        # Second Google login ? keep custom name/avatar; may refresh default_avatar.
        again = upsert_oauth_user(
            user_id="google:sub-1",
            email="user@example.com",
            name="Google Name",
            avatar="https://lh3.googleusercontent.com/a/REALPHOTO2",
            provider="google",
            google_sub="sub-1",
        )
        assert again.name == "???"
        assert again.avatar_custom == updated.avatar_custom
        assert again.avatar == updated.avatar_custom
    finally:
        restore_default_sqlite_engine()


def test_oauth_placeholder_not_stored_as_default(tmp_path: Path, monkeypatch):
    _use_tmp_db(tmp_path, monkeypatch, "oauth-default.db")
    from app.services.auth.email_store import upsert_oauth_user
    from app.services.db import init_schema

    try:
        init_schema()
        monkeypatch.setattr(
            "app.services.auth.email_store._rehost_remote_avatar",
            lambda *a, **k: None,
        )
        u = upsert_oauth_user(
            user_id="google:sub-def",
            email="d@example.com",
            name="No Photo",
            avatar="https://lh3.googleusercontent.com/a/default",
            provider="google",
            google_sub="sub-def",
        )
        assert u.default_avatar is None
        assert u.avatar is None
    finally:
        restore_default_sqlite_engine()


def test_create_session_returns_persisted_profile(tmp_path: Path, monkeypatch):
    _use_tmp_db(tmp_path, monkeypatch, "oauth-session.db")

    from app.services.auth import SessionUser, create_session
    from app.services.auth.email_store import update_profile, upsert_oauth_user
    from app.services.db import init_schema

    try:
        init_schema()
        monkeypatch.setattr(
            "app.services.auth.email_store._rehost_remote_avatar",
            lambda *a, **k: None,
        )
        upsert_oauth_user(
            user_id="google:sub-2",
            email="b@example.com",
            name="From Google",
            avatar="https://example.com/g.png",
            provider="google",
            google_sub="sub-2",
        )
        update_profile(
            "google:sub-2",
            name="Edited",
            avatar="/api/v1/uploads/files/avatars/x.png",
        )

        session, token = create_session(
            SessionUser(
                id="google:sub-2",
                email="b@example.com",
                name="From Google",
                avatar="https://example.com/g.png",
                provider="google",
            )
        )
        assert token
        assert session.name == "Edited"
        assert session.avatar == "/api/v1/uploads/files/avatars/x.png"
    finally:
        restore_default_sqlite_engine()
