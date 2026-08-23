"""Industrial 2.5D mockup renderer — full PBR pipeline."""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

from mockup_pipeline.color_mgmt import apply_icc_rgb
from mockup_pipeline.depth_warp import depth_to_uv_offset, estimate_depth_for_mockup
from mockup_pipeline.export_psd import export_mockup_psd
from mockup_pipeline.pbr_blend import composite_mockup
from mockup_pipeline.types import MockupTemplate
from mockup_pipeline.uv_remap import apply_uv_remap, resolve_uv_map


@dataclass
class MockupRenderResult:
  image: Image.Image
  warped_design_rgb: np.ndarray
  warped_alpha: np.ndarray
  shaded_layer: np.ndarray
  elapsed_ms: float


class IndustrialMockupRenderer:
  """UV remap + TPS + normal displacement + PBR channel compositing."""

  def __init__(
    self,
    *,
    highlight_strength: float = 0.85,
    linear_space: bool = True,
    use_aces: bool = True,
    normal_strength: float = 0.015,
    depth_warp_strength: float = 0.018,
    icc_input: str | None = None,
    icc_output: str | None = None,
  ):
    self.highlight_strength = highlight_strength
    self.linear_space = linear_space
    self.use_aces = use_aces
    self.normal_strength = normal_strength
    self.depth_warp_strength = depth_warp_strength
    self.icc_input = icc_input
    self.icc_output = icc_output

  def render_layers(
    self,
    template: MockupTemplate,
    design_image: Image.Image,
  ) -> MockupRenderResult:
    t0 = time.perf_counter()
    design_np = np.array(design_image.convert("RGBA"))

    uv = resolve_uv_map(
      template.uv_map,
      tps_control_xy=template.tps_control_xy,
      tps_control_uv=template.tps_control_uv,
      uv_mode=str((template.meta or {}).get("uv_mode") or "dense"),
    )

    displacement = template.displacement_map
    depth_warp_on = bool((template.meta or {}).get("depth_warp")) or str(
      os.environ.get("MOCKUP_DEPTH_WARP", "") or ""
    ).strip().lower() in {"1", "true", "yes", "on"}
    if depth_warp_on:
      depth = estimate_depth_for_mockup(template.base_image)
      depth_off = depth_to_uv_offset(depth, strength=self.depth_warp_strength)
      if displacement is None:
        displacement = depth_off
      else:
        displacement = displacement.astype(np.float32) + depth_off

    warped = apply_uv_remap(
      design_np,
      uv,
      displacement,
      normal_map=template.normal_map,
      normal_strength=self.normal_strength,
    )
    design_rgb = warped[:, :, :3]
    design_alpha = warped[:, :, 3:4] * template.mask

    shaded = design_rgb * template.shadow_map
    final_rgb = composite_mockup(
      template.base_image,
      design_rgb,
      design_alpha,
      template.shadow_map,
      template.highlight_map,
      highlight_strength=self.highlight_strength,
      env_reflection=template.env_reflection_map,
      normal_map=template.normal_map,
      mask=template.mask,
      fresnel=template.fresnel,
      linear_space=self.linear_space,
      use_aces=self.use_aces,
    )

    if self.icc_input or self.icc_output:
      from pathlib import Path

      final_rgb = apply_icc_rgb(
        final_rgb,
        input_profile=Path(self.icc_input) if self.icc_input else None,
        output_profile=Path(self.icc_output) if self.icc_output else None,
      )

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    out = (np.clip(final_rgb * 255.0, 0, 255)).astype(np.uint8)
    return MockupRenderResult(
      image=Image.fromarray(out, mode="RGB"),
      warped_design_rgb=design_rgb,
      warped_alpha=design_alpha,
      shaded_layer=shaded,
      elapsed_ms=elapsed_ms,
    )

  def render_rgba(self, template: MockupTemplate, design_image: Image.Image) -> Image.Image:
    return self.render_layers(template, design_image).image

  def render_png_bytes(self, template: MockupTemplate, design_image: Image.Image) -> bytes:
    img = self.render_rgba(template, design_image)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

  def render_psd_bytes(
    self,
    template: MockupTemplate,
    design_image: Image.Image,
  ) -> bytes:
    layers = self.render_layers(template, design_image)
    buf = io.BytesIO()
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as td:
      psd_path = Path(td) / "mockup.psd"
      export_mockup_psd(
        psd_path,
        base_rgb=template.base_image,
        warped_design_rgb=layers.warped_design_rgb,
        warped_alpha=layers.warped_alpha,
        shaded_layer=layers.shaded_layer,
        final_rgb=np.asarray(layers.image, dtype=np.float32) / 255.0,
      )
      buf.write(psd_path.read_bytes())
    return buf.getvalue()
