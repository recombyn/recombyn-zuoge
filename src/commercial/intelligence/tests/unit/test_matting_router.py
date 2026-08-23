"""Tests for matting model routing."""

from __future__ import annotations

from image_layer_pipeline.stages.matting_router import (
    normalize_scene,
    resolve_matting_route,
)


def test_normalize_scene_unified_general():
    assert normalize_scene("auto") == "general"
    assert normalize_scene("hair") == "general"
    assert normalize_scene("glass") == "general"
    assert normalize_scene("product") == "general"


def test_normalize_scene_benchmark_presets():
    assert normalize_scene("portrait") == "portrait"
    assert normalize_scene("transparent") == "transparent"


def test_resolve_auto_uses_general():
    route = resolve_matting_route(scene="auto", use_precision_onnx=False)
    assert route.scene == "general"
    assert route.model == "birefnet-general"
    assert route.decontaminate == 0.65


def test_resolve_portrait_benchmark_preset():
    route = resolve_matting_route(scene="portrait", use_precision_onnx=False)
    assert route.scene == "portrait"
    assert route.model == "birefnet-portrait"
    assert route.decontaminate == 0.72


def test_resolve_transparent_benchmark_preset():
    route = resolve_matting_route(scene="transparent", use_precision_onnx=False)
    assert route.scene == "transparent"
    assert route.model == "birefnet-general"
    assert route.decontaminate == 0.55


def test_explicit_model_overrides_scene():
    route = resolve_matting_route(
        scene="portrait",
        model="birefnet-general-lite",
        use_precision_onnx=False,
    )
    assert route.model == "birefnet-general-lite"


def test_custom_onnx_uses_ben_custom(monkeypatch, tmp_path):
    onnx = tmp_path / "precision.onnx"
    onnx.write_bytes(b"fake")
    monkeypatch.setenv("ILP_MATTING_ONNX", str(onnx))
    route = resolve_matting_route(scene="auto")
    assert route.model == "ben_custom"
    assert route.custom_onnx == str(onnx)
    assert route.scene == "general"


def test_hr_matting_auto_for_general(monkeypatch, tmp_path):
    onnx = tmp_path / "BiRefNet_HR-matting-epoch_135.onnx"
    onnx.write_bytes(b"fake")
    monkeypatch.setenv("ILP_MATTING_ONNX", str(onnx))
    route = resolve_matting_route(scene="auto")
    assert route.model == "ben_custom"
    assert route.scene == "general"
