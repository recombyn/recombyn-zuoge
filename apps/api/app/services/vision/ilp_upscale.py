"""Super-resolution (放大) — Recombyn Intelligence Real-ESRGAN only."""

from __future__ import annotations

import base64
import io
from typing import Any

from PIL import Image

from app.services.vision.ilp_client import ilp_enabled, upscale_via_ilp

_ILP_REQUIRED_MSG = (
    "高清放大需要接入 Recombyn Intelligence 闭源服务（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)


def _png_data_url_from_bytes(png: bytes) -> str:
    b64 = base64.b64encode(png).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _target_long_edge(
    *,
    resolution: str | None,
    meta: dict[str, Any] | None,
) -> int | None:
    m = meta or {}
    tw = int(m.get("targetWidth") or 0)
    th = int(m.get("targetHeight") or 0)
    if tw > 0 or th > 0:
        return max(tw, th)
    res = str(m.get("resolution") or resolution or "").strip().upper()
    if res == "2K":
        return 2048
    if res == "4K":
        return 4096
    return None


async def upscale_image_via_ilp(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    resolution: str | None = None,
) -> dict[str, Any]:
    """
    Upscale via intelligence Real-ESRGAN (tiled ONNX).

    Returns ``{ image, kind, engine, mode, width, height }``.
    """
    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    m = meta or {}
    res = str(m.get("resolution") or resolution or "4K").strip() or "4K"
    long_edge = _target_long_edge(resolution=res, meta=m)
    png_bytes, engine = await upscale_via_ilp(
        image,
        resolution=res,
        target_long_edge=long_edge,
    )
    rgb = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    return {
        "image": _png_data_url_from_bytes(png_bytes),
        "kind": "upscale",
        "engine": f"ilp:{engine or 'realesrgan'}",
        "mode": "ilp",
        "width": int(rgb.width),
        "height": int(rgb.height),
    }
