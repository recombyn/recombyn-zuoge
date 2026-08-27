"""UV mesh warping — bicubic remap with TPS, normal displacement, optional offset map."""

from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from mockup_pipeline.normal_displace import normal_map_to_uv_offset
from mockup_pipeline.tps_warp import build_tps_uv_map


def apply_uv_remap(
  design_rgba: np.ndarray,
  uv_map: np.ndarray,
  displacement: Optional[np.ndarray] = None,
  *,
  normal_map: Optional[np.ndarray] = None,
  normal_strength: float = 0.015,
) -> np.ndarray:
  """Warp design RGBA onto background UV grid (returns float32 RGBA [0, 1])."""
  h_tex, w_tex = design_rgba.shape[:2]
  u = uv_map[:, :, 0].astype(np.float32, copy=True)
  v = uv_map[:, :, 1].astype(np.float32, copy=True)

  if displacement is not None:
    u = u + displacement[:, :, 0].astype(np.float32)
    v = v + displacement[:, :, 1].astype(np.float32)

  if normal_map is not None:
    n_off = normal_map_to_uv_offset(normal_map, strength=normal_strength)
    u = u + n_off[:, :, 0]
    v = v + n_off[:, :, 1]

  map_x = (u * max(w_tex - 1, 1)).astype(np.float32)
  map_y = (v * max(h_tex - 1, 1)).astype(np.float32)

  warped = cv2.remap(
    design_rgba,
    map_x,
    map_y,
    interpolation=cv2.INTER_CUBIC,
    borderMode=cv2.BORDER_CONSTANT,
    borderValue=(0, 0, 0, 0),
  )
  return warped.astype(np.float32) / 255.0


def resolve_uv_map(
  template_uv: np.ndarray,
  *,
  tps_control_xy: Optional[np.ndarray] = None,
  tps_control_uv: Optional[np.ndarray] = None,
  uv_mode: str = "dense",
) -> np.ndarray:
  """Use TPS-refined UV only when asset is calibrated with sparse landmarks."""
  if uv_mode == "tps" and tps_control_xy is not None and tps_control_uv is not None:
    h, w = template_uv.shape[:2]
    return build_tps_uv_map(h, w, tps_control_xy, tps_control_uv)
  return template_uv


def build_cylinder_uv_map(
  height: int,
  width: int,
  *,
  curve_factor: float = 0.25,
) -> np.ndarray:
  """Procedural cylindrical UV for mug/bottle templates."""
  ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
  nx = (xs - width / 2.0) / max(width / 2.0, 1.0)
  u = (np.arcsin(np.clip(nx * 0.96, -1.0, 1.0)) / (np.pi / 2.0) + 1.0) / 2.0
  v = ys / max(height - 1, 1) + curve_factor * (1.0 - nx**2) * 0.05
  uv = np.stack([np.clip(u, 0.0, 1.0), np.clip(v, 0.0, 1.0)], axis=-1)
  return uv.astype(np.float32)
