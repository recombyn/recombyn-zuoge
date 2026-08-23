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

        # paddleocr 3.x + paddle 3.3.x: default mkldnn/PIR path crashes on CPU
        # (ConvertPirAttribute2RuntimeAttribute). Prefer enable_mkldnn=False.
        # Do not pass show_log — paddleocr 3.x rejects it as an unknown argument.
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
    """Return (x, y, w, h) from a 4-point polygon or flat bbox."""
    try:
        if poly is None:
            return None
        # numpy array / list of points
        pts = poly
        if hasattr(pts, "tolist"):
            pts = pts.tolist()
        if not pts:
            return None
        # flat [x1,y1,x2,y2]
        if len(pts) == 4 and not isinstance(pts[0], (list, tuple)):
            x1, y1, x2, y2 = map(float, pts)
            return x1, y1, max(x2 - x1, 1.0), max(y2 - y1, 1.0)
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        x0, y0 = min(xs), min(ys)
        return x0, y0, max(max(xs) - x0, 1.0), max(max(ys) - y0, 1.0)
    except (TypeError, ValueError, IndexError):
        return None


def _blocks_from_v3_result(page_result: Any, page_index: int) -> list[dict[str, Any]]:
    """Parse paddleocr 3.x OCRResult / dict with rec_texts + rec_polys."""
    data = page_result
    if hasattr(page_result, "json"):
        raw = page_result.json
        raw = raw() if callable(raw) else raw
        if isinstance(raw, dict):
            data = raw.get("res") or raw

    # Mapping-like OCRResult supports .get / keys
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
        if i < len(polys):
            geom = _poly_bounds(polys[i])
        if geom is None and boxes is not None:
            try:
                row = boxes[i]
                if hasattr(row, "tolist"):
                    row = row.tolist()
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
            }
        )
    return blocks


def _blocks_from_classic(result: Any, page_index: int) -> list[dict[str, Any]]:
    """Parse classic list[[box, (text, score)]] from paddleocr 2.x / ocr()."""
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
                }
            )
    return blocks


def ocr_image(path: Path, page_index: int = 0, lang: str = "ch") -> list[dict[str, Any]]:
    """Run OCR and return text blocks in image pixel coordinates."""
    engine = get_ocr(lang=lang)

    # paddleocr 3.x: prefer predict(); ocr() may share the same path
    if hasattr(engine, "predict"):
        result = engine.predict(str(path))
        blocks: list[dict[str, Any]] = []
        for page_result in result or []:
            blocks.extend(_blocks_from_v3_result(page_result, page_index))
        if blocks:
            return blocks
        # empty predict — try classic fallback below

    if hasattr(engine, "ocr"):
        try:
            result = engine.ocr(str(path), cls=True)
        except TypeError:
            result = engine.ocr(str(path))
        return _blocks_from_classic(result, page_index)

    return []
