"""Pipeline stage modules (depth, segmentation, masks, inpainting, export)."""

from image_layer_pipeline.stages.depth import depth_to_uint8, estimate_depth
from image_layer_pipeline.stages.export_psd import export_psd, save_png_layers, try_export_psd
from image_layer_pipeline.stages.inpainting import cascade_inpaint, inpaint_once
from image_layer_pipeline.stages.mask_ops import (
    build_repair_mask,
    color_decontaminate,
    extract_rgba_layer,
    split_mid_far_by_depth,
)
from image_layer_pipeline.stages.segmentation import segment_foreground

__all__ = [
    "depth_to_uint8",
    "estimate_depth",
    "export_psd",
    "save_png_layers",
    "try_export_psd",
    "cascade_inpaint",
    "inpaint_once",
    "build_repair_mask",
    "color_decontaminate",
    "extract_rgba_layer",
    "split_mid_far_by_depth",
    "segment_foreground",
]
