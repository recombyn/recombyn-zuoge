"""Subpixel alpha post-processing for industrial matting (抠图 / 分层抠图)."""

from __future__ import annotations

import cv2
import numpy as np

from image_layer_pipeline.stages.mask_ops import color_decontaminate

# Low-confidence fringe band — sigmoid compresses without erode.
_FRINGE_LO = 0.05
_FRINGE_HI = 0.35
_SIGMOID_K = 12.0
_SIGMOID_MID = 0.18


def _to_float_alpha(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if rgba.ndim != 3 or rgba.shape[2] < 4:
        raise ValueError("rgba must be HxWx4")
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    return rgb, np.clip(alpha, 0.0, 1.0)


def _guided_filter_gray(guide: np.ndarray, src: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """Fast guided filter (He et al.) on single-channel float maps."""
    r = max(1, int(radius))
    ksize = 2 * r + 1
    guide = guide.astype(np.float32)
    src = src.astype(np.float32)
    mean_i = cv2.boxFilter(guide, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    mean_p = cv2.boxFilter(src, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    corr_ip = cv2.boxFilter(guide * src, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    corr_ii = cv2.boxFilter(guide * guide, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    var_i = np.maximum(corr_ii - mean_i * mean_i, 0.0)
    cov_ip = corr_ip - mean_i * mean_p
    a = cov_ip / (var_i + eps)
    b = mean_p - a * mean_i
    mean_a = cv2.boxFilter(a, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    mean_b = cv2.boxFilter(b, -1, (ksize, ksize), borderType=cv2.BORDER_REFLECT)
    return mean_a * guide + mean_b


def _sigmoid_fringe(alpha: np.ndarray) -> np.ndarray:
    out = alpha.copy()
    fringe = (alpha >= _FRINGE_LO) & (alpha <= _FRINGE_HI)
    if not fringe.any():
        return out
    band = alpha[fringe]
    compressed = 1.0 / (1.0 + np.exp(-_SIGMOID_K * (band - _SIGMOID_MID)))
    out[fringe] = np.clip(compressed, 0.0, 1.0)
    return out


def _joint_bilateral_alpha(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Edge-aware upsample/smooth — at same resolution this preserves hair detail."""
    guide = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    refined = cv2.bilateralFilter(
        (alpha * 255.0).astype(np.float32),
        d=5,
        sigmaColor=16,
        sigmaSpace=16,
    )
    refined /= 255.0
    return np.clip(refined, 0.0, 1.0)


def refine_alpha_subpixel(
    image_rgb: np.ndarray,
    foreground_rgba: np.ndarray,
    *,
    guided_radius: int = 8,
    guided_eps: float = 1e-3,
    decontaminate: float = 0.65,
) -> np.ndarray:
    """
    Run float alpha pipeline; returns uint8 RGBA.

    Steps: float alpha → joint bilateral → guided filter → sigmoid fringe → decontaminate.
    """
    rgb, alpha = _to_float_alpha(foreground_rgba)
    alpha = _joint_bilateral_alpha(image_rgb, alpha)
    guide = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    alpha = _guided_filter_gray(guide, alpha, guided_radius, guided_eps)
    alpha = _sigmoid_fringe(alpha)
    alpha = np.clip(alpha, 0.0, 1.0)

    rgba_u8 = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    rgba_u8[:, :, 3] = (alpha * 255.0).astype(np.uint8)
    strength = max(0.0, min(1.0, float(decontaminate)))
    return color_decontaminate(rgba_u8, strength=strength)


def trim_rgba_bbox(
    rgba: np.ndarray,
    *,
    pad: float = 2.0,
    alpha_threshold: int = 8,
) -> tuple[np.ndarray, dict[str, float]]:
    """Subpixel-safe crop to alpha bbox (floor/ceil padding)."""
    if rgba.ndim != 3 or rgba.shape[2] < 4:
        raise ValueError("rgba must be HxWx4")
    h, w = rgba.shape[:2]
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > alpha_threshold)
    if ys.size == 0:
        return rgba, {"trimX": 0.0, "trimY": 0.0, "originWidth": float(w), "originHeight": float(h)}

    pad = max(0.0, float(pad))
    left = max(0, int(np.floor(float(xs.min()) - pad)))
    top = max(0, int(np.floor(float(ys.min()) - pad)))
    right = min(w, int(np.ceil(float(xs.max()) + 1.0 + pad)))
    bottom = min(h, int(np.ceil(float(ys.max()) + 1.0 + pad)))
    cropped = rgba[top:bottom, left:right].copy()
    meta = {
        "trimX": float(left),
        "trimY": float(top),
        "originWidth": float(w),
        "originHeight": float(h),
    }
    return cropped, meta
