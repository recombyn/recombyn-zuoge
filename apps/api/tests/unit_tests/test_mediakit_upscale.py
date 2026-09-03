"""Unit tests for MediaKit enhance-image / upscale."""

from __future__ import annotations

import asyncio
import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.upscale import upscale_image


def _rgb_png_bytes(size: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=(10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_enhance_params_resolution_2k():
    body = mk.enhance_params_from_meta({"resolution": "2K"})
    assert body["tool_version"] == "professional"
    assert body["generative_enhance_mode"] == "fidelity_first"
    assert body["target_width"] == 2048
    assert body["target_height"] == 2048


def test_enhance_params_multiple_wins_over_targets():
    body = mk.enhance_params_from_meta(
        {"multiple": 2.5, "targetWidth": 1920, "toolVersion": "max"}
    )
    assert body["tool_version"] == "max"
    assert body["multiple"] == 2.5
    assert "target_width" not in body


def test_enhance_params_target_width_only():
    body = mk.enhance_params_from_meta({"target_width": 1920, "tool_version": "standard"})
    assert body["tool_version"] == "standard"
    assert body["target_width"] == 1920
    assert "generative_enhance_mode" not in body


def test_upscale_image_requires_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.upscale.mediakit_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(upscale_image("data:image/png;base64,xx"))


def test_upscale_image_rehosts(monkeypatch):
    monkeypatch.setattr("app.services.vision.upscale.mediakit_enabled", lambda: True)
    png = _rgb_png_bytes()

    async def fake_enhance(image, *, meta=None, resolution=None):
        assert resolution == "2K" or (meta or {}).get("resolution") == "2K"
        return {
            "image_bytes": png,
            "image_url": "https://output.test/up.png",
            "width": 8,
            "height": 8,
            "format": "png",
            "tool_version": "professional",
            "task_id": "t1",
            "request_id": "r1",
        }

    monkeypatch.setattr("app.services.vision.upscale.enhance_image", fake_enhance)
    monkeypatch.setattr(
        "app.services.vision.upscale.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/upscale.png",
    )
    result = asyncio.run(
        upscale_image(
            "data:image/png;base64,abc",
            meta={"resolution": "2K"},
            resolution="2K",
            user_id="u1",
        )
    )
    assert result["kind"] == "upscale"
    assert result["engine"] == "mediakit:enhance-image"
    assert result["mode"] == "mediakit"
    assert result["image"] == "https://cdn.example/upscale.png"
    assert result["width"] == 8


def test_enhance_image_posts_body(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "amk-test-key")
    monkeypatch.setattr(mk.settings, "mediakit_base_url", "https://mediakit.test")
    png = _rgb_png_bytes()
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/request-media-upload-url"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "file_id": "mediakit://up-1",
                        "method": "PUT",
                        "upload_url": "https://upload.test/put",
                        "upload_headers": [],
                    },
                },
            )
        if str(request.url) == "https://upload.test/put":
            return httpx.Response(200, content=b"ok")
        if path.endswith("/enhance-image"):
            bodies.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-tool-enhance-image-1",
                    "result": {
                        "image_url": "https://output.test/enhanced.jpg",
                        "image_width": 16,
                        "image_height": 16,
                        "image_format": "jpeg",
                    },
                },
            )
        if str(request.url) == "https://output.test/enhanced.jpg":
            return httpx.Response(200, content=png)
        return httpx.Response(404, json={"error": "nope"})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    monkeypatch.setattr(mk.httpx, "AsyncClient", fake_client)
    data_url = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
    out = asyncio.run(
        mk.enhance_image(
            data_url,
            meta={"toolVersion": "professional", "generativeEnhanceMode": "fidelity_first"},
            resolution="4K",
        )
    )
    assert out["width"] == 16
    assert out["tool_version"] == "professional"
    assert len(bodies) == 1
    assert bodies[0]["tool_version"] == "professional"
    assert bodies[0]["generative_enhance_mode"] == "fidelity_first"
    assert bodies[0]["target_width"] == 4096
    assert bodies[0]["target_height"] == 4096
    assert bodies[0]["image_url"].startswith("mediakit://")
