"""Smart alpha eraser — expand brush hint to full region, then punch transparency."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from image_layer_pipeline.stages.matting_hints import apply_matting_hints, mask_from_bytes


def erase_alpha_bytes(image_bytes: bytes, mask_bytes: bytes) -> tuple[bytes, dict[str, object]]:
    if not image_bytes:
        raise ValueError("empty image")
    if not mask_bytes:
        raise ValueError("empty mask")

    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_rgb = np.asarray(pil, dtype=np.uint8)
    h, w = image_rgb.shape[:2]
    exc = mask_from_bytes(mask_bytes, h=h, w=w)
    if exc is None or not np.any(exc):
        raise ValueError("empty erase mask")

    rgba = np.dstack([image_rgb, np.full((h, w), 255, dtype=np.uint8)])
    rgba = apply_matting_hints(
        rgba,
        image_rgb,
        exclude_mask=exc,
        grow_similar=True,
    )

    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    meta: dict[str, object] = {
        "engine": "ilp:erase-alpha",
        "engines": ["matting-hints", "grow-similar", "grabcut"],
    }
    return buf.getvalue(), meta
