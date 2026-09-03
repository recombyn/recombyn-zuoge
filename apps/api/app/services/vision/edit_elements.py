"""Image layer decompose — Seedream 5.0 Pro or WaveSpeed layered."""

from __future__ import annotations

import base64
import io
import logging
from collections.abc import Callable
from typing import Any

from PIL import Image

from app.services.vision.providers.registry import resolve_edit_elements_provider
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

ProgressCb = Callable[[int, str], None] | None


def _layer_src(user_id: str | None, raw: bytes, index: int) -> str:
    if user_id:
        return rehost_image_bytes(
            user_id,
            raw,
            filename=f"editElements-layer-{index + 1}.png",
            content_type="image/png",
        )
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


async def _via_wavespeed(
    image: str,
    *,
    meta: dict[str, Any] | None,
    user_id: str | None,
    on_progress: ProgressCb,
) -> dict[str, Any]:
    from app.services.vision.providers.wavespeed import run_layered

    out = await run_layered(
        image, meta=meta, user_id=user_id, on_progress=on_progress
    )
    layers_bytes: list[bytes] = list(out.get("layers_bytes") or [])
    if not layers_bytes:
        raise RuntimeError("WaveSpeed layered returned no layers")

    width = int(out.get("width") or 0)
    height = int(out.get("height") or 0)
    layers: list[dict[str, Any]] = []
    for i, raw in enumerate(layers_bytes):
        if width <= 0 or height <= 0:
            with Image.open(io.BytesIO(raw)) as img:
                width, height = int(img.width), int(img.height)
        src = _layer_src(user_id, raw, i)
        layers.append(
            {
                "type": "image",
                "src": src,
                "x": 0.0,
                "y": 0.0,
                "width": float(width),
                "height": float(height),
                "name": f"Layer {i + 1}",
            }
        )
    return {
        "image": layers[0]["src"],
        "layers": layers,
        "kind": "editElements",
        "width": width,
        "height": height,
        "engines": ["wavespeed:qwen-image/layered"],
        "warnings": [],
        "model": str(out.get("model") or "wavespeed-ai/qwen-image/layered"),
    }


async def _via_seedream(
    image: str,
    *,
    meta: dict[str, Any] | None,
    user_id: str | None,
    on_progress: ProgressCb,
) -> dict[str, Any]:
    from app.services.vision.providers.seedream import run_layered

    out = await run_layered(
        image, meta=meta, user_id=user_id, on_progress=on_progress
    )
    rows: list[dict[str, Any]] = list(out.get("layers") or [])
    if not rows:
        raise RuntimeError("Seedream layered returned no layers")

    width = int(out.get("canvas_width") or 0)
    height = int(out.get("canvas_height") or 0)
    layers: list[dict[str, Any]] = []
    for i, row in enumerate(rows):
        raw = row["bytes"]
        src = _layer_src(user_id, raw, i)
        layers.append(
            {
                "type": "image",
                "src": src,
                "x": float(row.get("x") or 0),
                "y": float(row.get("y") or 0),
                "width": float(row.get("width") or 0),
                "height": float(row.get("height") or 0),
                "name": str(row.get("name") or f"Layer {i + 1}"),
            }
        )
    if width <= 0 or height <= 0:
        width = int(layers[0]["width"])
        height = int(layers[0]["height"])

    return {
        "image": layers[0]["src"],
        "layers": layers,
        "kind": "editElements",
        "width": width,
        "height": height,
        "engines": [str(out.get("engine") or "seedream:layer_decomposition")],
        "warnings": [],
        "model": str(out.get("model") or "doubao-seedream-5-0-pro-260628"),
    }


async def edit_elements_layered(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    on_progress: ProgressCb = None,
) -> dict[str, Any]:
    """
    Split one raster into layers.

    Provider from ``VISION_EDIT_ELEMENTS_PROVIDER`` (``seedream`` | ``wavespeed``).
    Returns ``{ image, layers, kind, width, height, engines, warnings }``.
    """
    provider = resolve_edit_elements_provider()
    if provider == "seedream":
        return await _via_seedream(
            image, meta=meta, user_id=user_id, on_progress=on_progress
        )
    return await _via_wavespeed(
        image, meta=meta, user_id=user_id, on_progress=on_progress
    )
