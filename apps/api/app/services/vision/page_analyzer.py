"""Analyze page images → text/layout blocks + color palette."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.vision.colors import extract_palette
from app.services.vision.crop import attach_crops
from app.services.vision.layout import layout_or_ocr
from app.services.vision.merge_blocks import merge_text_blocks
from app.services.vision.ocr import available as ocr_available
from app.services.vision.opencv_ops import load_bgr, preprocess_bgr, write_temp_png


def _scale_blocks(blocks: list[dict], img_w: int, img_h: int, target_w: int) -> tuple[list[dict], int, int]:
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


def analyze_page_images(page_paths: list[Path]) -> dict[str, Any]:
    """
    Run OCR/layout on raster pages for document import.

    Returns blocks (text merged, figures cropped, tables as cells), page size, palette, engines, warnings.
    """
    from app.services.vision.ilp_client import analyze_pages_via_ilp, ilp_enabled

    ilp_fallback_warnings: list[str] = []
    if ilp_enabled():
        try:
            result = analyze_pages_via_ilp(
                page_paths,
                lang=settings.ocr_lang,
                target_width=settings.scene_target_width,
                palette_k=settings.palette_k,
                expand_table_cells=settings.expand_table_cells,
            )
            engines = list(result.get("engines") or [])
            if "ilp:analyze-pages" not in engines:
                engines.insert(0, "ilp:analyze-pages")
            result["engines"] = engines
            return result
        except Exception as exc:  # noqa: BLE001
            ilp_fallback_warnings.append(f"intelligence analyze-pages failed: {exc}")
            empty_w = settings.scene_target_width
            empty_h = int(empty_w * 1.414)
            if not ocr_available():
                ilp_fallback_warnings.append(
                    "local OCR unavailable; import will use raster fallback "
                    "(pip install -e '.[ocr]' or fix intelligence)"
                )
                return {
                    "blocks": [],
                    "width": empty_w,
                    "height": empty_h,
                    "palette": [],
                    "engines": [],
                    "warnings": ilp_fallback_warnings,
                    "sam_regions": [],
                    "lama_applied": False,
                }

    warnings: list[str] = list(ilp_fallback_warnings)
    engines: list[str] = []
    all_blocks: list[dict] = []
    palette: list[str] = []
    page_w = settings.scene_target_width
    page_h = int(page_w * 1.414)
    page_heights: list[int] = []

    empty = {
        "blocks": [],
        "width": page_w,
        "height": page_h,
        "palette": [],
        "engines": [],
        "warnings": warnings,
        "sam_regions": [],
        "lama_applied": False,
    }

    if not page_paths:
        warnings.append("no page images for vision analysis")
        return empty

    if not ocr_available():
        warnings.append("opencv/paddleocr not installed; skip vision OCR (pip install -e '.[ocr]')")
        return empty

    for page_index, path in enumerate(page_paths):
        try:
            bgr = load_bgr(path)
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
                palette = extract_palette(pre, k=settings.palette_k)
                if palette:
                    engines.append("kmeans")
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"kmeans failed: {exc}")

        page_blocks: list[dict] = []
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp) / f"page_{page_index:04d}.png"
            write_temp_png(pre, tmp_path)
            try:
                blocks, engine = layout_or_ocr(tmp_path, page_index=page_index, lang=settings.ocr_lang)
                page_blocks = blocks
                if engine not in engines:
                    engines.append(engine)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"page {page_index}: layout/ocr failed: {exc}")

        try:
            page_blocks = attach_crops(bgr, page_blocks, page_index=page_index)
            if any(b.get("src") for b in page_blocks):
                if "crop" not in engines:
                    engines.append("crop")
            if any(b.get("source") == "table-ocr" or b.get("layout_type") == "table-cell" for b in page_blocks):
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
        all_blocks, page_w, page_h = _scale_blocks(
            all_blocks, page_w, total_h, settings.scene_target_width
        )

    return {
        "blocks": all_blocks,
        "width": page_w,
        "height": page_h,
        "palette": palette,
        "engines": engines,
        "warnings": warnings,
        "sam_regions": [],
        "lama_applied": False,
    }
