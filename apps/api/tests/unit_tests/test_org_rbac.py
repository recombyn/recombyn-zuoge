"""Org RBAC + pending invite unit tests."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def test_org_role_rank():
    from app.api.deps import org_role_at_least, user_has_org_permission

    assert org_role_at_least("owner", "admin") is True
    assert org_role_at_least("member", "admin") is False

    user = SimpleNamespace(id="u1", role="user", email="u@x.com")
    assert (
        user_has_org_permission(
            user=user,
            org_id="org_1",
            permission="org:project:write",
            member_role="member",
        )
        is True
    )
    assert (
        user_has_org_permission(
            user=user,
            org_id="org_1",
            permission="org:members:write",
            member_role="member",
        )
        is False
    )
    assert (
        user_has_org_permission(
            user=user,
            org_id="org_1",
            permission="org:members:write",
            member_role="admin",
        )
        is True
    )


def test_require_org_permission_denied(monkeypatch: pytest.MonkeyPatch):
    from app.api import deps as deps_mod

    monkeypatch.setattr(
        "app.services.auth.orgs.get_org_member_role",
        lambda **_k: "member",
    )
    dep = deps_mod.require_org_permission("org:members:write")
    user = SimpleNamespace(id="u1", role="user", email="u@x.com")
    with pytest.raises(HTTPException) as ei:
        dep(user, "org_1")  # type: ignore[arg-type]
    assert ei.value.status_code == 403
    assert ei.value.detail["code"] == "org_permission_denied"


def test_alembic_includes_org_revision():
    versions = Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    names = {p.name for p in versions.glob("*.py")}
    assert "0006_org_members.py" in names
    assert "0007_project_org_id.py" in names
    assert "0008_org_invites.py" in names


def test_org_project_access_and_pending_invite(monkeypatch: pytest.MonkeyPatch):
    from app.services.auth import orgs as org_store
    from app.services.auth.email_store import upsert_user
    from app.services.db import init_schema
    from app.services import projects as project_store

    init_schema()
    owner = upsert_user(
        email="owner@example.com",
        password="password123",
        name="Owner",
    )
    member = upsert_user(
        email="member@example.com",
        password="password123",
        name="Member",
    )
    org = org_store.create_org(name="Team A", owner_user_id=owner.id)
    org_id = org["id"]

    invited = org_store.create_org_invite(
        org_id=org_id,
        actor_user_id=owner.id,
        email="member@example.com",
        role="member",
    )
    assert invited["status"] == "pending"
    assert invited["userId"] == member.id

    # Not a member until accept.
    assert project_store.get_project(member.id, "nope") is None
    assert org_store.get_org_member_role(org_id=org_id, user_id=member.id) is None

    pending = org_store.list_pending_invites_for_user(
        user_id=member.id, email="member@example.com"
    )
    assert any(i["id"] == invited["id"] for i in pending)

    org_store.accept_org_invite(
        invite_id=invited["id"],
        user_id=member.id,
        email="member@example.com",
    )
    assert org_store.get_org_member_role(org_id=org_id, user_id=member.id) == "member"

    created = project_store.upsert_project(
        owner.id,
        project_id=None,
        name="Shared",
        document={"nodes": {}},
        org_id=org_id,
    )
    assert created["orgId"] == org_id
    pid = created["id"]

    got = project_store.get_project(member.id, pid)
    assert got is not None
    assert got["orgId"] == org_id

    patched = project_store.upsert_project(
        member.id,
        project_id=pid,
        name="Shared renamed",
        document={"nodes": {"a": 1}},
        base_revision=created["revision"],
    )
    assert patched["name"] == "Shared renamed"
    assert patched["revision"] == created["revision"] + 1

    stranger = upsert_user(
        email="stranger@example.com",
        password="password123",
        name="Stranger",
    )
    assert project_store.get_project(stranger.id, pid) is None

    listed = project_store.list_projects(member.id, org_id=org_id)
    assert any(p["id"] == pid for p in listed["projects"])

    mine = org_store.list_orgs_for_user(user_id=member.id)
    assert any(o["id"] == org_id for o in mine)


def test_decline_invite(monkeypatch: pytest.MonkeyPatch):
    from app.services.auth import orgs as org_store
    from app.services.auth.email_store import upsert_user
    from app.services.db import init_schema

    init_schema()
    owner = upsert_user(email="o2@example.com", password="password123", name="O")
    member = upsert_user(email="m2@example.com", password="password123", name="M")
    org = org_store.create_org(name="Team B", owner_user_id=owner.id)
    inv = org_store.create_org_invite(
        org_id=org["id"],
        actor_user_id=owner.id,
        user_id=member.id,
        role="member",
    )
    org_store.decline_org_invite(
        invite_id=inv["id"], user_id=member.id, email=member.email
    )
    assert org_store.get_org_member_role(org_id=org["id"], user_id=member.id) is None
    pending = org_store.list_pending_invites_for_user(
        user_id=member.id, email=member.email
    )
    assert pending == []


def test_set_project_org_and_rename_kick(monkeypatch: pytest.MonkeyPatch):
    from app.services.auth import orgs as org_store
    from app.services.auth.email_store import upsert_user
    from app.services.db import init_schema
    from app.services import projects as project_store

    init_schema()
    owner = upsert_user(email="o3@example.com", password="password123", name="O")
    member = upsert_user(email="m3@example.com", password="password123", name="M")
    org = org_store.create_org(name="Team C", owner_user_id=owner.id)
    org_store.upsert_org_member(
        org_id=org["id"], user_id=member.id, role="member"
    )
    renamed = org_store.rename_org(org_id=org["id"], name="Team C2")
    assert renamed["name"] == "Team C2"

    created = project_store.upsert_project(
        owner.id,
        project_id=None,
        name="P",
        document={"nodes": {}},
    )
    moved = project_store.set_project_org(
        owner.id, created["id"], org_id=org["id"]
    )
    assert moved["orgId"] == org["id"]
    assert moved["orgName"] == "Team C2"

    listed = project_store.list_projects(member.id, org_id=org["id"])
    assert any(
        p["id"] == created["id"] and p.get("orgName") == "Team C2"
        for p in listed["projects"]
    )

    org_store.remove_org_member(
        org_id=org["id"], user_id=member.id, actor_user_id=owner.id
    )
    assert (
        org_store.get_org_member_role(org_id=org["id"], user_id=member.id) is None
    )


def test_org_invite_email_best_effort(monkeypatch: pytest.MonkeyPatch):
    from app.services.auth import orgs as org_store
    from app.services.auth.email_store import upsert_user
    from app.services.db import init_schema

    sent: list[dict] = []

    def fake_send(**kwargs):
        sent.append(kwargs)
        return "msg-1"

    monkeypatch.setattr(
        "app.services.auth.ses_mail.ses_configured", lambda: True
    )
    monkeypatch.setattr(
        "app.services.auth.ses_mail.send_org_invite_email", fake_send
    )

    init_schema()
    owner = upsert_user(email="o4@example.com", password="password123", name="Owner4")
    member = upsert_user(
        email="m4@example.com", password="password123", name="Member4"
    )
    org = org_store.create_org(name="Mail Team", owner_user_id=owner.id)
    inv = org_store.create_org_invite(
        org_id=org["id"],
        actor_user_id=owner.id,
        email=member.email,
        role="member",
    )
    assert inv["emailSent"] is True
    assert len(sent) == 1
    assert sent[0]["to_email"] == "m4@example.com"
    assert sent[0]["org_name"] == "Mail Team"
    assert "Owner" in sent[0]["inviter_name"]


def test_public_app_origin_derives_from_activate(monkeypatch: pytest.MonkeyPatch):
    from app.services.auth import ses_mail

    # public_app_origin reads a fresh Settings() — patch the helper, not the singleton.
    class _FakeSettings:
        public_app_base_url = ""
        ses_activate_base_url = "https://example.com/activate"

    monkeypatch.setattr(ses_mail, "_settings", lambda: _FakeSettings())
    assert ses_mail.public_app_origin() == "https://example.com"
