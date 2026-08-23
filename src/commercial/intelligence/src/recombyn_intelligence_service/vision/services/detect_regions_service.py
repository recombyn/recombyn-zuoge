"""Region proposals for Mark tool — OCR text boxes + SAM + BiRefNet subject."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

from image_layer_pipeline.stages import ocr as ocr_mod
from image_layer_pipeline.stages.sam_roi import (
    propose_sam_regions,
    regions_to_layer_dicts,
    sam_backend_name,
    sam_enabled,
)
from image_layer_pipeline.matting import run_matting
from image_layer_pipeline.stages.subpixel import snap_inset
from image_layer_pipeline.stages.text_blocks import merge_text_blocks


def _bgr_from_bytes(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")
    return bgr


def _subject_bbox_from_rgba(
    rgba: np.ndarray,
    *,
    min_area_ratio: float = 0.02,
    alpha_threshold: float = 0.05,
) -> dict[str, Any] | None:
    if rgba.ndim != 3 or rgba.shape[2] < 4:
        return None
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    if float(alpha.max()) < alpha_threshold:
        return None
    h, w = alpha.shape[:2]
    mask = alpha >= alpha_threshold
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    x0_f, x1_f = float(xs.min()), float(xs.max()) + 1.0
    y0_f, y1_f = float(ys.min()), float(ys.max()) + 1.0
    bw_f, bh_f = x1_f - x0_f, y1_f - y0_f
    if bw_f * bh_f < max(400.0, float(h * w * min_area_ratio)):
        return None
    if bw_f * bh_f > float(h * w * 0.92):
        return None
    x0, y0, bw, bh = snap_inset(x0_f, y0_f, bw_f, bh_f, pad=1.0, max_w=w, max_h=h)
    return {
        "type": "image",
        "x": float(x0),
        "y": float(y0),
        "width": float(max(bw, 1)),
        "height": float(max(bh, 1)),
        "name": "主体",
    }


def _layer_iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax2 = float(a["x"]) + float(a["width"])
    ay2 = float(a["y"]) + float(a["height"])
    bx2 = float(b["x"]) + float(b["width"])
    by2 = float(b["y"]) + float(b["height"])
    ix1, iy1 = max(float(a["x"]), float(b["x"])), max(float(a["y"]), float(b["y"]))
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = float(a["width"]) * float(a["height"]) + float(b["width"]) * float(b["height"]) - inter
    return inter / max(union, 1.0)


def _append_unique_layer(layers: list[dict[str, Any]], layer: dict[str, Any]) -> None:
    if any(_layer_iou(layer, existing) > 0.72 for existing in layers):
        return
    layers.append(layer)


def detect_regions_image_bytes(
    image_bytes: bytes,
    *,
    lang: str = "ch",
    segmentation_model: str = "birefnet-general",
) -> dict[str, Any]:
    """
    Propose text + SAM + subject boxes in source-pixel coordinates (no crops / inpaint).
    """
    if not image_bytes:
        raise ValueError("empty image")

    bgr = _bgr_from_bytes(image_bytes)
    h, w = bgr.shape[:2]
    warnings: list[str] = []
    engines: list[str] = []
    layers: list[dict[str, Any]] = []
    sam_regions: list[dict[str, Any]] = []

    if ocr_mod.available():
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "src.png"
            ok, buf = cv2.imencode(".png", bgr)
            if not ok:
                raise RuntimeError("encode source png failed")
            path.write_bytes(buf.tobytes())
            try:
                blocks = merge_text_blocks(ocr_mod.ocr_image(path, page_index=0, lang=lang))
                engines.append("paddleocr")
                for block in blocks:
                    if str(block.get("type") or "") != "text":
                        continue
                    text = str(block.get("text") or "").strip()
                    if not text:
                        continue
                    _append_unique_layer(
                        layers,
                        {
                            "type": "text",
                            "text": text,
                            "x": float(block.get("x") or 0),
                            "y": float(block.get("y") or 0),
                            "width": max(8.0, float(block.get("width") or 40)),
                            "height": max(8.0, float(block.get("height") or 14)),
                            "name": "文字",
                        },
                    )
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"OCR failed: {exc}"[:200])
    else:
        warnings.append("OCR unavailable (install .[ocr])")

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    try:
        if sam_enabled():
            proposals = propose_sam_regions(rgb, max_regions=8)
            sam_regions = [r.to_dict() for r in proposals]
            if sam_regions:
                engines.append(sam_backend_name())
            for layer in regions_to_layer_dicts(proposals, start_index=len(layers) + 1):
                _append_unique_layer(layers, layer)

        matting = run_matting(
            rgb,
            scene="auto",
            model=segmentation_model.strip() or None,
            decontaminate=0.65,
            trim_output=False,
        )
        rgba = matting.foreground_rgba
        refined_sam = matting.sam_regions
        if refined_sam and not sam_regions:
            sam_regions = refined_sam
        for engine in matting.engines:
            if engine not in engines:
                engines.append(engine)
        subject = _subject_bbox_from_rgba(rgba)
        if subject:
            _append_unique_layer(layers, subject)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"segment failed: {exc}"[:200])

    return {
        "width": w,
        "height": h,
        "layers": layers,
        "engines": engines,
        "warnings": warnings,
        "sam_regions": sam_regions,
    }
