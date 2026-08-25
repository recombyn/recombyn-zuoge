"""Unit tests for ILP-only remove background."""

from __future__ import annotations

import asyncio
import base64
import io

import pytest
from PIL import Image

from app.services.vision.remove_bg import remove_background


def _tiny_png() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _tiny_mask_png() -> str:
    buf = io.BytesIO()
    Image.new("L", (8, 8), color=255).save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def test_remove_background_requires_ilp(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.ilp_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="Recombyn Intelligence"):
        asyncio.run(remove_background(_tiny_png()))


def test_remove_background_uses_ilp(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.ilp_enabled", lambda: True)

    rgba = io.BytesIO()
    # Subject-sized paint on a larger canvas — removeBg must keep full size (no trim).
    Image.new("RGBA", (64, 48), color=(10, 20, 30, 200)).save(rgba, format="PNG")

    async def fake_segment(_image, *, model="birefnet-general", decontaminate=0.65, include_mask=None, exclude_mask=None):
        assert decontaminate >= 0.8
        assert include_mask is None
        assert exclude_mask is None
        return rgba.getvalue(), "image/png"

    monkeypatch.setattr("app.services.vision.remove_bg.segment_foreground_via_ilp", fake_segment)

    result = asyncio.run(remove_background(_tiny_png()))
    assert result["kind"] == "removeBg"
    assert result["engine"] == "ilp:birefnet"
    assert result["width"] == 64
    assert result["height"] == 48
    assert str(result["image"]).startswith("data:image/png;base64,")


def test_remove_background_forwards_brush_masks(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.ilp_enabled", lambda: True)

    rgba = io.BytesIO()
    Image.new("RGBA", (16, 16), color=(1, 2, 3, 255)).save(rgba, format="PNG")
    captured: dict[str, object] = {}

    async def fake_segment(_image, *, model="birefnet-general", decontaminate=0.65, include_mask=None, exclude_mask=None):
        captured["include"] = include_mask
        captured["exclude"] = exclude_mask
        captured["decontaminate"] = decontaminate
        return rgba.getvalue(), "image/png"

    monkeypatch.setattr("app.services.vision.remove_bg.segment_foreground_via_ilp", fake_segment)

    inc = _tiny_mask_png()
    exc = _tiny_mask_png()
    result = asyncio.run(
        remove_background(
            _tiny_png(),
            meta={"includeMask": inc, "excludeMask": exc, "decontaminate": 0.9},
        )
    )
    assert result["kind"] == "removeBg"
    assert isinstance(captured["include"], (bytes, bytearray)) and len(captured["include"]) > 8
    assert isinstance(captured["exclude"], (bytes, bytearray)) and len(captured["exclude"]) > 8
    assert captured["decontaminate"] == 0.9
