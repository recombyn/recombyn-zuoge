"""Bake photometric channels + UV for auto-detected printable regions."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from mockup_pipeline.auto_regions import (
  PrintableRegion,
  alpha_mask_from_rgba_png,
  detect_printable_regions,
)
from mockup_pipeline.normal_displace import estimate_normal_from_luminance
from mockup_pipeline.tps_warp import build_tps_uv_map, cylinder_tps_controls_in_rect


def decode_photo_rgb(photo_bytes: bytes) -> np.ndarray:
  arr = np.frombuffer(photo_bytes, dtype=np.uint8)
  bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
  if bgr is None:
    raise ValueError("could not decode photo")
  return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def photometric_maps_from_rgb(base_rgb: np.ndarray) -> dict[str, np.ndarray]:
  """Shadow / highlight / env / normal from luminance (same as bake.py)."""
  gray = (
    0.299 * base_rgb[:, :, 0] + 0.587 * base_rgb[:, :, 1] + 0.114 * base_rgb[:, :, 2]
  ).astype(np.float32)
  shadow = np.clip(gray / 0.8, 0.0, 1.0)[:, :, np.newaxis]
  shadow_map = np.repeat(shadow, 3, axis=2).astype(np.float32)
  highlight = np.clip((gray - 0.75) / 0.25, 0.0, 1.0)[:, :, np.newaxis]
  highlight_map = np.repeat(highlight, 3, axis=2).astype(np.float32)
  blur = cv2.GaussianBlur(gray, (0, 0), 3.0)
  spec = np.clip(gray - blur, 0.0, 1.0)[:, :, np.newaxis]
  env_reflection = np.repeat(spec, 3, axis=2).astype(np.float32)
  normal_u8 = estimate_normal_from_luminance(base_rgb)
  normal_map = normal_u8.astype(np.float32) / 255.0
  return {
    "shadow_map": shadow_map,
    "highlight_map": highlight_map,
    "env_reflection_map": env_reflection,
    "normal_map": normal_map,
  }


def uv_map_for_printable(
  height: int,
  width: int,
  bbox: tuple[int, int, int, int],
  *,
  curve_factor: float = 0.25,
) -> np.ndarray:
  x0, y0, rw, rh = bbox
  ctrl_xy, ctrl_uv = cylinder_tps_controls_in_rect(
    float(x0), float(y0), float(rw), float(rh), curve_factor=curve_factor
  )
  return build_tps_uv_map(height, width, ctrl_xy, ctrl_uv)


def bake_auto_region_assets(
  base_rgb: np.ndarray,
  region: PrintableRegion,
  photo_maps: dict[str, np.ndarray],
) -> dict[str, Any]:
  """Per-region arrays ready for kit serialization (full-res)."""
  h, w = base_rgb.shape[:2]
  mask = region.printable_mask.astype(np.float32)
  if mask.ndim == 2:
    mask = mask[:, :, np.newaxis]
  uv = uv_map_for_printable(h, w, region.bbox)
  x0, y0, rw, rh = region.bbox
  return {
    "id": region.region_id,
    "mask": mask,
    "uv": uv.astype(np.float32),
    "shadow": photo_maps["shadow_map"],
    "highlight": photo_maps["highlight_map"],
    "printFull": {"x": float(x0), "y": float(y0), "w": float(rw), "h": float(rh)},
    "bbox": {"x": int(x0), "y": int(y0), "w": int(rw), "h": int(rh)},
  }


def bake_auto_from_photo_and_matte(
  photo_bytes: bytes,
  matte_rgba_png: bytes,
) -> tuple[np.ndarray, list[dict[str, Any]], list[str]]:
  """
  Photo + matting RGBA → base RGB + list of region asset dicts.

  Returns (base_rgb, regions, notes).
  """
  base_rgb = decode_photo_rgb(photo_bytes)
  h, w = base_rgb.shape[:2]
  fg = alpha_mask_from_rgba_png(matte_rgba_png)
  if fg.shape[0] != h or fg.shape[1] != w:
    fg = cv2.resize(fg, (w, h), interpolation=cv2.INTER_AREA)
  regions_geo = detect_printable_regions(fg)
  maps = photometric_maps_from_rgb(base_rgb)
  regions = [bake_auto_region_assets(base_rgb, r, maps) for r in regions_geo]
  notes = [f"regions={len(regions)}"]
  return base_rgb, regions, notes
