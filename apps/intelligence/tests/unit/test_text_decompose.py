"""Tests for editText decomposition service."""

from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _make_text_png() -> bytes:
    img = Image.new("RGB", (200, 80), (240, 240, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle((20, 20, 180, 60), fill=(20, 20, 20))
    draw.text((30, 28), "TEST", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_decompose_text_image_bytes_mocked(monkeypatch):
    from recombyn_intelligence_service.vision.services import text_decompose_service as svc

    monkeypatch.setattr(svc.ocr_mod, "available", lambda: True)
    monkeypatch.setattr(
        svc,
        "merge_text_blocks",
        lambda blocks: blocks,
    )
    monkeypatch.setattr(
        svc.ocr_mod,
        "ocr_image",
        lambda path, page_index=0, lang="ch": [
            {
                "type": "text",
                "text": "TEST",
                "x": 20.0,
                "y": 20.0,
                "width": 160.0,
                "height": 40.0,
                "font_size": 32.0,
                "score": 0.95,
                "poly": [[20, 20], [180, 20], [180, 60], [20, 60]],
            }
        ],
    )

    def fake_inpaint(rgb, mask, backend="lama"):
        out = rgb.copy()
        out[mask > 127] = (250, 250, 255)
        return out

    monkeypatch.setattr(svc, "inpaint_once", fake_inpaint)

    result = svc.decompose_text_image_bytes(_make_text_png(), min_confidence=0.72)
    assert result["width"] == 200
    assert result["height"] == 80
    assert len(result["editable_blocks"]) == 1
    assert result["editable_blocks"][0]["text"] == "TEST"
    assert not result["raster_layers"]
    assert result["background_b64"]
    decoded = base64.b64decode(result["background_b64"])
    assert decoded[:8] == b"\x89PNG\r\n\x1a\n"
