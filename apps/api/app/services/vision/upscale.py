"""Super-resolution / 高清放大 — Volcengine MediaKit enhance-image."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import enhance_image, mediakit_enabled
from app.services.vision.rehost import rehost_image_bytes

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

    if user_id:
        filename = "upscale.png" if fmt == "png" else "upscale.jpg"
        content_type = "image/png" if fmt == "png" else "image/jpeg"
        image_out = rehost_image_bytes(
            user_id, raw, filename=filename, content_type=content_type
        )
    else:
        buf = io.BytesIO()
        if fmt == "png":
            img.convert("RGBA" if "A" in img.getbands() else "RGB").save(buf, format="PNG")
            ctype = "image/png"
        else:
            img.convert("RGB").save(buf, format="JPEG", quality=92)
            ctype = "image/jpeg"
        import base64

        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        image_out = f"data:{ctype};base64,{b64}"

    return {
        "image": image_out,
        "kind": "upscale",
        "engine": "mediakit:enhance-image",
        "model": f"mediakit:{version}",
        "mode": "mediakit",
        "width": width,
        "height": height,
    }
