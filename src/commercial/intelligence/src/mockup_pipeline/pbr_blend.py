"""Photometric blending — multiply shadow, screen highlight, Fresnel, alpha over."""

from __future__ import annotations

import numpy as np

from mockup_pipeline.color_mgmt import aces_tonemap, linear_to_srgb, srgb_to_linear
from mockup_pipeline.fresnel import composite_with_transparency, view_fresnel_weight
from mockup_pipeline.types import FresnelParams


def blend_screen(a: np.ndarray, b: np.ndarray) -> np.ndarray:
  """Screen / linear dodge: 1 - (1-a)(1-b)."""
  return 1.0 - (1.0 - np.clip(a, 0.0, 1.0)) * (1.0 - np.clip(b, 0.0, 1.0))


def composite_mockup(
  base_rgb: np.ndarray,
  design_rgb: np.ndarray,
  design_alpha: np.ndarray,
  shadow_map: np.ndarray,
  highlight_map: np.ndarray,
  *,
  highlight_strength: float = 0.85,
  env_reflection: np.ndarray | None = None,
  normal_map: np.ndarray | None = None,
  mask: np.ndarray | None = None,
  fresnel: FresnelParams | None = None,
  linear_space: bool = True,
  use_aces: bool = True,
) -> np.ndarray:
  """
  Full PBR-style 2.5D composite in linear light (optional ACES tonemap).

  final = base * (1-a) + [ (design * shadow) screen highlight + env*rim ] * a
  """
  base = base_rgb.astype(np.float32)
  design = design_rgb.astype(np.float32)
  shadow = shadow_map.astype(np.float32)
  highlight = highlight_map.astype(np.float32)
  alpha = np.clip(design_alpha, 0.0, 1.0)

  if linear_space:
    base = srgb_to_linear(base)
    design = srgb_to_linear(design)
    if env_reflection is not None:
      env_reflection = srgb_to_linear(env_reflection.astype(np.float32))

  shaded = design * shadow
  lit = blend_screen(shaded, highlight * float(highlight_strength))

  if env_reflection is not None:
    lit = lit + env_reflection * 0.35
    lit = np.clip(lit, 0.0, 1.0)

  fp = fresnel or FresnelParams()
  m = mask if mask is not None else alpha
  fresnel_w = view_fresnel_weight(normal_map, m, fp)

  if use_aces:
    lit = aces_tonemap(lit)

  if fp.transparency > 0.01 or env_reflection is not None:
    out = composite_with_transparency(
      base,
      lit,
      alpha,
      fresnel_w,
      transparency=fp.transparency,
      env_reflection=env_reflection,
    )
  else:
    out = base * (1.0 - alpha) + lit * alpha

  if linear_space:
    out = linear_to_srgb(out)
  return np.clip(out, 0.0, 1.0)
