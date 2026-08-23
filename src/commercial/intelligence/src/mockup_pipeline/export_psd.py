"""Layered PSD export for mockup decomposition."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def export_mockup_psd(
  out_path: str | Path,
  *,
  base_rgb: np.ndarray,
  warped_design_rgb: np.ndarray,
  warped_alpha: np.ndarray,
  shaded_layer: np.ndarray,
  final_rgb: np.ndarray,
  names: tuple[str, ...] = (
    "Background",
    "Design Warped",
    "Design Alpha",
    "Shaded Design",
    "Final Composite",
  ),
) -> Path:
  """Write non-destructive mockup layers to PSD (requires pytoshop)."""
  from pytoshop import enums
  from pytoshop.user.nested_layers import Image as PsdImage
  from pytoshop.user.nested_layers import nested_layers_to_psd

  path = Path(out_path)
  h, w = base_rgb.shape[:2]

  def _layer(name: str, rgb: np.ndarray, alpha: np.ndarray | None = None) -> PsdImage:
    rgb_u8 = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    if alpha is None:
      a = np.full((h, w), 255, dtype=np.uint8)
    else:
      a = (np.clip(alpha.squeeze(), 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([rgb_u8, a])
    channels = {
      0: np.ascontiguousarray(rgba[:, :, 0]),
      1: np.ascontiguousarray(rgba[:, :, 1]),
      2: np.ascontiguousarray(rgba[:, :, 2]),
      -1: np.ascontiguousarray(rgba[:, :, 3]),
    }
    return PsdImage(
      name=name,
      top=0,
      left=0,
      bottom=h,
      right=w,
      channels=channels,
      opacity=255,
      visible=True,
      color_mode=enums.ColorMode.rgb,
    )

  layers = [
    _layer(names[0], base_rgb),
    _layer(names[1], warped_design_rgb, warped_alpha),
    _layer(names[2], np.repeat(warped_alpha, 3, axis=2), warped_alpha),
    _layer(names[3], shaded_layer, warped_alpha),
    _layer(names[4], final_rgb),
  ]
  psd = nested_layers_to_psd(layers, color_mode=enums.ColorMode.rgb)
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("wb") as f:
    psd.write(f)
  return path
