"""Closed-source image layer pipeline (depth / matting / inpaint) HTTP routes."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.deps import set_auth_check
from recombyn_intelligence_service.vision.router import api_router


def mount_vision_routes(
    app: FastAPI,
    *,
    auth_check: Callable[[str | None], None] | None = None,
) -> None:
    """Mount /api/v1 pipeline routes and /files static workspace."""
    set_auth_check(auth_check)

    settings.workspace.mkdir(parents=True, exist_ok=True)
    (settings.workspace / "uploads").mkdir(parents=True, exist_ok=True)
    (settings.workspace / "outputs").mkdir(parents=True, exist_ok=True)
    (settings.workspace / "jobs").mkdir(parents=True, exist_ok=True)

    app.include_router(api_router, prefix=settings.api_v1_str)
    app.mount(
        "/files",
        StaticFiles(directory=str(settings.workspace)),
        name="vision-files",
    )
