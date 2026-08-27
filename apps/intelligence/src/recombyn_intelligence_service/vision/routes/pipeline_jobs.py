"""Async pipeline jobs — POST /pipeline/jobs + GET + SSE events."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.infra.job_events import stream_job_events
from recombyn_intelligence_service.vision.infra.job_executor import queue_stats, submit_pipeline_job
from recombyn_intelligence_service.vision.infra.job_store import get_job, list_jobs, new_job_id, save_job, update_job

router = APIRouter(prefix="/pipeline", tags=["pipeline-jobs"], dependencies=[Depends(require_auth)])


class JobCreateResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    urls: dict | None = None
    layers: list | None = None
    meta: dict | None = None
    error: str | None = None


def _enqueue(job_id: str) -> None:
    submit_pipeline_job(job_id)


@router.post("/jobs", response_model=JobCreateResponse)
async def create_pipeline_job(
    file: UploadFile | None = File(None),
    object_key: str | None = Form(None),
):
    uploads = settings.workspace / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)

    if file is not None:
        suffix = Path(file.filename or "image.png").suffix.lower() or ".png"
        name = f"{new_job_id()}{suffix}"
        dest = uploads / name
        dest.write_bytes(await file.read())
        file_path = dest
    elif object_key:
        src = settings.workspace / object_key
        if not src.exists():
            raise HTTPException(404, "object_key not found")
        dest = uploads / f"{new_job_id()}{src.suffix}"
        shutil.copy2(src, dest)
        file_path = dest
    else:
        raise HTTPException(400, "file or object_key required")

    job_id = new_job_id()
    save_job(
        job_id,
        {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "file_path": str(file_path),
            "created_at": time.time(),
            "artifacts": {},
            "urls": None,
            "layers": None,
            "meta": None,
            "error": None,
        },
    )
    _enqueue(job_id)
    return JobCreateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}/events")
async def stream_pipeline_job_events(job_id: str):
    if get_job(job_id) is None:
        raise HTTPException(404, "Job not found")
    return StreamingResponse(
        stream_job_events(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_pipeline_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JobStatusResponse(
        job_id=job_id,
        status=job.get("status", "queued"),
        progress=int(job.get("progress") or 0),
        urls=job.get("urls"),
        layers=job.get("layers"),
        meta=job.get("meta"),
        error=job.get("error"),
    )


@router.get("/jobs")
def list_pipeline_jobs(limit: int = 50):
    return {"jobs": list_jobs(limit=limit), "queue": queue_stats()}


@router.post("/jobs/{job_id}/approve")
def approve_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    update_job(job_id, status="done")
    return {"job_id": job_id, "status": "done"}
