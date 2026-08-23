"""Fresnel rim and transparency compositing for glass / plastic mockups."""

from __future__ import annotations

import numpy as np

from mockup_pipeline.types import FresnelParams


def view_fresnel_weight(
    normal_map: np.ndarray | None,
    mask: np.ndarray,
    params: FresnelParams,
) -> np.ndarray:
    """
    Schlick-style Fresnel weight (H,W,1) in [0,1].

    When no normal map, uses radial view proxy from mask boundary.
    """
    f0 = float(params.f0)
    power = max(float(params.power), 0.1)

    if normal_map is not None and normal_map.ndim == 3 and normal_map.shape[2] >= 3:
        n = normal_map.astype(np.float32)
        nz = np.clip(n[:, :, 2:3] * 2.0 - 1.0, -1.0, 1.0)
        ndotv = np.clip(nz, 0.0, 1.0)
    else:
        h, w = mask.shape[:2]
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        cx, cy = w * 0.5, h * 0.5
        nx = (xs - cx) / max(w * 0.5, 1.0)
        ny = (ys - cy) / max(h * 0.5, 1.0)
        ndotv = np.clip(1.0 - np.sqrt(nx * nx + ny * ny), 0.0, 1.0)[:, :, np.newaxis]

    fresnel = f0 + (1.0 - f0) * np.power(1.0 - ndotv, power)
    return np.clip(fresnel * mask, 0.0, 1.0).astype(np.float32)


def composite_with_transparency(
    base_rgb: np.ndarray,
    lit_rgb: np.ndarray,
    alpha: np.ndarray,
    fresnel_w: np.ndarray,
    *,
    transparency: float = 0.0,
    env_reflection: np.ndarray | None = None,
) -> np.ndarray:
    """
    Porter-Duff over with optional glass transparency and env reflection on rim.
    """
    a = np.clip(alpha, 0.0, 1.0)
    t = float(np.clip(transparency, 0.0, 1.0))
    rim = np.clip(fresnel_w, 0.0, 1.0)

    if env_reflection is not None:
        refl = env_reflection.astype(np.float32)
        lit_rgb = lit_rgb + refl * rim * 0.65
        lit_rgb = np.clip(lit_rgb, 0.0, 1.0)

    # Glass: reduce interior opacity, keep rim via fresnel
    effective_alpha = a * (1.0 - t * (1.0 - rim))
    out = base_rgb * (1.0 - effective_alpha) + lit_rgb * effective_alpha
    return np.clip(out, 0.0, 1.0)
