"""Tests for mockup depth-driven UV warp."""

from __future__ import annotations

import numpy as np
from PIL import Image

from mockup_pipeline.depth_warp import depth_to_uv_offset, estimate_depth_for_mockup
from mockup_pipeline.renderer import IndustrialMockupRenderer
from mockup_pipeline.templates_builtin import demo_cylinder_template


def test_depth_to_uv_offset_shape():
    depth = np.linspace(0, 1, 64 * 48, dtype=np.float32).reshape(48, 64)
    off = depth_to_uv_offset(depth, strength=0.02)
    assert off.shape == (48, 64, 2)


def test_renderer_depth_warp_enabled(monkeypatch):
    template = demo_cylinder_template(width=160, height=200)
    assert template.meta.get("depth_warp") is True
    design = Image.new("RGBA", (128, 128), (10, 180, 90, 255))
    out = IndustrialMockupRenderer().render_rgba(template, design)
    assert out.size == (160, 200)


def test_estimate_depth_for_mockup_matches_template_size():
    base = np.full((30, 40, 3), 0.5, dtype=np.float32)
    depth = estimate_depth_for_mockup(base)
    assert depth.shape == (30, 40)
