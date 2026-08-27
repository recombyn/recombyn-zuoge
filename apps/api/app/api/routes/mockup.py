"""Mockup render API — BFF proxy to closed-source Recombyn Intelligence."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep
from app.services.mockup.mockup_client import (
    mockup_enabled,
    list_mockup_templates,
    fetch_mockup_template_kit,
    auto_bake_mockup_via_intelligence,
    render_mockup_batch_via_intelligence,
    render_mockup_via_intelligence,
)

router = APIRouter(prefix="/mockup", tags=["mockup"])


class MockupRenderIn(BaseModel):
    image: str = Field(..., min_length=1, description="Design image data URL or https URL")
    template_id: str = Field("demo-cylinder", min_length=1)


class MockupAutoBakeIn(BaseModel):
    image: str = Field(..., min_length=1, description="Product photo data URL / https / storage URL")
    scale: float = Field(0.5, ge=0.25, le=1.0)


class MockupBatchItemIn(BaseModel):
    image: str = Field(..., min_length=1)
    template_id: str = Field("demo-cylinder", min_length=1)
    name: str = ""


class MockupBatchIn(BaseModel):
    items: list[MockupBatchItemIn] = Field(..., min_length=1, max_length=64)


def _require_mockup(locale: str | None) -> None:
    if not mockup_enabled():
        raise http_error(503, "mockup_unavailable", locale)


@router.get("/tools")
async def list_mockup_tools() -> dict[str, Any]:
    enabled = mockup_enabled()
    templates: list[dict[str, Any]] = []
    if enabled:
        templates = await list_mockup_templates()
    return {
        "mockup": {
            "enabled": enabled,
            "templates": templates,
        }
    }


@router.get("/templates/{template_id}/kit")
async def get_mockup_template_kit(
    locale: LocaleDep,
    _current_user: CurrentUser,
    template_id: str,
    scale: float = 0.5,
) -> dict[str, Any]:
    """Proxy Intelligence template kit (UV/mask/base) for FE WebGL preview."""
    _require_mockup(locale)
    try:
        return await fetch_mockup_template_kit(template_id, scale=scale)
    except RuntimeError as err:
        raise value_error_http(err, locale, status=502) from err


@router.post("/auto-bake")
async def post_mockup_auto_bake(
    locale: LocaleDep,
    _current_user: CurrentUser,
    body: MockupAutoBakeIn,
) -> dict[str, Any]:
    """
    Full-auto: product photo → printable zones + UV + shadow/highlight kit.

    Called when the user enables 样机 on a product image.
    """
    _require_mockup(locale)
    try:
        return await auto_bake_mockup_via_intelligence(
            body.image.strip(),
            scale=float(body.scale),
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    except RuntimeError as err:
        raise value_error_http(err, locale, status=502) from err


@router.post("/render")
async def post_mockup_render(
    locale: LocaleDep,
    _current_user: CurrentUser,
    body: MockupRenderIn,
) -> dict[str, Any]:
    _require_mockup(locale)
    try:
        return await render_mockup_via_intelligence(
            body.image.strip(),
            template_id=body.template_id.strip() or "demo-cylinder",
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    except RuntimeError as err:
        raise value_error_http(err, locale, status=502) from err


@router.post("/render/batch")
async def post_mockup_batch_render(
    locale: LocaleDep,
    _current_user: CurrentUser,
    body: MockupBatchIn,
) -> dict[str, Any]:
    _require_mockup(locale)
    try:
        return await render_mockup_batch_via_intelligence(
            [i.model_dump() for i in body.items]
        )
    except RuntimeError as err:
        raise value_error_http(err, locale, status=502) from err
