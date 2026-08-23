"""Tests for inpaint backend routing."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.routing.scene_router import mask_area_ratio, select_inpaint_backend


def test_mask_area_ratio_half():
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[:50, :] = 255
    assert abs(mask_area_ratio(mask) - 0.5) < 0.01


def test_select_inpaint_backend_defaults_to_lama():
    mask = np.zeros((10, 10), dtype=np.uint8)
    assert select_inpaint_backend(mask) == "lama"


def test_select_inpaint_backend_flux_when_configured(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    mask = np.ones((10, 10), dtype=np.uint8) * 255
    assert (
        select_inpaint_backend(
            mask,
            configured="flux",
            flux_enabled=True,
            flux_area_threshold=0.1,
        )
        == "flux"
    )


def test_select_inpaint_backend_flux_fallback_without_key(monkeypatch):
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("ILP_FLUX_API_KEY", raising=False)
    mask = np.ones((10, 10), dtype=np.uint8) * 255
    assert (
        select_inpaint_backend(
            mask,
            configured="flux",
            flux_enabled=True,
            flux_area_threshold=0.1,
        )
        == "lama"
    )
