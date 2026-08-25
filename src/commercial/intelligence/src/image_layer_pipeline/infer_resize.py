"""Long-edge cap for vision inference — downscale in, upscale masks/alpha out."""

from __future__ import annotations

import os
from typing import Any

import numpy as np


def infer_max_long_edge(default: int = 2048) -> int:
    raw = str(os.environ.get("ILP_INFER_MAX_LONG_EDGE") or "").strip()
    if not raw:
        return max(64, int(default))
    try:
        return max(64, int(float(raw)))
    except ValueError:
        return max(64, int(default))


def fit_long_edge_scale(h: int, w: int, max_long: int | None = None) -> float:
    """Return scale factor ≤ 1.0 so max(h, w) ≤ max_long."""
    mh = max(1, int(h))
    mw = max(1, int(w))
    cap = infer_max_long_edge() if max_long is None else max(64, int(max_long))
    long_edge = max(mh, mw)
    if long_edge <= cap:
        return 1.0
    return float(cap) / float(long_edge)


def resize_rgb(image_rgb: np.ndarray, scale: float) -> np.ndarray:
    if scale >= 0.999:
        return image_rgb
    import cv2

    h, w = image_rgb.shape[:2]
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(image_rgb, (nw, nh), interpolation=cv2.INTER_AREA)


def resize_mask(mask: np.ndarray | None, scale: float) -> np.ndarray | None:
    if mask is None or scale >= 0.999:
        return mask
    import cv2

    h, w = mask.shape[:2]
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    out = cv2.resize(mask, (nw, nh), interpolation=cv2.INTER_NEAREST)
    return out


def upscale_mask(mask: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    import cv2

    if mask.shape[0] == out_h and mask.shape[1] == out_w:
        return mask
    return cv2.resize(mask, (out_w, out_h), interpolation=cv2.INTER_NEAREST)


def upscale_rgba(rgba: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    """Upscale RGBA; RGB with linear, alpha with nearest to keep hard edges."""
    import cv2

    if rgba.shape[0] == out_h and rgba.shape[1] == out_w:
        return rgba
    rgb = cv2.resize(rgba[:, :, :3], (out_w, out_h), interpolation=cv2.INTER_LINEAR)
    alpha = cv2.resize(rgba[:, :, 3], (out_w, out_h), interpolation=cv2.INTER_NEAREST)
    out = np.empty((out_h, out_w, 4), dtype=np.uint8)
    out[:, :, :3] = rgb
    out[:, :, 3] = alpha
    return out


def scale_sam_regions(
    regions: list[dict[str, Any]],
    scale: float,
    *,
    out_h: int,
    out_w: int,
) -> list[dict[str, Any]]:
    """Map SAM region boxes from infer space back to original pixels."""
    if not regions or scale >= 0.999:
        return regions
    inv = 1.0 / scale if scale > 1e-9 else 1.0
    out: list[dict[str, Any]] = []
    for r in regions:
        row = dict(r)
        box = row.get("box") or row.get("bbox")
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            x0, y0, x1, y1 = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
            scaled = [
                max(0.0, min(float(out_w), x0 * inv)),
                max(0.0, min(float(out_h), y0 * inv)),
                max(0.0, min(float(out_w), x1 * inv)),
                max(0.0, min(float(out_h), y1 * inv)),
            ]
            if "box" in row:
                row["box"] = scaled
            if "bbox" in row:
                row["bbox"] = scaled
        out.append(row)
    return out
