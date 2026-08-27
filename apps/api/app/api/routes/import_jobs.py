"""Async import jobs (image)."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form,  UploadFile

from app.api.deps import CurrentUser
from app.api.routes.import_image import save_upload
from app.schemas.import_response import JobCreateResponse, JobStatusResponse
from app.services.i18n.errors import http_error
from app.services.i18n.locale import LocaleDep
from app.services.job_store import get_job, save_job
from worker.tasks import run_import_job

router = APIRouter(prefix="/import", tags=["import-jobs"])

SourceType = Literal["image"]


@router.post("/jobs", response_model=JobCreateResponse)
async def create_import_job(
    locale: LocaleDep,
    _current_user: CurrentUser,
    file: UploadFile = File(...),
    source_type: SourceType = Form(...),
):
    if source_type != "image":
        raise http_error(400, "import_image_only", locale)

    suffix = Path(file.filename or "image.png").suffix or ".png"
    saved = save_upload(file, suffix)
    job_id = uuid.uuid4().hex
    payload = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "source_type": source_type,
        "file_path": str(saved),
        "document": None,
        "meta": None,
        "error": None,
    }
    try:
        save_job(job_id, payload)
        run_import_job.delay(job_id, source_type, str(saved))
    except Exception as exc:  # noqa: BLE001 — Redis/broker down
        raise http_error(503, "job_queue_unavailable", locale) from exc
    return JobCreateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_import_job(locale: LocaleDep, _current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_store_unavailable", locale) from exc
    if not job:
        raise http_error(404, "job_not_found", locale)

    meta = job.get("meta")
    return JobStatusResponse(
        job_id=job_id,
        status=job.get("status", "queued"),
        progress=int(job.get("progress") or 0),
        document=job.get("document"),
        meta=meta,
        error=job.get("error"),
    )
