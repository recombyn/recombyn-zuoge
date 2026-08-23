"""Resolve board paint runner by paint_mode."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any

from app.services.design.board_modes.types import (
    PAINT_MODE_IMG_LAYERS,
    PaintMode,
    normalize_paint_mode,
)

BoardRunner = Callable[..., AsyncIterator[dict[str, Any]]]


def resolve_paint_mode(raw: str | None) -> PaintMode:
    return normalize_paint_mode(raw)


def is_img_layers_mode(raw: str | None) -> bool:
    return resolve_paint_mode(raw) == PAINT_MODE_IMG_LAYERS


async def run_board_mode(
    *,
    paint_mode: str | None,
    **kwargs: Any,
) -> AsyncIterator[dict[str, Any]]:
    """Dispatch to img_layers pipeline when selected; else raise for caller to use ops graph."""
    if not is_img_layers_mode(paint_mode):
        raise ValueError("not_img_layers")
    from app.services.design.img_layers.pipeline import run_img_layers_job

    async for ev in run_img_layers_job(**kwargs):
        yield ev
