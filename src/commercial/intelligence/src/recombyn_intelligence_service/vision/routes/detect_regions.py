"""Region detection for Mark tool — OCR + foreground bbox."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from recombyn_intelligence_service.vision.async_offload import run_sync
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.detect_regions_service import (
    detect_regions_image_bytes,
)

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-detect-regions"],
    dependencies=[Depends(require_auth)],
)


@router.post("/detect-regions")
async def detect_regions(
    file: UploadFile = File(...),
    lang: str = Form("ch"),
    model: str = Form(""),
):
    """Return text/subject boxes for the Mark tool (no layer crops)."""
    raw = await file.read()
    return await run_sync(
        detect_regions_image_bytes,
        raw,
        lang=lang.strip() or "ch",
        segmentation_model=model.strip() or "birefnet-general",
    )
