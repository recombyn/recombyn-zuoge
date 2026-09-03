"""Vision image hosting + URL helpers for remote APIs (Seedream / WaveSpeed / MediaKit)."""

from __future__ import annotations

import base64
from urllib.parse import urlparse

from app.core.config import settings

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})


def is_http_url(ref: str) -> bool:
    try:
        parsed = urlparse(ref)
    except Exception:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _host_is_private_lan(host: str) -> bool:
    if host.startswith("10.") or host.startswith("192.168."):
        return True
    if not host.startswith("172."):
        return False
    parts = host.split(".")
    if len(parts) < 2:
        return False
    try:
        second = int(parts[1])
    except ValueError:
        return False
    return 16 <= second <= 31


def is_public_http_url(ref: str) -> bool:
    """True when a remote cloud API can fetch the URL itself."""
    if not is_http_url(ref):
        return False
    try:
        host = (urlparse(ref).hostname or "").lower()
    except Exception:
        return False
    if not host or host in _LOOPBACK_HOSTS:
        return False
    if host.endswith(".local") or host.endswith(".internal"):
        return False
    if _host_is_private_lan(host):
        return False
    return True


def ipv4_loopback_url(ref: str) -> str:
    """Rewrite localhost / ::1 → 127.0.0.1 so local MinIO fetches work on Windows."""
    try:
        parsed = urlparse(ref)
        host = (parsed.hostname or "").lower()
        if host not in {"localhost", "::1"}:
            return ref
        port = f":{parsed.port}" if parsed.port else ""
        out = f"{parsed.scheme}://127.0.0.1{port}{parsed.path or ''}"
        if parsed.query:
            return f"{out}?{parsed.query}"
        return out
    except Exception:
        return ref


def bytes_to_data_url(raw: bytes, *, content_type: str = "image/png") -> str:
    ctype = (content_type or "image/png").split(";")[0].strip() or "image/png"
    if not ctype.startswith("image/"):
        ctype = "image/png"
    return f"data:{ctype};base64,{base64.b64encode(raw).decode('ascii')}"


def storage_object_key(ref: str, *, local_base: str = "") -> str:
    """Extract object key from a storage display URL."""
    src = (ref or "").strip()
    base = (local_base or "").strip().rstrip("/")
    if base and src.startswith(base + "/"):
        return src[len(base) + 1 :].split("?", 1)[0].lstrip("/")
    try:
        path = urlparse(src).path or ""
    except Exception:
        return ""
    # path-style MinIO: /{bucket}/{key…}
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2:
        return ""
    return "/".join(parts[1:])


def rewrite_private_storage_url(ref: str) -> str | None:
    """
    Map local MinIO URL → public CDN (VISION_PUBLIC_BASE_URL).

    Example:
      http://localhost:9000/recombyn/uploads/a.png
      → https://files.recombyn.com/recombyn/uploads/a.png
    """
    src = (ref or "").strip()
    if not src or not is_http_url(src):
        return None
    if is_public_http_url(src):
        return src

    local_base = str(settings.s3_public_base_url or "").strip().rstrip("/")
    public_base = str(settings.vision_public_base_url or "").strip().rstrip("/")
    if not public_base and local_base and is_public_http_url(local_base):
        public_base = local_base
    if not public_base or not is_public_http_url(public_base):
        return None

    key = storage_object_key(src, local_base=local_base)
    if not key:
        return None
    return f"{public_base}/{key}"


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


def encode_or_rehost_image(
    raw: bytes,
    *,
    user_id: str | None,
    filename: str,
    content_type: str = "image/png",
) -> str:
    """Upload when ``user_id`` is set; otherwise return a data URL."""
    if str(user_id or "").strip():
        return rehost_image_bytes(
            user_id, raw, filename=filename, content_type=content_type
        )
    return bytes_to_data_url(raw, content_type=content_type)


def raster_filename_and_type(
    fmt: str,
    *,
    stem: str,
    index: int | None = None,
) -> tuple[str, str]:
    """``(filename, content_type)`` for png/jpeg vision outputs."""
    use_png = str(fmt or "png").strip().lower() == "png"
    suffix = f"-{index}" if index is not None else ""
    if use_png:
        return f"{stem}{suffix}.png", "image/png"
    return f"{stem}{suffix}.jpg", "image/jpeg"


async def _download_image_bytes(ref: str) -> bytes:
    """Fetch image bytes; rewrite localhost → 127.0.0.1 for Windows MinIO."""
    import httpx

    url = ipv4_loopback_url((ref or "").strip())
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def ensure_remote_fetchable_image_ref(image: str) -> str:
    """Public URL, CDN rewrite, or data URL — never localhost/LAN for cloud APIs.

    Same contract as Seedream layering: prefer ``VISION_PUBLIC_BASE_URL`` rewrite,
    else download from local MinIO and inline as data URL.
    """
    ref = (image or "").strip()
    if not ref:
        raise ValueError("image is required")
    if ref.startswith("data:"):
        return ref
    if not is_http_url(ref):
        raise ValueError("image must be a data URL or http(s) URL")
    if is_public_http_url(ref):
        return ref
    rewritten = rewrite_private_storage_url(ref)
    if rewritten:
        return rewritten
    return bytes_to_data_url(await _download_image_bytes(ref))


async def ensure_remote_fetchable_image_refs(
    images: list[str] | None,
) -> list[str]:
    """Apply ``ensure_remote_fetchable_image_ref`` to each non-empty image URL."""
    out: list[str] = []
    for raw in images or []:
        if not isinstance(raw, str):
            continue
        s = raw.strip()
        if not s:
            continue
        out.append(await ensure_remote_fetchable_image_ref(s))
    return out
