"""Unit tests for ILP text-decompose BFF adapter."""

from __future__ import annotations

import asyncio
import base64
import io

import numpy as np
import pytest
from PIL import Image


def _tiny_png_data_url() -> str:
    img = Image.new("RGB", (64, 48), color=(200, 210, 220))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def test_decompose_text_via_ilp_maps_layers(monkeypatch):
    bg = base64.b64encode(b"png-bytes").decode("ascii")

    async def fake_text_decompose(_image: str, *, lang: str = "ch", min_confidence: float = 0.72):
        return {
            "width": 64,
            "height": 48,
            "background_b64": bg,
            "editable_blocks": [
                {
                    "text": "Hello",
                    "x": 5.0,
                    "y": 6.0,
                    "width": 40.0,
                    "height": 12.0,
                    "font_size": 11.0,
                }
            ],
            "raster_layers": [],
            "engines": ["paddleocr", "lama"],
            "warnings": [],
        }

    monkeypatch.setattr("app.services.vision.ilp_text_decompose.ilp_enabled", lambda: True)
    monkeypatch.setattr("app.services.vision.ilp_text_decompose.text_decompose_via_ilp", fake_text_decompose)
    monkeypatch.setattr(
        "app.services.vision.ilp_text_decompose.rehost_image_bytes",
        lambda _uid, data, **kwargs: f"https://cdn.example/{kwargs.get('filename', 'x')}",
    )

    bgr = np.full((48, 64, 3), 200, dtype=np.uint8)

    async def fake_load(_ref: str):
        return bgr

    monkeypatch.setattr("app.services.vision.ilp_text_decompose.load_bgr", fake_load)

    from app.services.vision.ilp_text_decompose import decompose_text_via_ilp

    result = asyncio.run(
        decompose_text_via_ilp(
            kind="editText",
            image=_tiny_png_data_url(),
            user_id="u1",
        )
    )
    assert result["kind"] == "editText"
    assert result["width"] == 64
    assert len(result["layers"]) >= 2
    text_layers = [l for l in result["layers"] if l.get("type") == "text"]
    assert len(text_layers) == 1
    assert text_layers[0]["text"] == "Hello"
    assert "ilp:text-decompose" in result["engines"][0]


def test_decompose_text_via_ilp_rehosts_when_user_id(monkeypatch):
    bg = base64.b64encode(b"png-bytes").decode("ascii")

    async def fake_text_decompose(_image: str, *, lang: str = "ch", min_confidence: float = 0.72):
        return {
            "width": 64,
            "height": 48,
            "background_b64": bg,
            "editable_blocks": [],
            "raster_layers": [
                {
                    "png_b64": bg,
                    "x": 1.0,
                    "y": 2.0,
                    "width": 10.0,
                    "height": 8.0,
                    "name": "艺术字",
                }
            ],
            "engines": ["paddleocr", "lama"],
            "warnings": [],
        }

    monkeypatch.setattr("app.services.vision.ilp_text_decompose.ilp_enabled", lambda: True)
    monkeypatch.setattr("app.services.vision.ilp_text_decompose.text_decompose_via_ilp", fake_text_decompose)
    monkeypatch.setattr(
        "app.services.vision.ilp_text_decompose.rehost_image_bytes",
        lambda _uid, data, **kwargs: f"https://cdn.example/{kwargs.get('filename', 'x')}",
    )

    bgr = np.full((48, 64, 3), 200, dtype=np.uint8)

    async def fake_load(_ref: str):
        return bgr

    monkeypatch.setattr("app.services.vision.ilp_text_decompose.load_bgr", fake_load)

    from app.services.vision.ilp_text_decompose import decompose_text_via_ilp

    result = asyncio.run(
        decompose_text_via_ilp(
            kind="editText",
            image=_tiny_png_data_url(),
            user_id="u1",
        )
    )
    assert result["image"].startswith("https://cdn.example/")
    raster = [
        l
        for l in result["layers"]
        if l.get("type") == "image" and l.get("name") == "艺术字"
    ]
    assert raster[0]["src"].startswith("https://cdn.example/")
