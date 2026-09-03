"""Unit tests for MediaKit remove background."""

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


def test_remove_background_requires_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.mediakit_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(remove_background(_tiny_png()))


def test_remove_background_uses_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.mediakit_enabled", lambda: True)

    rgba = io.BytesIO()
    Image.new("RGBA", (64, 48), color=(10, 20, 30, 200)).save(rgba, format="PNG")

    async def fake_mk(_image, *, meta=None):
        assert meta is None or isinstance(meta, dict)
        return {
            "image_bytes": rgba.getvalue(),
            "image_url": "https://output.example/cutout.png",
            "width": 64,
            "height": 48,
            "format": "png",
            "scene": "general",
            "task_id": "amk-tool-remove-bg-1",
            "request_id": "req-1",
        }

    monkeypatch.setattr("app.services.vision.remove_bg.remove_image_background", fake_mk)
    monkeypatch.setattr(
        "app.services.vision.remove_bg.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/removeBg.png",
    )

    result = asyncio.run(remove_background(_tiny_png(), user_id="u1"))
    assert result["kind"] == "removeBg"
    assert result["engine"] == "mediakit:remove-image-background"
    assert result["mode"] == "mediakit"
    assert result["width"] == 64
    assert result["height"] == 48
    assert str(result["image"]).startswith("https://cdn.example/")


def test_remove_background_passes_scene_meta(monkeypatch):
    monkeypatch.setattr("app.services.vision.remove_bg.mediakit_enabled", lambda: True)
    captured: dict[str, object] = {}

    rgba = io.BytesIO()
    Image.new("RGBA", (16, 16), color=(1, 2, 3, 255)).save(rgba, format="PNG")

    async def fake_mk(_image, *, meta=None):
        captured["meta"] = meta
        return {
            "image_bytes": rgba.getvalue(),
            "image_url": "https://output.example/cutout.png",
            "width": 16,
            "height": 16,
            "format": "png",
            "scene": "product",
            "task_id": None,
            "request_id": None,
        }

    monkeypatch.setattr("app.services.vision.remove_bg.remove_image_background", fake_mk)
    monkeypatch.setattr(
        "app.services.vision.remove_bg.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/removeBg.png",
    )

    result = asyncio.run(
        remove_background(
            _tiny_png(),
            meta={"scene": "product"},
            user_id="u1",
        )
    )
    assert result["scene"] == "product"
    assert captured["meta"]["scene"] == "product"
