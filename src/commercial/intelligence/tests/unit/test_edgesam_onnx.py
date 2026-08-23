"""EdgeSAM ONNX availability tests."""

from __future__ import annotations

from pathlib import Path


def test_edgesam_not_available_without_weights():
    from image_layer_pipeline.stages import edgesam_onnx as mod

    assert mod.edgesam_available() is False


def test_sam_backend_prefers_edgesam_when_configured(monkeypatch, tmp_path):
    from image_layer_pipeline.stages import sam_roi as mod

    enc = tmp_path / "enc.onnx"
    dec = tmp_path / "dec.onnx"
    enc.write_bytes(b"onnx")
    dec.write_bytes(b"onnx")
    monkeypatch.setenv("ILP_EDGESAM_ENCODER_PATH", str(enc))
    monkeypatch.setenv("ILP_EDGESAM_DECODER_PATH", str(dec))
    monkeypatch.setenv("ILP_SAM_BACKEND", "auto")

    from image_layer_pipeline.stages import edgesam_onnx

    monkeypatch.setattr(edgesam_onnx, "edgesam_available", lambda: True)
    assert mod._resolve_backend() == "edgesam"
