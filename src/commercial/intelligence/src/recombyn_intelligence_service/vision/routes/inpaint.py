"""Stateless inpaint endpoint for text erase / local refine."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.inpaint_service import inpaint_image_bytes

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-inpaint"],
    dependencies=[Depends(require_auth)],
)


@router.post("/inpaint")
async def inpaint_image(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    backend: str = Form("lama"),
):
    """Return inpainted RGB PNG — white mask pixels are repainted."""
    image_bytes = await file.read()
    mask_bytes = await mask.read()
    png = inpaint_image_bytes(image_bytes, mask_bytes, backend=backend.strip() or "lama")
    return Response(content=png, media_type="image/png")
