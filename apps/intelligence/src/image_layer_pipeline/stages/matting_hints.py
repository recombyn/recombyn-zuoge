"""User brush hints — keep / exclude regions + optional similar-color grow."""

from __future__ import annotations

import cv2
import numpy as np


def _normalize_mask(mask: np.ndarray, *, h: int, w: int) -> np.ndarray:
    if mask is None or mask.size == 0:
        return np.zeros((h, w), dtype=np.float32)
    m = mask
    if m.ndim == 3:
        m = m[:, :, 0] if m.shape[2] >= 1 else cv2.cvtColor(m, cv2.COLOR_RGB2GRAY)
    if m.shape[0] != h or m.shape[1] != w:
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
    return np.clip(m.astype(np.float32) / 255.0, 0.0, 1.0)


def _grow_similar_from_seeds(image_rgb: np.ndarray, seed: np.ndarray, *, threshold: float = 28.0) -> np.ndarray:
    """Flood similar LAB color from painted seeds (same-region assist)."""
    h, w = image_rgb.shape[:2]
    if not seed.any():
        return seed
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    grown = seed.copy()
    ys, xs = np.where(seed > 0.5)
    if ys.size == 0:
        return grown
    # Sample mean color from seed
    mean_lab = lab[seed > 0.5].mean(axis=0)
    dist = np.linalg.norm(lab - mean_lab.reshape(1, 1, 3), axis=2)
    similar = (dist <= threshold).astype(np.float32)
    grown = np.maximum(grown, similar * 0.85)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    grown = cv2.morphologyEx((grown * 255).astype(np.uint8), cv2.MORPH_CLOSE, k)
    return grown.astype(np.float32) / 255.0


def _grabcut_refine(
    image_rgb: np.ndarray,
    alpha: np.ndarray,
    include: np.ndarray,
    exclude: np.ndarray,
) -> np.ndarray:
    h, w = image_rgb.shape[:2]
    gc = np.full((h, w), cv2.GC_PR_FGD, dtype=np.uint8)
    gc[alpha < 0.15] = cv2.GC_PR_BGD
    gc[alpha > 0.85] = cv2.GC_FGD
    if include.any():
        gc[include > 0.35] = cv2.GC_FGD
    if exclude.any():
        gc[exclude > 0.35] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    try:
        cv2.grabCut(bgr, gc, None, bgd, fgd, 2, cv2.GC_INIT_WITH_MASK)
    except Exception:
        return alpha
    fg = np.isin(gc, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.float32)
    return np.clip(0.55 * alpha + 0.45 * fg, 0.0, 1.0)


def apply_matting_hints(
    rgba: np.ndarray,
    image_rgb: np.ndarray,
    *,
    include_mask: np.ndarray | None = None,
    exclude_mask: np.ndarray | None = None,
    grow_similar: bool = True,
) -> np.ndarray:
    """
    Refine alpha using optional user strokes.

    - **include** (保留): force foreground
    - **exclude** (排除): force background
    """
    if rgba.ndim != 3 or rgba.shape[2] < 4:
        raise ValueError("rgba must be HxWx4")
    h, w = rgba.shape[:2]
    inc = _normalize_mask(include_mask, h=h, w=w) if include_mask is not None else np.zeros((h, w), np.float32)
    exc = _normalize_mask(exclude_mask, h=h, w=w) if exclude_mask is not None else np.zeros((h, w), np.float32)

    if inc.max() < 0.02 and exc.max() < 0.02:
        return rgba

    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)

    if grow_similar and inc.max() > 0.02:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        inc_u8 = cv2.dilate((inc * 255).astype(np.uint8), k, iterations=1)
        inc = _grow_similar_from_seeds(image_rgb, inc_u8.astype(np.float32) / 255.0)

    if inc.max() > 0.02:
        alpha = np.maximum(alpha, inc * 0.96)
    if exc.max() > 0.02:
        alpha = alpha * (1.0 - exc * 0.97)

    alpha = _grabcut_refine(image_rgb, alpha, inc, exc)

    out = rgba.copy()
    out[:, :, 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    # Premultiply-ish: zero RGB where fully transparent after exclude
    out[:, :, :3] = np.where(
        out[:, :, 3:4] < 8,
        0,
        np.clip(rgb, 0, 255),
    ).astype(np.uint8)
    return out


def mask_from_bytes(raw: bytes, *, h: int, w: int) -> np.ndarray | None:
    if not raw:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    gray = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return None
    if gray.shape[0] != h or gray.shape[1] != w:
        gray = cv2.resize(gray, (w, h), interpolation=cv2.INTER_LINEAR)
    return gray
