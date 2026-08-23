"""Super-resolution service — Real-ESRGAN tiled inference."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from image_layer_pipeline.stages.upscale import upscale_image

# 2K ≈ 2048 long edge, 4K ≈ 4096
_RESOLUTION_LONG_EDGE = {
    "2K": 2048,
    "4K": 4096,
    "2k": 2048,
    "4k": 4096,
}


def upscale_image_bytes(
    image_bytes: bytes,
    *,
    resolution: str = "4K",
    target_long_edge: int | None = None,
) -> tuple[bytes, dict[str, object]]:
    if not image_bytes:
        raise ValueError("empty image")

    rgb = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"), dtype=np.uint8)
    long_edge = target_long_edge
    if long_edge is None:
        key = (resolution or "4K").strip()
        long_edge = _RESOLUTION_LONG_EDGE.get(key, 4096)

    result, meta = upscale_image(rgb, target_long_edge=int(long_edge))
    buf = io.BytesIO()
    Image.fromarray(result, mode="RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue(), meta
