"""Industrial 2.5D mockup rendering — PBR channel compositing + UV remap."""

from mockup_pipeline.bake import bake_mockup_template_from_photo, save_template_bundle
from mockup_pipeline.renderer import IndustrialMockupRenderer
from mockup_pipeline.types import FresnelParams, MockupTemplate

__all__ = [
  "IndustrialMockupRenderer",
  "MockupTemplate",
  "FresnelParams",
  "bake_mockup_template_from_photo",
  "save_template_bundle",
]
