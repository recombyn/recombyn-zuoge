"""Mockup render service."""

from __future__ import annotations

import io

from PIL import Image

from mockup_pipeline.loader import load_template
from mockup_pipeline.renderer import IndustrialMockupRenderer
from recombyn_intelligence_service.mockup.config import settings


def render_mockup_png(
  design_bytes: bytes,
  *,
  template_id: str = "demo-cylinder",
) -> tuple[bytes, dict]:
  if not design_bytes:
    raise ValueError("empty design image")

  template = load_template(template_id, settings.templates_dir)
  design = Image.open(io.BytesIO(design_bytes))
  renderer = IndustrialMockupRenderer()
  layers = renderer.render_layers(template, design)
  png = renderer.render_png_bytes(template, design)
  meta = {
    "template_id": template.template_id,
    "template_name": template.name,
    "width": template.width,
    "height": template.height,
    "elapsed_ms": round(layers.elapsed_ms, 2),
    "engine": "mockup:2.5d-pbr",
    "features": {
      "uv_mode": (template.meta or {}).get("uv_mode", "dense"),
      "tps": (template.meta or {}).get("uv_mode") == "tps",
      "fresnel": template.fresnel is not None,
      "glass": template.supports_transparency,
      "normal_map": template.normal_map is not None,
      "env_reflection": template.env_reflection_map is not None,
    },
  }
  return png, meta


def render_mockup_psd(
  design_bytes: bytes,
  *,
  template_id: str = "demo-cylinder",
) -> tuple[bytes, dict]:
  if not design_bytes:
    raise ValueError("empty design image")
  template = load_template(template_id, settings.templates_dir)
  design = Image.open(io.BytesIO(design_bytes))
  renderer = IndustrialMockupRenderer()
  psd = renderer.render_psd_bytes(template, design)
  meta = {
    "template_id": template.template_id,
    "format": "psd",
    "engine": "mockup:2.5d-pbr-psd",
  }
  return psd, meta
