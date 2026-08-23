"""Smart eraser service — LaMa inpaint with mask dilation + seam blend."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from image_layer_pipeline.stages.eraser import erase_regions


def erase_image_bytes(
    image_bytes: bytes,
    mask_bytes: bytes,
    *,
    dilate_px: int = 10,
    backend: str = "lama",
    seam_radius: int = 8,
) -> tuple[bytes, dict[str, object]]:
    if not image_bytes:
        raise ValueError("empty image")
    if not mask_bytes:
        raise ValueError("empty mask")

    rgb = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"), dtype=np.uint8)
    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L")
    mask = np.asarray(mask_img.resize((rgb.shape[1], rgb.shape[0]), Image.Resampling.NEAREST), dtype=np.uint8)

    result, meta = erase_regions(
        rgb,
        mask,
        dilate_px=dilate_px,
        backend=backend,
        seam_radius=seam_radius,
    )
    buf = io.BytesIO()
    Image.fromarray(result, mode="RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue(), meta
