"""Background removal (抠图) — Volcengine AI MediaKit sync API."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import mediakit_enabled, remove_image_background
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "抠图需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


async def remove_background(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Cut out the main subject via MediaKit ``remove-image-background``.

    Keeps whatever canvas MediaKit returns (PNG with transparency by default).
    Brush hint masks from older ILP flows are ignored — MediaKit has no mask input.

    Returns ``{ image, kind, engine, model, mode, width, height, scene? }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    m = meta or {}
    if m.get("includeMask") or m.get("excludeMask"):
        logger.info("removeBg: MediaKit ignores includeMask/excludeMask brush hints")

    out = await remove_image_background(image, meta=m)
    png_bytes = out["image_bytes"]
    rgba = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    image_out = rehost_image_bytes(user_id, png_bytes, filename="removeBg.png")
    width = int(out.get("width") or rgba.width)
    height = int(out.get("height") or rgba.height)
    scene = str(out.get("scene") or "general")
    return {
        "image": image_out,
        "kind": "removeBg",
        "engine": "mediakit:remove-image-background",
        "model": f"mediakit:{scene}",
        "mode": "mediakit",
        "scene": scene,
        "width": width,
        "height": height,
    }
