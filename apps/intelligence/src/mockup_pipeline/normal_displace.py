"""Normal-map driven micro-displacement for UV perturbation."""

from __future__ import annotations

import numpy as np


def normal_map_to_uv_offset(
    normal_map: np.ndarray,
    *,
    strength: float = 0.015,
) -> np.ndarray:
    """
    Convert tangent-space normal map (RGB [0,1]) to UV displacement (H,W,2).

    Uses xy components of the normal to perturb sampling coordinates.
    """
    n = normal_map.astype(np.float32)
    if n.ndim == 2:
        n = np.repeat(n[:, :, np.newaxis], 3, axis=2)
    tangent = n[:, :, :2] * 2.0 - 1.0
    du = tangent[:, :, 0] * float(strength)
    dv = tangent[:, :, 1] * float(strength)
    return np.stack([du, dv], axis=-1).astype(np.float32)


def estimate_normal_from_luminance(rgb: np.ndarray) -> np.ndarray:
    """Cheap normal estimate from albedo luminance (offline bake helper)."""
    gray = np.mean(rgb.astype(np.float32), axis=2)
    gy, gx = np.gradient(gray)
    nx = -gx
    ny = -gy
    nz = np.ones_like(nx) * 0.5
    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
    n = np.stack([nx / norm, ny / norm, nz / norm], axis=-1)
    return ((n * 0.5 + 0.5) * 255.0).clip(0, 255).astype(np.uint8)
