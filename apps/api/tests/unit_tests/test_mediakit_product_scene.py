"""Unit tests for MediaKit generate-product-scene-image."""

from __future__ import annotations

import asyncio
import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.product_scene import product_scene


def _rgb_png_bytes(size: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=(10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_product_scene_params_standard_defaults():
    body = mk.product_scene_params_from_meta({})
    assert body["tool_version"] == "standard"
    assert body["standard_scene"] == "exhibit_home"
    assert body["batch_count"] == 1
    assert body["output_width"] == 600
    assert body["output_height"] == 600


def test_product_scene_params_general_requires_prompt():
    with pytest.raises(ValueError, match="prompt"):
        mk.product_scene_params_from_meta({"standardScene": "general"})


def test_product_scene_params_professional():
    body = mk.product_scene_params_from_meta(
        {
            "toolVersion": "professional",
            "prompt": "wooden table, soft light",
            "professionalReferenceImageUrl": "https://example.com/ref.jpg",
            "batchCount": 3,
        }
    )
    assert body["tool_version"] == "professional"
    assert body["prompt"] == "wooden table, soft light"
    assert body["professional_reference_image_url"] == "https://example.com/ref.jpg"
    assert body["professional_reference_image_adapt_scale"] == 0.9
    assert body["batch_count"] == 3
    assert "standard_scene" not in body


def test_product_scene_params_professional_requires_ref():
    with pytest.raises(ValueError, match="professionalReferenceImageUrl"):
        mk.product_scene_params_from_meta(
            {"toolVersion": "professional", "prompt": "x"}
        )


def test_product_scene_requires_mediakit(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.product_scene.mediakit_enabled", lambda: False
    )
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(product_scene("data:image/png;base64,xx"))


def test_product_scene_rehosts_batch(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.product_scene.mediakit_enabled", lambda: True
    )
    png = _rgb_png_bytes()

    async def fake_gen(image, *, meta=None):
        assert meta and meta.get("standardScene") == "exhibit_simple"
        return {
            "images": [
                {
                    "image_bytes": png,
                    "image_url": "https://output.test/a.png",
                    "width": 8,
                    "height": 8,
                    "format": "png",
                },
                {
                    "image_bytes": png,
                    "image_url": "https://output.test/b.png",
                    "width": 8,
                    "height": 8,
                    "format": "png",
                },
            ],
            "tool_version": "standard",
            "standard_scene": "exhibit_simple",
            "task_id": "t1",
            "request_id": "r1",
        }

    monkeypatch.setattr(
        "app.services.vision.product_scene.generate_product_scene_image", fake_gen
    )
    calls: list[str] = []

    def fake_rehost(data, *, user_id=None, filename="", content_type="image/png"):
        calls.append(str(filename or ""))
        return f"https://cdn.example/{filename}"

    monkeypatch.setattr(
        "app.services.vision.product_scene.encode_or_rehost_image", fake_rehost
    )
    result = asyncio.run(
        product_scene(
            "data:image/png;base64,abc",
            meta={"standardScene": "exhibit_simple", "batchCount": 2},
            user_id="u1",
        )
    )
    assert result["kind"] == "productScene"
    assert result["engine"] == "mediakit:generate-product-scene-image"
    assert len(result["images"]) == 2
    assert result["image"] == result["images"][0]
    assert len(calls) == 2


def test_generate_product_scene_image_posts_body(monkeypatch):
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
        if path.endswith("/generate-product-scene-image"):
            bodies.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-tool-generate-product-scene-image-1",
                    "result": {
                        "images": [
                            {
                                "image_url": "https://output.test/scene.png",
                                "image_width": 600,
                                "image_height": 600,
                                "image_format": "png",
                            }
                        ]
                    },
                },
            )
        if str(request.url) == "https://output.test/scene.png":
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
        mk.generate_product_scene_image(
            data_url,
            meta={
                "toolVersion": "standard",
                "standardScene": "exhibit_home",
                "batchCount": 4,
            },
        )
    )
    assert len(out["images"]) == 1
    assert out["images"][0]["width"] == 600
    assert len(bodies) == 1
    assert bodies[0]["tool_version"] == "standard"
    assert bodies[0]["standard_scene"] == "exhibit_home"
    assert bodies[0]["batch_count"] == 4
    assert bodies[0]["image_url"].startswith("mediakit://")
