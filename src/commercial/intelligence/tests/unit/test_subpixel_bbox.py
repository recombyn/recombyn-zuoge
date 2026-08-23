"""Tests for subpixel bbox helpers."""

from __future__ import annotations

from image_layer_pipeline.stages.subpixel import rect_from_region, snap_inset


def test_snap_inset_floor_ceil():
    x, y, w, h = snap_inset(10.3, 20.8, 30.2, 15.1, pad=1.0, max_w=200, max_h=200)
    assert x == 9
    assert y == 19
    assert w >= 32
    assert h >= 17


def test_rect_from_region_clamps_to_canvas():
    region = {"x": 5.5, "y": 6.5, "width": 20.0, "height": 10.0}
    x, y, w, h = rect_from_region(region, pad=2.0, max_w=40, max_h=30)
    assert x >= 0
    assert y >= 0
    assert x + w <= 40
    assert y + h <= 30
