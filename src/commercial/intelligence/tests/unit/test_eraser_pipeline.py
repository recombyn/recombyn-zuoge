"""Tests for eraser pipeline (mask dilate + seam blend)."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.stages.eraser.pipeline import erase_regions


def test_erase_regions_calls_inpaint(monkeypatch):
    rgb = np.full((16, 16, 3), 180, dtype=np.uint8)
    mask = np.zeros((16, 16), dtype=np.uint8)
    mask[4:12, 4:12] = 255

    def fake_inpaint(image_rgb, repair_mask, backend="lama"):
        out = image_rgb.copy()
        out[repair_mask > 127] = (0, 255, 0)
        return out

    monkeypatch.setattr("image_layer_pipeline.stages.eraser.pipeline.inpaint_once", fake_inpaint)

    result, meta = erase_regions(rgb, mask, dilate_px=2)
    assert result.shape == rgb.shape
    assert meta["dilate_px"] == 2
    assert result[8, 8, 1] == 255
