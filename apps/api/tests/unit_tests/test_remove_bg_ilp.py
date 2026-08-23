"""Unit tests for ILP-only remove background."""

from __future__ import annotations

import asyncio
import io

import pytest
from PIL import Image

from app.services.vision.remove_bg import remove_background


def _tiny_png() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(buf, format="PNG")
    import base64

    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def test_remove_background_requires_ilp(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.ilp_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="Recombyn Intelligence"):
        asyncio.run(remove_background(_tiny_png()))


def test_remove_background_uses_ilp(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.ilp_enabled", lambda: True)

    rgba = io.BytesIO()
    Image.new("RGBA", (8, 8), color=(10, 20, 30, 200)).save(rgba, format="PNG")

    async def fake_segment(_image, *, model="birefnet-general"):
        return rgba.getvalue(), "image/png"

    monkeypatch.setattr("app.services.vision.remove_bg.segment_foreground_via_ilp", fake_segment)

    result = asyncio.run(remove_background(_tiny_png()))
    assert result["kind"] == "removeBg"
    assert result["engine"] == "ilp:birefnet"
    assert str(result["image"]).startswith("data:image/png;base64,")
