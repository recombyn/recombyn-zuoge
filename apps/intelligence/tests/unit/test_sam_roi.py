"""Tests for SAM ROI proposals."""

from __future__ import annotations

import numpy as np


def test_opencv_proposals_returns_subject_bbox(monkeypatch):
    from image_layer_pipeline.stages import sam_roi as mod

    monkeypatch.setenv("ILP_SAM_BACKEND", "opencv")
    rgb = np.zeros((80, 120, 3), dtype=np.uint8)
    rgb[20:60, 30:90] = (200, 80, 40)

    regions = mod.propose_sam_regions(rgb, max_regions=4)
    assert len(regions) >= 1
    primary = mod.select_primary_region(regions, image_w=120, image_h=80)
    assert primary is not None
    assert primary.width > 10
    assert primary.height > 10


def test_crop_and_paste_roundtrip():
    from image_layer_pipeline.stages.sam_roi import SamRegion, crop_roi, paste_rgba_crop

    rgb = np.zeros((40, 50, 3), dtype=np.uint8)
    region = SamRegion(x=10, y=8, width=20, height=18, score=0.9, id="sam-0")
    crop, ox, oy = crop_roi(rgb, region)
    assert crop.shape[0] >= 18
    rgba = np.zeros((crop.shape[0], crop.shape[1], 4), dtype=np.uint8)
    rgba[:, :, 3] = 255
    full = paste_rgba_crop(rgb.shape, rgba, ox, oy)
    assert full.shape == (40, 50, 4)
    assert int(full.sum()) > 0
