"""Shared ONNX Runtime provider selection."""

from __future__ import annotations

import os


def preferred_ort_providers() -> list[str]:
    """Available EPs in preference order.

    Default: CUDA → CPU. DirectML is opt-in via ``ILP_ORT_PROVIDERS`` because
    BiRefNet routinely OOMs under DmlExecutionProvider on Windows.

    Override: ``ILP_ORT_PROVIDERS=DmlExecutionProvider,CPUExecutionProvider``
    """
    import onnxruntime as ort

    available = set(ort.get_available_providers())
    explicit = str(os.environ.get("ILP_ORT_PROVIDERS") or "").strip()
    if explicit:
        picked = [p.strip() for p in explicit.split(",") if p.strip() in available]
        return picked or ["CPUExecutionProvider"]

    order = ("CUDAExecutionProvider", "CPUExecutionProvider")
    picked = [p for p in order if p in available]
    return picked or ["CPUExecutionProvider"]
