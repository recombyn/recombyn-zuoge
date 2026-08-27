"""editText pipeline — OCR, raster partition, LaMa background inpaint."""

from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

from image_layer_pipeline.stages import ocr as ocr_mod
from image_layer_pipeline.stages.text_blocks import (
    block_ocr_score,
    looks_like_display_text,
    merge_text_blocks,
    partition_text_blocks,
    rgba_crop_png_bytes,
    union_erase_mask,
)
from image_layer_pipeline.stages.inpainting import inpaint_once
from recombyn_intelligence_service.vision.services.inpaint_service import inpaint_image_bytes


def _bgr_from_bytes(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")
    return bgr


def _png_bytes_from_bgr(bgr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("encode png failed")
    return buf.tobytes()


def decompose_text_image_bytes(
    image_bytes: bytes,
    *,
    lang: str = "ch",
    min_confidence: float = 0.72,
) -> dict[str, Any]:
    """
    Run editText decomposition on raw image bytes.

    Returns JSON-serializable dict with background + editable blocks + raster layers.
    """
    if not image_bytes:
        raise ValueError("empty image")
    if not ocr_mod.available():
        raise RuntimeError(
            "OCR unavailable. Install optional deps: pip install -e '.[ocr]'"
        )

    bgr = _bgr_from_bytes(image_bytes)
    h, w = bgr.shape[:2]
    warnings: list[str] = []
    engines: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "src.png"
        ok, buf = cv2.imencode(".png", bgr)
        if not ok:
            raise RuntimeError("encode source png failed")
        path.write_bytes(buf.tobytes())

        blocks = merge_text_blocks(ocr_mod.ocr_image(path, page_index=0, lang=lang))
        engines.append("paddleocr")

        texts_raw = [b for b in blocks if str(b.get("type") or "") == "text"]
        editable_raw, raster_raw = partition_text_blocks(
            texts_raw,
            min_confidence=min_confidence,
        )

        raster_layers: list[dict[str, Any]] = []
        for i, block in enumerate(raster_raw):
            png = rgba_crop_png_bytes(bgr, block, pad=3)
            if not png:
                continue
            score = block_ocr_score(block)
            raster_layers.append(
                {
                    "png_b64": base64.b64encode(png).decode("ascii"),
                    "x": float(block.get("x") or 0),
                    "y": float(block.get("y") or 0),
                    "width": max(1.0, float(block.get("width") or 1)),
                    "height": max(1.0, float(block.get("height") or 1)),
                    "name": "艺术字" if looks_like_display_text(block) else f"文字图 {i + 1}",
                    "letteringText": str(block.get("text") or "").strip() or None,
                    "ocrScore": score,
                }
            )

        if raster_layers:
            engines.append("text-raster")
            warnings.append(
                f"{len(raster_layers)} 处低置信/艺术字已保留为图片层，可移动但不可直接改字体"
            )

        bg_bgr = bgr
        inpaint_engine = "none"
        if texts_raw:
            mask = union_erase_mask(h, w, texts_raw)
            if mask.max() > 0:
                try:
                    painted = inpaint_once(
                        cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB),
                        mask,
                        backend="lama",
                    )
                    bg_bgr = cv2.cvtColor(painted, cv2.COLOR_RGB2BGR)
                    inpaint_engine = "lama"
                except Exception:
                    png = inpaint_image_bytes(
                        _png_bytes_from_bgr(bgr),
                        _png_bytes_from_bgr(mask),
                        backend="lama",
                    )
                    bg_bgr = _bgr_from_bytes(png)
                    inpaint_engine = "lama"

        if texts_raw and inpaint_engine != "none":
            engines.append(f"inpaint:{inpaint_engine}")

        if not editable_raw and not raster_layers:
            warnings.append("未识别到文字")
            background_b64 = base64.b64encode(image_bytes).decode("ascii")
        else:
            background_b64 = base64.b64encode(_png_bytes_from_bgr(bg_bgr)).decode("ascii")

    editable_blocks: list[dict[str, Any]] = []
    for block in editable_raw:
        editable_blocks.append(
            {
                "text": str(block.get("text") or "").strip(),
                "x": float(block.get("x") or 0),
                "y": float(block.get("y") or 0),
                "width": max(8.0, float(block.get("width") or 40)),
                "height": max(8.0, float(block.get("height") or 14)),
                "font_size": float(block.get("font_size") or max(12.0, float(block.get("height") or 14) * 0.8)),
                "score": block_ocr_score(block),
                "poly": block.get("poly"),
            }
        )

    return {
        "width": w,
        "height": h,
        "background_b64": background_b64,
        "editable_blocks": editable_blocks,
        "raster_layers": raster_layers,
        "engines": engines,
        "warnings": warnings,
    }
