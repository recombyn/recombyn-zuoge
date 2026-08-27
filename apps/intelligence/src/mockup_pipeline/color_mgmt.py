"""sRGB / linear color management and optional ICC transforms."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

_SRGB_A = 0.055
_SRGB_GAMMA = 2.4


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    """sRGB encoded [0,1] → linear RGB."""
    x = np.clip(rgb.astype(np.float32), 0.0, 1.0)
    lo = x <= 0.04045
    hi = ~lo
    out = np.empty_like(x)
    out[lo] = x[lo] / 12.92
    out[hi] = ((x[hi] + _SRGB_A) / (1.0 + _SRGB_A)) ** _SRGB_GAMMA
    return out


def linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    """Linear RGB [0,1] → sRGB encoded."""
    x = np.clip(rgb.astype(np.float32), 0.0, 1.0)
    lo = x <= 0.0031308
    hi = ~lo
    out = np.empty_like(x)
    out[lo] = x[lo] * 12.92
    out[hi] = (1.0 + _SRGB_A) * np.power(x[hi], 1.0 / _SRGB_GAMMA) - _SRGB_A
    return np.clip(out, 0.0, 1.0)


def aces_tonemap(linear_rgb: np.ndarray) -> np.ndarray:
    """Simple ACES fitted tonemap for HDR highlights before sRGB encode."""
    a = 2.51
    b = 0.03
    c = 2.43
    d = 0.59
    e = 0.14
    x = np.clip(linear_rgb.astype(np.float32), 0.0, None)
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def apply_icc_rgb(
    rgb01: np.ndarray,
    *,
    input_profile: Optional[Path] = None,
    output_profile: Optional[Path] = None,
) -> np.ndarray:
    """Optional ICC transform via Pillow ImageCms (no-op when profiles missing)."""
    if input_profile is None and output_profile is None:
        return rgb01
    try:
        from PIL import Image, ImageCms
    except ImportError:
        return rgb01

    arr = (np.clip(rgb01, 0.0, 1.0) * 255.0).astype(np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    in_prof = (
        ImageCms.getOpenProfile(str(input_profile))
        if input_profile and input_profile.is_file()
        else ImageCms.createProfile("sRGB")
    )
    out_prof = (
        ImageCms.getOpenProfile(str(output_profile))
        if output_profile and output_profile.is_file()
        else ImageCms.createProfile("sRGB")
    )
    xform = ImageCms.buildTransform(in_prof, out_prof, "RGB", "RGB")
    out = ImageCms.applyTransform(img, xform)
    return np.asarray(out, dtype=np.float32) / 255.0
