"""Tests for detect-regions service."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw


def _make_png() -> bytes:
    img = Image.new("RGB", (160, 100), (240, 240, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle((20, 30, 140, 70), fill=(20, 20, 20))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_detect_regions_mocked(monkeypatch):
    from recombyn_intelligence_service.vision.services import detect_regions_service as svc

    monkeypatch.setattr(svc.ocr_mod, "available", lambda: True)
    monkeypatch.setattr(
        svc.ocr_mod,
        "ocr_image",
        lambda path, page_index=0, lang="ch": [
            {
                "type": "text",
                "text": "HELLO",
                "x": 20.0,
                "y": 30.0,
                "width": 120.0,
                "height": 40.0,
            }
        ],
    )

    rgba = np.zeros((100, 160, 4), dtype=np.uint8)
    rgba[25:75, 30:130, 3] = 255

    def fake_matting(rgb, **kwargs):
        from image_layer_pipeline.matting import MattingResult
        from image_layer_pipeline.stages.matting_router import resolve_matting_route

        route = resolve_matting_route(scene="general")
        return MattingResult(
            foreground_rgba=rgba,
            binary_mask=np.zeros((100, 160), dtype=np.uint8),
            sam_regions=[{"source": "opencv-grabcut"}],
            route=route,
            engines=["subpixel-matting"],
            trim={},
        )

    monkeypatch.setattr(svc, "run_matting", fake_matting)
    monkeypatch.setattr(
        svc,
        "propose_sam_regions",
        lambda *_a, **_k: [],
    )

    result = svc.detect_regions_image_bytes(_make_png())
    assert result["width"] == 160
    assert result["height"] == 100
    assert len(result["layers"]) >= 2
    assert any(l.get("type") == "text" for l in result["layers"])
    assert any(l.get("type") == "image" for l in result["layers"])
    assert "subpixel-matting" in result["engines"]
    assert isinstance(result.get("sam_regions"), list)
