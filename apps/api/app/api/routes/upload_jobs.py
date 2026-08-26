"""Async media upload jobs — survive refresh after the API has received the file."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.api.routes.chat_job_sse import streaming_media_job_events
from app.core.config import settings
from app.services.job_store import get_job, save_job
from worker.tasks import run_upload_job

router = APIRouter(tags=["upload-jobs"])
_log = logging.getLogger(__name__)
_KIND = "upload"


class UploadJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"


class UploadJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None


def _upload_job_temp_dir() -> Path:
    """Shared with Celery worker via compose volume ``storage/uploads``."""
    root = Path(getattr(settings, "upload_dir", None) or "storage/uploads")
    if not root.is_absolute():
        # Match API cwd layout in Docker: /app/apps/api/storage/uploads
        root = (Path.cwd() / root).resolve()
    dest = root / "upload_jobs"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


@router.post("/jobs", response_model=UploadJobCreateResponse)
async def create_upload_job(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """Accept one file, persist to temp storage, enqueue worker to push to object storage."""
    if not file:
        raise HTTPException(status_code=400, detail="file required")

    raw = await file.read()
    max_bytes = int(getattr(settings, "max_upload_mb", 50) or 50) * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail="file too large")
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")

    job_id = uuid.uuid4().hex
    temp_path = _upload_job_temp_dir() / job_id
    temp_path.write_bytes(raw)

    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "status": "queued",
        "progress": 0,
        "user_id": current_user.id,
        "filename": file.filename,
        "content_type": file.content_type,
        "temp_path": str(temp_path),
        "size": len(raw),
        "result": None,
        "error": None,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_upload_job.delay(job_id)
    except Exception as exc:  # noqa: BLE001
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(
            status_code=503,
            detail=f"Job queue unavailable (start Redis + worker). {exc}",
        ) from exc

    _log.info("upload_job event=enqueued job_id=%s bytes=%s", job_id, len(raw))
    return UploadJobCreateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}", response_model=UploadJobStatusResponse)
def get_upload_job(current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id") or "") != str(current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    result = job.get("result") if isinstance(job.get("result"), dict) else None
    return UploadJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=result,
        error=job.get("error"),
    )


@router.get("/jobs/{job_id}/events")
async def stream_upload_job_events(current_user: CurrentUser, job_id: str):
    return streaming_media_job_events(current_user, job_id, kind=_KIND)


def execute_upload_job(job: dict[str, Any]) -> dict[str, Any]:
    """Push temp bytes to object storage; returns first uploaded item dict."""
    from app.services import uploads as upload_store

    user_id = str(job.get("user_id") or "").strip()
    temp_path = Path(str(job.get("temp_path") or ""))
    if not user_id or not temp_path.is_file():
        raise RuntimeError(
            "上传作业缺少临时文件（API 与 worker 未共享 storage/uploads；"
            "或临时文件已过期被清理）"
        )

    try:
        raw = temp_path.read_bytes()
        items = upload_store.upload_user_files(
            user_id,
            [(raw, job.get("filename"), job.get("content_type"))],
        )
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass

    if not items:
        raise RuntimeError("upload returned no items")
    item = items[0]
    if not isinstance(item, dict) or not item.get("url"):
        raise RuntimeError("upload returned no url")
    return {"item": item}
