"""Image text translation — Volcengine MediaKit translate-image-text."""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import mediakit_enabled, translate_image_text
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "图像翻译需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


async def translate_image(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Translate on-image text via MediaKit ``translate-image-text``.

    Meta: ``targetLang`` (required, default zh), optional ``sourceLang``,
    ``toolVersion`` (default seed-translation).

    Returns ``{ image, kind, engine, model, mode, width, height, targetLang }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    out = await translate_image_text(image, meta=meta)
    raw = out["image_bytes"]
    img = Image.open(io.BytesIO(raw))
    width = int(out.get("width") or img.width)
    height = int(out.get("height") or img.height)
    fmt = str(out.get("format") or "png").lower()
    version = str(out.get("tool_version") or "seed-translation")
    target = str(out.get("target_lang") or "zh")

    if user_id:
        filename = "translate.png" if fmt == "png" else "translate.jpg"
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
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        image_out = f"data:{ctype};base64,{b64}"

    return {
        "image": image_out,
        "kind": "translateImage",
        "engine": "mediakit:translate-image-text",
        "model": f"mediakit:{version}",
        "mode": "mediakit",
        "width": width,
        "height": height,
        "targetLang": target,
    }
