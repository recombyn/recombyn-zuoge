"""Crop figures and expand tables into editable cell textboxes."""

from __future__ import annotations

import base64
from typing import Any

from app.core.config import settings
from app.services.vision.table_cells import expand_table_to_cells


def crop_region_to_data_url(img_bgr, block: dict[str, Any], pad: int = 2) -> str:
    """Return PNG data URL of block bbox cropped from BGR image."""
    try:
        import cv2
    except ImportError as err:
        raise RuntimeError("opencv required for image crop") from err
    if img_bgr is None:
        raise ValueError("empty image for crop")

    h, w = img_bgr.shape[:2]
    x = int(max(0, float(block.get("x") or 0) - pad))
    y = int(max(0, float(block.get("y") or 0) - pad))
    bw = int(max(1, float(block.get("width") or 1) + pad * 2))
    bh = int(max(1, float(block.get("height") or 1) + pad * 2))
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        raise ValueError("invalid crop region")

    crop = img_bgr[y:y2, x:x2]
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        raise RuntimeError("failed to encode crop as PNG")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def attach_crops(img_bgr, blocks: list[dict[str, Any]], page_index: int = 0) -> list[dict[str, Any]]:
    """
    - figure/image → image node with data-URL src
    - table → editable cell textboxes (+ background rect)
    """
    out: list[dict[str, Any]] = []
    for block in blocks:
        item = dict(block)
        btype = str(item.get("type") or "")
        layout = str(item.get("layout_type") or "").lower()

        if btype == "table" or layout == "table":
            if settings.expand_table_cells:
                cells = expand_table_to_cells(
                    img_bgr, item, page_index=page_index, lang=settings.ocr_lang
                )
                if not cells:
                    raise RuntimeError("table cell expansion returned no cells")
                out.extend(cells)
                continue
            src = crop_region_to_data_url(img_bgr, item)
            item["type"] = "image"
            item["src"] = src
            item["layout_type"] = "table"
            out.append(item)
            continue

        if btype == "image" or layout in {"figure", "image", "equation"}:
            if not item.get("src"):
                src = crop_region_to_data_url(img_bgr, item)
                item["type"] = "image"
                item["src"] = src
                item["layout_type"] = layout or "image"
            out.append(item)
            continue

        out.append(item)
    return out
