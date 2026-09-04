"""Unit tests for MediaKit expand-image-canvas."""

from __future__ import annotations

import asyncio
import base64
import io

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.expand_canvas import expand_canvas


def _tiny_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 20), color=(1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


def test_expand_ratios_from_pads():
    # Source 100x200, pad left/right 20 each → short=100 → 0.2
    left, right, top, bottom = mk.expand_ratios_from_meta(
        {
            "padLeft": 20,
            "padRight": 20,
            "padTop": 0,
            "padBottom": 0,
            "targetWidth": 140,
            "targetHeight": 200,
        }
    )
    assert left == pytest.approx(0.2)
    assert right == pytest.approx(0.2)
    assert top == 0
    assert bottom == 0


def test_expand_ratios_direct():
    left, right, top, bottom = mk.expand_ratios_from_meta(
        {"expandLeft": 0.15, "expandRight": 0.1, "expandTop": 0, "expandBottom": 0.05}
    )
    assert (left, right, top, bottom) == (0.15, 0.1, 0.0, 0.05)


def test_progressive_expand_steps_splits_over_cap():
    steps = mk._progressive_expand_steps(0.7, 0.0, 0.0, 0.0)
    assert len(steps) == 2
    assert steps[0] == (0.4, 0.0, 0.0, 0.0)
    assert steps[1][0] == pytest.approx(0.3)


def test_expand_canvas_requires_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.expand_canvas.mediakit_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(expand_canvas("data:image/png;base64,abc", user_id="u1"))


def test_expand_image_canvas_happy_path(monkeypatch):
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
                        "file_id": "mediakit://file-exp",
                        "method": "PUT",
                        "upload_url": "https://upload.test/put",
                        "upload_headers": [],
                    },
                },
            )
        if str(request.url) == "https://upload.test/put":
            return httpx.Response(200, content=b"ok")
        if path.endswith("/expand-image-canvas"):
            body = request.read()
            assert b"expand_left" in body
            assert b"0.2" in body
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "task_id": "amk-exp-1",
                    "result": {
                        "image_url": "https://output.test/exp.jpg",
                        "image_width": 14,
                        "image_height": 20,
                        "image_format": "jpeg",
                        "image_size": len(png),
                    },
                },
            )
        if str(request.url) == "https://output.test/exp.jpg":
            return httpx.Response(200, content=png)
        return httpx.Response(404, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(mk.httpx, "AsyncClient", fake_async_client)

    data_url = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
    out = asyncio.run(
        mk.expand_image_canvas(
            data_url,
            meta={
                "padLeft": 2,
                "padRight": 2,
                "padTop": 0,
                "padBottom": 0,
                "targetWidth": 14,
                "targetHeight": 20,
            },
        )
    )
    assert out["width"] == 14
    assert out["height"] == 20
    assert out["steps"] == 1
    assert out["image_bytes"] == png
    assert any("expand-image-canvas" in c for c in calls)


def test_expand_canvas_service(monkeypatch):
    monkeypatch.setattr("app.services.vision.expand_canvas.mediakit_enabled", lambda: True)
    png = _tiny_png_bytes()

    async def fake_expand(_image, *, meta=None):
        return {
            "image_bytes": png,
            "image_url": "https://output.test/exp.jpg",
            "width": 12,
            "height": 20,
            "format": "jpeg",
            "ratios": {"left": 0.1, "right": 0.1, "top": 0, "bottom": 0},
            "steps": 1,
            "task_id": "t1",
            "request_id": "r1",
        }

    monkeypatch.setattr(
        "app.services.vision.expand_canvas.expand_image_canvas", fake_expand
    )
    monkeypatch.setattr(
        "app.services.vision.expand_canvas.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/expand.jpg",
    )
    result = asyncio.run(
        expand_canvas("data:image/png;base64,xx", meta={"expandLeft": 0.1}, user_id="u1")
    )
    assert result["kind"] == "expand"
    assert result["engine"] == "mediakit:expand-image-canvas"
    assert result["mode"] == "mediakit"
    assert result["width"] == 12
