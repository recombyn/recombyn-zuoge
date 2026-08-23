"""PaddleOCR wrapper (lazy singleton). Compatible with paddleocr 2.x and 3.x."""

from __future__ import annotations

from pathlib import Path
from typing import Any

_ocr = None
_ocr_error: str | None = None


def available() -> bool:
    try:
        import paddleocr  # noqa: F401
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


def get_ocr(lang: str = "ch"):
    global _ocr, _ocr_error
    if _ocr is not None:
        return _ocr
    if _ocr_error:
        raise RuntimeError(_ocr_error)
    try:
        from paddleocr import PaddleOCR

        init_attempts: list[dict[str, Any]] = [
            {"lang": lang, "enable_mkldnn": False},
            {"lang": lang, "use_textline_orientation": True, "enable_mkldnn": False},
            {"lang": lang, "use_angle_cls": True, "enable_mkldnn": False},
            {"lang": lang},
            {"lang": lang, "use_angle_cls": True},
        ]
        last_err: Exception | None = None
        for kwargs in init_attempts:
            try:
                _ocr = PaddleOCR(**kwargs)
                return _ocr
            except (TypeError, ValueError) as exc:
                last_err = exc
                continue
        if last_err:
            raise last_err
        raise RuntimeError("PaddleOCR init failed")
    except Exception as exc:  # noqa: BLE001
        _ocr_error = str(exc)
        raise


def _poly_bounds(poly: Any) -> tuple[float, float, float, float] | None:
    try:
        if poly is None:
            return None
        pts = poly
        if hasattr(pts, "tolist"):
            pts = pts.tolist()
        if not pts:
            return None
        if len(pts) == 4 and not isinstance(pts[0], (list, tuple)):
            x1, y1, x2, y2 = map(float, pts)
            return x1, y1, max(x2 - x1, 1.0), max(y2 - y1, 1.0)
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        x0, y0 = min(xs), min(ys)
        return x0, y0, max(max(xs) - x0, 1.0), max(max(ys) - y0, 1.0)
    except (TypeError, ValueError, IndexError):
        return None


def _poly_points(poly: Any) -> list[list[float]] | None:
    if poly is None:
        return None
    pts = poly.tolist() if hasattr(poly, "tolist") else poly
    if not pts:
        return None
    if len(pts) == 4 and not isinstance(pts[0], (list, tuple)):
        x1, y1, x2, y2 = map(float, pts)
        return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    out: list[list[float]] = []
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            continue
        out.append([float(p[0]), float(p[1])])
    return out or None


def _blocks_from_v3_result(page_result: Any, page_index: int) -> list[dict[str, Any]]:
    data = page_result
    if hasattr(page_result, "json"):
        raw = page_result.json
        raw = raw() if callable(raw) else raw
        if isinstance(raw, dict):
            data = raw.get("res") or raw

    getter = None
    if isinstance(data, dict):
        getter = data.get
    elif hasattr(page_result, "get"):
        getter = page_result.get

    if getter is None:
        return []

    texts = getter("rec_texts") or getter("texts") or []
    scores = getter("rec_scores") or []
    polys = getter("rec_polys") or getter("dt_polys") or []
    boxes = getter("rec_boxes")

    blocks: list[dict[str, Any]] = []
    for i, text in enumerate(texts):
        if text is None or not str(text).strip():
            continue
        geom = None
        poly_src = None
        if i < len(polys):
            poly_src = polys[i]
            geom = _poly_bounds(poly_src)
        if geom is None and boxes is not None:
            try:
                row = boxes[i]
                if hasattr(row, "tolist"):
                    row = row.tolist()
                poly_src = row
                geom = _poly_bounds(row)
            except (TypeError, IndexError, ValueError):
                geom = None
        if geom is None:
            continue
        x, y, w, h = geom
        score = None
        if i < len(scores):
            try:
                score = float(scores[i])
            except (TypeError, ValueError):
                score = None
        blocks.append(
            {
                "type": "text",
                "page": page_index,
                "text": str(text).strip(),
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "font_size": max(12.0, h * 0.8),
                "score": score,
                "source": "paddleocr",
                "poly": _poly_points(poly_src),
            }
        )
    return blocks


def _blocks_from_classic(result: Any, page_index: int) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    lines = result
    if result and isinstance(result, list) and len(result) == 1 and isinstance(result[0], list):
        lines = result
    for page_lines in lines or []:
        if page_lines is None:
            continue
        if isinstance(page_lines, dict) or hasattr(page_lines, "get"):
            blocks.extend(_blocks_from_v3_result(page_lines, page_index))
            continue
        for item in page_lines:
            try:
                box, (text, score) = item
            except (TypeError, ValueError):
                continue
            if not text or not str(text).strip():
                continue
            geom = _poly_bounds(box)
            if geom is None:
                continue
            x, y, w, h = geom
            blocks.append(
                {
                    "type": "text",
                    "page": page_index,
                    "text": str(text).strip(),
                    "x": x,
                    "y": y,
                    "width": w,
                    "height": h,
                    "font_size": max(12.0, h * 0.8),
                    "score": float(score) if score is not None else None,
                    "source": "paddleocr",
                    "poly": _poly_points(box),
                }
            )
    return blocks


def ocr_image(path: Path, page_index: int = 0, lang: str = "ch") -> list[dict[str, Any]]:
    """Run OCR and return text blocks in image pixel coordinates."""
    engine = get_ocr(lang=lang)

    if hasattr(engine, "predict"):
        result = engine.predict(str(path))
        blocks: list[dict[str, Any]] = []
        for page_result in result or []:
            blocks.extend(_blocks_from_v3_result(page_result, page_index))
        if blocks:
            return blocks

    if hasattr(engine, "ocr"):
        try:
            result = engine.ocr(str(path), cls=True)
        except TypeError:
            result = engine.ocr(str(path))
        return _blocks_from_classic(result, page_index)

    return []
