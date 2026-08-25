"""Rehost vision tool outputs to our uploads store (avoid giant data-URL round-trips)."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def rehost_image_bytes(
    user_id: str | None,
    data: bytes,
    *,
    filename: str = "processed.png",
    content_type: str = "image/png",
) -> str | None:
    """Upload bytes for ``user_id``; return display URL or None."""
    uid = str(user_id or "").strip()
    if not uid or not data:
        return None
    try:
        from app.services.uploads import upload_user_file

        item = upload_user_file(
            uid,
            data=data,
            filename=filename,
            content_type=content_type,
        )
        url = str(item.get("url") or "").strip()
        return url or None
    except Exception as err:  # noqa: BLE001
        logger.warning("rehost %s failed: %s", filename, err)
        return None
