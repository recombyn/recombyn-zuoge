"""Shared upload size limits."""

from __future__ import annotations

from app.core.config import settings


def upload_max_mb_for_mime(mime: str | None) -> int:
    """Per-file ceiling in MB; 0 means unlimited."""
    image_mb = int(settings.max_upload_mb or 0)
    video_mb = int(getattr(settings, "max_video_upload_mb", None) or 0)
    m = (mime or "").split(";")[0].strip().lower()
    if m.startswith("video/") or m.startswith("audio/"):
        if video_mb <= 0 and image_mb <= 0:
            return 0
        if video_mb <= 0:
            return image_mb
        if image_mb <= 0:
            return video_mb
        return max(image_mb, video_mb)
    return image_mb


def upload_max_bytes_for_mime(mime: str | None) -> int | None:
    """None when uploads are uncapped."""
    max_mb = upload_max_mb_for_mime(mime)
    if max_mb <= 0:
        return None
    return max_mb * 1024 * 1024


def upload_multipart_max_part_bytes() -> int:
    """Largest multipart part we accept (matches chunk part size)."""
    return upload_chunk_part_bytes()


def upload_chunk_part_bytes() -> int:
    mb = max(1, int(getattr(settings, "upload_chunk_size_mb", None) or 8))
    return mb * 1024 * 1024


def assert_upload_size_allowed(size: int, mime: str | None) -> None:
    max_bytes = upload_max_bytes_for_mime(mime)
    if max_bytes is None:
        return
    if size > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise ValueError(f"file too large (max {max_mb}MB)")
