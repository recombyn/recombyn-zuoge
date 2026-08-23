"""Mockup render API — BFF proxy to closed-source Recombyn Intelligence."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.mockup.mockup_client import (
    mockup_enabled,
    list_mockup_templates,
    render_mockup_batch_via_intelligence,
    render_mockup_via_intelligence,
)

router = APIRouter(prefix="/mockup", tags=["mockup"])


class MockupRenderIn(BaseModel):
    image: str = Field(..., min_length=1, description="Design image data URL or https URL")
    template_id: str = Field("demo-cylinder", min_length=1)


class MockupBatchItemIn(BaseModel):
    image: str = Field(..., min_length=1)
    template_id: str = Field("demo-cylinder", min_length=1)
    name: str = ""


class MockupBatchIn(BaseModel):
    items: list[MockupBatchItemIn] = Field(..., min_length=1, max_length=64)


@router.get("/tools")
async def list_mockup_tools() -> dict[str, Any]:
    enabled = mockup_enabled()
    templates: list[dict[str, Any]] = []
    if enabled:
        try:
            templates = await list_mockup_templates()
        except Exception:
            templates = [{"id": "demo-cylinder", "name": "Demo cylinder mug", "kind": "builtin"}]
    return {
        "mockup": {
            "enabled": enabled,
            "templates": templates,
        }
    }


@router.post("/render")
async def post_mockup_render(
    _current_user: CurrentUser,
    body: MockupRenderIn,
) -> dict[str, Any]:
    if not mockup_enabled():
        raise HTTPException(
            status_code=503,
            detail="样机渲染需要接入 Recombyn Intelligence（设置 RECOMBYN_INTELLIGENCE_URL）",
        )
    try:
        return await render_mockup_via_intelligence(
            body.image.strip(),
            template_id=body.template_id.strip() or "demo-cylinder",
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@router.post("/render/batch")
async def post_mockup_batch_render(
    _current_user: CurrentUser,
    body: MockupBatchIn,
) -> dict[str, Any]:
    if not mockup_enabled():
        raise HTTPException(
            status_code=503,
            detail="样机渲染需要接入 Recombyn Intelligence（设置 RECOMBYN_INTELLIGENCE_URL）",
        )
    try:
        return await render_mockup_batch_via_intelligence(
            [i.model_dump() for i in body.items]
        )
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
