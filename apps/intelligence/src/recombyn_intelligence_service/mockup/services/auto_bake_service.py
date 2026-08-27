"""Build FE kit JSON from auto-baked multi-region mockup assets."""

from __future__ import annotations

import base64
from typing import Any

import cv2
import numpy as np

from mockup_pipeline.bake_auto import bake_auto_from_photo_and_matte
from recombyn_intelligence_service.mockup.services.kit_service import (
  _png_b64_gray,
  _png_b64_rgb,
  _resize_maps,
)


def _resize_rgb(rgb: np.ndarray, w: int, h: int) -> np.ndarray:
  if rgb.shape[1] == w and rgb.shape[0] == h:
    return rgb
  return cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)


def serialize_auto_kit(
  base_rgb: np.ndarray,
  regions: list[dict[str, Any]],
  *,
  scale: float = 0.5,
  template_id: str = "auto-bake",
  name: str = "Auto mockup",
  engines: list[str] | None = None,
) -> dict[str, Any]:
  """JSON-serializable multi-region kit for WebGL live remap (+ shadow/highlight)."""
  full_h, full_w = base_rgb.shape[:2]
  scale = float(max(0.25, min(1.0, scale)))
  w = max(32, int(round(full_w * scale)))
  h = max(32, int(round(full_h * scale)))
  sx = w / max(full_w, 1)
  sy = h / max(full_h, 1)

  base_r = _resize_rgb(base_rgb.astype(np.float32), w, h)
  out_regions: list[dict[str, Any]] = []
  for reg in regions:
    mask = reg["mask"].astype(np.float32)
    uv = reg["uv"].astype(np.float32)
    _, mask_r, uv_r, _, _ = _resize_maps(base_rgb.astype(np.float32), mask, uv, scale)
    shadow_r = _resize_rgb(reg["shadow"].astype(np.float32), w, h)
    highlight_r = _resize_rgb(reg["highlight"].astype(np.float32), w, h)
    pf = reg.get("printFull") or {}
    print_full = {
      "x": float(pf.get("x", 0)),
      "y": float(pf.get("y", 0)),
      "w": float(pf.get("w", full_w)),
      "h": float(pf.get("h", full_h)),
    }
    print_rect = {
      "x": print_full["x"] * sx,
      "y": print_full["y"] * sy,
      "w": print_full["w"] * sx,
      "h": print_full["h"] * sy,
    }
    uv_bytes = np.ascontiguousarray(uv_r, dtype=np.float32).tobytes()
    out_regions.append(
      {
        "id": str(reg.get("id") or "r0"),
        "mask": _png_b64_gray(mask_r),
        "uvEncoding": "float32-le-hw2",
        "uvBase64": base64.b64encode(uv_bytes).decode("ascii"),
        "shadow": _png_b64_rgb(shadow_r),
        "highlight": _png_b64_rgb(highlight_r),
        "printRect": print_rect,
        "printFull": print_full,
      }
    )

  primary = out_regions[0] if out_regions else None
  payload: dict[str, Any] = {
    "templateId": template_id,
    "name": name,
    "width": w,
    "height": h,
    "fullWidth": full_w,
    "fullHeight": full_h,
    "scale": float(scale),
    "base": _png_b64_rgb(base_r),
    "regions": out_regions,
    "engines": list(engines or []),
    "auto": True,
  }
  # Backward-compatible top-level fields = first region.
  if primary:
    payload.update(
      {
        "mask": primary["mask"],
        "uvEncoding": primary["uvEncoding"],
        "uvBase64": primary["uvBase64"],
        "shadow": primary["shadow"],
        "highlight": primary["highlight"],
        "printRect": primary["printRect"],
        "printFull": primary["printFull"],
      }
    )
  return payload


def build_auto_bake_kit(
  photo_bytes: bytes,
  matte_rgba_png: bytes,
  *,
  scale: float = 0.5,
  engines: list[str] | None = None,
) -> dict[str, Any]:
  base_rgb, regions, _notes = bake_auto_from_photo_and_matte(photo_bytes, matte_rgba_png)
  return serialize_auto_kit(
    base_rgb,
    regions,
    scale=scale,
    engines=engines,
  )
