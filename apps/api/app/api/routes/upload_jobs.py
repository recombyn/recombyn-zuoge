from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import streaming_media_job_events
from app.services.i18n.errors import http_error, upload_value_error_code
from app.services.i18n.locale import LocaleDep
from app.services.job_store import get_job
from app.services import upload_job_store as job_store
from worker.tasks import run_upload_job

router = APIRouter(tags=["upload-jobs"])
_log = logging.getLogger(__name__)
_KIND = "upload"


class UploadSessionCreate(BaseModel):
    filename: str = Field(..., min_length=1, max_length=512)
    content_type: str | None = None
    total_size: int = Field(..., gt=0)


class UploadSessionResponse(BaseModel):
    job_id: str
    part_size: int
    part_count: int


class UploadPartResponse(BaseModel):
    part_number: int
    received: int
    part_count: int
    progress: int


class UploadJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    received_parts: list[int] | None = None
    part_count: int | None = None
    part_size: int | None = None


def _http_value_error(exc: ValueError, locale: str):
    code = upload_value_error_code(str(exc))
    status = 413 if code == "upload_too_large" else 400
    return http_error(status, code, locale)


def _job_not_found(locale: str):
    return http_error(404, "job_not_found", locale)


@router.post("/jobs/session", response_model=UploadSessionResponse)
def create_upload_session(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: UploadSessionCreate,
):
    try:
        out = job_store.create_upload_session(
            current_user.id,
            filename=body.filename.strip(),
            content_type=body.content_type,
            total_size=int(body.total_size),
        )
    except ValueError as exc:
        raise _http_value_error(exc, locale) from exc
    return UploadSessionResponse(**out)


@router.put("/jobs/{job_id}/parts/{part_number}", response_model=UploadPartResponse)
async def upload_job_part(
    request: Request,
    locale: LocaleDep,
    current_user: CurrentUser,
    job_id: str,
    part_number: int,
):
    data = await request.body()
    try:
        out = job_store.save_upload_part(current_user.id, job_id, part_number, data)
    except LookupError as exc:
        raise _job_not_found(locale) from exc
    except ValueError as exc:
        raise _http_value_error(exc, locale) from exc
    return UploadPartResponse(**out)


@router.post("/jobs/{job_id}/complete")
def complete_upload_job(
    locale: LocaleDep,
    current_user: CurrentUser,
    job_id: str,
):
    try:
        assembled = job_store.assemble_upload_job(current_user.id, job_id)
        job_store.mark_upload_job_queued(current_user.id, job_id, assembled)
        status = _enqueue_or_run_upload_inline(job_id)
    except LookupError as exc:
        raise _job_not_found(locale) from exc
    except ValueError as exc:
        raise _http_value_error(exc, locale) from exc
    except Exception as exc:  # noqa: BLE001
        job_store.abort_upload_job(current_user.id, job_id)
        raise http_error(503, "job_queue_unavailable", locale) from exc
    _log.info("upload_job event=enqueued job_id=%s status=%s", job_id, status)
    return {"job_id": job_id, "status": status}


def _celery_has_workers(timeout: float = 0.5) -> bool:
    try:
        from worker.celery_app import celery

        ping = celery.control.inspect(timeout=timeout).ping()
        return bool(ping)
    except Exception:  # noqa: BLE001
        return False


def _finish_upload_inline(job_id: str) -> None:
    from app.services.job_store import update_job

    job = get_job(job_id, kind=_KIND)
    if not job:
        raise LookupError("job not found")
    update_job(job_id, kind=_KIND, status="processing", progress=97, error=None)
    result = execute_upload_job(job)
    update_job(job_id, kind=_KIND, status="done", progress=100, result=result, error=None)


def _enqueue_or_run_upload_inline(job_id: str) -> str:
    """Prefer Celery when workers are up; otherwise finish in-process (local API-only)."""
    if _celery_has_workers():
        try:
            run_upload_job.delay(job_id)
            return "queued"
        except Exception as exc:  # noqa: BLE001
            _log.warning(
                "upload_job event=enqueue_failed job_id=%s err=%s; running inline",
                job_id,
                exc,
            )
    else:
        _log.warning("upload_job event=no_workers job_id=%s; running inline", job_id)
    _finish_upload_inline(job_id)
    return "done"


@router.delete("/jobs/{job_id}")
def abort_upload_job(current_user: CurrentUser, job_id: str):
    job_store.abort_upload_job(current_user.id, job_id)
    return {"ok": True}


@router.get("/jobs/{job_id}", response_model=UploadJobStatusResponse)
def get_upload_job(locale: LocaleDep, current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise http_error(503, "job_store_unavailable", locale) from exc
    if not job:
        raise _job_not_found(locale)
    if str(job.get("user_id") or "") != str(current_user.id):
        raise _job_not_found(locale)
    result = job.get("result") if isinstance(job.get("result"), dict) else None
    received = job.get("received_parts")
    return UploadJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=result,
        error=job.get("error"),
        received_parts=list(received) if isinstance(received, list) else None,
        part_count=int(job["part_count"]) if job.get("part_count") else None,
        part_size=int(job["part_size"]) if job.get("part_size") else None,
    )


@router.get("/jobs/{job_id}/events")
async def stream_upload_job_events(request: Request, current_user: CurrentUser, job_id: str):
    return streaming_media_job_events(current_user, job_id, kind=_KIND, request=request)


def execute_upload_job(job: dict[str, Any]) -> dict[str, Any]:
    from app.services import uploads as upload_store

    user_id = str(job.get("user_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    temp_path = Path(str(job.get("temp_path") or ""))
    if not user_id or not job_id or not temp_path.is_file():
        raise RuntimeError("upload job missing assembled file")

    try:
        item = upload_store.upload_user_file_from_path(
            user_id,
            path=temp_path,
            filename=str(job.get("filename") or "upload.bin"),
            content_type=str(job.get("content_type") or "") or None,
        )
    finally:
        job_store.cleanup_upload_job_files(user_id, job_id)

    if not isinstance(item, dict) or not item.get("url"):
        raise RuntimeError("upload returned no url")
    return {"item": item}
