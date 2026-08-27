"""Layout analysis via PPStructure with OCR fallback."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from image_layer_pipeline.stages.ocr import ocr_image

_structure = None
_structure_error: str | None = None


def structure_available() -> bool:
    try:
        from paddleocr import PPStructure  # noqa: F401
    except ImportError:
        return False
    return True


def get_structure():
    global _structure, _structure_error
    if _structure is not None:
        return _structure
    if _structure_error:
        raise RuntimeError(_structure_error)
    try:
        from paddleocr import PPStructure

        try:
            _structure = PPStructure(recovery=False)
        except TypeError:
            try:
                _structure = PPStructure(show_log=False, recovery=False)
            except TypeError:
                _structure = PPStructure()
        return _structure
    except Exception as exc:  # noqa: BLE001
        _structure_error = str(exc)
        raise


def _box_from_region(region: dict) -> tuple[float, float, float, float] | None:
    box = region.get("bbox") or region.get("box")
    if box and len(box) >= 4:
        x1, y1, x2, y2 = map(float, box[:4])
        return x1, y1, max(x2 - x1, 1), max(y2 - y1, 1)
    return None


def layout_or_ocr(path: Path, page_index: int = 0, lang: str = "ch") -> tuple[list[dict[str, Any]], str]:
    """Prefer PPStructure layout regions; fall back to plain PaddleOCR."""
    if structure_available():
        try:
            engine = get_structure()
            raw = engine(str(path))
            blocks: list[dict[str, Any]] = []
            for region in raw or []:
                if not isinstance(region, dict):
                    continue
                rtype = str(region.get("type") or region.get("label") or "text").lower()
                geom = _box_from_region(region)
                if not geom:
                    continue
                x, y, w, h = geom
                if rtype in {"text", "title", "header", "footer", "list", "reference"}:
                    res = region.get("res")
                    if isinstance(res, list):
                        for line in res:
                            if not isinstance(line, dict):
                                continue
                            text = line.get("text") or ""
                            if not text:
                                continue
                            tb = line.get("text_region") or line.get("bbox")
                            if tb and len(tb) >= 4:
                                if isinstance(tb[0], (list, tuple)):
                                    xs = [float(p[0]) for p in tb]
                                    ys = [float(p[1]) for p in tb]
                                    lx, ly = min(xs), min(ys)
                                    lw, lh = max(xs) - lx, max(ys) - ly
                                else:
                                    lx, ly, lx2, ly2 = map(float, tb[:4])
                                    lw, lh = max(lx2 - lx, 1), max(ly2 - ly, 1)
                            else:
                                lx, ly, lw, lh = x, y, w, h
                            blocks.append(
                                {
                                    "type": "text",
                                    "page": page_index,
                                    "text": str(text).strip(),
                                    "x": lx,
                                    "y": ly,
                                    "width": lw,
                                    "height": lh,
                                    "font_size": max(12.0, lh * 0.8),
                                    "layout_type": rtype,
                                    "source": "ppstructure",
                                }
                            )
                    else:
                        text = ""
                        if isinstance(res, dict):
                            text = str(res.get("text") or "")
                        if text:
                            blocks.append(
                                {
                                    "type": "text",
                                    "page": page_index,
                                    "text": text.strip(),
                                    "x": x,
                                    "y": y,
                                    "width": w,
                                    "height": h,
                                    "font_size": max(12.0, h * 0.8),
                                    "layout_type": rtype,
                                    "source": "ppstructure",
                                }
                            )
                elif rtype in {"figure", "image", "table", "equation"}:
                    blocks.append(
                        {
                            "type": "image" if rtype != "table" else "table",
                            "page": page_index,
                            "text": "",
                            "x": x,
                            "y": y,
                            "width": w,
                            "height": h,
                            "layout_type": rtype,
                            "source": "ppstructure",
                        }
                    )
            if blocks:
                return blocks, "ppstructure"
        except Exception:
            pass

    return ocr_image(path, page_index=page_index, lang=lang), "paddleocr"
