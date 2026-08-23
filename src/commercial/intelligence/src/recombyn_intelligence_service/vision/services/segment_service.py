"""Matting service — delegates to unified ``run_matting``."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from image_layer_pipeline.matting import matting_png_bytes, run_matting
from image_layer_pipeline.stages.matting_hints import mask_from_bytes


def segment_foreground_rgba(
    image_bytes: bytes,
    *,
    model_name: str = "",
    decontaminate: float = 0.65,
    include_mask_bytes: bytes | None = None,
    exclude_mask_bytes: bytes | None = None,
) -> tuple[bytes, list[str]]:
    if not image_bytes:
        raise ValueError("empty upload")
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_rgb = np.asarray(pil, dtype=np.uint8)
    h, w = image_rgb.shape[:2]
    inc = mask_from_bytes(include_mask_bytes or b"", h=h, w=w)
    exc = mask_from_bytes(exclude_mask_bytes or b"", h=h, w=w)

    result = run_matting(
        image_rgb,
        scene="auto",
        model=model_name.strip() or None,
        decontaminate=decontaminate,
        include_mask=inc,
        exclude_mask=exc,
        trim_output=True,
    )
    return matting_png_bytes(result), result.engines
