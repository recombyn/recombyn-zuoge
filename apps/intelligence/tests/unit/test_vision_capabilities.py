"""Unit tests for vision capability probe."""

from __future__ import annotations

from image_layer_pipeline.vision_capabilities import vision_model_status, vision_ready_for_production


def test_vision_model_status_shape():
    status = vision_model_status()
    assert "sam" in status
    assert "realesrgan" in status
    assert "ocr" in status
    assert isinstance(status["sam"]["backend"], str)


def test_vision_ready_for_production_returns_str():
    reason = vision_ready_for_production()
    assert isinstance(reason, str)
