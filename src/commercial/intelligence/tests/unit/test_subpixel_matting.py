"""Unit tests for subpixel matting post-process."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.stages.subpixel_matting import (
    refine_alpha_subpixel,
    trim_rgba_bbox,
)


def _fake_rgba(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    rgb = np.full((h, w, 3), 180, dtype=np.uint8)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[20:60, 30:90, 3] = 255
    return rgb, rgba


def test_refine_alpha_subpixel_preserves_shape():
    rgb, rgba = _fake_rgba(80, 120)
    out = refine_alpha_subpixel(rgb, rgba)
    assert out.shape == rgba.shape
    assert out.dtype == np.uint8
    assert int(out[:, :, 3].max()) > 0


def test_trim_rgba_bbox_subpixel_pad():
    _, rgba = _fake_rgba(80, 120)
    cropped, meta = trim_rgba_bbox(rgba, pad=2.0)
    assert cropped.shape[0] <= rgba.shape[0]
    assert cropped.shape[1] <= rgba.shape[1]
    assert meta["trimX"] >= 0
    assert meta["trimY"] >= 0
    assert meta["originWidth"] == 120.0
    assert meta["originHeight"] == 80.0
