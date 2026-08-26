"""Upload size limit helpers."""

from __future__ import annotations

import pytest


def test_upload_unlimited_by_default(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.services.upload_limits import (
        assert_upload_size_allowed,
        upload_max_bytes_for_mime,
        upload_max_mb_for_mime,
    )

    monkeypatch.setattr(settings, "max_upload_mb", 0)
    monkeypatch.setattr(settings, "max_video_upload_mb", 0)

    assert upload_max_mb_for_mime("image/png") == 0
    assert upload_max_mb_for_mime("video/mp4") == 0
    assert upload_max_bytes_for_mime("image/png") is None
    assert_upload_size_allowed(10 * 1024 * 1024 * 1024, "image/png")


def test_upload_max_mb_for_mime_video_uses_video_ceiling(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.services.upload_limits import upload_max_bytes_for_mime, upload_max_mb_for_mime

    monkeypatch.setattr(settings, "max_upload_mb", 50)
    monkeypatch.setattr(settings, "max_video_upload_mb", 120)

    assert upload_max_mb_for_mime("image/png") == 50
    assert upload_max_mb_for_mime("video/mp4") == 120
    assert upload_max_bytes_for_mime("audio/mpeg") == 120 * 1024 * 1024


def test_upload_multipart_max_part_bytes_uses_chunk_size(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.services.upload_limits import upload_chunk_part_bytes, upload_multipart_max_part_bytes

    monkeypatch.setattr(settings, "upload_chunk_size_mb", 8)

    assert upload_chunk_part_bytes() == 8 * 1024 * 1024
    assert upload_multipart_max_part_bytes() == 8 * 1024 * 1024
