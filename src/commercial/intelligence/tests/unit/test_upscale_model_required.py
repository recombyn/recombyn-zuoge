"""Upscale must fail closed without ONNX weights (commercial)."""

from __future__ import annotations

import numpy as np
import pytest


def test_upscale_requires_model_by_default(monkeypatch):
    from image_layer_pipeline.stages.upscale import esrgan

    monkeypatch.setattr(esrgan, "_resolve_model_path", lambda: None)
    monkeypatch.delenv("ILP_UPSCALE_ALLOW_LANCZOS", raising=False)
    rgb = np.zeros((8, 8, 3), dtype=np.uint8)
    with pytest.raises(RuntimeError, match="Real-ESRGAN ONNX"):
        esrgan.upscale_image(rgb, target_long_edge=64)


def test_upscale_lanczos_when_explicitly_allowed(monkeypatch):
    from image_layer_pipeline.stages.upscale import esrgan

    monkeypatch.setattr(esrgan, "_resolve_model_path", lambda: None)
    monkeypatch.setenv("ILP_UPSCALE_ALLOW_LANCZOS", "1")
    rgb = np.zeros((8, 8, 3), dtype=np.uint8)
    out, meta = esrgan.upscale_image(rgb, target_long_edge=32)
    assert out.shape[0] >= 8
    assert meta["engine"] == "lanczos-sharpen"
