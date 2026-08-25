"""Rehost vision tool outputs to our uploads store (avoid giant data-URL round-trips)."""

from __future__ import annotations


def rehost_image_bytes(
    user_id: str | None,
    data: bytes,
    *,
    filename: str = "processed.png",
    content_type: str = "image/png",
) -> str:
    """Upload bytes for ``user_id``; return display URL. Raises on failure."""
    uid = str(user_id or "").strip()
    if not uid:
        raise RuntimeError("user_id required to rehost image")
    if not data:
        raise ValueError("empty image bytes")
    from app.services.uploads import upload_user_file

    item = upload_user_file(
        uid,
        data=data,
        filename=filename,
        content_type=content_type,
    )
    url = str(item.get("url") or "").strip()
    if not url:
        raise RuntimeError(f"rehost failed for {filename}")
    return url
