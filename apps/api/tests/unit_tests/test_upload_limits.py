"""Upload size limit helpers."""

from __future__ import annotations

import pytest


def test_upload_max_mb_for_mime_video_uses_video_ceiling(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.services.upload_limits import upload_max_bytes_for_mime, upload_max_mb_for_mime

    monkeypatch.setattr(settings, "max_upload_mb", 50)
    monkeypatch.setattr(settings, "max_video_upload_mb", 120)

    assert upload_max_mb_for_mime("image/png") == 50
    assert upload_max_mb_for_mime("video/mp4") == 120
    assert upload_max_bytes_for_mime("audio/mpeg") == 120 * 1024 * 1024


def test_upload_multipart_max_part_bytes_uses_ceiling(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.services.upload_limits import upload_multipart_max_part_bytes

    monkeypatch.setattr(settings, "max_upload_mb", 50)
    monkeypatch.setattr(settings, "max_video_upload_mb", 120)

    assert upload_multipart_max_part_bytes() == 120 * 1024 * 1024
