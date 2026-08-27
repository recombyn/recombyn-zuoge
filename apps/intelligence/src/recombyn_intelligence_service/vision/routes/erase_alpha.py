"""Smart alpha eraser — painted hint expands to full region, then made transparent."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.vision.async_offload import run_sync
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.erase_alpha_service import erase_alpha_bytes

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-erase-alpha"],
    dependencies=[Depends(require_auth)],
)


@router.post("/erase-alpha")
async def erase_alpha(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
):
    """Return RGBA PNG — white mask pixels expand to similar regions and become transparent."""
    image_bytes = await file.read()
    mask_bytes = await mask.read()
    png, meta = await run_sync(erase_alpha_bytes, image_bytes, mask_bytes)
    headers = {"X-ILP-Engine": str(meta.get("engine") or "")}
    return Response(content=png, media_type="image/png", headers=headers)
