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


async def remove_background(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Cut out the main subject via intelligence BiRefNet matting.

    Keeps the original canvas size (transparent outside the subject) — no bbox trim.

    Returns ``{ image, kind, engine, model, mode, width, height }``.
    """
    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    model_name = str((meta or {}).get("segmentationModel") or "birefnet-general").strip() or "birefnet-general"
    # Stronger edge decontaminate reduces dark fringe / black halo on hard product edges.
    png_bytes, _ctype = await segment_foreground_via_ilp(
        image, model=model_name, decontaminate=0.85
    )
    rgba = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return {
        "image": _png_data_url_from_pil(rgba),
        "kind": "removeBg",
        "engine": "ilp:birefnet",
        "model": model_name,
        "mode": "ilp",
        "width": int(rgba.width),
        "height": int(rgba.height),
    }
