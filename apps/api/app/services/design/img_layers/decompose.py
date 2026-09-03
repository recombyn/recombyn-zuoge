"""Decompose a board raster into vision layers via WaveSpeed layered."""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


async def decompose_board_layers(*, image: str) -> dict[str, Any]:
    """
    Full editElements split via WaveSpeed qwen-image/layered.

    Shape: ``{ layers, width, height, engines, warnings, image }``.
    """
    from app.services.vision.edit_elements import edit_elements_layered

    return await edit_elements_layered(image)
