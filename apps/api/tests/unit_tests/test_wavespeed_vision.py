"""Unit tests for WaveSpeed multi-angle + Seedream layered routing."""

from __future__ import annotations

import asyncio
import io
import json

import httpx
import pytest
from PIL import Image

from app.services.llm.image_tools import (
    requires_seedream_layers,
    requires_wavespeed,
    uses_llm_for_kind,
)
from app.services.vision.providers import seedream as sd
from app.services.vision.providers import wavespeed as ws


def _rgba_png_bytes(size: int = 8, color=(10, 20, 30, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (size, size), color=color).save(buf, format="PNG")
    return buf.getvalue()


def test_requires_provider_kinds_default_seedream(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.vision_edit_elements_provider", "seedream"
    )
    assert requires_wavespeed("editElements") is False
    assert requires_seedream_layers("editElements") is True
    assert requires_wavespeed("multiAngle") is True
    assert requires_wavespeed("removeBg") is False


def test_requires_wavespeed_when_provider_wavespeed(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.vision_edit_elements_provider", "wavespeed"
    )
    assert requires_wavespeed("editElements") is True
    assert requires_seedream_layers("editElements") is False


def test_uses_llm_excludes_vision_kinds():
    assert uses_llm_for_kind("multiAngle") is False
    assert uses_llm_for_kind("editElements") is False
    assert uses_llm_for_kind("replaceText") is True


def test_angle_mapping():
    assert ws.horizontal_angle_from_rotate(-90) == 270
    assert ws.horizontal_angle_from_rotate(90) == 90
    assert ws.horizontal_angle_from_rotate(0) == 0
    assert ws.vertical_angle_from_tilt(-60) == -30
    assert ws.vertical_angle_from_tilt(60) == 60
    assert ws.vertical_angle_from_tilt(0) == 0
    assert ws.distance_from_zoom(0) == 0
    assert ws.distance_from_zoom(50) == 1
    assert ws.distance_from_zoom(100) == 2
    assert ws.num_layers_from_meta(None) == 4
    assert ws.num_layers_from_meta({"num_layers": 8}) == 8
    assert ws.num_layers_from_meta({"num_layers": 1}) == 2


def test_credit_cost_vision_kinds_zero():
    from app.api.routes.image_tools import credit_cost_for_kind

    assert credit_cost_for_kind("upscale") == 0
    assert credit_cost_for_kind("expand") == 0
    assert credit_cost_for_kind("removeBg") == 0
    assert credit_cost_for_kind("translateImage") == 0
    assert credit_cost_for_kind("productScene") == 0
    assert credit_cost_for_kind("editElements") == 0
    assert credit_cost_for_kind("multiAngle") == 0
    assert credit_cost_for_kind("replaceText") == 30


def test_process_rejects_edit_elements_without_doubao(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.vision_edit_elements_provider", "seedream"
    )
    monkeypatch.setattr(
        "app.services.vision.providers.registry.seedream_enabled", lambda: False
    )
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="DOUBAO_API_KEY"):
        asyncio.run(
            process_image_tool(kind="editElements", image="data:image/png;base64,abc")
        )


def test_process_rejects_edit_elements_without_wavespeed_when_selected(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.vision_edit_elements_provider", "wavespeed"
    )
    monkeypatch.setattr(
        "app.services.vision.providers.registry.wavespeed_enabled", lambda: False
    )
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="WAVESPEED_API_KEY"):
        asyncio.run(
            process_image_tool(kind="editElements", image="data:image/png;base64,abc")
        )


def test_process_rejects_multi_angle_without_wavespeed(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.providers.registry.wavespeed_enabled", lambda: False
    )
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="WAVESPEED_API_KEY"):
        asyncio.run(
            process_image_tool(kind="multiAngle", image="data:image/png;base64,abc")
        )


def test_seedream_map_layers_bbox():
    mapped = sd.map_seedream_data_to_layers(
        [
            {"url": "https://cdn.example/base.jpg", "z_index": 0, "size": "100x80"},
            {
                "url": "https://cdn.example/l1.png",
                "z_index": 2,
                "name": "Title",
                "bounding_box": {"absolute": [10, 20, 60, 40]},
            },
            {
                "url": "https://cdn.example/l0.png",
                "z_index": 1,
                "name": "Subject",
                "bounding_box": {"absolute": [0, 0, 50, 50]},
            },
        ]
    )
    assert [r["z_index"] for r in mapped] == [0, 1, 2]
    assert mapped[1]["name"] == "Subject"
    assert sd._bbox_xywh(mapped[2]) == (10.0, 20.0, 50.0, 20.0)


def test_edit_elements_via_seedream(monkeypatch):
    png_base = _rgba_png_bytes(size=100, color=(1, 2, 3, 255))
    png_layer = _rgba_png_bytes(size=40, color=(4, 5, 6, 200))

    async def fake_run(image, *, meta=None, user_id=None, on_progress=None):
        return {
            "layers": [
                {
                    "bytes": png_base,
                    "x": 0.0,
                    "y": 0.0,
                    "width": 100.0,
                    "height": 80.0,
                    "name": "Background",
                    "z_index": 0,
                    "description": "",
                },
                {
                    "bytes": png_layer,
                    "x": 10.0,
                    "y": 20.0,
                    "width": 50.0,
                    "height": 30.0,
                    "name": "Title",
                    "z_index": 1,
                    "description": "text",
                },
            ],
            "canvas_width": 100,
            "canvas_height": 80,
            "model": "doubao-seedream-5-0-pro-260628",
            "engine": "seedream:layer_decomposition",
        }

    monkeypatch.setattr(
        "app.core.config.settings.vision_edit_elements_provider", "seedream"
    )
    monkeypatch.setattr(
        "app.services.vision.edit_elements.resolve_edit_elements_provider",
        lambda: "seedream",
    )
    monkeypatch.setattr(
        "app.services.vision.providers.seedream.run_layered", fake_run
    )
    monkeypatch.setattr(
        "app.services.vision.edit_elements.rehost_image_bytes",
        lambda _uid, data, **kwargs: f"https://cdn.example/{kwargs.get('filename', 'x')}",
    )
    from app.services.vision.edit_elements import edit_elements_layered

    result = asyncio.run(
        edit_elements_layered(
            "https://cdn.example/in.png",
            user_id="u1",
        )
    )
    assert result["kind"] == "editElements"
    assert result["width"] == 100
    assert result["height"] == 80
    assert len(result["layers"]) == 2
    assert result["layers"][1]["name"] == "Title"
    assert result["layers"][1]["x"] == 10.0
    assert result["engines"] == ["seedream:layer_decomposition"]


def test_multi_angle_image_rehosts(monkeypatch):
    png = _rgba_png_bytes()

    async def fake_run(image, *, meta=None, user_id=None, on_progress=None):
        assert meta and meta.get("rotate") == 45
        return {
            "image_bytes": png,
            "width": 8,
            "height": 8,
            "model": "wavespeed-ai/qwen-image/edit-multiple-angles",
        }

    monkeypatch.setattr(
        "app.services.vision.multi_angle.resolve_multi_angle_provider",
        lambda: "wavespeed",
    )
    monkeypatch.setattr("app.services.vision.multi_angle.run_multi_angle", fake_run)
    monkeypatch.setattr(
        "app.services.vision.multi_angle.rehost_image_bytes",
        lambda _uid, data, **kwargs: "https://cdn.example/multi-angle.png",
    )
    from app.services.vision.multi_angle import multi_angle_image

    result = asyncio.run(
        multi_angle_image(
            "https://cdn.example/in.png",
            meta={"rotate": 45, "tilt": 0, "zoom": 50},
            user_id="u1",
        )
    )
    assert result["kind"] == "multiAngle"
    assert result["engine"] == "wavespeed:edit-multiple-angles"
    assert result["image"] == "https://cdn.example/multi-angle.png"


def test_edit_elements_layered_maps_layers(monkeypatch):
    png_a = _rgba_png_bytes(color=(1, 2, 3, 255))
    png_b = _rgba_png_bytes(color=(4, 5, 6, 200))
    png_c = _rgba_png_bytes(color=(7, 8, 9, 180))
    png_d = _rgba_png_bytes(color=(10, 11, 12, 160))

    async def fake_run(image, *, meta=None, user_id=None, on_progress=None):
        assert ws.num_layers_from_meta(meta) == 4
        return {
            "layers_bytes": [png_a, png_b, png_c, png_d],
            "width": 8,
            "height": 8,
            "num_layers": 4,
            "model": "wavespeed-ai/qwen-image/layered",
        }

    monkeypatch.setattr(
        "app.services.vision.edit_elements.resolve_edit_elements_provider",
        lambda: "wavespeed",
    )
    monkeypatch.setattr(
        "app.services.vision.providers.wavespeed.run_layered", fake_run
    )
    monkeypatch.setattr(
        "app.services.vision.edit_elements.rehost_image_bytes",
        lambda _uid, data, **kwargs: f"https://cdn.example/{kwargs.get('filename', 'x')}",
    )
    from app.services.vision.edit_elements import edit_elements_layered

    result = asyncio.run(
        edit_elements_layered(
            "https://cdn.example/in.png",
            meta={"num_layers": 4},
            user_id="u1",
        )
    )
    assert result["kind"] == "editElements"
    assert len(result["layers"]) == 4
    assert result["layers"][0]["name"] == "Layer 1"
    assert result["layers"][0]["src"].startswith("https://cdn.example/")
    assert result["engines"] == ["wavespeed:qwen-image/layered"]


def test_submit_and_wait_poll(monkeypatch):
    monkeypatch.setattr(ws.settings, "wavespeed_api_key", "ws-test-key")
    monkeypatch.setattr(ws.settings, "wavespeed_base_url", "https://api.wavespeed.test")
    monkeypatch.setattr(ws.settings, "wavespeed_timeout_sec", 30.0)
    monkeypatch.setattr(ws, "_POLL_SEC", 0.01)

    png = _rgba_png_bytes()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/wavespeed-ai/qwen-image/edit-multiple-angles"):
            body = json.loads(request.content.decode("utf-8"))
            assert body["horizontal_angle"] == 270
            assert body["vertical_angle"] == -30
            assert body["distance"] == 0
            assert body["images"] == ["https://cdn.example/in.png"]
            return httpx.Response(
                200,
                json={"data": {"id": "pred-1", "status": "processing"}},
            )
        if path.endswith("/predictions/pred-1/result"):
            calls["n"] += 1
            if calls["n"] < 2:
                return httpx.Response(
                    200, json={"data": {"id": "pred-1", "status": "processing"}}
                )
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "pred-1",
                        "status": "completed",
                        "outputs": ["https://cdn.example/out.png"],
                    }
                },
            )
        if path.endswith("/out.png"):
            return httpx.Response(200, content=png, headers={"content-type": "image/png"})
        return httpx.Response(404, text=f"missing {path}")

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(ws.httpx, "AsyncClient", client_factory)

    async def run():
        outputs = await ws.submit_and_wait(
            "wavespeed-ai/qwen-image/edit-multiple-angles",
            {
                "images": ["https://cdn.example/in.png"],
                "horizontal_angle": 270,
                "vertical_angle": -30,
                "distance": 0,
            },
        )
        assert outputs == ["https://cdn.example/out.png"]
        raw = await ws._download_output(outputs[0])
        assert raw == png

    asyncio.run(run())
    assert calls["n"] >= 2
