"""Step 3: 掩码后处理 — 膨胀防溢色 + 深度聚类切层。"""

from __future__ import annotations

import cv2
import numpy as np


def dilate_mask(mask: np.ndarray, dilate_px: int = 16) -> np.ndarray:
    if dilate_px <= 0:
        return mask.copy()
    k = dilate_px * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.dilate(mask, kernel, iterations=1)


def feather_mask(mask: np.ndarray, feather_px: int = 2) -> np.ndarray:
    if feather_px <= 0:
        return mask.copy()
    k = max(1, feather_px * 2 + 1)
    if k % 2 == 0:
        k += 1
    return cv2.GaussianBlur(mask, (k, k), 0)


def color_decontaminate(
    foreground_rgba: np.ndarray,
    strength: float = 0.65,
) -> np.ndarray:
    """半透明边缘向不透明邻域颜色靠拢，减轻背景溢色与黑边。"""
    if strength <= 0:
        return foreground_rgba.copy()

    fg = foreground_rgba.astype(np.float32)
    rgb = fg[:, :, :3]
    alpha = fg[:, :, 3:4] / 255.0

    opaque = (alpha[:, :, 0] > 0.9).astype(np.uint8) * 255
    if opaque.sum() == 0:
        return foreground_rgba.copy()

    opaque_rgb = rgb.copy()
    opaque_rgb[opaque == 0] = 0
    count = cv2.blur(opaque.astype(np.float32), (21, 21)) + 1e-6
    mean_rgb = cv2.blur(opaque_rgb, (21, 21)) / count[:, :, None]

    a = alpha[:, :, 0]
    fringe = (a > 0.02) & (a < 0.95)
    blend = strength * (1.0 - a)
    blend = np.clip(blend, 0.0, 1.0)[:, :, None]

    cleaned = rgb.copy()
    cleaned[fringe] = (1.0 - blend[fringe]) * rgb[fringe] + blend[fringe] * mean_rgb[fringe]

    # Dark fringe / black halo: replace with opaque neighborhood color.
    lum = cleaned.mean(axis=2)
    mean_lum = mean_rgb.mean(axis=2)
    dark = fringe & (lum + 18.0 < mean_lum)
    cleaned[dark] = mean_rgb[dark]

    # Kill near-clear RGB so composites don't show black matte ghosts.
    cleaned[a < 0.04] = 0.0

    out = fg.copy()
    out[:, :, :3] = np.clip(cleaned, 0, 255)
    # Mild edge harden on weak fringe (avoids soft black halo from alpha blur).
    a_out = a.copy()
    weak = (a_out > 0.02) & (a_out < 0.28)
    a_out[weak] = a_out[weak] * a_out[weak]
    out[:, :, 3] = np.clip(a_out * 255.0, 0, 255)
    return out.astype(np.uint8)


def build_repair_mask(
    binary_mask: np.ndarray,
    dilate_px: int = 16,
    feather_px: int = 2,
) -> np.ndarray:
    dilated = dilate_mask(binary_mask, dilate_px=dilate_px)
    return feather_mask(dilated, feather_px=feather_px)


def split_mid_far_by_depth(
    depth: np.ndarray,
    subject_mask: np.ndarray,
    *,
    mid_far_quantile: float = 0.45,
) -> tuple[np.ndarray, np.ndarray]:
    """
    在非主体区域，按深度分位数切中景 / 远景。
    depth: 0~1，越大越近。
    返回 mid_mask, far_mask（uint8 0/255）。
    """
    subject = subject_mask > 127
    bg = ~subject
    if bg.sum() == 0:
        z = np.zeros_like(subject_mask, dtype=np.uint8)
        return z, z

    vals = depth[bg]
    thr = float(np.quantile(vals, mid_far_quantile))

    # 近于阈值 → 中景；远于阈值 → 远景
    mid = bg & (depth >= thr)
    far = bg & (depth < thr)

    mid_u8 = mid.astype(np.uint8) * 255
    far_u8 = far.astype(np.uint8) * 255

    # 轻微闭运算，减少碎斑
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mid_u8 = cv2.morphologyEx(mid_u8, cv2.MORPH_CLOSE, k)
    far_u8 = cv2.morphologyEx(far_u8, cv2.MORPH_CLOSE, k)
    # 主体区域强制清零
    mid_u8[subject] = 0
    far_u8[subject] = 0
    return mid_u8, far_u8


def extract_rgba_layer(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """按 mask 切出带 Alpha 的图层。"""
    a = mask if mask.ndim == 2 else mask[:, :, 0]
    return np.dstack([rgb, a]).astype(np.uint8)
