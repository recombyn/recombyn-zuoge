"""Startup warmup for heavy vision models (optional, env-gated)."""

from __future__ import annotations

import logging
import os
import threading

_log = logging.getLogger(__name__)
_started = False


def _env_on(key: str, default: bool = True) -> bool:
    raw = str(os.environ.get(key) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def warmup_vision_models() -> None:
    """Load BiRefNet/ONNX (+ optional OCR/LaMa) so first user click is warm."""
    if not _env_on("ILP_WARMUP", True):
        _log.info("ILP warmup skipped (ILP_WARMUP=0)")
        return

    import numpy as np

    from image_layer_pipeline.matting import run_matting

    tiny = np.full((64, 64, 3), 180, dtype=np.uint8)
    tiny[16:48, 16:48] = (40, 90, 160)
    try:
        run_matting(tiny, scene="general", trim_output=False, use_sam_roi=False)
        _log.info("ILP warmup: matting session ready")
    except Exception as exc:
        _log.warning("ILP warmup: matting failed: %s", exc)

    if _env_on("ILP_WARMUP_OCR", False):
        try:
            from image_layer_pipeline.stages import ocr as ocr_mod

            if ocr_mod.available():
                ocr_mod.get_ocr(str(os.environ.get("ILP_OCR_LANG") or "ch"))
                _log.info("ILP warmup: OCR ready")
        except Exception as exc:
            _log.warning("ILP warmup: OCR failed: %s", exc)

    if _env_on("ILP_WARMUP_LAMA", False):
        try:
            from image_layer_pipeline.stages.inpainting import cascade as cascade_mod

            cascade_mod._lama()
            _log.info("ILP warmup: LaMa ready")
        except Exception as exc:
            _log.warning("ILP warmup: LaMa failed: %s", exc)


def schedule_warmup() -> None:
    """Fire warmup once in a daemon thread (does not block /health)."""
    global _started
    if _started:
        return
    _started = True
    if not _env_on("ILP_WARMUP", True):
        return

    def _run() -> None:
        try:
            warmup_vision_models()
        except Exception as exc:
            _log.warning("ILP warmup crashed: %s", exc)

    threading.Thread(target=_run, name="ilp-warmup", daemon=True).start()
