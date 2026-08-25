"""High-quality matting-only endpoint (smart auto + optional brush hints)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.segment_service import segment_foreground_rgba

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-segment"],
    dependencies=[Depends(require_auth)],
)


@router.post("/segment")
async def segment_image(
    file: UploadFile = File(...),
    model: str = Form(""),
    decontaminate: float = Form(0.85),
    include_mask: UploadFile | None = File(None),
    exclude_mask: UploadFile | None = File(None),
):
    """Smart matting — auto scene; optional include/exclude brush masks."""
    raw = await file.read()
    inc_raw = await include_mask.read() if include_mask else b""
    exc_raw = await exclude_mask.read() if exclude_mask else b""
    png, engines = segment_foreground_rgba(
        raw,
        model_name=model,
        decontaminate=decontaminate,
        include_mask_bytes=inc_raw or None,
        exclude_mask_bytes=exc_raw or None,
    )
    return Response(
        content=png,
        media_type="image/png",
        headers={"X-ILP-Engines": ",".join(engines)},
    )
