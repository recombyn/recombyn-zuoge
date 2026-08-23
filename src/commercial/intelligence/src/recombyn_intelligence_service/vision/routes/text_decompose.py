"""editText decomposition — OCR + LaMa inpaint on intelligence."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.text_decompose_service import (
    decompose_text_image_bytes,
)

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-text-decompose"],
    dependencies=[Depends(require_auth)],
)


@router.post("/text-decompose")
async def text_decompose(
    file: UploadFile = File(...),
    lang: str = Form("ch"),
    min_confidence: float = Form(0.72),
):
    """OCR text layers + inpainted background for editText."""
    raw = await file.read()
    return decompose_text_image_bytes(
        raw,
        lang=lang.strip() or "ch",
        min_confidence=max(0.0, min(1.0, float(min_confidence))),
    )
