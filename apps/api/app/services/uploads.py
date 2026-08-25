"""User file uploads → object storage or local disk."""

from __future__ import annotations

import logging
import mimetypes
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.storage import delete_object, get_storage, put_bytes

_log = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._\-]+")
_SVG_SCRIPT = re.compile(r"<\s*(script|foreignObject)\b", re.IGNORECASE)

_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
}

_VIDEO_MIME = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
}

_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
}

_MAGIC_TO_EXT_MIME: list[tuple[bytes, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
    (b"BM", "bmp", "image/bmp"),
    (b"fLaC", "flac", "audio/flac"),
    (b"OggS", "ogg", "audio/ogg"),
    (b"ID3", "mp3", "audio/mpeg"),
    (b"\x1a\x45\xdf\xa3", "webm", "video/webm"),
]


def _ext_mime(filename: str | None, content_type: str | None) -> tuple[str, str]:
    ctype = (content_type or "").split(";")[0].strip().lower()
    name = (filename or "").strip().lower()
    ext = ""
    if "." in name:
        ext = "." + name.rsplit(".", 1)[-1]
    if ext in _IMAGE_MIME:
        return ext.lstrip("."), _IMAGE_MIME[ext]
    if ext in _VIDEO_MIME and not ctype.startswith("audio/"):
        return ext.lstrip("."), _VIDEO_MIME[ext]
    if ext in _AUDIO_MIME:
        return ext.lstrip("."), _AUDIO_MIME[ext]
    if ctype.startswith("image/"):
        guessed = mimetypes.guess_extension(ctype) or ".bin"
        if guessed == ".jpe":
            guessed = ".jpg"
        return guessed.lstrip("."), ctype
    if ctype.startswith("video/"):
        guessed = mimetypes.guess_extension(ctype) or ".mp4"
        return guessed.lstrip("."), ctype
    if ctype.startswith("audio/"):
        guessed = mimetypes.guess_extension(ctype) or ".mp3"
        if ctype == "audio/mpeg" and guessed in (".mp2", ".mpga", ".bin"):
            guessed = ".mp3"
        return guessed.lstrip("."), ctype
    if ext:
        mime = mimetypes.guess_type(f"x{ext}")[0] or "application/octet-stream"
        return ext.lstrip("."), mime
    return "bin", ctype or "application/octet-stream"


def _safe_filename(name: str | None) -> str:
    raw = (name or "file").strip() or "file"
    base = raw.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = _SAFE_NAME.sub("_", base).strip("._") or "file"
    return cleaned[:120]


def _sniff_media(data: bytes) -> tuple[str, str] | None:
    """Return (ext, mime) from magic bytes, or None if unrecognized."""
    if not data:
        return None
    head = data[:64]
    # PE / ELF — never accept as media.
    if head.startswith(b"MZ") or head.startswith(b"\x7fELF"):
        raise ValueError("executable content is not allowed")
    for magic, ext, mime in _MAGIC_TO_EXT_MIME:
        if head.startswith(magic):
            return ext, mime
    if len(head) >= 12 and head.startswith(b"RIFF"):
        tag = head[8:12]
        if tag == b"WEBP":
            return "webp", "image/webp"
        if tag == b"WAVE":
            return "wav", "audio/wav"
        if tag == b"AVI ":
            return "avi", "video/x-msvideo"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"qt  ",):
            return "mov", "video/quicktime"
        return "mp4", "video/mp4"
    # MP3 frame sync without ID3
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return "mp3", "audio/mpeg"
    # SVG (text)
    sample = data[:4096].lstrip(b"\xef\xbb\xbf \t\r\n")
    try:
        text = sample.decode("utf-8", errors="ignore").lstrip().lower()
    except Exception:
        text = ""
    if text.startswith("<svg") or (text.startswith("<?xml") and "<svg" in text[:500]):
        return "svg", "image/svg+xml"
    return None


def _family(mime: str) -> str:
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "other"


def _reconcile_claimed_and_magic(
    data: bytes,
    *,
    claimed_ext: str,
    claimed_mime: str,
) -> tuple[str, str]:
    """Prefer magic when present; reject dangerous / mismatched families."""
    if claimed_mime == "image/svg+xml" or claimed_ext == "svg":
        sniffed = _sniff_media(data)
        if not sniffed or sniffed[1] != "image/svg+xml":
            raise ValueError("SVG content mismatch")
        if _SVG_SCRIPT.search(data.decode("utf-8", errors="ignore")):
            raise ValueError("SVG scripts are not allowed")
        return "svg", "image/svg+xml"

    require = bool(getattr(settings, "upload_require_magic_match", True))
    sniffed = _sniff_media(data)
    if sniffed is None:
        if require and _family(claimed_mime) in ("image", "video", "audio"):
            # AVIF and some codecs lack stable short magics — allow if Pillow can open images.
            if claimed_mime.startswith("image/") and claimed_mime != "image/svg+xml":
                w, h = _probe_image_size(data, claimed_mime)
                if w and h:
                    return claimed_ext, claimed_mime
            raise ValueError("file content does not match a known media type")
        return claimed_ext, claimed_mime

    magic_ext, magic_mime = sniffed
    if _family(magic_mime) != _family(claimed_mime):
        raise ValueError(
            f"content type mismatch: claimed {claimed_mime}, detected {magic_mime}"
        )
    # Trust magic for extension/mime (blocks .png.exe renamed as .png with PE magic already).
    return magic_ext, magic_mime


def _run_av_hook(data: bytes, *, filename: str) -> None:
    """Optional external scanner (ClamAV-style). No-op unless enabled."""
    if not bool(getattr(settings, "upload_av_hook_enabled", False)):
        return
    cmd = str(getattr(settings, "upload_av_command", "") or "").strip()
    if not cmd:
        raise ValueError("AV hook enabled but UPLOAD_AV_COMMAND is empty")
    with tempfile.TemporaryDirectory(prefix="recombyn-av-") as tmp:
        path = Path(tmp) / _safe_filename(filename)
        path.write_bytes(data)
        # Shell-less: first token is executable; remaining are args + path.
        parts = cmd.split()
        argv = [*parts, str(path)]
        try:
            completed = subprocess.run(
                argv,
                check=False,
                capture_output=True,
                timeout=60,
            )
        except FileNotFoundError as exc:
            raise ValueError(f"AV scanner not found: {parts[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise ValueError("AV scanner timed out") from exc
        if completed.returncode != 0:
            _log.warning(
                "upload_av_hook rejected file=%s code=%s stderr=%s",
                filename,
                completed.returncode,
                (completed.stderr or b"")[:200],
            )
            raise ValueError("file rejected by AV scanner")


def _probe_image_size(data: bytes, mime: str) -> tuple[int | None, int | None]:
    if not mime.startswith("image/") or mime == "image/svg+xml":
        return None, None
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(data)) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None, None


def upload_user_file(
    user_id: str,
    *,
    data: bytes,
    filename: str | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    """
    Store one file in object storage and return a public (or API) URL.

    Keys: ``uploads/{user_id}/{yyyy}/{mm}/{uuid}.{ext}``
    """
    if not data:
        raise ValueError("empty file")

    ext, mime = _ext_mime(filename, content_type)
    # Browsers often send application/octet-stream (clipboard / unnamed blob).
    # Prefer magic sniff before rejecting non-media Content-Type.
    if not (
        mime.startswith("image/")
        or mime.startswith("video/")
        or mime.startswith("audio/")
    ):
        sniffed = _sniff_media(data)
        if sniffed is None:
            raise ValueError("only image, video, or audio uploads are supported")
        ext, mime = sniffed

    ext, mime = _reconcile_claimed_and_magic(data, claimed_ext=ext, claimed_mime=mime)
    _run_av_hook(data, filename=filename or f"upload.{ext}")

    max_mb = max(1, int(settings.max_upload_mb or 20))
    # Videos / audio need a higher ceiling than stills (default 100MB unless configured higher).
    if mime.startswith("video/") or mime.startswith("audio/"):
        max_mb = max(max_mb, int(getattr(settings, "max_video_upload_mb", None) or 100))
    max_bytes = max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise ValueError(f"file too large (max {max_mb}MB)")

    now = time.gmtime()
    file_id = uuid.uuid4().hex
    object_key = f"uploads/{user_id}/{now.tm_year:04d}/{now.tm_mon:02d}/{file_id}.{ext}"
    put_bytes(object_key, data, content_type=mime)

    storage = get_storage()
    url = storage.url_for(object_key)
    # Local backend: expose via authenticated download route.
    if not storage.enabled_remote():
        url = f"/api/v1/uploads/files/{object_key}"

    width, height = _probe_image_size(data, mime)
    thumb_b64 = ""
    thumb_key = ""
    if mime.startswith("image/"):
        try:
            from app.services.design.admin.blob_codec import make_webp_thumb
            import base64

            thumb = make_webp_thumb(data, max_edge=512, quality=70)
            # Also keep a small sibling object for CDN/cache (optional).
            thumb_key = f"{object_key.rsplit('.', 1)[0]}.thumb.webp"
            try:
                put_bytes(thumb_key, thumb, content_type="image/webp")
            except Exception:
                thumb_key = ""
            thumb_b64 = base64.b64encode(thumb).decode("ascii")
        except Exception:
            thumb_key = ""

    return {
        "url": url,
        "key": object_key,
        "originPath": object_key,
        "mime": mime,
        "name": _safe_filename(filename),
        "size": len(data),
        "width": width,
        "height": height,
        "thumbKey": thumb_key or None,
        "thumbWebpBase64": thumb_b64 or None,
    }


def upload_user_files(
    user_id: str,
    files: list[tuple[bytes, str | None, str | None]],
) -> list[dict[str, Any]]:
    """``files`` items: (bytes, filename, content_type)."""
    if not files:
        raise ValueError("files required")
    out: list[dict[str, Any]] = []
    for data, filename, content_type in files:
        out.append(
            upload_user_file(
                user_id,
                data=data,
                filename=filename,
                content_type=content_type,
            )
        )
    return out


def delete_user_file(user_id: str, object_key: str) -> bool:
    """Delete one of the user's uploaded objects. Returns False if key is invalid/foreign."""
    key = (object_key or "").strip().lstrip("/")
    if not key or ".." in key:
        return False
    prefix = f"uploads/{user_id}/"
    if not key.startswith(prefix):
        return False
    try:
        delete_object(key)
    except Exception:
        return False
    return True
