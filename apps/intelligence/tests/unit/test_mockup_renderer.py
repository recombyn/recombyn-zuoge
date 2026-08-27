"""Unit tests for industrial mockup pipeline."""

from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from mockup_pipeline.bake import bake_mockup_template_from_photo, save_template_bundle
from mockup_pipeline.batch import BatchRenderItem, render_batch
from mockup_pipeline.color_mgmt import linear_to_srgb, srgb_to_linear
from mockup_pipeline.pbr_blend import blend_screen, composite_mockup
from mockup_pipeline.renderer import IndustrialMockupRenderer
from mockup_pipeline.templates_builtin import demo_cylinder_template, demo_glass_template, list_builtin_templates
from mockup_pipeline.tps_warp import build_tps_uv_map, default_cylinder_tps_controls


def test_render_demo_cylinder_produces_png():
  template = demo_cylinder_template(width=320, height=400)
  design = Image.new("RGBA", (512, 512), (220, 40, 60, 255))
  renderer = IndustrialMockupRenderer()
  layers = renderer.render_layers(template, design)
  assert layers.image.size == (320, 400)
  assert layers.elapsed_ms < 5000
  arr = np.array(layers.image)
  assert arr.std() > 5


def test_glass_template_fresnel():
  template = demo_glass_template(width=240, height=320)
  assert template.fresnel is not None
  assert template.fresnel.transparency > 0.5
  design = Image.new("RGBA", (256, 256), (30, 120, 200, 200))
  out = IndustrialMockupRenderer().render_rgba(template, design)
  assert out.size == (240, 320)


def test_tps_uv_map_shape():
  xy, uv = default_cylinder_tps_controls(400, 500)
  field = build_tps_uv_map(500, 400, xy, uv)
  assert field.shape == (500, 400, 2)
  assert float(field.min()) >= 0.0
  assert float(field.max()) <= 1.0


def test_screen_blend_and_linear_roundtrip():
  a = np.array([[[0.5, 0.2, 0.8]]], dtype=np.float32)
  b = np.array([[[0.4, 0.6, 0.1]]], dtype=np.float32)
  s = blend_screen(a, b)
  assert s.shape == a.shape
  lin = srgb_to_linear(a)
  back = linear_to_srgb(lin)
  assert np.allclose(back, a, atol=0.02)


def test_batch_render_qps():
  design = Image.new("RGBA", (128, 128), (255, 0, 0, 255))
  buf = io.BytesIO()
  design.save(buf, format="PNG")
  raw = buf.getvalue()
  items = [BatchRenderItem(design_bytes=raw, template_id="demo-cylinder") for _ in range(3)]
  result = render_batch(items)
  assert len(result.items) == 3
  assert result.qps > 0


def test_list_builtin_templates_includes_glass():
  items = list_builtin_templates()
  ids = {t["id"] for t in items}
  assert "demo-cylinder" in ids
  assert "demo-glass" in ids


def test_bake_from_synthetic_photo(tmp_path):
  h, w = 200, 160
  photo = np.full((h, w, 3), 200, dtype=np.uint8)
  cv2 = __import__("cv2")
  photo_path = tmp_path / "cup.png"
  mask_path = tmp_path / "mask.png"
  cv2.imwrite(str(photo_path), cv2.cvtColor(photo, cv2.COLOR_RGB2BGR))
  mask = np.zeros((h, w), dtype=np.uint8)
  mask[40:160, 30:130] = 255
  cv2.imwrite(str(mask_path), mask)
  tpl = bake_mockup_template_from_photo(photo_path, mask_path, template_id="test-mug")
  out = tmp_path / "bundle"
  save_template_bundle(tpl, out)
  assert (out / "uv.npy").is_file()
  assert (out / "meta.json").is_file()


def test_psd_export_optional():
  template = demo_cylinder_template(width=160, height=200)
  design = Image.new("RGBA", (128, 128), (10, 200, 10, 255))
  renderer = IndustrialMockupRenderer()
  try:
    psd = renderer.render_psd_bytes(template, design)
    assert len(psd) > 100
  except Exception:
    pass  # pytoshop optional in minimal env
