"""Built-in procedural mockup templates (no external assets required)."""

from __future__ import annotations

import numpy as np

from mockup_pipeline.normal_displace import estimate_normal_from_luminance
from mockup_pipeline.tps_warp import build_tps_uv_map, default_cylinder_tps_controls
from mockup_pipeline.types import FresnelParams, MockupTemplate
from mockup_pipeline.uv_remap import build_cylinder_uv_map


def _ellipse_mask(h: int, w: int, cx: float, cy: float, rx: float, ry: float) -> np.ndarray:
  ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
  nx = (xs - cx) / max(rx, 1.0)
  ny = (ys - cy) / max(ry, 1.0)
  m = (nx * nx + ny * ny) <= 1.0
  return m.astype(np.float32)[:, :, np.newaxis]


def _studio_maps(base: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
  gray = np.mean(base, axis=2)
  shadow = np.clip(gray / 0.85, 0.55, 1.0)[:, :, np.newaxis]
  shadow_map = np.repeat(shadow, 3, axis=2).astype(np.float32)
  highlight = np.clip((gray - 0.72) / 0.28, 0.0, 1.0)[:, :, np.newaxis]
  highlight_map = np.repeat(highlight, 3, axis=2).astype(np.float32)
  blur = np.stack([gray, gray, gray], axis=2)
  env = np.clip(base - blur * 0.85, 0.0, 1.0).astype(np.float32)
  return shadow_map, highlight_map, env


def demo_cylinder_template(
  *,
  width: int = 720,
  height: int = 960,
  template_id: str = "demo-cylinder",
) -> MockupTemplate:
  """Synthetic mug mockup with TPS UV + normal micro-displacement."""
  cx, cy = width * 0.5, height * 0.52
  rx, ry = width * 0.28, height * 0.34

  base = np.full((height, width, 3), 0.94, dtype=np.float32)
  body = _ellipse_mask(height, width, cx, cy, rx, ry)
  base = base * (1.0 - body * 0.08) + body * np.array([0.82, 0.84, 0.86], dtype=np.float32)

  shadow_map, highlight_map, env_reflection = _studio_maps(base)
  mask = _ellipse_mask(height, width, cx, cy, rx * 0.92, ry * 0.88)

  tps_xy, tps_uv = default_cylinder_tps_controls(width, height)
  # Builtin preview uses analytic cylinder UV (fast + stable); baked assets use TPS field.
  uv_map = build_cylinder_uv_map(height, width)
  normal_u8 = estimate_normal_from_luminance(base)
  normal_map = normal_u8.astype(np.float32) / 255.0

  return MockupTemplate(
    template_id=template_id,
    name="Demo cylinder mug",
    base_image=base.astype(np.float32),
    uv_map=uv_map,
    mask=mask.astype(np.float32),
    shadow_map=shadow_map,
    highlight_map=highlight_map,
    displacement_map=None,
    env_reflection_map=env_reflection,
    normal_map=normal_map,
    fresnel=FresnelParams(f0=0.04, power=5.0, transparency=0.0),
    tps_control_xy=tps_xy,
    tps_control_uv=tps_uv,
    meta={"kind": "cylinder", "width": width, "height": height, "uv_mode": "dense", "depth_warp": True},
  )


def demo_glass_template(
  *,
  width: int = 720,
  height: int = 960,
  template_id: str = "demo-glass",
) -> MockupTemplate:
  """Transparent glass cylinder with Fresnel rim and env reflection."""
  tpl = demo_cylinder_template(width=width, height=height, template_id=template_id)
  tpl.name = "Demo glass cylinder"
  tpl.fresnel = FresnelParams(f0=0.06, power=4.5, transparency=0.78)
  tpl.meta = {"kind": "glass", "width": width, "height": height, "uv_mode": "dense"}
  # lighter studio base for glass
  tpl.base_image = np.clip(tpl.base_image * 0.92 + 0.06, 0.0, 1.0)
  return tpl


_BUILTIN = {
  "demo-cylinder": demo_cylinder_template,
  "demo-glass": demo_glass_template,
}


def list_builtin_templates() -> list[dict[str, str | int | bool]]:
  items: list[dict[str, str | int | bool]] = []
  for tid, factory in _BUILTIN.items():
    tpl = factory()
    items.append(
      {
        "id": tid,
        "name": tpl.name,
        "kind": "builtin",
        "width": int(tpl.meta.get("width") or 720),
        "height": int(tpl.meta.get("height") or 960),
        "glass": bool(tpl.fresnel and tpl.fresnel.transparency > 0.1),
      }
    )
  return items


def get_builtin_template(template_id: str) -> MockupTemplate:
  factory = _BUILTIN.get(template_id.strip())
  if factory is None:
    raise KeyError(f"unknown builtin template: {template_id}")
  return factory()
