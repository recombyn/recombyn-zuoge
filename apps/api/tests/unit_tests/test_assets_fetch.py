"""Asset byte fetch — local storage keys and data URLs."""

from __future__ import annotations

import pytest


def test_object_key_from_uploads_api_path():
    from app.services.assets import _object_key_from_ref

    key = _object_key_from_ref("/api/v1/uploads/files/uploads/u1/gen.png")
    assert key == "uploads/u1/gen.png"


def test_fetch_bytes_reads_local_storage(monkeypatch: pytest.MonkeyPatch):
    from app.services import assets as asset_store

    monkeypatch.setattr(asset_store, "get_bytes", lambda key: b"png" if key == "uploads/u1/a.png" else None)
    data, ctype = asset_store._fetch_bytes("/api/v1/uploads/files/uploads/u1/a.png")
    assert data == b"png"
    assert ctype is None


def test_fetch_bytes_data_url():
    from app.services.assets import _fetch_bytes

    data, ctype = _fetch_bytes("data:image/png;base64,aGVsbG8=")
    assert data == b"hello"
    assert ctype == "image/png"
