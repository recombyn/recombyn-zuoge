"""Async design image-hydrate jobs — Celery + Redis poll (ADR 0005 / 0007)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.job_store import get_job, normalize_trace_id, save_job
from worker.tasks import run_image_hydrate_job

router = APIRouter(prefix="/design/hydrate", tags=["design-hydrate-jobs"])
_log = logging.getLogger(__name__)

_KIND = "hydrate"


class HydrateJobCreateRequest(BaseModel):
    ops: list[dict[str, Any]] = Field(default_factory=list)
    limit: int = Field(default=6, ge=1, le=24)
    policy: str = "auto"
    rules: dict[str, str] | None = None
    trace_id: str | None = None


class HydrateJobCreateResponse(BaseModel):
    job_id: str
    status: str = "queued"
    trace_id: str = ""


class HydrateJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    trace_id: str | None = None


@router.post("/jobs", response_model=HydrateJobCreateResponse)
async def create_hydrate_job(
    body: HydrateJobCreateRequest,
    request: Request,
    _current_user: CurrentUser,
):
    if not body.ops:
        raise HTTPException(status_code=400, detail="ops required")
    job_id = uuid.uuid4().hex
    header_tid = getattr(request.state, "trace_id", None)
    trace_id = normalize_trace_id(body.trace_id or header_tid)
    payload = {
        "job_id": job_id,
        "kind": _KIND,
        "status": "queued",
        "progress": 0,
        "ops": body.ops,
        "limit": body.limit,
        "policy": body.policy,
        "rules": body.rules or {},
        "result": None,
        "error": None,
        "user_id": getattr(_current_user, "id", None) or None,
        "trace_id": trace_id,
    }
    try:
        save_job(job_id, payload, kind=_KIND)
        run_image_hydrate_job.delay(job_id)
    except Exception as exc:  # noqa: BLE001 — Redis/broker down
        raise HTTPException(
            status_code=503,
            detail=f"Job queue unavailable (start Redis + worker). {exc}",
        ) from exc
    try:
        from app.core.metrics import observe_job

        observe_job("hydrate", "enqueued")
    except Exception:
        pass
    _log.info(
        "hydrate_job event=enqueued job_id=%s trace_id=%s",
        job_id,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "enqueued"},
    )
    return HydrateJobCreateResponse(job_id=job_id, status="queued", trace_id=trace_id)


@router.get("/jobs/{job_id}", response_model=HydrateJobStatusResponse)
def get_hydrate_job(_current_user: CurrentUser, job_id: str):
    try:
        job = get_job(job_id, kind=_KIND)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    owner = str(job.get("user_id") or "")
    if owner and owner != str(_current_user.id):
        raise HTTPException(status_code=404, detail="Job not found")
    return HydrateJobStatusResponse(
        job_id=job_id,
        status=str(job.get("status") or "queued"),
        progress=int(job.get("progress") or 0),
        result=job.get("result") if isinstance(job.get("result"), dict) else None,
        error=job.get("error"),
        trace_id=str(job.get("trace_id") or "") or None,
    )
