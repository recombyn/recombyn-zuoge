"""Depth-driven UV perturbation for live mockup deformation."""

from __future__ import annotations

import cv2
import numpy as np


def depth_to_uv_offset(
    depth: np.ndarray,
    *,
    strength: float = 0.02,
) -> np.ndarray:
    """
    Convert normalized depth (0=far, 1=near) into UV displacement (H,W,2).

    Uses depth gradients to simulate parallax warp on the printable surface.
    """
    d = depth.astype(np.float32)
    if d.ndim != 2:
        raise ValueError("depth must be HxW")
    gy, gx = np.gradient(d)
    du = gx.astype(np.float32) * float(strength)
    dv = gy.astype(np.float32) * float(strength)
    return np.stack([du, dv], axis=-1).astype(np.float32)


def estimate_depth_for_mockup(base_rgb01: np.ndarray) -> np.ndarray:
    """Proxy depth from template albedo — avoids loading Depth Anything at render time."""
    from image_layer_pipeline.stages.depth import estimate_depth_proxy

    rgb_u8 = np.clip(base_rgb01 * 255.0, 0, 255).astype(np.uint8)
    depth = estimate_depth_proxy(rgb_u8)
    if depth.shape[:2] != base_rgb01.shape[:2]:
        depth = cv2.resize(depth, (base_rgb01.shape[1], base_rgb01.shape[0]), interpolation=cv2.INTER_LINEAR)
    return depth.astype(np.float32)
