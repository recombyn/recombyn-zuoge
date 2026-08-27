"""Serialize mockup template kit (UV + mask + base) for frontend live remap."""

from __future__ import annotations

import base64
import io
from typing import Any

import cv2
import numpy as np

from mockup_pipeline.loader import load_template

# Printable body on builtin demo-cylinder / demo-glass (720×960 design space).
_DEFAULT_PRINT = {"x": 175, "y": 212, "w": 371, "h": 574}


def _png_b64_rgb(rgb01: np.ndarray) -> str:
  u8 = np.clip(rgb01 * 255.0, 0, 255).astype(np.uint8)
  bgr = cv2.cvtColor(u8, cv2.COLOR_RGB2BGR)
  ok, buf = cv2.imencode(".png", bgr)
  if not ok:
    raise RuntimeError("failed to encode base png")
  return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _png_b64_gray(gray01: np.ndarray) -> str:
  plane = gray01[:, :, 0] if gray01.ndim == 3 else gray01
  u8 = np.clip(plane * 255.0, 0, 255).astype(np.uint8)
  ok, buf = cv2.imencode(".png", u8)
  if not ok:
    raise RuntimeError("failed to encode mask png")
  return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _resize_maps(
  base: np.ndarray,
  mask: np.ndarray,
  uv: np.ndarray,
  scale: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int, int]:
  h0, w0 = base.shape[:2]
  scale = float(max(0.25, min(1.0, scale)))
  w = max(32, int(round(w0 * scale)))
  h = max(32, int(round(h0 * scale)))
  if w == w0 and h == h0:
    return base, mask, uv, w0, h0
  base_r = cv2.resize(base, (w, h), interpolation=cv2.INTER_AREA)
  mask_r = cv2.resize(mask, (w, h), interpolation=cv2.INTER_AREA)
  if mask_r.ndim == 2:
    mask_r = mask_r[:, :, np.newaxis]
  uv_r = cv2.resize(uv, (w, h), interpolation=cv2.INTER_LINEAR)
  return base_r, mask_r, uv_r.astype(np.float32), w, h


def build_template_kit(
  template_id: str,
  *,
  templates_dir=None,
  scale: float = 0.5,
) -> dict[str, Any]:
  """Return JSON-serializable kit for FE WebGL UV preview."""
  tid = (template_id or "demo-cylinder").strip() or "demo-cylinder"
  tpl = load_template(tid, templates_dir)
  base, mask, uv, w, h = _resize_maps(
    tpl.base_image.astype(np.float32),
    tpl.mask.astype(np.float32),
    tpl.uv_map.astype(np.float32),
    scale,
  )
  meta = dict(tpl.meta or {})
  full_w = int(meta.get("width") or tpl.base_image.shape[1])
  full_h = int(meta.get("height") or tpl.base_image.shape[0])
  print_raw = meta.get("print") if isinstance(meta.get("print"), dict) else _DEFAULT_PRINT
  sx = w / max(full_w, 1)
  sy = h / max(full_h, 1)
  print_rect = {
    "x": float(print_raw.get("x", _DEFAULT_PRINT["x"])) * sx,
    "y": float(print_raw.get("y", _DEFAULT_PRINT["y"])) * sy,
    "w": float(print_raw.get("w", _DEFAULT_PRINT["w"])) * sx,
    "h": float(print_raw.get("h", _DEFAULT_PRINT["h"])) * sy,
  }
  # Design-space print rect (full template coords) for FE placement.
  print_full = {
    "x": float(print_raw.get("x", _DEFAULT_PRINT["x"])),
    "y": float(print_raw.get("y", _DEFAULT_PRINT["y"])),
    "w": float(print_raw.get("w", _DEFAULT_PRINT["w"])),
    "h": float(print_raw.get("h", _DEFAULT_PRINT["h"])),
  }
  uv_bytes = np.ascontiguousarray(uv, dtype=np.float32).tobytes()
  return {
    "templateId": tpl.template_id,
    "name": tpl.name,
    "width": w,
    "height": h,
    "fullWidth": full_w,
    "fullHeight": full_h,
    "scale": float(scale),
    "base": _png_b64_rgb(base),
    "mask": _png_b64_gray(mask),
    "uvEncoding": "float32-le-hw2",
    "uvBase64": base64.b64encode(uv_bytes).decode("ascii"),
    "printRect": print_rect,
    "printFull": print_full,
    "shadow": _png_b64_rgb(
      cv2.resize(tpl.shadow_map.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
      if tpl.shadow_map is not None
      else np.ones((h, w, 3), dtype=np.float32)
    ),
    "highlight": _png_b64_rgb(
      cv2.resize(tpl.highlight_map.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
      if tpl.highlight_map is not None
      else np.zeros((h, w, 3), dtype=np.float32)
    ),
    "regions": [
      {
        "id": "r0",
        "mask": _png_b64_gray(mask),
        "uvEncoding": "float32-le-hw2",
        "uvBase64": base64.b64encode(uv_bytes).decode("ascii"),
        "shadow": _png_b64_rgb(
          cv2.resize(tpl.shadow_map.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
          if tpl.shadow_map is not None
          else np.ones((h, w, 3), dtype=np.float32)
        ),
        "highlight": _png_b64_rgb(
          cv2.resize(tpl.highlight_map.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
          if tpl.highlight_map is not None
          else np.zeros((h, w, 3), dtype=np.float32)
        ),
        "printRect": print_rect,
        "printFull": print_full,
      }
    ],
    "auto": False,
  }
