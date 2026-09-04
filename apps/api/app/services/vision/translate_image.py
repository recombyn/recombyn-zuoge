"""Image text translation — Volcengine MediaKit translate-image-text."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import mediakit_enabled, translate_image_text
from app.services.vision.rehost import encode_or_rehost_image, raster_filename_and_type

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "图像翻译需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


def _payload_for_output(raw: bytes, *, fmt: str, user_id: str | None) -> tuple[bytes, str, str]:
    """Return ``(bytes, filename, content_type)``."""
    filename, content_type = raster_filename_and_type(fmt, stem="translate")
    if user_id:
        return raw, filename, content_type
    img = Image.open(io.BytesIO(raw))
    buf = io.BytesIO()
    if content_type == "image/png":
        img.convert("RGBA" if "A" in img.getbands() else "RGB").save(buf, format="PNG")
    else:
        img.convert("RGB").save(buf, format="JPEG", quality=92)
    return buf.getvalue(), filename, content_type


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

    payload, filename, content_type = _payload_for_output(raw, fmt=fmt, user_id=user_id)
    image_out = encode_or_rehost_image(
        payload, user_id=user_id, filename=filename, content_type=content_type
    )

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
