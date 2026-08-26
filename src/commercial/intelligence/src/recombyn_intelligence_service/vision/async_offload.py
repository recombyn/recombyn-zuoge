"""Offload CPU/ONNX work so async routes do not block /health."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


async def run_sync(fn: Callable[..., T], /, *args, **kwargs) -> T:
    """Run blocking vision work in a worker thread."""
    return await asyncio.to_thread(fn, *args, **kwargs)
