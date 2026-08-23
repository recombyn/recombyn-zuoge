"""RBAC permission helpers (resource×action)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def test_user_has_permission_admin_and_user():
    from app.api.deps import user_has_permission

    admin = SimpleNamespace(id="a1", role="admin", email="a@x.com")
    user = SimpleNamespace(id="u1", role="user", email="u@x.com")

    assert user_has_permission(admin, "admin:users:write") is True
    assert user_has_permission(user, "admin:users:write") is False
    assert user_has_permission(user, "project:write") is True
    assert user_has_permission(user, "plaza:moderate") is False


def test_require_permission_denies():
    from app.api.deps import require_permission

    dep = require_permission("admin:users:write")
    user = SimpleNamespace(id="u1", role="user", email="u@x.com")
    with pytest.raises(HTTPException) as ei:
        dep(user)  # type: ignore[arg-type]
    assert ei.value.status_code == 403
    assert ei.value.detail["code"] == "permission_denied"
