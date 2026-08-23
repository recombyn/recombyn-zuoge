"""Admin ops — job DLQ list / replay / discard (hydrate + export)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import require_permission, audit_admin_mutation
from app.services.auth import SessionUser
from app.services.job_store import (
    dlq_depth,
    get_job,
    list_dlq,
    normalize_trace_id,
    remove_dlq_job,
    save_job,
)

router = APIRouter(prefix="/ops", tags=["admin-ops"])
_log = logging.getLogger(__name__)

DlqKind = Literal["hydrate", "export"]


class DlqReplayIn(BaseModel):
    jobId: str = Field(min_length=1, max_length=64)


def _dlq_entry_for_job(kind: DlqKind, job_id: str) -> dict[str, Any] | None:
    for row in list_dlq(kind, limit=500):
        if str(row.get("job_id") or "") == job_id:
            return row
    return None


def _rebuild_hydrate_job(job_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    ops = entry.get("ops") if isinstance(entry.get("ops"), list) else []
    if not ops:
        raise HTTPException(
            status_code=409,
            detail="Job payload expired and DLQ entry has no ops snapshot — cannot replay",
        )
    payload = {
        "job_id": job_id,
        "kind": "hydrate",
        "status": "queued",
        "progress": 0,
        "ops": ops,
        "limit": int(entry.get("limit") or 6),
        "policy": str(entry.get("policy") or "auto"),
        "rules": entry.get("rules") if isinstance(entry.get("rules"), dict) else {},
        "result": None,
        "error": None,
        "trace_id": normalize_trace_id(str(entry.get("trace_id") or "") or None),
        "replayed_from_dlq": True,
    }
    save_job(job_id, payload, kind="hydrate")
    return payload


def _rebuild_export_job(job_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    project_id = str(entry.get("project_id") or "").strip()
    user_id = str(entry.get("user_id") or "").strip()
    if not project_id or not user_id:
        raise HTTPException(
            status_code=409,
            detail="DLQ entry missing project_id/user_id — cannot replay",
        )
    fmt = str(entry.get("format") or "png").strip().lower()
    if fmt != "png":
        fmt = "png"
    payload = {
        "job_id": job_id,
        "kind": "export",
        "status": "queued",
        "progress": 0,
        "project_id": project_id,
        "format": fmt,
        "frame_id": str(entry.get("frame_id") or "").strip() or None,
        "user_id": user_id,
        "result": None,
        "error": None,
        "trace_id": normalize_trace_id(str(entry.get("trace_id") or "") or None),
        "replayed_from_dlq": True,
    }
    save_job(job_id, payload, kind="export")
    return payload


def _rebuild_job(kind: DlqKind, job_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    if kind == "export":
        return _rebuild_export_job(job_id, entry)
    return _rebuild_hydrate_job(job_id, entry)


def _enqueue_replay(kind: DlqKind, job_id: str) -> None:
    if kind == "export":
        from worker.tasks import run_design_export_job

        run_design_export_job.delay(job_id)
        return
    from worker.tasks import run_image_hydrate_job

    run_image_hydrate_job.delay(job_id)


def _list_kind(kind: DlqKind, limit: int) -> dict[str, Any]:
    try:
        items = list_dlq(kind, limit=limit)
        depth = dlq_depth(kind)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"DLQ unavailable: {exc}") from exc
    return {"items": items, "depth": depth}


def _replay_kind(
    kind: DlqKind,
    job_id: str,
    request: Request,
    admin: SessionUser,
) -> dict[str, Any]:
    entry = _dlq_entry_for_job(kind, job_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Job not found in {kind} DLQ")

    try:
        job = get_job(job_id, kind=kind)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Job store unavailable: {exc}") from exc

    if job is None:
        job = _rebuild_job(kind, job_id, entry)
    else:
        save_job(
            job_id,
            {
                **job,
                "status": "queued",
                "progress": 0,
                "error": None,
                "result": None,
                "replayed_from_dlq": True,
            },
            kind=kind,
        )

    try:
        _enqueue_replay(kind, job_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Job queue unavailable (start Redis + worker). {exc}",
        ) from exc

    removed = remove_dlq_job(kind, job_id)
    try:
        from app.core.metrics import observe_job

        observe_job(kind, "enqueued")
    except Exception:
        pass

    audit_admin_mutation(
        actor=admin,
        action=f"ops.{kind}_dlq.replay",
        resource=f"{kind}_dlq",
        resource_id=job_id,
        trace_id=getattr(request.state, "trace_id", None),
    )
    _log.info(
        "%s_dlq event=replay job_id=%s removed=%s actor=%s",
        kind,
        job_id,
        removed,
        getattr(admin, "id", ""),
    )
    return {
        "jobId": job_id,
        "status": "queued",
        "removedFromDlq": removed,
        "traceId": str((job or {}).get("trace_id") or entry.get("trace_id") or "")
        or None,
    }


def _discard_kind(
    kind: DlqKind,
    job_id: str,
    request: Request,
    admin: SessionUser,
) -> dict[str, Any]:
    jid = str(job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id required")
    try:
        removed = remove_dlq_job(kind, jid)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"DLQ unavailable: {exc}") from exc
    if removed <= 0:
        raise HTTPException(status_code=404, detail=f"Job not found in {kind} DLQ")
    audit_admin_mutation(
        actor=admin,
        action=f"ops.{kind}_dlq.discard",
        resource=f"{kind}_dlq",
        resource_id=jid,
        trace_id=getattr(request.state, "trace_id", None),
    )
    return {"jobId": jid, "removedFromDlq": removed}


@router.get("/hydrate-dlq")
def admin_list_hydrate_dlq(
    _admin: SessionUser = Depends(require_permission("admin:metrics:read")),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return _list_kind("hydrate", limit)


@router.post("/hydrate-dlq/replay")
def admin_replay_hydrate_dlq(
    body: DlqReplayIn,
    request: Request,
    admin: SessionUser = Depends(require_permission("admin:design:write")),
) -> dict[str, Any]:
    return _replay_kind("hydrate", body.jobId.strip(), request, admin)


@router.delete("/hydrate-dlq/{job_id}")
def admin_discard_hydrate_dlq(
    job_id: str,
    request: Request,
    admin: SessionUser = Depends(require_permission("admin:design:write")),
) -> dict[str, Any]:
    return _discard_kind("hydrate", job_id, request, admin)


@router.get("/export-dlq")
def admin_list_export_dlq(
    _admin: SessionUser = Depends(require_permission("admin:metrics:read")),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return _list_kind("export", limit)


@router.post("/export-dlq/replay")
def admin_replay_export_dlq(
    body: DlqReplayIn,
    request: Request,
    admin: SessionUser = Depends(require_permission("admin:design:write")),
) -> dict[str, Any]:
    return _replay_kind("export", body.jobId.strip(), request, admin)


@router.delete("/export-dlq/{job_id}")
def admin_discard_export_dlq(
    job_id: str,
    request: Request,
    admin: SessionUser = Depends(require_permission("admin:design:write")),
) -> dict[str, Any]:
    return _discard_kind("export", job_id, request, admin)
