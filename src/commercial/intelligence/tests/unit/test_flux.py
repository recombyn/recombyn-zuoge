"""Tests for Flux inpaint adapter helpers."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.stages.inpainting import flux


def test_flux_available_without_key(monkeypatch):
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("ILP_FLUX_API_KEY", raising=False)
    assert flux.flux_available() is False


def test_flux_available_with_fal_key(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    assert flux.flux_available() is True


def test_extract_image_url_dict_image():
    url = flux._extract_image_url({"image": {"url": "https://example.com/out.png"}})
    assert url == "https://example.com/out.png"


def test_extract_image_url_images_list():
    url = flux._extract_image_url({"images": [{"url": "https://example.com/a.png"}]})
    assert url == "https://example.com/a.png"


def test_mask_png_b64_shape():
    mask = np.zeros((4, 4), dtype=np.uint8)
    mask[1:3, 1:3] = 255
    b64 = flux._mask_png_b64(mask)
    assert isinstance(b64, str) and len(b64) > 20
