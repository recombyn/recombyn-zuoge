"""Tests for tiled upscale stitching."""

from __future__ import annotations

import numpy as np

from image_layer_pipeline.stages.upscale.esrgan import upscale_tiled


def test_upscale_tiled_feathers_overlap():
    rgb = np.random.default_rng(0).integers(0, 255, (64, 64, 3), dtype=np.uint8)

    def tile_fn(tile: np.ndarray) -> np.ndarray:
        h, w = tile.shape[:2]
        return np.repeat(np.repeat(tile, 2, axis=0), 2, axis=1)

    out = upscale_tiled(rgb, scale=2, tile_fn=tile_fn, tile_size=32, overlap=8)
    assert out.shape == (128, 128, 3)
    # Seam should be smooth — no hard zero columns in center band.
    col_mean = out[:, 60:68, :].mean(axis=(0, 1))
    assert col_mean.min() > 0
