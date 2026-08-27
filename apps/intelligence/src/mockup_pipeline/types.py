"""Mockup asset types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass
class FresnelParams:
  """Glass / plastic rim reflection parameters."""

  f0: float = 0.04
  power: float = 5.0
  transparency: float = 0.0  # 0=opaque mug, 1=clear glass body


@dataclass
class MockupTemplate:
  """Industrial five+ channel physical asset kit for 2.5D mockup rendering."""

  template_id: str
  name: str
  base_image: np.ndarray  # RGB float32 [0, 1], shape (H, W, 3) — albedo backdrop
  uv_map: np.ndarray  # (H, W, 2) normalized u,v
  mask: np.ndarray  # (H, W, 1) float32 [0, 1]
  shadow_map: np.ndarray  # (H, W, 3) multiply diffuse shadow
  highlight_map: np.ndarray  # (H, W, 3) specular highlight (screen)
  displacement_map: np.ndarray | None = None  # (H, W, 2) UV offset
  env_reflection_map: np.ndarray | None = None  # (H, W, 3) environment / studio reflection
  normal_map: np.ndarray | None = None  # (H, W, 3) tangent normals [0,1]
  fresnel: FresnelParams | None = None
  tps_control_xy: np.ndarray | None = None  # (N, 2) optional sparse warp landmarks
  tps_control_uv: np.ndarray | None = None  # (N, 2)
  meta: dict[str, Any] = field(default_factory=dict)

  @property
  def height(self) -> int:
    return int(self.base_image.shape[0])

  @property
  def width(self) -> int:
    return int(self.base_image.shape[1])

  @property
  def supports_transparency(self) -> bool:
    f = self.fresnel
    return f is not None and float(f.transparency) > 0.01
