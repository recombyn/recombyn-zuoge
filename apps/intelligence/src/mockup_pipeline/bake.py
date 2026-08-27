"""Offline template baking from studio photography."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from mockup_pipeline.normal_displace import estimate_normal_from_luminance
from mockup_pipeline.tps_warp import build_tps_uv_map, default_cylinder_tps_controls
from mockup_pipeline.types import FresnelParams, MockupTemplate
from mockup_pipeline.uv_remap import build_cylinder_uv_map


def bake_mockup_template_from_photo(
  cup_photo_path: str | Path,
  mask_path: str | Path,
  *,
  template_id: str = "baked-mug",
  name: str = "Baked mug",
  curve_factor: float = 0.25,
  use_tps: bool = True,
  glass: bool = False,
) -> MockupTemplate:
  """
  Decouple shadow / highlight / UV from a real product photo.

  Industrial offline step — run once per SKU, store as `.mockup` asset bundle.
  """
  raw_bgr = cv2.imread(str(cup_photo_path))
  if raw_bgr is None:
    raise ValueError(f"could not read photo: {cup_photo_path}")
  base_image = cv2.cvtColor(raw_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
  h, w = base_image.shape[:2]

  mask_gray = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
  if mask_gray is None:
    raise ValueError(f"could not read mask: {mask_path}")
  mask = (mask_gray.astype(np.float32) / 255.0)[:, :, np.newaxis]

  gray = cv2.cvtColor(raw_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
  shadow = np.clip(gray / 0.8, 0.0, 1.0)[:, :, np.newaxis]
  shadow_map = np.repeat(shadow, 3, axis=2).astype(np.float32)

  highlight = np.clip((gray - 0.75) / 0.25, 0.0, 1.0)[:, :, np.newaxis]
  highlight_map = np.repeat(highlight, 3, axis=2).astype(np.float32)

  # Environment reflection proxy — high-frequency specular residual
  blur = cv2.GaussianBlur(gray, (0, 0), 3.0)
  spec = np.clip(gray - blur, 0.0, 1.0)[:, :, np.newaxis]
  env_reflection = np.repeat(spec, 3, axis=2).astype(np.float32)

  normal_u8 = estimate_normal_from_luminance(base_image)
  normal_map = normal_u8.astype(np.float32) / 255.0

  if use_tps:
    ctrl_xy, ctrl_uv = default_cylinder_tps_controls(w, h, curve_factor=curve_factor)
    uv_map = build_tps_uv_map(h, w, ctrl_xy, ctrl_uv)
    tps_xy, tps_uv = ctrl_xy, ctrl_uv
  else:
    uv_map = build_cylinder_uv_map(h, w, curve_factor=curve_factor)
    tps_xy, tps_uv = None, None

  fresnel = FresnelParams(f0=0.04, power=5.0, transparency=0.72 if glass else 0.0)

  return MockupTemplate(
    template_id=template_id,
    name=name,
    base_image=base_image,
    uv_map=uv_map,
    mask=mask,
    shadow_map=shadow_map,
    highlight_map=highlight_map,
    displacement_map=None,
    env_reflection_map=env_reflection,
    normal_map=normal_map,
    fresnel=fresnel,
    tps_control_xy=tps_xy,
    tps_control_uv=tps_uv,
    meta={"kind": "glass" if glass else "cylinder", "width": w, "height": h, "baked": True, "uv_mode": "tps" if use_tps else "dense"},
  )


def save_template_bundle(template: MockupTemplate, out_dir: str | Path) -> Path:
  """Write standard `.mockup` asset bundle to disk."""
  root = Path(out_dir)
  root.mkdir(parents=True, exist_ok=True)

  meta = dict(template.meta or {})
  meta.update(
    {
      "id": template.template_id,
      "name": template.name,
      "fresnel": {
        "f0": template.fresnel.f0 if template.fresnel else 0.04,
        "power": template.fresnel.power if template.fresnel else 5.0,
        "transparency": template.fresnel.transparency if template.fresnel else 0.0,
      },
    }
  )
  (root / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

  base_u8 = (np.clip(template.base_image, 0, 1) * 255).astype(np.uint8)
  cv2.imwrite(str(root / "base.png"), cv2.cvtColor(base_u8, cv2.COLOR_RGB2BGR))

  mask_u8 = (np.clip(template.mask.squeeze(), 0, 1) * 255).astype(np.uint8)
  cv2.imwrite(str(root / "mask.png"), mask_u8)

  for name, arr in (
    ("shadow.png", template.shadow_map),
    ("highlight.png", template.highlight_map),
  ):
    u8 = (np.clip(arr, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(root / name), cv2.cvtColor(u8, cv2.COLOR_RGB2BGR))

  np.save(root / "uv.npy", template.uv_map.astype(np.float32))

  if template.displacement_map is not None:
    np.save(root / "displacement.npy", template.displacement_map.astype(np.float32))
  if template.env_reflection_map is not None:
    u8 = (np.clip(template.env_reflection_map, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(root / "env.png"), cv2.cvtColor(u8, cv2.COLOR_RGB2BGR))
  if template.normal_map is not None:
    u8 = (np.clip(template.normal_map, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(root / "normal.png"), cv2.cvtColor(u8, cv2.COLOR_RGB2BGR))
  if template.tps_control_xy is not None and template.tps_control_uv is not None:
    np.save(root / "tps_xy.npy", template.tps_control_xy.astype(np.float32))
    np.save(root / "tps_uv.npy", template.tps_control_uv.astype(np.float32))

  return root
