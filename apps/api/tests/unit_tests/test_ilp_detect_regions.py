"""Unit tests for ILP detect-regions BFF adapter."""

from __future__ import annotations

import asyncio

import pytest


def test_detect_regions_adapter_maps_layers(monkeypatch):
    async def fake_detect(_image: str, *, lang: str = "ch", model: str = "birefnet-general"):
        return {
            "width": 800,
            "height": 600,
            "layers": [
                {
                    "type": "text",
                    "text": "标题",
                    "x": 10.0,
                    "y": 20.0,
                    "width": 100.0,
                    "height": 30.0,
                    "name": "文字",
                },
                {
                    "type": "image",
                    "x": 50.0,
                    "y": 80.0,
                    "width": 200.0,
                    "height": 150.0,
                    "name": "主体",
                },
            ],
            "engines": ["paddleocr", "birefnet"],
            "warnings": [],
        }

    monkeypatch.setattr("app.services.vision.ilp_detect_regions.ilp_enabled", lambda: True)
    monkeypatch.setattr("app.services.vision.ilp_detect_regions.detect_regions_via_ilp", fake_detect)

    from app.services.vision.ilp_detect_regions import detect_regions_via_ilp_adapter

    result = asyncio.run(
        detect_regions_via_ilp_adapter(image="data:image/png;base64,abc")
    )
    assert result["kind"] == "detectRegions"
    assert result["width"] == 800
    assert len(result["layers"]) == 2
    assert result["layers"][0]["type"] == "text"
    assert result["layers"][0]["text"] == "标题"
    assert "ilp:detect-regions" in result["engines"][0]


def test_process_image_tool_detect_regions_requires_ilp(monkeypatch):
    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: False)
    from app.services.llm.image_tools import process_image_tool

    with pytest.raises(RuntimeError, match="Recombyn Intelligence"):
        asyncio.run(process_image_tool(kind="detectRegions", image="data:image/png;base64,x"))
