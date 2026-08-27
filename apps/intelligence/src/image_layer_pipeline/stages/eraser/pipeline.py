"""Industrial eraser: dilate mask → LaMa inpaint → guided seam blend."""

from __future__ import annotations

import cv2
import numpy as np

from image_layer_pipeline.stages.inpainting import inpaint_once
from image_layer_pipeline.stages.mask_ops import dilate_mask


def _guided_seam_blend(
    original_rgb: np.ndarray,
    inpainted_rgb: np.ndarray,
    mask_u8: np.ndarray,
    *,
    radius: int = 8,
) -> np.ndarray:
    """Blend inpainted patch into original using a soft edge (guided-filter style)."""
    if mask_u8.ndim == 3:
        mask_u8 = mask_u8[:, :, 0]
    m = (mask_u8 > 127).astype(np.uint8) * 255
    if m.max() == 0:
        return original_rgb.copy()

    dist_in = cv2.distanceTransform((m > 0).astype(np.uint8), cv2.DIST_L2, 3)
    dist_out = cv2.distanceTransform((m == 0).astype(np.uint8), cv2.DIST_L2, 3)
    edge = np.minimum(dist_in, dist_out)
    soft = np.clip(edge / max(1.0, float(radius)), 0.0, 1.0)
    alpha = (m.astype(np.float32) / 255.0)
    alpha = np.maximum(alpha, 1.0 - soft)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.2)
    alpha3 = alpha[:, :, None]

    orig = original_rgb.astype(np.float32)
    inp = inpainted_rgb.astype(np.float32)
    out = inp * alpha3 + orig * (1.0 - alpha3)
    return np.clip(out, 0, 255).astype(np.uint8)


def erase_regions(
    image_rgb: np.ndarray,
    mask_u8: np.ndarray,
    *,
    dilate_px: int = 10,
    backend: str = "lama",
    seam_radius: int = 8,
) -> tuple[np.ndarray, dict[str, object]]:
    """
    Erase masked regions via LaMa and blend seams.

    White mask pixels (``>127``) are repainted.
    """
    if image_rgb.ndim != 3:
        raise ValueError("image_rgb must be HxWx3")
    if mask_u8.ndim not in (2, 3):
        raise ValueError("mask_u8 must be HxW or HxWx1")

    m = mask_u8[:, :, 0] if mask_u8.ndim == 3 else mask_u8
    if m.shape[:2] != image_rgb.shape[:2]:
        m = cv2.resize(m, (image_rgb.shape[1], image_rgb.shape[0]), interpolation=cv2.INTER_NEAREST)

    binary = (m > 8).astype(np.uint8) * 255
    if binary.max() == 0:
        raise ValueError("empty erase mask")

    repair = dilate_mask(binary, dilate_px=max(0, int(dilate_px)))
    inpainted = inpaint_once(image_rgb, repair, backend=backend.strip() or "lama")
    result = _guided_seam_blend(image_rgb, inpainted, repair, radius=seam_radius)

    meta = {
        "engine": f"ilp:{backend}:dilate{dilate_px}",
        "dilate_px": int(dilate_px),
        "seam_radius": int(seam_radius),
        "engines": [f"ilp:lama", "opencv:dilate", "guided-seam"],
    }
    return result, meta
