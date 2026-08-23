"""Celery tasks for async import and design hydrate."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.services.job_store import get_job, update_job
from app.services.pipeline import run_import
from worker.celery_app import celery

_log = logging.getLogger(__name__)

_HYDRATE_KIND = "hydrate"
_EXPORT_KIND = "export"
_IMAGE_KIND = "image"
_VIDEO_KIND = "video"
_AUDIO_KIND = "audio"
_DESIGN_AGENT_KIND = "design_agent"
_JOB_TRANSIENT = (ConnectionError, TimeoutError, OSError)


def _fail_job_to_dlq(
    *,
    kind: str,
    job_id: str,
    error: str,
    retries: int,
    extra: dict[str, Any],
) -> dict:
    from app.core.metrics import observe_dlq, observe_job
    from app.services.job_store import push_dlq

    update_job(job_id, kind=kind, status="failed", progress=100, error=error)
    push_dlq(kind, {"job_id": job_id, "error": error, "retries": retries, **extra})
    observe_job(kind, "failed")
    observe_job(kind, "dlq")
    observe_dlq(kind)
    trace_id = str(extra.get("trace_id") or "")
    _log.error(
        "%s_job event=dlq job_id=%s trace_id=%s err=%s",
        kind,
        job_id,
        trace_id,
        error,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "dlq"},
    )
    return {"job_id": job_id, "status": "failed", "error": error, "dlq": True}


@celery.task(name="worker.tasks.run_design_agent_job", bind=True)
def run_design_agent_job(
    self, task_id: str, resume: bool = False, resume_token: str | None = None
) -> dict:
    """Run a persisted design task. Payload travels via DB, never Celery messages."""
    from app.services.design.admin.task_store import get_design_task, parse_task_meta
    from app.services.design.runtime.event_publisher import publish_design_output
    from app.services.design.runtime.orchestrator import (
        resume_design_job,
        run_design_job_from_snapshot,
    )

    row = get_design_task(task_id)
    if not row:
        return {"task_id": task_id, "status": "error", "error": "task_not_found"}
    meta = parse_task_meta(row.get("meta_json"))
    snapshot = meta.get("worker_snapshot")
    if not isinstance(snapshot, dict) or int(snapshot.get("version") or 0) != 2:
        return {"task_id": task_id, "status": "error", "error": "snapshot_unavailable"}

    async def execute() -> None:
        if resume:
            async for event in resume_design_job(
                user_id=str(row.get("user_id") or ""),
                task_id=task_id,
                resume_token=resume_token,
            ):
                publish_design_output(task_id, event)
            return
        async for event in run_design_job_from_snapshot(
            user_id=str(row.get("user_id") or ""),
            snapshot=snapshot,
            task_id=task_id,
        ):
            publish_design_output(task_id, event)

    try:
        asyncio.run(execute())
        return {"task_id": task_id, "status": "done"}
    except Exception as exc:  # noqa: BLE001
        from app.services.design.admin.task_store import (
            _update_task,
            build_run_lifecycle,
            merge_task_meta,
            release_run_lease,
        )

        error = str(exc)[:800] or "worker_failed"
        publish_design_output(task_id, {"type": "error", "code": "worker_failed", "message": error})
        merge_task_meta(
            task_id,
            {
                "run_lifecycle": build_run_lifecycle(
                    thread_id=f"design:{task_id}",
                    resumable=True,
                    interrupt_kind="worker_failed",
                    extra={"recovery_hint": "resume_from_checkpoint"},
                )
            },
        )
        _update_task(task_id, status="error", error_message=error)
        release_run_lease(task_id)
        return {"task_id": task_id, "status": "error", "error": str(exc)[:800]}


@celery.task(name="worker.tasks.requeue_stale_design_agent_jobs")
def requeue_stale_design_agent_jobs() -> dict:
    """Recover tasks lost between API persistence and Worker claim."""
    from app.core.config import settings

    if not bool(getattr(settings, "design_agent_worker_enabled", False)):
        return {"status": "disabled", "requeued": 0}
    from app.services.design.admin.task_store import list_stale_queued_task_ids

    ids = list_stale_queued_task_ids(
        older_than_sec=float(getattr(settings, "design_agent_worker_requeue_sec", 60.0))
    )
    for task_id in ids:
        run_design_agent_job.delay(task_id)
    return {"status": "ok", "requeued": len(ids)}


@celery.task(name="worker.tasks.recover_expired_design_agent_leases")
def recover_expired_design_agent_leases() -> dict:
    from app.core.config import settings
    from app.services.design.admin.task_store import (
        list_stale_running_task_ids,
        recover_expired_running_task,
    )

    if not bool(getattr(settings, "design_agent_worker_enabled", False)):
        return {"status": "disabled", "recovered": 0}
    ttl = float(getattr(settings, "design_run_lease_ttl_sec", 90.0))
    ids = list_stale_running_task_ids(older_than_sec=ttl, limit=100)
    recovered = sum(1 for task_id in ids if recover_expired_running_task(task_id))
    return {"status": "ok", "recovered": recovered}


@celery.task(name="worker.tasks.prune_design_agent_outboxes")
def prune_design_agent_outboxes() -> dict:
    from app.core.config import settings
    from app.services.design.admin.task_store import prune_design_run_outboxes

    if not bool(getattr(settings, "design_agent_worker_enabled", False)):
        return {"status": "disabled", "events": 0, "commands": 0}
    return {"status": "ok", **prune_design_run_outboxes(
        retention_days=int(getattr(settings, "design_agent_outbox_retention_days", 7))
    )}


@celery.task(name="worker.tasks.run_import_job", bind=True)
def run_import_job(self, job_id: str, source_type: str, file_path: str) -> dict:
    update_job(job_id, status="processing", progress=15, error=None)
    try:
        update_job(job_id, progress=35)
        result = run_import(source_type, Path(file_path), job_id=job_id)  # type: ignore[arg-type]
        update_job(job_id, progress=90)
        status = result.get("status") or "done"
        update_job(
            job_id,
            status=status,
            progress=100,
            document=result.get("document"),
            meta=result.get("meta"),
            error=result.get("error"),
        )
        return {"job_id": job_id, "status": status, "error": result.get("error")}
    except Exception as exc:  # noqa: BLE001 — persist failure for client poll
        update_job(job_id, status="failed", progress=100, error=str(exc))
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


@celery.task(
    name="worker.tasks.run_image_hydrate_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_image_hydrate_job(self, job_id: str) -> dict:
    """Fill create_image genPrompt ops via image providers (ADR 0005 / 0007)."""
    from app.core.metrics import observe_job

    def _fail_to_dlq(
        error: str,
        *,
        trace_id: str = "",
        ops: list | None = None,
        limit: int = 6,
        policy: str = "auto",
        rules: dict | None = None,
    ) -> dict:
        return _fail_job_to_dlq(
            kind=_HYDRATE_KIND,
            job_id=job_id,
            error=error,
            retries=int(getattr(self.request, "retries", 0) or 0),
            extra={
                "trace_id": trace_id,
                "ops": ops if isinstance(ops, list) else [],
                "limit": int(limit or 6),
                "policy": str(policy or "auto"),
                "rules": rules if isinstance(rules, dict) else {},
            },
        )

    job = get_job(job_id, kind=_HYDRATE_KIND)
    if not job:
        observe_job(_HYDRATE_KIND, "failed")
        _log.warning(
            "hydrate_job event=failed job_id=%s error=job_not_found",
            job_id,
            extra={"job_id": job_id, "event": "failed"},
        )
        return {"job_id": job_id, "status": "failed", "error": "job_not_found"}

    trace_id = str(job.get("trace_id") or "")
    _log.info(
        "hydrate_job event=start job_id=%s trace_id=%s",
        job_id,
        trace_id,
        extra={"job_id": job_id, "trace_id": trace_id, "event": "start"},
    )
    update_job(job_id, kind=_HYDRATE_KIND, status="processing", progress=10, error=None)
    ops = job.get("ops") if isinstance(job.get("ops"), list) else []
    limit = int(job.get("limit") or 6)
    policy = str(job.get("policy") or "auto")
    rules = job.get("rules") if isinstance(job.get("rules"), dict) else {}

    try:
        update_job(job_id, kind=_HYDRATE_KIND, progress=35)
        from app.services.design.ops.image_hydrate import _hydrate_tool_ops_images

        hydrated, filled = asyncio.run(
            _hydrate_tool_ops_images(
                list(ops),
                limit=max(1, min(24, limit)),
                policy=policy,
                rules={str(k): str(v) for k, v in rules.items()},
            )
        )
        result: dict[str, Any] = {
            "ops": hydrated,
            "filled": int(filled),
            "requested": len(ops),
        }
        update_job(
            job_id,
            kind=_HYDRATE_KIND,
            status="done",
            progress=100,
            result=result,
            error=None,
        )
        observe_job(_HYDRATE_KIND, "done")
        _log.info(
            "hydrate_job event=done job_id=%s trace_id=%s filled=%s",
            job_id,
            trace_id,
            filled,
            extra={"job_id": job_id, "trace_id": trace_id, "event": "done"},
        )
        return {"job_id": job_id, "status": "done", "filled": filled}
    except _JOB_TRANSIENT as exc:
        retries = int(getattr(self.request, "retries", 0) or 0)
        max_retries = int(getattr(self, "max_retries", 2) or 2)
        if retries >= max_retries:
            return _fail_to_dlq(
                f"retries exhausted: {exc}",
                trace_id=trace_id,
                ops=ops,
                limit=limit,
                policy=policy,
                rules=rules,
            )
        observe_job(_HYDRATE_KIND, "retry")
        update_job(
            job_id,
            kind=_HYDRATE_KIND,
            status="processing",
            error=f"transient retry: {exc}",
        )
        _log.warning(
            "hydrate_job event=retry job_id=%s trace_id=%s err=%s",
            job_id,
            trace_id,
            exc,
            extra={"job_id": job_id, "trace_id": trace_id, "event": "retry"},
        )
        raise
    except Exception as exc:  # noqa: BLE001
        return _fail_to_dlq(
            str(exc),
            trace_id=trace_id,
            ops=ops,
            limit=limit,
            policy=policy,
            rules=rules,
        )


@celery.task(
    name="worker.tasks.run_design_export_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_design_export_job(self, job_id: str) -> dict:
    """Rasterize project artboards to PNG (ADR 0005 export vertical)."""
    from app.core.metrics import observe_job
    from app.services.design.export_render import render_and_store_export
    from app.services.projects import get_project

    def _fail_to_dlq(error: str, *, trace_id: str = "") -> dict:
        job_now = get_job(job_id, kind=_EXPORT_KIND) or {}
        return _fail_job_to_dlq(
            kind=_EXPORT_KIND,
            job_id=job_id,
            error=error,
            retries=int(getattr(self.request, "retries", 0) or 0),
            extra={
                "trace_id": trace_id,
                "project_id": job_now.get("project_id"),
                "format": job_now.get("format"),
                "frame_id": job_now.get("frame_id"),
                "user_id": job_now.get("user_id"),
            },
        )

    job = get_job(job_id, kind=_EXPORT_KIND)
    if not job:
        observe_job(_EXPORT_KIND, "failed")
        return {"job_id": job_id, "status": "failed", "error": "job_not_found"}

    trace_id = str(job.get("trace_id") or "")
    user_id = str(job.get("user_id") or "")
    project_id = str(job.get("project_id") or "")
    fmt = str(job.get("format") or "png")
    frame_id = str(job.get("frame_id") or "") or None
    update_job(job_id, kind=_EXPORT_KIND, status="processing", progress=10, error=None)

    try:
        project = get_project(user_id, project_id)
        if not project:
            return _fail_to_dlq("project_not_found", trace_id=trace_id)
        document = project.get("document")
        if not isinstance(document, dict):
            return _fail_to_dlq("document_missing", trace_id=trace_id)
        update_job(job_id, kind=_EXPORT_KIND, progress=40)
        result = render_and_store_export(
            document=document,
            user_id=user_id,
            job_id=job_id,
            fmt=fmt,
            frame_id=frame_id,
        )
        update_job(
            job_id,
            kind=_EXPORT_KIND,
            status="done",
            progress=100,
            result=result,
            error=None,
        )
        observe_job(_EXPORT_KIND, "done")
        _log.info(
            "export_job event=done job_id=%s pages=%s format=%s",
            job_id,
            result.get("pages"),
            fmt,
            extra={"job_id": job_id, "trace_id": trace_id, "event": "done"},
        )
        return {"job_id": job_id, "status": "done", "pages": result.get("pages")}
    except _JOB_TRANSIENT as exc:
        retries = int(getattr(self.request, "retries", 0) or 0)
        max_retries = int(getattr(self, "max_retries", 2) or 2)
        if retries >= max_retries:
            return _fail_to_dlq(f"retries exhausted: {exc}", trace_id=trace_id)
        observe_job(_EXPORT_KIND, "retry")
        update_job(
            job_id,
            kind=_EXPORT_KIND,
            status="processing",
            error=f"transient retry: {exc}",
        )
        raise
    except Exception as exc:  # noqa: BLE001
        return _fail_to_dlq(str(exc), trace_id=trace_id)



def _run_chat_media_job(
    self,
    job_id: str,
    *,
    kind: str,
    execute,
) -> dict:
    """Shared Celery runner for chat image/video/audio jobs."""
    from app.core.metrics import observe_job

    job = get_job(job_id, kind=kind)
    if not job:
        observe_job(kind, "failed")
        return {"job_id": job_id, "status": "failed", "error": "job_not_found"}

    trace_id = str(job.get("trace_id") or "")
    update_job(job_id, kind=kind, status="processing", progress=10, error=None)

    try:
        update_job(job_id, kind=kind, progress=35)
        result = asyncio.run(execute(job))
        update_job(
            job_id,
            kind=kind,
            status="done",
            progress=100,
            result=result,
            error=None,
        )
        observe_job(kind, "done")
        _log.info(
            "%s_job event=done job_id=%s trace_id=%s",
            kind,
            job_id,
            trace_id,
            extra={"job_id": job_id, "trace_id": trace_id, "event": "done"},
        )
        return {"job_id": job_id, "status": "done"}
    except _JOB_TRANSIENT as exc:
        retries = int(getattr(self.request, "retries", 0) or 0)
        max_retries = int(getattr(self, "max_retries", 2) or 2)
        if retries >= max_retries:
            update_job(
                job_id,
                kind=kind,
                status="failed",
                progress=100,
                error=f"retries exhausted: {exc}",
            )
            observe_job(kind, "failed")
            return {"job_id": job_id, "status": "failed", "error": str(exc)}
        observe_job(kind, "retry")
        update_job(
            job_id,
            kind=kind,
            status="processing",
            error=f"transient retry: {exc}",
        )
        raise
    except Exception as exc:  # noqa: BLE001
        update_job(
            job_id,
            kind=kind,
            status="failed",
            progress=100,
            error=str(exc),
        )
        observe_job(kind, "failed")
        _log.error(
            "%s_job event=failed job_id=%s trace_id=%s err=%s",
            kind,
            job_id,
            trace_id,
            exc,
            extra={"job_id": job_id, "trace_id": trace_id, "event": "failed"},
        )
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


@celery.task(
    name="worker.tasks.run_chat_image_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_chat_image_job(self, job_id: str) -> dict:
    """Fill POST /chat/image/jobs via image providers (ADR 0005 long-paint)."""

    async def _execute(job: dict) -> dict:
        from app.api.routes.chat_image_jobs import execute_image_generate

        return await execute_image_generate(
            str(job.get("user_id") or ""),
            prompt=str(job.get("prompt") or ""),
            model_id=job.get("model"),
            aspect_ratio=job.get("aspect_ratio"),
            quality=job.get("quality"),
            resolution=job.get("resolution"),
            images=job.get("images") if isinstance(job.get("images"), list) else None,
            credits_charged=int(job.get("credits_charged") or 0),
        )

    return _run_chat_media_job(self, job_id, kind=_IMAGE_KIND, execute=_execute)


@celery.task(
    name="worker.tasks.run_chat_video_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_chat_video_job(self, job_id: str) -> dict:
    """Fill POST /chat/video/jobs via video providers (ADR 0005)."""

    async def _execute(job: dict) -> dict:
        from app.api.routes.chat_video_jobs import execute_video_generate

        return await execute_video_generate(
            str(job.get("user_id") or ""),
            prompt=str(job.get("prompt") or ""),
            model_id=job.get("model"),
            aspect_ratio=job.get("aspect_ratio"),
            resolution=job.get("resolution"),
            duration=job.get("duration") if job.get("duration") is not None else None,
            images=job.get("images") if isinstance(job.get("images"), list) else None,
            credits_charged=int(job.get("credits_charged") or 0),
        )

    return _run_chat_media_job(self, job_id, kind=_VIDEO_KIND, execute=_execute)


@celery.task(
    name="worker.tasks.run_chat_audio_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_chat_audio_job(self, job_id: str) -> dict:
    """Fill POST /chat/audio/jobs via TTS providers (ADR 0005)."""

    async def _execute(job: dict) -> dict:
        from app.api.routes.chat_audio_jobs import execute_audio_generate

        return await execute_audio_generate(
            str(job.get("user_id") or ""),
            prompt=str(job.get("prompt") or ""),
            model_id=job.get("model"),
            voice=job.get("voice"),
            response_format=job.get("response_format"),
            speed=job.get("speed"),
            credits_charged=int(job.get("credits_charged") or 0),
        )

    return _run_chat_media_job(self, job_id, kind=_AUDIO_KIND, execute=_execute)


@celery.task(name="worker.tasks.run_db_backup_job")
def run_db_backup_job(reason: str = "celery") -> dict:
    """Periodic DB backup (SQLite snapshot or MySQL/Postgres dump hint)."""
    from app.services.db.backup import run_db_backup

    return run_db_backup(reason=reason or "celery")
