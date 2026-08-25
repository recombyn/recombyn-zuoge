"""Expand table regions into editable text cell boxes via OCR."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from app.services.vision.merge_blocks import merge_text_blocks
from app.services.vision.ocr import ocr_image


def _crop_bgr(img_bgr, block: dict[str, Any], pad: int = 2):
    import cv2

    h, w = img_bgr.shape[:2]
    x = int(max(0, float(block.get("x") or 0) - pad))
    y = int(max(0, float(block.get("y") or 0) - pad))
    bw = int(max(1, float(block.get("width") or 1) + pad * 2))
    bh = int(max(1, float(block.get("height") or 1) + pad * 2))
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        return None, 0, 0
    return img_bgr[y:y2, x:x2].copy(), x, y


def _cluster_rows(cells: list[dict], y_tol: float) -> list[list[dict]]:
    ordered = sorted(cells, key=lambda c: float(c["y"]) + float(c["height"]) / 2)
    rows: list[list[dict]] = []
    for cell in ordered:
        cy = float(cell["y"]) + float(cell["height"]) / 2
        if not rows:
            rows.append([cell])
            continue
        last = rows[-1]
        last_cy = sum(float(c["y"]) + float(c["height"]) / 2 for c in last) / len(last)
        if abs(cy - last_cy) <= y_tol:
            last.append(cell)
        else:
            rows.append([cell])
    for row in rows:
        row.sort(key=lambda c: float(c["x"]))
    return rows


def expand_table_to_cells(
    img_bgr,
    block: dict[str, Any],
    page_index: int = 0,
    lang: str = "ch",
) -> list[dict[str, Any]]:
    """
    OCR inside a table bbox and emit:
    - one background rect for the table area
    - text nodes for detected cell/line fragments (merged per row-ish)
    Coordinates are in full-page pixel space.
    """
    crop, ox, oy = _crop_bgr(img_bgr, block)
    if crop is None:
        raise ValueError("invalid table crop region")

    try:
        import cv2
    except ImportError as err:
        raise RuntimeError("opencv required for table OCR") from err

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / "table.png"
        cv2.imwrite(str(tmp_path), crop)
        local_blocks = ocr_image(tmp_path, page_index=0, lang=lang)

    if not local_blocks:
        raise RuntimeError("table OCR produced no cells")

    # Map crop-local → page coords
    cells: list[dict[str, Any]] = []
    for item in local_blocks:
        cells.append(
            {
                "type": "text",
                "page": page_index,
                "text": item.get("text"),
                "x": float(item.get("x") or 0) + ox,
                "y": float(item.get("y") or 0) + oy,
                "width": float(item.get("width") or 20),
                "height": float(item.get("height") or 12),
                "font_size": float(item.get("font_size") or 12),
                "layout_type": "table-cell",
                "source": "table-ocr",
            }
        )

    cells = merge_text_blocks(cells, y_tol_ratio=0.6)
    heights = [max(float(c.get("height") or 0), 1) for c in cells]
    median_h = sorted(heights)[len(heights) // 2] if heights else 14
    rows = _cluster_rows(cells, y_tol=max(median_h * 0.55, 4))

    # Flatten row-clustered cells (already merged); keep as individual text boxes
    flat: list[dict[str, Any]] = []
    for row in rows:
        flat.extend(row)

    bg = {
        "type": "rect",
        "page": page_index,
        "x": float(block.get("x") or 0),
        "y": float(block.get("y") or 0),
        "width": float(block.get("width") or 1),
        "height": float(block.get("height") or 1),
        "fill": "#FAFAFA",
        "layout_type": "table",
        "source": "table-bg",
    }
    return [bg, *flat]
