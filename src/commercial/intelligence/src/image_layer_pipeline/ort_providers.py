"""Shared ONNX Runtime provider selection (CUDA → DirectML → CPU)."""

from __future__ import annotations


def preferred_ort_providers() -> list[str]:
    """Return available EPs in preference order for Windows/Linux GPUs."""
    import onnxruntime as ort

    available = set(ort.get_available_providers())
    order = (
        "CUDAExecutionProvider",
        "DmlExecutionProvider",  # Windows GPU without full CUDA toolkit
        "ROCMExecutionProvider",
        "CPUExecutionProvider",
    )
    picked = [p for p in order if p in available]
    return picked or ["CPUExecutionProvider"]
