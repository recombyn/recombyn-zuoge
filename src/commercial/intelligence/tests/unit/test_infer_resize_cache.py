"""Tests for inference long-edge resize + matting cache."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.infer_resize import (
    fit_long_edge_scale,
    resize_rgb,
    upscale_mask,
    upscale_rgba,
)
from image_layer_pipeline.matting import run_matting


def test_fit_long_edge_scale_caps(monkeypatch):
    monkeypatch.setenv("ILP_INFER_MAX_LONG_EDGE", "1024")
    assert fit_long_edge_scale(800, 600) == 1.0
    s = fit_long_edge_scale(4096, 2048)
    assert abs(s * 4096 - 1024) < 1.0


def test_resize_roundtrip_rgba(monkeypatch):
    monkeypatch.setenv("ILP_INFER_MAX_LONG_EDGE", "128")
    rgb = np.zeros((400, 200, 3), dtype=np.uint8)
    rgb[50:150, 40:160] = (10, 20, 30)
    scale = fit_long_edge_scale(400, 200)
    small = resize_rgb(rgb, scale)
    assert max(small.shape[0], small.shape[1]) <= 128
    rgba = np.zeros((small.shape[0], small.shape[1], 4), dtype=np.uint8)
    rgba[:, :, :3] = small
    rgba[:, :, 3] = 255
    big = upscale_rgba(rgba, 400, 200)
    assert big.shape == (400, 200, 4)
    mask = upscale_mask(rgba[:, :, 3], 400, 200)
    assert mask.shape == (400, 200)


def test_run_matting_scales_and_caches(monkeypatch, tmp_path):
    monkeypatch.setenv("ILP_INFER_MAX_LONG_EDGE", "64")
    monkeypatch.setenv("ILP_MATTING_CACHE", "1")
    monkeypatch.setenv("ILP_MATTING_CACHE_DIR", str(tmp_path))

    calls = {"n": 0}

    def _fake_refined(image_rgb, **kwargs):
        calls["n"] += 1
        h, w = image_rgb.shape[:2]
        # Must run on capped size
        assert max(h, w) <= 64
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, 3] = 200
        rgba[:, :, :3] = image_rgb
        binary = np.full((h, w), 200, dtype=np.uint8)
        return rgba, binary, [{"box": [1, 2, 3, 4]}]

    import image_layer_pipeline.matting as matting_mod

    monkeypatch.setattr(matting_mod, "segment_foreground_refined", _fake_refined)

    rgb = np.full((200, 100, 3), 120, dtype=np.uint8)
    first = run_matting(rgb, scene="general", trim_output=False, use_sam_roi=False)
    assert first.foreground_rgba.shape == (200, 100, 4)
    assert "infer-resize" in first.engines
    assert calls["n"] == 1

    second = run_matting(rgb, scene="general", trim_output=False, use_sam_roi=False)
    assert second.foreground_rgba.shape == (200, 100, 4)
    assert "matting-cache" in second.engines
    assert calls["n"] == 1  # cache hit — no second model call
