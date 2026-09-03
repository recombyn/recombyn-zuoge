"""editText — MediaKit OCR + text erase, then local font/color enrichment."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from app.core.config import settings
from app.services.vision.mediakit_client import (
    erase_image,
    image_ocr,
    mediakit_enabled,
)
from app.services.vision.rehost import rehost_image_bytes
from app.services.vision.text_layer_style import enrich_text_layers, load_bgr

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "编辑文字需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


async def decompose_edit_text(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Split an image into editable text layers + cleaned background.

    1. MediaKit ``image-ocr`` → text boxes
    2. MediaKit ``erase-image`` (full_screen_text_erase) → background
    3. Local style enrichment (font size / fill from source pixels)
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    m = meta or {}
    min_conf = float(getattr(settings, "ocr_text_min_confidence", 0.72) or 0.72)
    ocr_meta = {
        "tool_version": str(m.get("toolVersion") or m.get("tool_version") or "max"),
    }
    ocr = await image_ocr(image, meta=ocr_meta)
    blocks = list(ocr.get("blocks") or [])
    if min_conf > 0:
        filtered: list[dict[str, Any]] = []
        for block in blocks:
            conf = block.get("confidence")
            # ``max`` OCR may omit confidence — keep those blocks.
            if conf is None or float(conf) >= min_conf:
                filtered.append(block)
        blocks = filtered

    erase = await erase_image(
        image,
        meta={
            "standard_scene": "full_screen_text_erase",
            "output_format": "png",
            "tool_version": "standard",
        },
    )
    bg_bytes = erase["image_bytes"]
    bg_img = Image.open(io.BytesIO(bg_bytes))
    w = int(erase.get("width") or bg_img.width)
    h = int(erase.get("height") or bg_img.height)
    bg_src = rehost_image_bytes(user_id, bg_bytes, filename="editText-bg.png")

    bgr = await load_bgr(image)
    text_layers = enrich_text_layers(
        bgr,
        [
            {
                "type": "text",
                "text": str(b.get("text") or ""),
                "x": b.get("x"),
                "y": b.get("y"),
                "width": b.get("width"),
                "height": b.get("height"),
                "font_size": b.get("font_size"),
            }
            for b in blocks
            if str(b.get("text") or "").strip()
        ],
    )

    if not text_layers:
        raise RuntimeError("MediaKit OCR found no editable text")

    layers: list[dict[str, Any]] = [
        {
            "type": "image",
            "src": bg_src,
            "x": 0.0,
            "y": 0.0,
            "width": float(w),
            "height": float(h),
            "name": "背景",
        }
    ]
    layers.extend(text_layers)

    engines = [
        "mediakit:image-ocr",
        "mediakit:erase-image",
    ]
    if text_layers:
        engines.append("text-style")

    logger.info(
        "MediaKit editText: %sx%s blocks=%s version=%s",
        w,
        h,
        len(text_layers),
        ocr.get("tool_version"),
    )

    return {
        "image": bg_src,
        "layers": layers,
        "kind": "editText",
        "width": w,
        "height": h,
        "engine": "mediakit:editText",
        "mode": "mediakit",
        "model": f"mediakit:ocr:{ocr.get('tool_version') or 'max'}",
        "engines": engines,
        "warnings": [],
    }
