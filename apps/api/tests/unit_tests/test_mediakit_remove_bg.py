"""Unit tests for MediaKit remove-image-background client helpers."""

from __future__ import annotations

import asyncio
import base64
import io

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk


def _tiny_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color=(1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


def test_mediakit_enabled_false_without_key(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "")
    assert mk.mediakit_enabled() is False
    assert mk.mediakit_supports() == []


def test_mediakit_supports_when_key_set(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "amk-test-key")
    assert mk.mediakit_enabled() is True
    assert mk.mediakit_supports() == [
        "removeBg",
        "expand",
        "editText",
        "eraser",
        "upscale",
        "translateImage",
        "productScene",
    ]


def test_scene_from_meta_maps_portrait_to_human():
    assert mk._scene_from_meta({"scene": "portrait"}) == "human"
    assert mk._scene_from_meta({"cutoutScene": "product"}) == "product"
    assert mk._scene_from_meta({"scene": "nope"}) == "general"


def test_remove_image_background_happy_path(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "amk-test-key")
    monkeypatch.setattr(mk.settings, "mediakit_base_url", "https://mediakit.test")
    png = _tiny_png_bytes()
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}")
        path = request.url.path
        if path.endswith("/request-media-upload-url"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "file_id": "mediakit://file-abc",
                        "method": "PUT",
                        "upload_url": "https://upload.test/put",
                        "upload_headers": [{"key": "Content-Type", "value": "image/png"}],
                    },
                },
            )
        if str(request.url) == "https://upload.test/put":
            return httpx.Response(200, content=b"ok")
        if path.endswith("/remove-image-background"):
            body = request.read()
            assert b"mediakit://file-abc" in body
            assert b'"scene":"general"' in body
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-1",
                    "result": {
                        "image_url": "https://output.test/out.png",
                        "image_width": 4,
                        "image_height": 4,
                        "image_format": "png",
                        "image_size": len(png),
                    },
                },
            )
        if str(request.url) == "https://output.test/out.png":
            return httpx.Response(200, content=png)
        return httpx.Response(404, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)

    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(mk.httpx, "AsyncClient", fake_async_client)

    data_url = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
    out = asyncio.run(mk.remove_image_background(data_url, meta={"scene": "general"}))
    assert out["width"] == 4
    assert out["height"] == 4
    assert out["image_bytes"] == png
    assert out["scene"] == "general"
    assert any("remove-image-background" in c for c in calls)
