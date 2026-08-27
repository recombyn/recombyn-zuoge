"""Upload file serving, proxy, and delete — uploads go through /uploads/jobs."""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
from typing import Any
from urllib.parse import unquote, urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from app.api.deps import CurrentUser, OptionalUser
from fastapi.responses import Response

from app.core.config import settings
from app.services.storage import get_bytes
from app.services import uploads as upload_store

router = APIRouter(prefix="/uploads", tags=["uploads"])
logger = logging.getLogger(__name__)

_MAX_PROXY_BYTES = 25 * 1024 * 1024
_PROXY_TIMEOUT = httpx.Timeout(60.0, connect=20.0)

# List/home covers: <img src> cannot send Bearer — these keys are readable without login.
_PUBLIC_PROJECT_COVER_KEY = re.compile(
    r"^projects/[^/]+/[^/]+/thumb[^/]*\.(?:jpe?g|png|webp|gif)$",
    re.IGNORECASE,
)


def _is_public_project_cover_key(key: str) -> bool:
    return bool(_PUBLIC_PROJECT_COVER_KEY.match((key or "").lstrip("/")))


def _mime_for_key(key: str) -> str:
    mime = "application/octet-stream"
    lower = (key or "").lower()
    for ext, ctype in (
        (".png", "image/png"),
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".webp", "image/webp"),
        (".gif", "image/gif"),
        (".svg", "image/svg+xml"),
        (".ttf", "font/ttf"),
        (".otf", "font/otf"),
        (".woff", "font/woff"),
        (".woff2", "font/woff2"),
        (".mp4", "video/mp4"),
        (".webm", "video/webm"),
        (".mov", "video/quicktime"),
        (".m4v", "video/mp4"),
        (".mp3", "audio/mpeg"),
        (".wav", "audio/wav"),
        (".ogg", "audio/ogg"),
        (".m4a", "audio/mp4"),
        (".aac", "audio/aac"),
        (".flac", "audio/flac"),
    ):
        if lower.endswith(ext):
            return ctype
    return mime


def _user_owns_key(user_id: str, key: str) -> bool:
    return (
        key.startswith(f"uploads/{user_id}/")
        or key.startswith(f"assets/{user_id}/")
        or key.startswith(f"font-tasks/{user_id}/")
        or key.startswith(f"projects/{user_id}/")
    )


def _object_key_from_url(raw: str) -> str | None:
    """Map display URL → storage key (API path or public COS/S3 base + key)."""
    s = (raw or "").strip()
    if not s or s.startswith("data:") or s.startswith("blob:"):
        return None
    try:
        if s.startswith("/"):
            path = s.split("?", 1)[0]
        else:
            path = urlparse(s).path or ""
        path = unquote(path)
        api_prefix = "/api/v1/uploads/files/"
        if path.startswith(api_prefix):
            key = path[len(api_prefix) :].lstrip("/")
            return key or None
        # Public object URL: …/uploads|assets|font-tasks|projects/{userId}/…
        for marker in ("/uploads/", "/assets/", "/font-tasks/", "/projects/"):
            idx = path.find(marker)
            if idx >= 0:
                key = path[idx + 1 :].lstrip("/")
                if key.startswith(("uploads/", "assets/", "font-tasks/", "projects/")):
                    return key
        # Fallback: strip configured public base path if present.
        base = (settings.s3_public_base_url or "").rstrip("/")
        if base and s.startswith(base + "/"):
            key = unquote(s[len(base) + 1 :].split("?", 1)[0]).lstrip("/")
            return key or None
    except Exception:
        return None
    return None


def _file_response(key: str, *, public: bool = False) -> Response:
    data = get_bytes(key)
    if not data:
        raise HTTPException(status_code=404, detail="Not found")
    cache = "public, max-age=86400" if public else "private, max-age=86400"
    return Response(
        content=data,
        media_type=_mime_for_key(key),
        headers={"Cache-Control": cache},
    )


def _host_is_blocked(hostname: str | None) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def _proxy_remote_image(url: str) -> Response:
    """
    Server-side fetch for third-party image URLs (Seedream/Ark TOS, etc.) so the
    browser can inline them for export without CORS.
    """
    current = (url or "").strip()
    if not current:
        raise HTTPException(status_code=404, detail="Not found")

    with httpx.Client(timeout=_PROXY_TIMEOUT, follow_redirects=False) as client:
        for _ in range(5):
            parsed = urlparse(current)
            if parsed.scheme not in ("http", "https"):
                raise HTTPException(status_code=404, detail="Not found")
            if _host_is_blocked(parsed.hostname):
                raise HTTPException(status_code=404, detail="Not found")
            try:
                resp = client.get(current)
            except httpx.HTTPError as err:
                logger.warning("upload content proxy fetch failed: %s", err)
                raise HTTPException(status_code=502, detail="upstream fetch failed") from err

            if resp.status_code in (301, 302, 303, 307, 308):
                loc = (resp.headers.get("location") or "").strip()
                if not loc:
                    raise HTTPException(status_code=404, detail="Not found")
                current = urljoin(current, loc)
                continue

            if resp.status_code >= 400:
                raise HTTPException(status_code=404, detail="Not found")

            data = resp.content or b""
            if len(data) < 8:
                raise HTTPException(status_code=404, detail="Not found")
            if len(data) > _MAX_PROXY_BYTES:
                raise HTTPException(status_code=413, detail="image too large")

            ctype = (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if ctype.startswith("image/"):
                media = ctype
            elif ctype in ("", "application/octet-stream", "binary/octet-stream"):
                # Signed CDN URLs often omit a useful Content-Type.
                media = _mime_for_key(parsed.path or "") or "image/png"
                if media == "application/octet-stream":
                    media = "image/png"
            else:
                raise HTTPException(status_code=404, detail="Not found")

            return Response(
                content=data,
                media_type=media,
                headers={"Cache-Control": "private, max-age=3600"},
            )

    raise HTTPException(status_code=404, detail="Not found")


@router.get("/content")
def get_upload_content_by_url(
    current_user: CurrentUser,
    url: str = Query(
        ...,
        min_length=1,
        description="Display URL (COS/API path, or remote AI CDN image URL)",
    ),
) -> Response:
    """
    Resolve an image display URL to bytes (same-origin for canvas crop/export).

    1. Owned upload/asset object key → read from storage
    2. Else http(s) remote (Seedream/Ark TOS, etc.) → server-side proxy (avoids CORS)
    """
    raw = (url or "").strip()
    key = _object_key_from_url(raw)
    if key and ".." not in key and _user_owns_key(current_user.id, key):
        return _file_response(key)

    if raw.startswith("http://") or raw.startswith("https://"):
        return _proxy_remote_image(raw)

    raise HTTPException(status_code=404, detail="Not found")


@router.get("/files/{object_key:path}")
def get_uploaded_file(
    object_key: str,
    current_user: OptionalUser,
) -> Response:
    """
    Serve stored uploads by object key (local disk or S3/COS via get_bytes).

    Project list covers (``projects/{user}/{project}/thumb-*``) are public so
    ``<img src>`` works without Authorization. Other keys still require login + ownership.
    """
    key = (object_key or "").lstrip("/")
    if ".." in key or not key:
        raise HTTPException(status_code=404, detail="Not found")
    if _is_public_project_cover_key(key):
        return _file_response(key, public=True)
    if current_user is None or not _user_owns_key(current_user.id, key):
        raise HTTPException(status_code=404, detail="Not found")
    return _file_response(key)


@router.delete("/files/{object_key:path}")
def delete_uploaded_file(
    current_user: CurrentUser,
    object_key: str,
) -> dict[str, Any]:
    """Delete a previously uploaded object owned by the current current_user."""
    ok = upload_store.delete_user_file(current_user.id, object_key)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


from app.api.routes import upload_jobs

router.include_router(upload_jobs.router)
