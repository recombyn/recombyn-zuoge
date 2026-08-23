"""Stateless LaMa inpaint — used by editText background erase."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from image_layer_pipeline.stages.inpainting import inpaint_once


def inpaint_image_bytes(
    image_bytes: bytes,
    mask_bytes: bytes,
    *,
    backend: str = "lama",
) -> bytes:
    if not image_bytes:
        raise ValueError("empty image")
    if not mask_bytes:
        raise ValueError("empty mask")

    rgb = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"), dtype=np.uint8)
    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L").resize(
        (rgb.shape[1], rgb.shape[0]),
        Image.Resampling.NEAREST,
    )
    mask = np.asarray(mask_img, dtype=np.uint8)
    result = inpaint_once(rgb, mask, backend=backend)
    buf = io.BytesIO()
    Image.fromarray(result, mode="RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()
