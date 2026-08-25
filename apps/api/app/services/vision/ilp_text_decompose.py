"""Map intelligence text-decompose output → editText decompose response."""

from __future__ import annotations

import base64
import logging
from typing import Any, Literal

from app.core.config import settings
from app.services.vision.ilp_client import (
    bytes_to_data_url,
    ilp_enabled,
    text_decompose_via_ilp,
)
from app.services.vision.rehost import rehost_image_bytes
from app.services.vision.text_layer_style import enrich_text_layers, load_bgr

logger = logging.getLogger(__name__)

EditMode = Literal["editElements", "editText"]


def _rehost_or_data_url(
    user_id: str | None,
    data: bytes,
    *,
    filename: str,
    content_type: str = "image/png",
) -> str:
    url = rehost_image_bytes(
        user_id,
        data,
        filename=filename,
        content_type=content_type,
    )
    return url or bytes_to_data_url(data, content_type)


async def decompose_text_via_ilp(
    *,
    kind: EditMode,
    image: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Run OCR + inpaint on intelligence; returns BFF layer payload.

    Font/color enrichment still runs locally on the original image.
    """
    if kind != "editText":
        raise ValueError("ILP text decompose only supports editText")
    if not ilp_enabled():
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    min_conf = float(getattr(settings, "ocr_text_min_confidence", 0.72) or 0.72)
    lang = str(getattr(settings, "ocr_lang", "ch") or "ch")

    payload = await text_decompose_via_ilp(
        image,
        lang=lang,
        min_confidence=min_conf,
    )
    logger.info("ILP text-decompose: %sx%s blocks=%s raster=%s", payload.get("width"), payload.get("height"), len(payload.get("editable_blocks") or []), len(payload.get("raster_layers") or []))

    w = int(payload.get("width") or 0)
    h = int(payload.get("height") or 0)
    bg_b64 = str(payload.get("background_b64") or "")
    if not bg_b64:
        raise RuntimeError("ILP text-decompose returned no background")

    bg_bytes = base64.b64decode(bg_b64)
    bg_src = _rehost_or_data_url(user_id, bg_bytes, filename="editText-bg.png")

    bgr = await load_bgr(image)
    editable_blocks = payload.get("editable_blocks") if isinstance(payload.get("editable_blocks"), list) else []
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
            for b in editable_blocks
            if str(b.get("text") or "").strip()
        ],
    )

    raster_layers: list[dict[str, Any]] = []
    for i, layer in enumerate(payload.get("raster_layers") or []):
        if not isinstance(layer, dict):
            continue
        png_b64 = str(layer.get("png_b64") or "").strip()
        if not png_b64:
            continue
        png_bytes = base64.b64decode(png_b64)
        raster_layers.append(
            {
                "type": "image",
                "src": _rehost_or_data_url(
                    user_id,
                    png_bytes,
                    filename=f"editText-raster-{i + 1}.png",
                ),
                "x": float(layer.get("x") or 0),
                "y": float(layer.get("y") or 0),
                "width": max(1.0, float(layer.get("width") or 1)),
                "height": max(1.0, float(layer.get("height") or 1)),
                "name": str(layer.get("name") or "文字图"),
                "letteringText": layer.get("letteringText"),
                "ocrScore": layer.get("ocrScore"),
            }
        )

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
    layers.extend(raster_layers)
    layers.extend(text_layers)

    warnings = list(payload.get("warnings") or [])
    engines = list(payload.get("engines") or [])
    if text_layers:
        engines.append("text-style")

    if not text_layers and not raster_layers:
        layers = [
            {
                "type": "image",
                "src": bg_src,
                "x": 0.0,
                "y": 0.0,
                "width": float(w),
                "height": float(h),
                "name": "原图",
            }
        ]

    return {
        "image": bg_src if text_layers or raster_layers else layers[0]["src"],
        "layers": layers,
        "kind": kind,
        "width": w,
        "height": h,
        "engines": ["ilp:text-decompose"] + engines,
        "warnings": warnings,
    }
