"""Unit tests for MediaKit editText (OCR + erase)."""

from __future__ import annotations

import asyncio
import base64
import io

import httpx
import numpy as np
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.edit_text import decompose_edit_text


def _tiny_png_bytes(w: int = 64, h: int = 48) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(200, 210, 220)).save(buf, format="PNG")
    return buf.getvalue()


def _tiny_png_data_url() -> str:
    return f"data:image/png;base64,{base64.b64encode(_tiny_png_bytes()).decode('ascii')}"


def test_ocr_block_from_raw():
    block = mk._ocr_block_from_raw(
        {
            "content": "Hello",
            "confidence": 0.99,
            "top_left_x": 5,
            "top_left_y": 6,
            "bottom_right_x": 45,
            "bottom_right_y": 18,
        }
    )
    assert block is not None
    assert block["text"] == "Hello"
    assert block["x"] == 5
    assert block["width"] == 40
    assert block["height"] == 12
    assert block["confidence"] == pytest.approx(0.99)


def test_image_ocr_happy_path(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "amk-test-key")
    monkeypatch.setattr(mk.settings, "mediakit_base_url", "https://mediakit.test")
    png = _tiny_png_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/request-media-upload-url"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "file_id": "mediakit://ocr-1",
                        "method": "PUT",
                        "upload_url": "https://upload.test/put",
                        "upload_headers": [],
                    },
                },
            )
        if str(request.url) == "https://upload.test/put":
            return httpx.Response(200, content=b"ok")
        if path.endswith("/image-ocr"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-ocr-1",
                    "result": {
                        "ocr_result": [
                            {
                                "content": "AI",
                                "confidence": 0.98,
                                "top_left_x": 2,
                                "top_left_y": 3,
                                "bottom_right_x": 20,
                                "bottom_right_y": 15,
                            }
                        ]
                    },
                },
            )
        return httpx.Response(404, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    monkeypatch.setattr(mk.httpx, "AsyncClient", fake_client)
    data_url = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
    out = asyncio.run(mk.image_ocr(data_url, meta={"tool_version": "max"}))
    assert len(out["blocks"]) == 1
    assert out["blocks"][0]["text"] == "AI"
    assert out["tool_version"] == "max"


def test_decompose_edit_text(monkeypatch):
    monkeypatch.setattr("app.services.vision.edit_text.mediakit_enabled", lambda: True)
    png = _tiny_png_bytes()

    async def fake_ocr(_image, *, meta=None, resolved_url=None):
        return {
            "blocks": [
                {
                    "text": "Hello",
                    "x": 5.0,
                    "y": 6.0,
                    "width": 40.0,
                    "height": 12.0,
                    "font_size": 11.0,
                    "confidence": 0.99,
                }
            ],
            "keyword_result": None,
            "tool_version": "max",
            "image_url": "mediakit://x",
            "task_id": "t1",
            "request_id": "r1",
        }

    async def fake_erase(_image, *, meta=None, resolved_url=None):
        return {
            "image_bytes": png,
            "image_url": "https://output.test/bg.png",
            "width": 64,
            "height": 48,
            "format": "png",
            "task_id": "t2",
            "request_id": "r2",
        }

    monkeypatch.setattr("app.services.vision.edit_text.image_ocr", fake_ocr)
    monkeypatch.setattr("app.services.vision.edit_text.erase_image", fake_erase)
    monkeypatch.setattr(
        "app.services.vision.edit_text.rehost_image_bytes",
        lambda _uid, data, **kwargs: f"https://cdn.example/{kwargs.get('filename', 'x')}",
    )

    bgr = np.full((48, 64, 3), 200, dtype=np.uint8)

    async def fake_load(_ref: str):
        return bgr

    monkeypatch.setattr("app.services.vision.edit_text.load_bgr", fake_load)

    result = asyncio.run(
        decompose_edit_text(_tiny_png_data_url(), user_id="u1")
    )
    assert result["kind"] == "editText"
    assert result["mode"] == "mediakit"
    assert result["width"] == 64
    text_layers = [l for l in result["layers"] if l.get("type") == "text"]
    assert len(text_layers) == 1
    assert text_layers[0]["text"] == "Hello"
    assert result["layers"][0]["name"] == "背景"
    assert "mediakit:image-ocr" in result["engines"]


def test_decompose_edit_text_requires_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.edit_text.mediakit_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(decompose_edit_text(_tiny_png_data_url()))
