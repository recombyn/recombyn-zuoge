"""Map intelligence detect-regions output → Mark tool response."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.services.vision.ilp_client import detect_regions_via_ilp, ilp_enabled

logger = logging.getLogger(__name__)


async def detect_regions_via_ilp_adapter(*, image: str) -> dict[str, Any]:
    """
    Propose text/subject boxes for the Mark tool.

    Returns ``{ image, layers, kind, width, height, engines, warnings }``.
    """
    if not ilp_enabled():
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    lang = str(getattr(settings, "ocr_lang", "ch") or "ch")
    payload = await detect_regions_via_ilp(image, lang=lang)
    logger.info(
        "ILP detect-regions: %sx%s layers=%s",
        payload.get("width"),
        payload.get("height"),
        len(payload.get("layers") or []),
    )

    w = int(payload.get("width") or 0)
    h = int(payload.get("height") or 0)
    layers_in = payload.get("layers") if isinstance(payload.get("layers"), list) else []
    layers: list[dict[str, Any]] = []
    for layer in layers_in:
        if not isinstance(layer, dict):
            continue
        item: dict[str, Any] = {
            "type": str(layer.get("type") or "image"),
            "x": float(layer.get("x") or 0),
            "y": float(layer.get("y") or 0),
            "width": max(1.0, float(layer.get("width") or 1)),
            "height": max(1.0, float(layer.get("height") or 1)),
            "name": str(layer.get("name") or "区域"),
        }
        if item["type"] == "text":
            item["text"] = str(layer.get("text") or "").strip() or None
        layers.append(item)

    return {
        "image": image,
        "layers": layers,
        "kind": "detectRegions",
        "width": w,
        "height": h,
        "engines": ["ilp:detect-regions"] + list(payload.get("engines") or []),
        "warnings": list(payload.get("warnings") or []),
    }
