"""Tests for /pipeline/segment matting service."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image


def _png_bytes(w: int = 16, h: int = 16) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(100, 120, 140)).save(buf, format="PNG")
    return buf.getvalue()


def test_segment_foreground_rgba_uses_subpixel_pipeline(monkeypatch):
    from recombyn_intelligence_service.vision.services import segment_service as svc

    fake_rgba = np.zeros((16, 16, 4), dtype=np.uint8)
    fake_rgba[4:12, 4:12, 3] = 255

    def fake_matting(rgb, **kwargs):
        assert rgb.shape[:2] == (16, 16)
        from image_layer_pipeline.matting import MattingResult
        from image_layer_pipeline.stages.matting_router import resolve_matting_route

        route = resolve_matting_route(scene="general", decontaminate=0.5)
        return MattingResult(
            foreground_rgba=fake_rgba,
            binary_mask=np.zeros((16, 16), dtype=np.uint8),
            sam_regions=[{"source": "opencv-grabcut"}],
            route=route,
            engines=["subpixel-matting"],
            trim={},
        )

    monkeypatch.setattr(svc, "run_matting", fake_matting)

    out, engines = svc.segment_foreground_rgba(_png_bytes(), decontaminate=0.5)
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    assert "subpixel-matting" in engines


def test_segment_foreground_rgba_rejects_empty():
    from recombyn_intelligence_service.vision.services.segment_service import (
        segment_foreground_rgba,
    )

    import pytest

    with pytest.raises(ValueError, match="empty"):
        segment_foreground_rgba(b"")
