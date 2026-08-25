"""Text-layer style helpers shared by ILP text-decompose adapter.

Local SAM/LaMa/rembg decompose used to live here — that path is retired.
抠图 / 分层 / 标记 / 高清 run only through closed-source Intelligence (ilp_* adapters).
"""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx

_CJK_RE = re.compile(r"[\u3400-\u9fff]")


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        n = float(v)
        return n if n == n else fallback  # noqa: PLR0124 — NaN check
    except (TypeError, ValueError):
        return fallback


async def _load_bgr(image_ref: str):
    """Decode data URL or https URL → BGR ndarray."""
    import cv2
    import numpy as np

    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")

    raw: bytes
    if ref.startswith("data:"):
        try:
            _, b64 = ref.split(",", 1)
        except ValueError as exc:
            raise ValueError("invalid data URL") from exc
        raw = base64.b64decode(b64)
    elif ref.startswith("http://") or ref.startswith("https://"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
            resp = await client.get(ref)
            if resp.status_code >= 400:
                raise ValueError(f"failed to download image ({resp.status_code})")
            raw = resp.content
    else:
        raise ValueError("image must be a data URL or https URL")

    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")
    return bgr


def _sample_ink_color(bgr, block: dict[str, Any]) -> str:
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    x = int(max(0, min(w - 1, _num(block.get("x")))))
    y = int(max(0, min(h - 1, _num(block.get("y")))))
    bw = int(max(1, min(w - x, _num(block.get("width"), 8))))
    bh = int(max(1, min(h - y, _num(block.get("height"), 8))))
    crop = bgr[y : y + bh, x : x + bw]
    if crop.size == 0:
        return "#111111"
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # Prefer dark ink pixels when present.
    ink = crop[gray < 160]
    sample = ink if len(ink) > 8 else crop.reshape(-1, 3)
    mean = np.mean(sample, axis=0)
    b, g, r = [int(max(0, min(255, v))) for v in mean]
    return f"#{r:02x}{g:02x}{b:02x}"


def _estimate_font(block: dict[str, Any], fill: str) -> dict[str, Any]:
    text = str(block.get("text") or "")
    height = max(8.0, _num(block.get("height"), 14))
    # Rough px → canvas font size.
    font_size = max(10, min(96, int(round(height * 0.85))))
    font_family = "Noto Sans SC" if _CJK_RE.search(text) else "Inter"
    return {
        "fill": fill,
        "fontSize": font_size,
        "fontFamily": font_family,
        "fontWeight": 400,
    }


def _enrich_texts(bgr, texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in texts:
        if str(block.get("type") or "") != "text":
            continue
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        fill = _sample_ink_color(bgr, block)
        style = _estimate_font(block, fill)
        out.append(
            {
                "type": "text",
                "text": text,
                "x": _num(block.get("x")),
                "y": _num(block.get("y")),
                "width": max(8.0, _num(block.get("width"), 40)),
                "height": max(8.0, _num(block.get("height"), 14)),
                "name": "文字",
                **style,
            }
        )
    return out
