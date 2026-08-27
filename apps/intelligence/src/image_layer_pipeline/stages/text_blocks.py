"""OCR text block merge, raster partition, and mask helpers for editText."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np


from image_layer_pipeline.stages.subpixel import rect_from_region


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        n = float(v)
        return n if n == n else fallback
    except (TypeError, ValueError):
        return fallback


def _median(values: list[float], default: float = 14.0) -> float:
    if not values:
        return default
    vals = sorted(values)
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def merge_text_blocks(blocks: list[dict[str, Any]], y_tol_ratio: float = 0.55) -> list[dict[str, Any]]:
    others = [b for b in blocks if b.get("type") != "text" or not str(b.get("text") or "").strip()]
    texts = [b for b in blocks if b.get("type") == "text" and str(b.get("text") or "").strip()]
    if not texts:
        return others

    by_page: dict[int, list[dict]] = {}
    for block in texts:
        page = int(block.get("page") or 0)
        by_page.setdefault(page, []).append(block)

    merged: list[dict[str, Any]] = []
    for page, page_blocks in sorted(by_page.items()):
        heights = [max(float(b.get("height") or 0), 1.0) for b in page_blocks]
        median_h = _median(heights)
        y_tol = max(median_h * y_tol_ratio, 4.0)

        ordered = sorted(
            page_blocks,
            key=lambda b: (
                float(b.get("y") or 0) + float(b.get("height") or 0) / 2.0,
                float(b.get("x") or 0),
            ),
        )

        clusters: list[list[dict]] = []
        for block in ordered:
            cy = float(block.get("y") or 0) + float(block.get("height") or 0) / 2.0
            if not clusters:
                clusters.append([block])
                continue
            last = clusters[-1]
            last_cy = sum(float(b.get("y") or 0) + float(b.get("height") or 0) / 2.0 for b in last) / len(last)
            if abs(cy - last_cy) <= y_tol:
                clusters[-1].append(block)
            else:
                clusters.append([block])

        for cluster in clusters:
            cluster = sorted(cluster, key=lambda b: float(b.get("x") or 0))
            xs0 = [float(b.get("x") or 0) for b in cluster]
            ys0 = [float(b.get("y") or 0) for b in cluster]
            xs1 = [float(b.get("x") or 0) + float(b.get("width") or 0) for b in cluster]
            ys1 = [float(b.get("y") or 0) + float(b.get("height") or 0) for b in cluster]
            text = " ".join(str(b.get("text") or "").strip() for b in cluster if str(b.get("text") or "").strip())
            h = max(ys1) - min(ys0)
            font_sizes = [float(b.get("font_size") or h * 0.8) for b in cluster]
            base = dict(cluster[0])
            base.update(
                {
                    "type": "text",
                    "page": page,
                    "text": text,
                    "x": min(xs0),
                    "y": min(ys0),
                    "width": max(max(xs1) - min(xs0), 20),
                    "height": max(h, 12),
                    "font_size": _median(font_sizes, max(h * 0.8, 12)),
                    "source": "merged",
                    "merged_count": len(cluster),
                }
            )
            merged.append(base)

    combined = merged + others
    combined.sort(
        key=lambda b: (
            int(b.get("page") or 0),
            float(b.get("y") or 0),
            float(b.get("x") or 0),
        )
    )
    return combined


def block_ocr_score(block: dict[str, Any]) -> float | None:
    score = block.get("score")
    if score is None:
        return None
    try:
        return float(score)
    except (TypeError, ValueError):
        return None


def looks_like_display_text(block: dict[str, Any]) -> bool:
    text = str(block.get("text") or "").strip()
    if not text:
        return False
    h = max(1.0, _num(block.get("height"), 14))
    w = max(1.0, _num(block.get("width"), 14))
    font_size = _num(block.get("font_size"), h * 0.78)
    chars = max(1, len(text))
    avg_char_w = w / chars
    if font_size >= 40:
        return True
    if chars <= 8 and font_size >= 28 and avg_char_w / font_size >= 0.85:
        return True
    return False


def should_rasterize_text(block: dict[str, Any], *, min_confidence: float = 0.72) -> bool:
    score = block_ocr_score(block)
    threshold = max(0.0, min(1.0, float(min_confidence)))
    if score is not None and score < threshold:
        return True
    if score is not None and score < 0.88 and looks_like_display_text(block):
        return True
    if score is None and looks_like_display_text(block):
        return True
    return False


def partition_text_blocks(
    texts: list[dict[str, Any]],
    *,
    min_confidence: float = 0.72,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    editable: list[dict[str, Any]] = []
    raster: list[dict[str, Any]] = []
    for block in texts:
        if str(block.get("type") or "") != "text":
            continue
        if not str(block.get("text") or "").strip():
            continue
        if should_rasterize_text(block, min_confidence=min_confidence):
            raster.append(block)
        else:
            editable.append(block)
    return editable, raster


def apply_region_mask(mask: np.ndarray, h: int, w: int, region: dict[str, Any]) -> None:
    soft = region.get("mask")
    if soft is not None:
        try:
            m = np.asarray(soft)
            if m.ndim == 2 and m.shape[0] == h and m.shape[1] == w:
                np.maximum(mask, (m > 8).astype(np.uint8) * 255, out=mask)
                return
        except Exception:
            pass

    poly = region.get("poly")
    if poly:
        try:
            pts = np.asarray(poly, dtype=np.float32).reshape(-1, 1, 2)
            if pts.shape[0] >= 3:
                layer = np.zeros_like(mask)
                cv2.fillPoly(layer, [np.round(pts).astype(np.int32)], 255)
                np.maximum(mask, layer, out=mask)
                return
        except Exception:
            pass

    pad = 3
    x, y, bw, bh = rect_from_region(region, pad=float(pad), max_w=w, max_h=h)
    mask[y : min(h, y + bh), x : min(w, x + bw)] = 255


def union_erase_mask(
    h: int,
    w: int,
    regions: list[dict[str, Any]],
    *,
    dilate_px: int = 16,
    feather_px: int = 2,
) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    for region in regions:
        apply_region_mask(mask, h, w, region)
    if mask.max() == 0:
        return mask
    if dilate_px > 0:
        k = dilate_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        mask = cv2.dilate(mask, kernel, iterations=1)
    if feather_px > 0:
        fk = max(1, feather_px * 2 + 1)
        if fk % 2 == 0:
            fk += 1
        mask = cv2.GaussianBlur(mask, (fk, fk), 0)
        mask = np.where(mask > 32, 255, 0).astype(np.uint8)
    return mask


def rgba_crop_png_bytes(bgr: np.ndarray, region: dict[str, Any], pad: int = 3) -> bytes | None:
    h, w = bgr.shape[:2]
    x, y, bw, bh = rect_from_region(region, pad=float(pad), max_w=w, max_h=h)
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        return None

    crop = bgr[y:y2, x:x2].copy()
    poly = region.get("poly")
    if poly:
        try:
            pts = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
            local = pts - np.array([x, y], dtype=np.float32)
            layer = np.zeros((y2 - y, x2 - x), dtype=np.uint8)
            if local.shape[0] >= 3:
                cv2.fillPoly(layer, [np.round(local).astype(np.int32)], 255)
                rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
                rgba[:, :, 3] = layer
                ok, buf = cv2.imencode(".png", rgba)
                if ok:
                    return buf.tobytes()
        except Exception:
            pass

    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        return None
    return buf.tobytes()
