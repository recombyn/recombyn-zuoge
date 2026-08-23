"""Render design onto a mockup template."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.mockup.services.render_service import render_mockup_png
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(
    prefix="/mockup",
    tags=["mockup-render"],
    dependencies=[Depends(require_auth)],
)


@router.post("/render")
async def render_mockup(
    file: UploadFile = File(...),
    template_id: str = Form("demo-cylinder"),
    return_meta: bool = Form(False),
):
    """Apply user design (RGBA) onto a PBR mockup template; returns PNG."""
    raw = await file.read()
    png, meta = render_mockup_png(raw, template_id=template_id.strip() or "demo-cylinder")
    headers = {}
    if return_meta:
        headers["X-Mockup-Meta"] = json.dumps(meta, ensure_ascii=False)
    return Response(content=png, media_type="image/png", headers=headers)
