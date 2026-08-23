"""Mount mockup routes on the intelligence FastAPI app."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI

from recombyn_intelligence_service.mockup.config import settings
from recombyn_intelligence_service.mockup.router import api_router
from recombyn_intelligence_service.vision.deps import set_auth_check


def mount_mockup_routes(
    app: FastAPI,
    *,
    auth_check: Callable[[str | None], None] | None = None,
) -> None:
    set_auth_check(auth_check)
    app.include_router(api_router, prefix=settings.api_v1_str)
