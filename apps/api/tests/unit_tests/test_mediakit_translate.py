"""Unit tests for MediaKit translate-image-text."""

from __future__ import annotations

import asyncio
import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.translate_image import translate_image


def _rgb_png_bytes(size: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=(10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_translate_params_defaults():
    body = mk.translate_params_from_meta({})
    assert body["tool_version"] == "seed-translation"
    assert body["target_lang"] == "zh"
    assert "source_lang" not in body


def test_translate_params_aliases():
    body = mk.translate_params_from_meta(
        {
            "targetLang": "zh-TW",
            "sourceLang": "en",
            "toolVersion": "dense-text-translation",
        }
    )
    assert body["target_lang"] == "zh_hant"
    assert body["source_lang"] == "en"
    assert body["tool_version"] == "dense-text-translation"


def test_translate_params_invalid_version_falls_back():
    body = mk.translate_params_from_meta({"tool_version": "nope", "target_lang": "ja"})
    assert body["tool_version"] == "seed-translation"
    assert body["target_lang"] == "ja"


def test_translate_image_requires_mediakit(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.translate_image.mediakit_enabled", lambda: False
    )
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(translate_image("data:image/png;base64,xx"))


def test_translate_image_rehosts(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.translate_image.mediakit_enabled", lambda: True
    )
    png = _rgb_png_bytes()

    async def fake_translate(image, *, meta=None):
        assert meta and meta.get("targetLang") == "en"
        return {
            "image_bytes": png,
            "image_url": "https://output.test/tr.jpg",
            "width": 8,
            "height": 8,
            "format": "png",
            "tool_version": "seed-translation",
            "target_lang": "en",
            "source_lang": None,
            "task_id": "t1",
            "request_id": "r1",
        }

    monkeypatch.setattr(
        "app.services.vision.translate_image.translate_image_text", fake_translate
    )
    monkeypatch.setattr(
        "app.services.vision.translate_image.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/translate.png",
    )
    result = asyncio.run(
        translate_image(
            "data:image/png;base64,abc",
            meta={"targetLang": "en"},
            user_id="u1",
        )
    )
    assert result["kind"] == "translateImage"
    assert result["engine"] == "mediakit:translate-image-text"
    assert result["mode"] == "mediakit"
    assert result["targetLang"] == "en"
    assert result["image"] == "https://cdn.example/translate.png"


def test_translate_image_text_posts_body(monkeypatch):
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
        if path.endswith("/translate-image-text"):
            bodies.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-tool-translate-image-text-1",
                    "result": {
                        "image_url": "https://output.test/translated.jpg",
                        "image_width": 16,
                        "image_height": 12,
                        "image_format": "jpeg",
                    },
                },
            )
        if str(request.url) == "https://output.test/translated.jpg":
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
        mk.translate_image_text(
            data_url,
            meta={"targetLang": "ja", "sourceLang": "en", "toolVersion": "erase"},
        )
    )
    assert out["width"] == 16
    assert out["target_lang"] == "ja"
    assert out["tool_version"] == "erase"
    assert len(bodies) == 1
    assert bodies[0]["target_lang"] == "ja"
    assert bodies[0]["source_lang"] == "en"
    assert bodies[0]["tool_version"] == "erase"
    assert bodies[0]["image_url"].startswith("mediakit://")
