"""Batch mockup rendering — sync and async job queue."""

from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from recombyn_intelligence_service.mockup.infra.job_store import get_job
from recombyn_intelligence_service.mockup.services.batch_service import render_batch_sync, submit_batch
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(
  prefix="/mockup",
  tags=["mockup-batch"],
  dependencies=[Depends(require_auth)],
)


class BatchItemIn(BaseModel):
  design_b64: str = Field(..., min_length=1)
  template_id: str = "demo-cylinder"
  name: str = ""


class BatchSubmitIn(BaseModel):
  items: list[BatchItemIn] = Field(..., min_length=1, max_length=64)


@router.post("/render/batch")
async def render_batch_endpoint(body: BatchSubmitIn):
  """Synchronous batch render (≤64 designs). Returns base64 PNGs + timing."""
  designs = [base64.b64decode(i.design_b64) for i in body.items]
  tids = [i.template_id for i in body.items]
  result = render_batch_sync(designs, tids)
  return JSONResponse(result)


@router.post("/jobs/batch")
async def submit_batch_job(body: BatchSubmitIn):
  """Enqueue async batch job (Celery or thread pool)."""
  job_id = submit_batch([i.model_dump() for i in body.items])
  return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
async def get_batch_job(job_id: str):
  job = get_job(job_id.strip())
  if not job:
    return JSONResponse({"detail": "job not found"}, status_code=404)
  return job


@router.post("/render/psd")
async def render_psd(
  file: UploadFile = File(...),
  template_id: str = Form("demo-cylinder"),
):
  """Render mockup and return layered PSD decomposition."""
  from recombyn_intelligence_service.mockup.services.render_service import render_mockup_psd

  raw = await file.read()
  psd, meta = render_mockup_psd(raw, template_id=template_id.strip() or "demo-cylinder")
  return Response(
    content=psd,
    media_type="application/octet-stream",
    headers={"X-Mockup-Meta": json.dumps(meta, ensure_ascii=False)},
  )
