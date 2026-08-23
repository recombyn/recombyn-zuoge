"""Unit tests for ILP-only image tool routing."""

from __future__ import annotations

import asyncio

import pytest

from app.services.llm.image_tools import ilp_supports, requires_ilp


def test_requires_ilp_kinds():
    assert requires_ilp("removeBg") is True
    assert requires_ilp("editText") is True
    assert requires_ilp("editElements") is True
    assert requires_ilp("upscale") is True


def test_ilp_supports_empty_when_off(monkeypatch):
    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: False)
    assert ilp_supports() == []


def test_ilp_supports_when_on(monkeypatch):
    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: True)
    assert ilp_supports() == ["removeBg", "eraser", "editText", "editElements", "detectRegions", "upscale"]


def test_process_image_tool_rejects_ilp_kind_when_off(monkeypatch):
    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: False)
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="Recombyn Intelligence"):
        asyncio.run(process_image_tool(kind="removeBg", image="data:image/png;base64,abc"))


def test_process_image_tool_rejects_upscale_when_ilp_off(monkeypatch):
    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: False)
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="Recombyn Intelligence"):
        asyncio.run(process_image_tool(kind="upscale", image="data:image/png;base64,abc"))


def test_credit_cost_for_upscale_is_zero():
    from app.api.routes.image_tools import credit_cost_for_kind

    assert credit_cost_for_kind("upscale") == 0


def test_decompose_via_ilp_maps_layers(monkeypatch):
    import io

    from PIL import Image

    png = io.BytesIO()
    Image.new("RGB", (64, 48), color=(10, 20, 30)).save(png, format="PNG")
    blob = png.getvalue()

    async def fake_create(_image: str) -> str:
        return "job-1"

    async def fake_wait(_job_id: str) -> dict:
        return {
            "status": "needs_review",
            "meta": {"size": [48, 64]},
            "urls": {
                "far_background": "/files/outputs/job-1/far.png",
                "midground": "/files/outputs/job-1/mid.png",
                "foreground": "/files/outputs/job-1/fg.png",
            },
        }

    async def fake_fetch(_url: str) -> tuple[bytes, str]:
        return blob, "image/png"

    monkeypatch.setattr("app.services.vision.ilp_decompose.create_job", fake_create)
    monkeypatch.setattr("app.services.vision.ilp_decompose.wait_for_job", fake_wait)
    monkeypatch.setattr("app.services.vision.ilp_decompose.fetch_file_bytes", fake_fetch)
    monkeypatch.setattr("app.services.vision.ilp_decompose.ilp_enabled", lambda: True)

    from app.services.vision.ilp_decompose import decompose_via_ilp

    result = asyncio.run(
        decompose_via_ilp(kind="editElements", image="data:image/png;base64,abc")
    )
    assert result["kind"] == "editElements"
    assert result["width"] == 64
    assert result["height"] == 48
    assert len(result["layers"]) == 3
    assert result["layers"][0]["name"] == "远景底图"
    assert str(result["layers"][0]["src"]).startswith("data:image/png;base64,")
