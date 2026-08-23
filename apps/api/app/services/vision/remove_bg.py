"""Background removal (抠图) — Recombyn Intelligence industrial matting only."""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.ilp_client import ilp_enabled, segment_foreground_via_ilp

logger = logging.getLogger(__name__)

_ILP_REQUIRED_MSG = (
    "工业抠图需要接入 Recombyn Intelligence 闭源服务（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)


def _png_data_url_from_pil(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _trim_transparent(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    pad = 2
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


async def remove_background(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Cut out the main subject via intelligence BiRefNet matting.

    Returns ``{ image, kind, engine, model, mode, width, height }``.
    """
    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    model_name = str((meta or {}).get("segmentationModel") or "birefnet-general").strip() or "birefnet-general"
    png_bytes, _ctype = await segment_foreground_via_ilp(image, model=model_name)
    rgba = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    rgba = _trim_transparent(rgba)
    return {
        "image": _png_data_url_from_pil(rgba),
        "kind": "removeBg",
        "engine": "ilp:birefnet",
        "model": model_name,
        "mode": "ilp",
        "width": int(rgba.width),
        "height": int(rgba.height),
    }
