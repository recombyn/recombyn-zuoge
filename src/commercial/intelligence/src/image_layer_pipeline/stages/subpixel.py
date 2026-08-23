"""Subpixel-safe bbox helpers for OCR masks and crops."""

from __future__ import annotations

import math
from typing import Any


def _float(v: Any, fallback: float = 0.0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return fallback
    if n != n:
        return fallback
    return n


def snap_inset(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    pad: float = 0.0,
    max_w: int | None = None,
    max_h: int | None = None,
) -> tuple[int, int, int, int]:
    """Floor origin, ceil extent — avoids clipping anti-aliased glyph edges."""
    x0 = max(0, int(math.floor(x - pad)))
    y0 = max(0, int(math.floor(y - pad)))
    x1 = int(math.ceil(x + w + pad))
    y1 = int(math.ceil(y + h + pad))
    if max_w is not None:
        x1 = min(max_w, x1)
    if max_h is not None:
        y1 = min(max_h, y1)
    return x0, y0, max(1, x1 - x0), max(1, y1 - y0)


def rect_from_region(region: dict[str, Any], *, pad: float = 0.0, max_w: int, max_h: int) -> tuple[int, int, int, int]:
    x = _float(region.get("x"))
    y = _float(region.get("y"))
    w = max(1.0, _float(region.get("width"), 1.0))
    h = max(1.0, _float(region.get("height"), 1.0))
    return snap_inset(x, y, w, h, pad=pad, max_w=max_w, max_h=max_h)
