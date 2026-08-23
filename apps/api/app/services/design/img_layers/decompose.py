"""Decompose a board raster into vision layers via Recombyn Intelligence."""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


async def decompose_board_layers(*, image: str) -> dict[str, Any]:
    """
    Full editElements split when intelligence is available; otherwise one image layer.

    Shape matches ILP decompose:
    ``{ layers, width, height, engines, warnings, image }``.
    """
    from app.services.vision.ilp_client import ilp_enabled
    from app.services.vision.ilp_decompose import decompose_via_ilp

    if not ilp_enabled():
        _log.info("img_layers: intelligence unavailable — single-image fallback")
        return {
            "image": image,
            "layers": [
                {
                    "type": "image",
                    "src": image,
                    "x": 0,
                    "y": 0,
                    "width": 0,
                    "height": 0,
                    "name": "整板",
                }
            ],
            "kind": "editElements",
            "width": 0,
            "height": 0,
            "engines": ["fallback:single"],
            "warnings": ["工业分层服务未配置 — 已作为单图层放置"],
        }

    try:
        return await decompose_via_ilp(kind="editElements", image=image)
    except Exception as err:  # noqa: BLE001
        _log.exception("img_layers decompose failed: %s", err)
        return {
            "image": image,
            "layers": [
                {
                    "type": "image",
                    "src": image,
                    "x": 0,
                    "y": 0,
                    "width": 0,
                    "height": 0,
                    "name": "整板",
                }
            ],
            "kind": "editElements",
            "width": 0,
            "height": 0,
            "engines": ["fallback:error"],
            "warnings": [f"decompose failed: {err}"[:200]],
        }
