"""Scene complexity routing — LaMa vs Flux."""

from __future__ import annotations

import numpy as np


def mask_area_ratio(mask: np.ndarray) -> float:
    m = mask
    if m.ndim == 3:
        m = m[:, :, 0]
    total = max(1, int(m.shape[0]) * int(m.shape[1]))
    covered = int(np.count_nonzero(m > 127))
    return covered / total


def select_inpaint_backend(
    subject_repair_mask: np.ndarray,
    *,
    configured: str = "lama",
    flux_enabled: bool = False,
    flux_area_threshold: float = 0.35,
) -> str:
    """
    Pick inpaint backend for cascade step 1.

    When flux routing is enabled and the repair mask exceeds the area threshold,
    use Flux if the HTTP adapter is configured; otherwise fall back to LaMa.
    """
    backend = str(configured or "lama").strip().lower()
    if backend not in {"lama", "opencv", "flux"}:
        backend = "lama"

    wants_flux = backend == "flux" or (
        flux_enabled and mask_area_ratio(subject_repair_mask) >= flux_area_threshold
    )
    if wants_flux:
        try:
            from image_layer_pipeline.stages.inpainting.flux import flux_available

            if flux_available():
                return "flux"
        except Exception:
            pass

    if backend == "flux":
        return "lama"
    return backend
