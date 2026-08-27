"""Commercial vision capability probe — model weights and backends."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _fastsam_model_path() -> Path | None:
    from image_layer_pipeline.stages.sam_roi import _resolve_fastsam_model

    return _resolve_fastsam_model()


def _realesrgan_model_path() -> Path | None:
    from image_layer_pipeline.stages.upscale.esrgan import _resolve_model_path

    return _resolve_model_path()


def vision_model_status() -> dict[str, Any]:
    """Report which closed-source vision models/backends are ready for production."""
    from image_layer_pipeline.stages import ocr as ocr_mod
    from image_layer_pipeline.stages.edgesam_onnx import edgesam_available
    from image_layer_pipeline.stages.sam_roi import sam_backend_name, sam_enabled

    esrgan = _realesrgan_model_path()
    fastsam = _fastsam_model_path()
    lanczos_dev = str(os.environ.get("ILP_UPSCALE_ALLOW_LANCZOS", "") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    return {
        "sam": {
            "enabled": sam_enabled(),
            "backend": sam_backend_name(),
        },
        "edgesam": {
            "available": edgesam_available(),
        },
        "fastsam": {
            "available": fastsam is not None,
            "path": str(fastsam) if fastsam else None,
        },
        "realesrgan": {
            "available": esrgan is not None,
            "path": str(esrgan) if esrgan else None,
            "dev_lanczos_fallback": lanczos_dev,
        },
        "ocr": {
            "available": ocr_mod.available(),
        },
        "inpaint": {
            "lama": True,
            "flux": _flux_available(),
        },
    }


def _flux_available() -> bool:
    try:
        from image_layer_pipeline.stages.inpainting.flux import flux_available

        return bool(flux_available())
    except Exception:
        return False


def vision_ready_for_production() -> str:
    """
    Return empty string when core vision stack is deployable, else human-readable reason.
    """
    status = vision_model_status()
    if not status["realesrgan"]["available"] and not status["realesrgan"]["dev_lanczos_fallback"]:
        return "Real-ESRGAN ONNX weights missing (set ILP_ESRGAN_MODEL_PATH)"
    if not status["ocr"]["available"]:
        return "PaddleOCR not installed (pip install -e '.[ocr]')"
    return ""
