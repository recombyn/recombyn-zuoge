"""Subject-layer decompose — BiRefNet + subpixel matting + OpenCV backdrop (no Depth/LaMa)."""

from __future__ import annotations

import cv2
import numpy as np

from image_layer_pipeline.stages.mask_ops import (
    build_repair_mask,
    dilate_mask,
    extract_rgba_layer,
)
from image_layer_pipeline.matting import run_matting
from image_layer_pipeline.types import LayerBundle, PipelineConfig


def _ring_mask(binary_mask: np.ndarray, *, inner_erode_px: int, outer_dilate_px: int) -> np.ndarray:
    outer = dilate_mask(binary_mask, dilate_px=max(1, outer_dilate_px))
    if inner_erode_px <= 0:
        return outer
    k = inner_erode_px * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    inner = cv2.erode(binary_mask, kernel, iterations=1)
    return cv2.subtract(outer, inner)


def _inpaint_background(image_rgb: np.ndarray, repair_mask: np.ndarray) -> np.ndarray:
    mask = repair_mask if repair_mask.ndim == 2 else repair_mask[:, :, 0]
    return cv2.inpaint(image_rgb, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)


def _pseudo_depth(binary_mask: np.ndarray) -> np.ndarray:
    """Distance-from-subject map for PSD/parallax export (0=far, 1=near)."""
    inv = np.where(binary_mask > 127, 0, 255).astype(np.uint8)
    dist = cv2.distanceTransform(inv, cv2.DIST_L2, 5)
    peak = float(dist.max()) if dist.size else 0.0
    if peak <= 0:
        return np.zeros_like(binary_mask, dtype=np.float32)
    near = 1.0 - np.clip(dist / peak, 0.0, 1.0)
    subject = binary_mask > 127
    near[subject] = 1.0
    return near.astype(np.float32)


def run_subject_layer_pipeline(
    image_rgb: np.ndarray,
    config: PipelineConfig | None = None,
) -> LayerBundle:
    cfg = config or PipelineConfig()

    matting = run_matting(
        image_rgb,
        scene="auto",
        model=cfg.segmentation_model,
        decontaminate=cfg.decontaminate_strength,
        trim_output=False,
    )
    foreground_rgba = matting.foreground_rgba
    binary_mask = matting.binary_mask

    subject_repair = build_repair_mask(
        binary_mask, dilate_px=cfg.dilate_px, feather_px=cfg.feather_px
    )
    behind_subject = _inpaint_background(image_rgb, subject_repair)
    far_background_rgb = behind_subject.copy()

    mid_mask = _ring_mask(
        binary_mask,
        inner_erode_px=max(4, cfg.dilate_px // 2),
        outer_dilate_px=cfg.mid_dilate_px,
    )
    midground_rgba = extract_rgba_layer(image_rgb, mid_mask)
    mid_repair = build_repair_mask(
        mid_mask, dilate_px=cfg.mid_dilate_px, feather_px=cfg.feather_px
    )

    bg_mask = np.where(binary_mask > 127, 0, 255).astype(np.uint8)
    far_mask = cv2.subtract(bg_mask, mid_mask)

    depth_map = _pseudo_depth(binary_mask)

    return LayerBundle(
        original_rgb=image_rgb,
        depth_map=depth_map,
        foreground_rgba=foreground_rgba,
        binary_mask=binary_mask,
        subject_repair_mask=subject_repair,
        mid_mask=mid_mask,
        far_mask=far_mask,
        mid_repair_mask=mid_repair,
        behind_subject_rgb=behind_subject,
        far_background_rgb=far_background_rgb,
        midground_rgba=midground_rgba,
    )
