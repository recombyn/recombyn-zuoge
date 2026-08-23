"""Smart eraser endpoint — LaMa inpaint + mask dilation + seam blend."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.eraser_service import erase_image_bytes

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-eraser"],
    dependencies=[Depends(require_auth)],
)


@router.post("/erase")
async def erase_image(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    dilate_px: int = Form(10),
    backend: str = Form("lama"),
    seam_radius: int = Form(8),
):
    """Return inpainted RGB PNG — white mask pixels are erased and filled."""
    image_bytes = await file.read()
    mask_bytes = await mask.read()
    png, meta = erase_image_bytes(
        image_bytes,
        mask_bytes,
        dilate_px=int(dilate_px),
        backend=backend.strip() or "lama",
        seam_radius=int(seam_radius),
    )
    headers = {"X-ILP-Engine": str(meta.get("engine") or "")}
    return Response(content=png, media_type="image/png", headers=headers)
