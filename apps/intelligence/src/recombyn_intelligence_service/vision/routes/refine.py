"""Human refine: mask brush / local inpainting."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from image_layer_pipeline.stages.inpainting import inpaint_once
from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.infra.job_store import get_job, update_job

router = APIRouter(prefix="/pipeline", tags=["refine"], dependencies=[Depends(require_auth)])


class RefineInpaintRequest(BaseModel):
    target: str = Field("far", description="far | behind_subject")
    mask_png_base64: str = Field(..., description="white = repaint region")
    backend: str = "lama"


class RefineMaskRequest(BaseModel):
    layer: str = Field("fg", description="fg | mid")
    mask_png_base64: str


def _decode_mask(b64: str, size: tuple[int, int]) -> np.ndarray:
    raw = b64.split(",")[-1]
    data = base64.b64decode(raw)
    img = Image.open(BytesIO(data)).convert("L").resize(size, Image.Resampling.NEAREST)
    return np.asarray(img, dtype=np.uint8)


@router.post("/jobs/{job_id}/refine/inpaint")
def refine_inpaint(job_id: str, body: RefineInpaintRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") not in {"needs_review", "refining", "done"}:
        raise HTTPException(400, f"job status={job.get('status')}")

    update_job(job_id, status="refining")
    artifacts = job.get("artifacts") or {}
    key = "far_background" if body.target == "far" else "behind_subject"
    src = artifacts.get(key)
    if not src or not Path(src).exists():
        raise HTTPException(400, f"missing artifact {key}")

    rgb = np.asarray(Image.open(src).convert("RGB"), dtype=np.uint8)
    mask = _decode_mask(body.mask_png_base64, (rgb.shape[1], rgb.shape[0]))
    if mask.shape != rgb.shape[:2]:
        mask = np.array(
            Image.fromarray(mask).resize((rgb.shape[1], rgb.shape[0]), Image.Resampling.NEAREST)
        )

    result = inpaint_once(rgb, mask, backend=body.backend)
    out_path = Path(src)
    Image.fromarray(result).save(out_path)

    update_job(job_id, status="needs_review")
    urls = job.get("urls") or {}
    return {
        "job_id": job_id,
        "target": body.target,
        "url": urls.get(key),
        "status": "needs_review",
    }


@router.post("/jobs/{job_id}/refine/mask")
def refine_mask(job_id: str, body: RefineMaskRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    artifacts = job.get("artifacts") or {}
    mask_key = "subject_mask" if body.layer == "fg" else "mid_mask"
    path = artifacts.get(mask_key)
    if not path:
        raise HTTPException(400, f"missing {mask_key}")

    existing = Image.open(path)
    mask = _decode_mask(body.mask_png_base64, existing.size)
    Image.fromarray(mask, mode="L").save(path)

    layer_key = "foreground" if body.layer == "fg" else "midground"
    layer_path = artifacts.get(layer_key)
    if layer_path and Path(layer_path).exists():
        rgba = np.asarray(Image.open(layer_path).convert("RGBA"))
        rgba[:, :, 3] = mask
        Image.fromarray(rgba, mode="RGBA").save(layer_path)

    update_job(job_id, status="needs_review")
    return {"job_id": job_id, "layer": body.layer, "status": "needs_review"}
