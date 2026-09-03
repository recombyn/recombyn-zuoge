"""Super-resolution / 高清放大 — Volcengine MediaKit enhance-image."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import enhance_image, mediakit_enabled
from app.services.vision.rehost import encode_or_rehost_image, raster_filename_and_type

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "高清放大需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


async def upscale_image(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    resolution: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Upscale / enhance via MediaKit ``enhance-image``.

    FE ``resolution`` (2K/4K) maps to target box; optional ``multiple`` /
    ``toolVersion`` / ``generativeEnhanceMode`` pass through.

    Returns ``{ image, kind, engine, model, mode, width, height }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    m = dict(meta or {})
    if resolution and not m.get("resolution"):
        m["resolution"] = resolution

    out = await enhance_image(image, meta=m, resolution=resolution)
    raw = out["image_bytes"]
    img = Image.open(io.BytesIO(raw))
    width = int(out.get("width") or img.width)
    height = int(out.get("height") or img.height)
    fmt = str(out.get("format") or "png").lower()
    version = str(out.get("tool_version") or "professional")
    filename, content_type = raster_filename_and_type(fmt, stem="upscale")

    if user_id:
        payload = raw
    else:
        buf = io.BytesIO()
        if content_type == "image/png":
            img.convert("RGBA" if "A" in img.getbands() else "RGB").save(buf, format="PNG")
        else:
            img.convert("RGB").save(buf, format="JPEG", quality=92)
        payload = buf.getvalue()

    image_out = encode_or_rehost_image(
        payload, user_id=user_id, filename=filename, content_type=content_type
    )

    return {
        "image": image_out,
        "kind": "upscale",
        "engine": "mediakit:enhance-image",
        "model": f"mediakit:{version}",
        "mode": "mediakit",
        "width": width,
        "height": height,
    }
