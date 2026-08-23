"""Tests for unified matting entry."""

from __future__ import annotations

import numpy as np
import pytest

from image_layer_pipeline.matting import run_matting


def test_run_matting_returns_rgba_and_engines(monkeypatch):
    rgb = np.full((64, 64, 3), 200, dtype=np.uint8)
    rgb[20:44, 20:44] = (40, 80, 160)

    def _fake_refined(image_rgb, **kwargs):
        h, w = image_rgb.shape[:2]
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[16:48, 16:48, 3] = 255
        rgba[16:48, 16:48, :3] = image_rgb[16:48, 16:48]
        binary = np.zeros((h, w), dtype=np.uint8)
        binary[16:48, 16:48] = 255
        return rgba, binary, []

    import image_layer_pipeline.stages.segment_refined as seg_ref

    monkeypatch.setattr(seg_ref, "segment_foreground_refined", _fake_refined)
    result = run_matting(rgb, scene="portrait", trim_output=False)

    assert result.foreground_rgba.shape == (64, 64, 4)
    assert result.route.scene == "portrait"
    assert "birefnet-portrait" in result.engines or "portrait" in str(result.engines)
