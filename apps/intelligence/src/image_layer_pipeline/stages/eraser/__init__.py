"""Smart eraser — mask prep + LaMa inpaint + seam blending."""

from image_layer_pipeline.stages.eraser.pipeline import erase_regions

__all__ = ["erase_regions"]
