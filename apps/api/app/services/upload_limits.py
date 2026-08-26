"""Shared upload size limits (multipart + stored objects)."""

from __future__ import annotations

from app.core.config import settings


def upload_max_mb_for_mime(mime: str | None) -> int:
    """Per-file ceiling from Content-Type (video/audio may use a higher cap)."""
    max_mb = max(1, int(settings.max_upload_mb or 20))
    m = (mime or "").split(";")[0].strip().lower()
    if m.startswith("video/") or m.startswith("audio/"):
        max_mb = max(max_mb, int(getattr(settings, "max_video_upload_mb", None) or 100))
    return max_mb


def upload_max_bytes_for_mime(mime: str | None) -> int:
    return upload_max_mb_for_mime(mime) * 1024 * 1024


def upload_multipart_max_part_bytes() -> int:
    """Largest multipart part we accept (matches the highest single-file cap)."""
    max_mb = max(
        max(1, int(settings.max_upload_mb or 20)),
        int(getattr(settings, "max_video_upload_mb", None) or 100),
    )
    return max_mb * 1024 * 1024
