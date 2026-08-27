"""Async artboard export jobs."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.i18n.errors import http_error
from app.services.i18n.locale import LocaleDep
from app.services.job_store import get_job, normalize_trace_id, save_job
from app.services.projects import get_project
from app.services.storage import get_bytes
from worker.tasks import run_design_export_job

router = APIRouter(prefix="/design/export", tags=["design-export-jobs"])
_log = logging.getLogger(__name__)
_KIND = "export"


class ExportJobCreateRequest(BaseModel):
    projectId: str = Field(min_length=1, max_length=64)
    format: Literal["png"] = "png"
    frameId: str | None = Field(default=None, max_length=64)
    trace_id: str | None = None


class ExportJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class ExportJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


def _require_export_job(current_user: CurrentUser, job_id: str, locale: str | None) -> dict:
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_store_unavailable", locale) from exc
    if not job or str(job.get("user_id") or "") != str(current_user.id):
        raise http_error(404, "job_not_found", locale)
    return job


@router.post("/jobs", response_model=ExportJobCreateResponse)
async def create_export_job(
    body: ExportJobCreateRequest,
    request: Request,
    locale: LocaleDep,
    current_user: CurrentUser,
):
    project_id = body.projectId.strip()
    project = get_project(current_user.id, project_id)
    if not project:
        raise http_error(404, "project_not_found", locale)
    document = project.get("document")
    if not isinstance(document, dict):
        raise http_error(400, "project_no_document", locale)

    job_id = uuid.uuid4().hex
    header_tid = getattr(request.state, "trace_id", None)
    trace_id = normalize_trace_id(body.trace_id or header_tid)
    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "status": "queued",
        "progress": 0,
        "project_id": project_id,
        "format": body.format,
        "frame_id": (body.frameId or "").strip() or None,
        "user_id": current_user.id,
        "result": None,
        "error": None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_design_export_job.delay(job_id)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_queue_unavailable", locale) from exc
    try:
        from app.core.metrics import observe_job

        observe_job("export", "enqueued")
    except Exception:
        pass
    _log.info(
        "export_job event=enqueued job_id=%s project_id=%s format=%s trace_id=%s",
        job_id,
        project_id,
        body.format,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return ExportJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=ExportJobStatusResponse)
def get_export_job(locale: LocaleDep, current_user: CurrentUser, job_id: str):
    job = _require_export_job(current_user, job_id, locale)
    return ExportJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )


@router.get("/jobs/{job_id}/file")
def download_export_job(locale: LocaleDep, current_user: CurrentUser, job_id: str):
    job = _require_export_job(current_user, job_id, locale)
    if str(job.get("status") or "") != "done":
        raise http_error(409, "export_not_ready", locale)
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    key = str(result.get("key") or "")
    if not key:
        raise http_error(404, "export_file_missing", locale)
    data = get_bytes(key)
    if not data:
        raise http_error(404, "export_file_missing", locale)
    content_type = str(result.get("contentType") or "application/octet-stream")
    ext = "png"

    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="export.{ext}"'},
    )
