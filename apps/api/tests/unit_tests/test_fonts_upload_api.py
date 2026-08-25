"""Integration tests for /fonts/upload duplicate rejection and list visibility."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import pytest

FAKE_TTF = (
    b"\x00\x01\x00\x00\x00\x0b\x00\x80\x00\x03\x00\x30"
    b"OS/2\x00\x00\x00\x56\x00\x00\x00\x01\x00\x00\x00"
    + b"\x00" * 200
)


@contextmanager
def _auth_client(
    monkeypatch: pytest.MonkeyPatch,
    *,
    user_id: str = "font-upload-test-user",
) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app
    from app.services.auth import SessionUser

    stored: dict[str, bytes] = {}

    def _put_bytes(key: str, data: bytes, *, content_type: str | None = None) -> None:
        stored[key] = data

    monkeypatch.setattr("app.api.routes.fonts.put_bytes", _put_bytes)

    app.dependency_overrides[deps.get_current_user] = lambda: SessionUser(
        id=user_id,
        email="font-upload@test.local",
        name="Font Upload Tester",
        avatar=None,
        provider="email",
        role="user",
    )
    app.dependency_overrides[deps.get_current_user_optional] = lambda: SessionUser(
        id=user_id,
        email="font-upload@test.local",
        name="Font Upload Tester",
        avatar=None,
        provider="email",
        role="user",
    )
    try:
        yield TestClient(app), stored
    finally:
        app.dependency_overrides.clear()


def _upload(client: Any, filename: str = "MyCustomFont.ttf") -> Any:
    return client.post(
        "/api/v1/fonts/upload",
        files={"file": (filename, FAKE_TTF, "font/ttf")},
    )


def _list_fonts(client: Any) -> dict[str, Any]:
    res = client.get("/api/v1/fonts?page=1&pageSize=500")
    assert res.status_code == 200, res.text
    return res.json()


def test_font_upload_success_then_visible_in_list(tmp_path, monkeypatch):
  from app.services import fonts_store

  family = "TestUploadVisibleFont"
  fonts_store.delete_font(family)
  try:
    with _auth_client(monkeypatch, user_id="font-upload-visible") as (client, _stored):
      first = _upload(client, "TestUploadVisibleFont.ttf")
      assert first.status_code == 200, first.text
      body = first.json()
      assert body.get("family")
      assert body.get("item")

      listed = _list_fonts(client)
      families = {it["family"] for it in listed.get("items") or []}
      mine = [it for it in listed.get("items") or [] if it.get("isMine")]
      assert body["family"] in families
      assert any(it.get("family") == body["family"] for it in mine)
  finally:
    fonts_store.delete_font(family)


def test_font_upload_rejects_duplicate_name(tmp_path, monkeypatch):
  from app.services import fonts_store

  family = "TestUploadDupName"
  fonts_store.delete_font(family)
  try:
    with _auth_client(monkeypatch, user_id="font-upload-dup-name") as (client, _stored):
      first = client.post(
        "/api/v1/fonts/upload",
        files={"file": ("TestUploadDupName.ttf", FAKE_TTF + b"a", "font/ttf")},
      )
      assert first.status_code == 200, first.text

      second = client.post(
        "/api/v1/fonts/upload",
        files={"file": ("TestUploadDupName.ttf", FAKE_TTF + b"b", "font/ttf")},
      )
      assert second.status_code == 400, second.text
      assert "name already exists" in second.json().get("detail", "").lower()
  finally:
    fonts_store.delete_font(family)


def test_font_upload_rejects_duplicate_content(tmp_path, monkeypatch):
  from app.services import fonts_store

  family = "TestUploadDupHash"
  fonts_store.delete_font(family)
  try:
    with _auth_client(monkeypatch, user_id="font-upload-dup-hash") as (client, _stored):
      first = _upload(client, "TestUploadDupHash.ttf")
      assert first.status_code == 200, first.text

      second = _upload(client, "RenamedButSameBytes.ttf")
      assert second.status_code == 400, second.text
      assert "already uploaded" in second.json().get("detail", "").lower()
  finally:
    fonts_store.delete_font(family)


def test_orphan_upload_path_is_visible_and_blocks_duplicate(tmp_path, monkeypatch):
  from app.services import fonts_store

  uid = "font-upload-orphan-user"
  family = "TestOrphanFont_abc123"
  label = "OrphanDisplayFont"
  fonts_store.delete_font(family)
  try:
    fonts_store.upsert_font(
      family=family,
      display_name=label,
      children=[
        {
          "family": family,
          "displayName": label,
          "weight": 400,
          "url": f"/api/v1/uploads/files/uploads/{uid}/fonts/deadbeef_orphan.woff2",
          "format": "woff2",
        }
      ],
      owner_user_id=None,
    )

    with _auth_client(monkeypatch, user_id=uid) as (client, _stored):
      listed = _list_fonts(client)
      mine = [it for it in listed.get("items") or [] if it.get("isMine")]
      assert any(it.get("family") == family for it in mine)

      dup = _upload(client, "OrphanDisplayFont.ttf")
      assert dup.status_code == 400, dup.text
      assert "name already exists" in dup.json().get("detail", "").lower()
  finally:
    fonts_store.delete_font(family)
