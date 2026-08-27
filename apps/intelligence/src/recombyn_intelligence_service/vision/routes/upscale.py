"""Super-resolution endpoint (Real-ESRGAN + tiling)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from recombyn_intelligence_service.vision.async_offload import run_sync
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.upscale_service import upscale_image_bytes

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-upscale"],
    dependencies=[Depends(require_auth)],
)


@router.post("/upscale")
async def upscale_image(
    file: UploadFile = File(...),
    resolution: str = Form("4K"),
    target_long_edge: int | None = Form(None),
):
    """Return upscaled RGB PNG — Real-ESRGAN (ONNX) with tiled feather stitching."""
    raw = await file.read()
    png, meta = await run_sync(
        upscale_image_bytes,
        raw,
        resolution=resolution.strip() or "4K",
        target_long_edge=target_long_edge,
    )
    headers = {
        "X-ILP-Engine": str(meta.get("engine") or ""),
        "X-ILP-Width": str(meta.get("width") or ""),
        "X-ILP-Height": str(meta.get("height") or ""),
    }
    return Response(content=png, media_type="image/png", headers=headers)
