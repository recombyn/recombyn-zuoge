"""Tests for stateless inpaint service."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image


def test_inpaint_image_bytes_roundtrip(monkeypatch):
    from recombyn_intelligence_service.vision.services import inpaint_service

    def fake_inpaint(rgb, mask, backend="lama"):
        out = rgb.copy()
        out[mask > 127] = (0, 255, 0)
        return out

    monkeypatch.setattr(inpaint_service, "inpaint_once", fake_inpaint)

    rgb = np.full((8, 8, 3), 200, dtype=np.uint8)
    mask = np.zeros((8, 8), dtype=np.uint8)
    mask[2:6, 2:6] = 255
    ibuf = io.BytesIO()
    mbuf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(ibuf, format="PNG")
    Image.fromarray(mask, mode="L").save(mbuf, format="PNG")

    out = inpaint_service.inpaint_image_bytes(ibuf.getvalue(), mbuf.getvalue())
    result = np.asarray(Image.open(io.BytesIO(out)).convert("RGB"))
    assert tuple(result[3, 3]) == (0, 255, 0)
