"""Tests for smart alpha eraser."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from recombyn_intelligence_service.vision.services.erase_alpha_service import erase_alpha_bytes


def test_erase_alpha_expands_brush_to_region():
    rgb = np.zeros((40, 40, 3), dtype=np.uint8)
    rgb[:, :20] = (0, 180, 0)
    rgb[:, 20:] = (200, 40, 40)
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="PNG")

    mask = np.zeros((40, 40), dtype=np.uint8)
    mask[18:22, 8:12] = 255
    mbuf = io.BytesIO()
    Image.fromarray(mask, mode="L").save(mbuf, format="PNG")

    out_bytes, meta = erase_alpha_bytes(buf.getvalue(), mbuf.getvalue())
    rgba = np.asarray(Image.open(io.BytesIO(out_bytes)).convert("RGBA"))
    assert meta["engine"] == "ilp:erase-alpha"
    # Green side should lose more opacity than untouched red side.
    assert rgba[:, :20, 3].mean() < rgba[:, 20:, 3].mean()
