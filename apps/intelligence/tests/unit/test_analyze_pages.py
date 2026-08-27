"""Unit tests for document import page analysis."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image


def _png_bytes(w: int = 120, h: int = 80) -> bytes:
    img = Image.new("RGB", (w, h), color=(240, 245, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_analyze_pages_requires_ocr(monkeypatch):
    from image_layer_pipeline.stages import page_import

    monkeypatch.setattr(page_import.ocr_mod, "available", lambda: False)
    out = page_import.analyze_page_images_bytes([_png_bytes()])
    assert out["blocks"] == []
    assert any("paddleocr" in w for w in out["warnings"])


def test_analyze_pages_empty_input():
    from image_layer_pipeline.stages.page_import import analyze_page_images_bytes

    out = analyze_page_images_bytes([])
    assert out["blocks"] == []
    assert "no page images" in out["warnings"][0]


def test_analyze_pages_with_mock_ocr(monkeypatch):
    from image_layer_pipeline.stages import page_import

    monkeypatch.setattr(page_import.ocr_mod, "available", lambda: True)

    def fake_layout(path, page_index=0, lang="ch"):
        return [
            {
                "type": "text",
                "page": page_index,
                "text": "Hello",
                "x": 10.0,
                "y": 12.0,
                "width": 50.0,
                "height": 14.0,
                "font_size": 12.0,
                "source": "paddleocr",
            }
        ], "paddleocr"

    monkeypatch.setattr(page_import, "layout_or_ocr", fake_layout)
    monkeypatch.setattr(page_import, "preprocess_bgr", lambda bgr: bgr)
    monkeypatch.setattr(page_import, "extract_palette", lambda _bgr, k=5: ["#112233"])

    out = page_import.analyze_page_images_bytes([_png_bytes()], target_width=400)
    assert out["width"] == 400
    assert len(out["blocks"]) >= 1
    texts = [b for b in out["blocks"] if b.get("type") == "text"]
    assert texts and texts[0]["text"] == "Hello"
    assert "paddleocr" in out["engines"]


def test_analyze_pages_sam_regions(monkeypatch):
    from image_layer_pipeline.stages import page_import

    monkeypatch.setattr(page_import.ocr_mod, "available", lambda: True)

    class _Proposal:
        def to_dict(self):
            return {"id": "sam-0", "bbox": [1, 2, 3, 4]}

    def fake_layout(path, page_index=0, lang="ch"):
        return [], "paddleocr"

    monkeypatch.setattr(page_import, "layout_or_ocr", fake_layout)
    monkeypatch.setattr(page_import, "preprocess_bgr", lambda bgr: bgr)
    monkeypatch.setattr(page_import, "extract_palette", lambda _bgr, k=5: [])

    import image_layer_pipeline.stages.sam_roi as sam_roi

    monkeypatch.setattr(sam_roi, "sam_enabled", lambda: True)
    monkeypatch.setattr(sam_roi, "propose_sam_regions", lambda _rgb, max_regions=8: [_Proposal()])
    monkeypatch.setattr(sam_roi, "sam_backend_name", lambda: "opencv")

    out = page_import.analyze_page_images_bytes([_png_bytes()])
    assert out["sam_regions"] == [{"id": "sam-0", "bbox": [1, 2, 3, 4]}]
    assert "opencv" in out["engines"]
