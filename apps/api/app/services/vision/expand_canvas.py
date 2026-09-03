"""Canvas expand / outpaint — Volcengine AI MediaKit sync API."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import expand_image_canvas, mediakit_enabled
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "扩图需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


async def expand_canvas(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Outpaint via MediaKit ``expand-image-canvas``.

    FE sends ``padLeft/Right/Top/Bottom`` (+ target size); ratios are derived
    relative to the source short side. Per-side >40% is split into progressive calls.

    Returns ``{ image, kind, engine, model, mode, width, height, steps? }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    out = await expand_image_canvas(image, meta=meta or {})
    raw = out["image_bytes"]
    img = Image.open(io.BytesIO(raw))
    fmt = str(out.get("format") or "jpeg").lower()
    filename = "expand.png" if fmt == "png" else "expand.jpg"
    content_type = "image/png" if fmt == "png" else "image/jpeg"
    image_out = rehost_image_bytes(
        user_id, raw, filename=filename, content_type=content_type
    )
    width = int(out.get("width") or img.width)
    height = int(out.get("height") or img.height)
    return {
        "image": image_out,
        "kind": "expand",
        "engine": "mediakit:expand-image-canvas",
        "model": "mediakit:expand",
        "mode": "mediakit",
        "width": width,
        "height": height,
        "steps": int(out.get("steps") or 1),
    }
