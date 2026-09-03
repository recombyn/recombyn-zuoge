"""Unit tests for MediaKit brush eraser."""

from __future__ import annotations

import asyncio
import base64
import io

import httpx
import pytest
from PIL import Image

from app.services.vision import mediakit_client as mk
from app.services.vision.smart_erase import mask_to_mediakit_bw_png, smart_erase


def _mask_data_url() -> str:
    img = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    px = img.load()
    for y in range(2, 6):
        for x in range(2, 6):
            px[x, y] = (255, 255, 255, 255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _rgb_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_mask_to_mediakit_bw_png():
    raw = base64.b64decode(_mask_data_url().split(",", 1)[1])
    out = mask_to_mediakit_bw_png(raw)
    bw = Image.open(io.BytesIO(out)).convert("L")
    assert bw.getpixel((0, 0)) == 0
    assert bw.getpixel((3, 3)) == 255


def test_smart_erase_requires_mediakit(monkeypatch):
    monkeypatch.setattr("app.services.vision.smart_erase.mediakit_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="MEDIAKIT_API_KEY"):
        asyncio.run(smart_erase("data:image/png;base64,xx", meta={"eraseMask": _mask_data_url()}))


def test_smart_erase_selected_area(monkeypatch):
    monkeypatch.setattr("app.services.vision.smart_erase.mediakit_enabled", lambda: True)
    png = _rgb_png_bytes()

    async def fake_erase(image, *, meta=None, mask_bytes=None):
        assert meta["standardScene"] == "selected_area_erase"
        assert mask_bytes and len(mask_bytes) > 8
        return {
            "image_bytes": png,
            "image_url": "https://output.test/erased.png",
            "width": 8,
            "height": 8,
            "format": "png",
            "task_id": "t1",
            "request_id": "r1",
            "scene": "selected_area_erase",
        }

    monkeypatch.setattr("app.services.vision.smart_erase.erase_image", fake_erase)
    monkeypatch.setattr(
        "app.services.vision.smart_erase.encode_or_rehost_image",
        lambda data, **kwargs: "https://cdn.example/eraser.png",
    )
    result = asyncio.run(
        smart_erase(
            "data:image/png;base64,abc",
            meta={"eraseMask": _mask_data_url()},
            user_id="u1",
        )
    )
    assert result["kind"] == "eraser"
    assert result["engine"] == "mediakit:erase-image"
    assert result["mode"] == "mediakit"
    assert result["image"] == "https://cdn.example/eraser.png"


def test_mediakit_target_size_snaps_odd_dims():
    # User failure: 1097x1463 → MediaKit 800012 resolution not supported.
    tw, th = mk.mediakit_target_size(1097, 1463)
    assert tw % 8 == 0 and th % 8 == 0
    assert tw == 1096 and th == 1464


def test_fit_raster_for_mediakit_odd_png():
    buf = io.BytesIO()
    Image.new("RGB", (1097, 1463), color=(1, 2, 3)).save(buf, format="PNG")
    fitted, orig, out = mk.fit_raster_for_mediakit(buf.getvalue())
    assert orig == (1097, 1463)
    assert out == (1096, 1464)
    img = Image.open(io.BytesIO(fitted))
    assert img.size == (1096, 1464)


def test_erase_image_selected_area_uploads_mask(monkeypatch):
    monkeypatch.setattr(mk.settings, "mediakit_api_key", "amk-test-key")
    monkeypatch.setattr(mk.settings, "mediakit_base_url", "https://mediakit.test")
    png = _rgb_png_bytes()
    mask = mask_to_mediakit_bw_png(base64.b64decode(_mask_data_url().split(",", 1)[1]))
    bodies: list[bytes] = []
    uploads = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal uploads
        path = request.url.path
        if path.endswith("/request-media-upload-url"):
            uploads += 1
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "file_id": f"mediakit://up-{uploads}",
                        "method": "PUT",
                        "upload_url": "https://upload.test/put",
                        "upload_headers": [],
                    },
                },
            )
        if str(request.url) == "https://upload.test/put":
            return httpx.Response(200, content=b"ok")
        if path.endswith("/erase-image"):
            bodies.append(request.read())
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "image_url": "https://output.test/erased.png",
                        "image_width": 8,
                        "image_height": 8,
                        "image_format": "png",
                    },
                },
            )
        if str(request.url) == "https://output.test/erased.png":
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
        mk.erase_image(
            data_url,
            meta={"standardScene": "selected_area_erase", "outputFormat": "png"},
            mask_bytes=mask,
        )
    )
    assert out["width"] == 8
    assert out["height"] == 8
    assert out["scene"] == "selected_area_erase"
    assert any(b"selected_area_erase" in b and b"mask_url" in b for b in bodies)
    assert uploads >= 2  # source + mask
