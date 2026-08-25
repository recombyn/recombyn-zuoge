"""Decompose a board raster into vision layers via Recombyn Intelligence."""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)

_ILP_REQUIRED_MSG = (
    "工业分层需要接入 Recombyn Intelligence（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)


async def decompose_board_layers(*, image: str) -> dict[str, Any]:
    """
    Full editElements split via intelligence.

    Shape matches ILP decompose:
    ``{ layers, width, height, engines, warnings, image }``.
    """
    from app.services.vision.ilp_client import ilp_enabled
    from app.services.vision.ilp_decompose import decompose_via_ilp

    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    return await decompose_via_ilp(kind="editElements", image=image)
