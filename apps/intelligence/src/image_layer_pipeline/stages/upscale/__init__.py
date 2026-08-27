"""Super-resolution upscaling (Real-ESRGAN + optional face refine)."""

from image_layer_pipeline.stages.upscale.esrgan import upscale_image

__all__ = ["upscale_image"]
