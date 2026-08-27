"""BiRefNet matting with optional SAM ROI crop + subpixel post-process."""

from __future__ import annotations

import os
from typing import Any

import numpy as np

from image_layer_pipeline.stages.sam_roi import (
    crop_roi,
    paste_binary_crop,
    paste_rgba_crop,
    propose_sam_regions,
    sam_backend_name,
    sam_enabled,
    select_primary_region,
)
from image_layer_pipeline.stages.segmentation import segment_foreground
from image_layer_pipeline.stages.subpixel import snap_inset
from image_layer_pipeline.stages.subpixel_matting import refine_alpha_subpixel


def _bbox_from_binary(binary_mask: np.ndarray) -> dict[str, Any] | None:
    ys, xs = np.where(binary_mask > 127)
    if ys.size == 0:
        return None
    h, w = binary_mask.shape[:2]
    x0_f, x1_f = float(xs.min()), float(xs.max()) + 1.0
    y0_f, y1_f = float(ys.min()), float(ys.max()) + 1.0
    x0, y0, bw, bh = snap_inset(x0_f, y0_f, x1_f - x0_f, y1_f - y0_f, pad=1.0, max_w=w, max_h=h)
    return {
        "id": "sam-binary",
        "x": float(x0),
        "y": float(y0),
        "width": float(bw),
        "height": float(bh),
        "score": 0.8,
        "label": "subject",
        "source": "birefnet",
    }


def segment_foreground_refined(
    image_rgb: np.ndarray,
    *,
    model_name: str = "birefnet-general",
    decontaminate: float = 0.65,
    use_sam_roi: bool | None = None,
    matting_scene: str | None = None,
    custom_onnx: str | None = None,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    """
    Segment foreground with optional SAM ROI crop, always ending in subpixel matting.

    Returns ``(foreground_rgba, binary_mask, sam_regions)``.
    """
    if use_sam_roi is None:
        use_sam_roi = not str(os.environ.get("ILP_DISABLE_SAM_ROI", "") or "").strip()

    sam_regions: list[dict[str, Any]] = []
    h, w = image_rgb.shape[:2]

    if use_sam_roi and sam_enabled():
        proposals = propose_sam_regions(image_rgb)
        sam_regions = [r.to_dict() for r in proposals]
        primary = select_primary_region(proposals, image_w=w, image_h=h)
        if primary is not None:
            crop_rgb, ox, oy = crop_roi(image_rgb, primary)
            fg_crop, binary_crop = segment_foreground(
                crop_rgb, model_name=model_name, custom_onnx=custom_onnx
            )
            fg_crop = refine_alpha_subpixel(crop_rgb, fg_crop, decontaminate=decontaminate)
            fg_full = paste_rgba_crop(image_rgb.shape, fg_crop, ox, oy)
            binary_full = paste_binary_crop(image_rgb.shape, binary_crop, ox, oy)
            if not sam_regions:
                fallback = _bbox_from_binary(binary_full)
                if fallback:
                    sam_regions = [fallback]
            return fg_full, binary_full, sam_regions

    foreground_rgba, binary_mask = segment_foreground(
        image_rgb, model_name=model_name, custom_onnx=custom_onnx
    )
    foreground_rgba = refine_alpha_subpixel(
        image_rgb, foreground_rgba, decontaminate=decontaminate
    )
    if not sam_regions:
        fallback = _bbox_from_binary(binary_mask)
        if fallback:
            sam_regions = [fallback]
    return foreground_rgba, binary_mask, sam_regions


def segment_engines(sam_regions: list[dict[str, Any]], *, scene: str = "general") -> list[str]:
    engines = ["birefnet", "subpixel-matting", f"scene:{scene}"]
    if sam_regions:
        sources = {str(r.get("source") or "") for r in sam_regions}
        if "fastsam" in sources:
            engines.insert(0, "fastsam")
        elif any(s.startswith("opencv") for s in sources):
            engines.insert(0, sam_backend_name())
    return engines
