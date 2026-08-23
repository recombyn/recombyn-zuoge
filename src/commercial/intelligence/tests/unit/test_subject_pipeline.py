"""Unit tests for subject-layer pipeline (no Depth/LaMa)."""

from __future__ import annotations

import numpy as np


def test_subject_pipeline_outputs_three_layers(monkeypatch):
    from image_layer_pipeline.subject_pipeline import run_subject_layer_pipeline

    h, w = 32, 40
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[8:24, 10:30] = (200, 80, 40)

    fg = np.zeros((h, w, 4), dtype=np.uint8)
    fg[8:24, 10:30, :3] = (200, 80, 40)
    fg[8:24, 10:30, 3] = 220
    binary = np.zeros((h, w), dtype=np.uint8)
    binary[8:24, 10:30] = 255

    monkeypatch.setattr(
        "image_layer_pipeline.subject_pipeline.run_matting",
        lambda _rgb, **_: type(
            "M",
            (),
            {
                "foreground_rgba": fg.copy(),
                "binary_mask": binary.copy(),
            },
        )(),
    )

    bundle = run_subject_layer_pipeline(rgb)
    assert bundle.foreground_rgba.shape == (h, w, 4)
    assert bundle.midground_rgba.shape == (h, w, 4)
    assert bundle.far_background_rgb.shape == (h, w, 3)
    assert bundle.depth_map.shape == (h, w)
    assert bundle.binary_mask.sum() > 0


def test_run_pipeline_delegates_to_subject(monkeypatch):
    from image_layer_pipeline import pipeline as pipe_mod

    called = {"n": 0}

    def fake_subject(_rgb, _cfg=None):
        called["n"] += 1
        return "bundle"

    monkeypatch.setattr(pipe_mod, "run_subject_layer_pipeline", fake_subject)
    out = pipe_mod.run_pipeline(np.zeros((4, 4, 3), dtype=np.uint8))
    assert called["n"] == 1
    assert out == "bundle"
