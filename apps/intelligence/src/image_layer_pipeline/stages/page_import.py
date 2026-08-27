"""Document import — OCR/layout blocks, palette, crops (mirrors web page_analyzer)."""

from __future__ import annotations

import base64
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from image_layer_pipeline.stages import ocr as ocr_mod
from image_layer_pipeline.stages.layout import layout_or_ocr
from image_layer_pipeline.stages.text_blocks import merge_text_blocks


def extract_palette(img_bgr, k: int = 5) -> list[str]:
    """Return up to k dominant colors as #RRGGBB."""
    if img_bgr is None or img_bgr.size == 0:
        return []
    small = cv2.resize(img_bgr, (0, 0), fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    data = small.reshape((-1, 3)).astype(np.float32)
    if data.shape[0] < k:
        k = max(1, data.shape[0])
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    centers = np.clip(centers, 0, 255).astype(np.uint8)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)
    colors: list[str] = []
    for idx in order:
        b, g, r = centers[idx]
        colors.append(f"#{int(r):02X}{int(g):02X}{int(b):02X}")
    return colors


def preprocess_bgr(img):
    denoise = cv2.fastNlMeansDenoisingColored(img, None, 3, 3, 7, 21)
    lab = cv2.cvtColor(denoise, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    merged = cv2.merge((l2, a, b))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def _bgr_from_bytes(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")
    return bgr


def crop_region_to_data_url(img_bgr, block: dict[str, Any], pad: int = 2) -> str | None:
    if img_bgr is None:
        return None
    h, w = img_bgr.shape[:2]
    x = int(max(0, float(block.get("x") or 0) - pad))
    y = int(max(0, float(block.get("y") or 0) - pad))
    bw = int(max(1, float(block.get("width") or 1) + pad * 2))
    bh = int(max(1, float(block.get("height") or 1) + pad * 2))
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        return None
    crop = img_bgr[y:y2, x:x2]
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        return None
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


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
    h, w = img_bgr.shape[:2]
    x = int(max(0, float(block.get("x") or 0) - 2))
    y = int(max(0, float(block.get("y") or 0) - 2))
    bw = int(max(1, float(block.get("width") or 1) + 4))
    bh = int(max(1, float(block.get("height") or 1) + 4))
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        return []
    crop = img_bgr[y:y2, x:x2].copy()
    ox, oy = x, y

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / "table.png"
        cv2.imwrite(str(tmp_path), crop)
        try:
            local_blocks = ocr_mod.ocr_image(tmp_path, page_index=0, lang=lang)
        except Exception:
            return []

    if not local_blocks:
        return []

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


def attach_crops(
    img_bgr,
    blocks: list[dict[str, Any]],
    *,
    page_index: int = 0,
    lang: str = "ch",
    expand_table_cells: bool = True,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in blocks:
        item = dict(block)
        btype = str(item.get("type") or "")
        layout = str(item.get("layout_type") or "").lower()

        if btype == "table" or layout == "table":
            if expand_table_cells:
                try:
                    cells = expand_table_to_cells(img_bgr, item, page_index=page_index, lang=lang)
                    if cells:
                        out.extend(cells)
                        continue
                except Exception:
                    pass
            src = crop_region_to_data_url(img_bgr, item)
            if src:
                item["type"] = "image"
                item["src"] = src
                item["layout_type"] = "table"
                out.append(item)
            else:
                item["type"] = "rect"
                item["fill"] = "#F5F5F5"
                out.append(item)
            continue

        if btype == "image" or layout in {"figure", "image", "equation"}:
            if not item.get("src"):
                src = crop_region_to_data_url(img_bgr, item)
                if src:
                    item["type"] = "image"
                    item["src"] = src
                    item["layout_type"] = layout or "image"
                else:
                    item["type"] = "rect"
                    item["fill"] = "#F0F0F0"
            out.append(item)
            continue

        out.append(item)
    return out


def _scale_blocks(
    blocks: list[dict], img_w: int, img_h: int, target_w: int
) -> tuple[list[dict], int, int]:
    if img_w <= 0:
        return blocks, target_w, int(target_w * 1.414)
    scale = target_w / float(img_w)
    target_h = max(1, int(round(img_h * scale)))
    scaled: list[dict] = []
    for block in blocks:
        item = dict(block)
        for key in ("x", "y", "width", "height", "font_size"):
            if key in item and item[key] is not None:
                item[key] = float(item[key]) * scale
        scaled.append(item)
    return scaled, target_w, target_h


def analyze_page_images_bytes(
    pages: list[bytes],
    *,
    lang: str = "ch",
    target_width: int = 794,
    palette_k: int = 5,
    expand_table_cells: bool = True,
) -> dict[str, Any]:
    """Analyze raster pages for document import (same JSON shape as web BFF)."""
    warnings: list[str] = []
    engines: list[str] = []
    all_blocks: list[dict] = []
    palette: list[str] = []
    page_w = target_width
    page_h = int(page_w * 1.414)
    page_heights: list[int] = []

    sam_regions: list[dict] = []

    empty = {
        "blocks": [],
        "width": page_w,
        "height": page_h,
        "palette": [],
        "engines": [],
        "warnings": warnings,
        "sam_regions": sam_regions,
        "lama_applied": False,
    }

    if not pages:
        warnings.append("no page images for vision analysis")
        return empty

    if not ocr_mod.available():
        warnings.append("paddleocr not installed; pip install -e '.[ocr]'")
        return empty

    for page_index, raw in enumerate(pages):
        try:
            bgr = _bgr_from_bytes(raw)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"page {page_index}: load failed: {exc}")
            continue

        h, w = bgr.shape[:2]
        page_heights.append(h)
        if page_index == 0:
            page_w, page_h = w, h

        try:
            pre = preprocess_bgr(bgr)
        except Exception:
            pre = bgr
            warnings.append(f"page {page_index}: preprocess skipped")

        if page_index == 0:
            try:
                palette = extract_palette(pre, k=palette_k)
                if palette:
                    engines.append("kmeans")
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"kmeans failed: {exc}")
            try:
                from image_layer_pipeline.stages.sam_roi import (
                    propose_sam_regions,
                    sam_backend_name,
                    sam_enabled,
                )

                if sam_enabled():
                    rgb = cv2.cvtColor(pre, cv2.COLOR_BGR2RGB)
                    proposals = propose_sam_regions(rgb, max_regions=8)
                    sam_regions = [r.to_dict() for r in proposals]
                    backend = sam_backend_name()
                    if backend not in engines:
                        engines.append(backend)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"sam_regions failed: {exc}"[:200])

        page_blocks: list[dict] = []
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp) / f"page_{page_index:04d}.png"
            cv2.imwrite(str(tmp_path), pre)
            try:
                blocks, engine = layout_or_ocr(tmp_path, page_index=page_index, lang=lang)
                page_blocks = blocks
                if engine not in engines:
                    engines.append(engine)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"page {page_index}: layout/ocr failed: {exc}")

        try:
            page_blocks = attach_crops(
                bgr,
                page_blocks,
                page_index=page_index,
                lang=lang,
                expand_table_cells=expand_table_cells,
            )
            if any(b.get("src") for b in page_blocks):
                if "crop" not in engines:
                    engines.append("crop")
            if any(
                b.get("source") == "table-ocr" or b.get("layout_type") == "table-cell"
                for b in page_blocks
            ):
                if "table-cells" not in engines:
                    engines.append("table-cells")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"page {page_index}: crop/table failed: {exc}")

        if page_index > 0 and page_heights:
            y_offset = sum(page_heights[:-1])
            for block in page_blocks:
                block["y"] = float(block.get("y") or 0) + y_offset

        all_blocks.extend(page_blocks)

    before = len([b for b in all_blocks if b.get("type") == "text"])
    all_blocks = merge_text_blocks(all_blocks)
    after = len([b for b in all_blocks if b.get("type") == "text"])
    if before != after:
        engines.append("merge")
        warnings.append(f"merged text blocks {before} → {after}")

    total_h = sum(page_heights) if page_heights else page_h
    if all_blocks and page_w > 0:
        all_blocks, page_w, page_h = _scale_blocks(all_blocks, page_w, total_h, target_width)

    return {
        "blocks": all_blocks,
        "width": page_w,
        "height": page_h,
        "palette": palette,
        "engines": engines,
        "warnings": warnings,
        "sam_regions": sam_regions,
        "lama_applied": False,
    }
