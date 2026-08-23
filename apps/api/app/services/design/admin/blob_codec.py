"""Compact binary helpers for design media + embedding BLOBs (MySQL LONGBLOB).

- Vectors: optional light zstd (fallback zlib).
- Thumbs: webp quality≈70 for DB preview; originals stay on object storage.
"""

from __future__ import annotations

import io
import zlib
from typing import Any

# zstd frame if available; else zlib.
_MAGIC_ZSTD = b"ZST1"
_MAGIC_ZLIB = b"ZL1\0"


def _zstd_mod() -> Any | None:
    try:
        import zstandard as zstd  # type: ignore

        return zstd
    except Exception:
        return None


def pack_emb_blob(raw: bytes, *, level: int = 3) -> bytes:
    """Light-compress embedding bytes for storage. Empty → empty."""
    if not raw:
        return b""
    zstd = _zstd_mod()
    if zstd is not None:
        cctx = zstd.ZstdCompressor(level=max(1, min(int(level), 10)))
        return _MAGIC_ZSTD + cctx.compress(raw)
    return _MAGIC_ZLIB + zlib.compress(raw, level=max(1, min(int(level), 9)))


def unpack_emb_blob(blob: bytes | bytearray | memoryview | None) -> bytes:
    """Decode packed embedding."""
    if blob is None:
        return b""
    data = bytes(blob)
    if not data:
        return b""
    if data.startswith(_MAGIC_ZSTD):
        zstd = _zstd_mod()
        if zstd is None:
            raise RuntimeError("zstd blob present but zstandard package missing")
        return zstd.ZstdDecompressor().decompress(data[len(_MAGIC_ZSTD) :])
    if data.startswith(_MAGIC_ZLIB):
        return zlib.decompress(data[len(_MAGIC_ZLIB) :])
    raise ValueError("Unknown embedding blob header")


def pack_text_blob(text: str, *, level: int = 19) -> bytes:
    """High-compress UTF-8 text for cold archive."""
    raw = (text or "").encode("utf-8")
    if not raw:
        return b""
    zstd = _zstd_mod()
    if zstd is not None:
        # zstd max practical level ~22; clamp
        cctx = zstd.ZstdCompressor(level=max(1, min(int(level), 22)))
        return _MAGIC_ZSTD + cctx.compress(raw)
    return _MAGIC_ZLIB + zlib.compress(raw, level=9)


def unpack_text_blob(blob: bytes | bytearray | memoryview | None) -> str:
    raw = unpack_emb_blob(blob)
    return raw.decode("utf-8", errors="replace") if raw else ""


def make_webp_thumb(
    image_bytes: bytes,
    *,
    max_edge: int = 512,
    quality: int = 70,
) -> bytes:
    """Resize longest edge and encode WebP for LONGBLOB preview."""
    from PIL import Image

    if not image_bytes:
        raise ValueError("empty image")
    im = Image.open(io.BytesIO(image_bytes))
    im = im.convert("RGBA") if im.mode in ("P", "RGBA", "LA") else im.convert("RGB")
    w, h = im.size
    edge = max(1, int(max_edge))
    scale = min(1.0, edge / float(max(w, h)))
    if scale < 0.999:
        im = im.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.Resampling.LANCZOS,
        )
    if im.mode == "RGBA":
        # Flatten onto white for smaller webp when alpha unused heavily.
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=max(40, min(int(quality), 90)), method=4)
    return buf.getvalue()


def thumb_data_url(thumb_webp: bytes | None) -> str:
    if not thumb_webp:
        return ""
    import base64

    b64 = base64.b64encode(bytes(thumb_webp)).decode("ascii")
    return f"data:image/webp;base64,{b64}"


def origin_key_from_url(url: str) -> str | None:
    """Best-effort storage key from upload/API/COS URL."""
    import re
    from urllib.parse import unquote, urlparse

    s = (url or "").strip()
    if not s or s.startswith("data:") or s.startswith("blob:"):
        return None
    path = unquote(urlparse(s).path if "://" in s else s.split("?", 1)[0])
    for prefix in ("/api/v1/uploads/files/", "/uploads/", "/objects/", "/files/"):
        idx = path.find(prefix)
        if idx >= 0:
            key = path[idx + len(prefix) :].lstrip("/")
            return key or None
    m = re.search(r"(uploads/[^?\s]+|assets/[^?\s]+)", path)
    return m.group(1) if m else None
