"""Shared types for vision providers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol


ProgressCb = Callable[[int, str], None] | None


class VisionProvider(Protocol):
    name: str

    def supports(self, kind: str) -> bool: ...

    async def run(
        self,
        kind: str,
        image: str,
        *,
        meta: dict[str, Any] | None = None,
        user_id: str | None = None,
        on_progress: ProgressCb = None,
    ) -> dict[str, Any]: ...
