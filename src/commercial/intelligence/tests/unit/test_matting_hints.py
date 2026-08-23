"""Tests for matting brush hints."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.stages.matting_hints import apply_matting_hints


def test_apply_matting_hints_exclude_clears_alpha():
    h, w = 32, 32
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 3] = 255
    rgb = np.full((h, w, 3), 128, dtype=np.uint8)
    exclude = np.zeros((h, w), dtype=np.uint8)
    exclude[10:20, 10:20] = 255
    out = apply_matting_hints(rgba, rgb, exclude_mask=exclude, grow_similar=False)
    assert out[15, 15, 3] < 32


def test_apply_matting_hints_include_boosts_alpha():
    h, w = 32, 32
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[8:24, 8:24, 3] = 200
    rgb = np.full((h, w, 3), 90, dtype=np.uint8)
    include = np.zeros((h, w), dtype=np.uint8)
    include[14:18, 14:18] = 255
    out = apply_matting_hints(rgba, rgb, include_mask=include, grow_similar=False)
    assert out[16, 16, 3] > 200
