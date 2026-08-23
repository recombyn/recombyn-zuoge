"""Multipart upload."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(prefix="/uploads", tags=["uploads"], dependencies=[Depends(require_auth)])

ALLOWED = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


@router.post("")
async def upload_files(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "files required")
    out_dir = settings.workspace / "uploads"
    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []
    for f in files:
        suffix = Path(f.filename or "image.png").suffix.lower() or ".png"
        if suffix not in ALLOWED:
            raise HTTPException(400, f"unsupported type: {suffix}")
        name = f"{uuid.uuid4().hex}{suffix}"
        path = out_dir / name
        data = await f.read()
        path.write_bytes(data)
        saved.append(
            {
                "object_key": f"uploads/{name}",
                "url": f"/files/uploads/{name}",
                "filename": f.filename,
                "size": len(data),
            }
        )
    return {"files": saved}
