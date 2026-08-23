"""Thread pool or Celery for pipeline jobs."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.infra.job_store import redis_ping

_executor: ThreadPoolExecutor | None = None


def get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=settings.max_job_workers)
    return _executor


def submit_pipeline_job(job_id: str) -> None:
    if settings.use_celery:
        try:
            from recombyn_intelligence_service.vision.infra.celery_app import (
                celery_app,
                process_pipeline_job,
            )

            if celery_app is not None:
                process_pipeline_job.delay(job_id)
                return
        except Exception as exc:  # noqa: BLE001
            print(f"[vision-queue] Celery unavailable, thread pool fallback: {exc}")
    get_executor().submit(_safe_run, job_id)


def _safe_run(job_id: str) -> None:
    from recombyn_intelligence_service.vision.services.pipeline_runner import execute_pipeline_job

    try:
        execute_pipeline_job(job_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[vision-worker] job {job_id} failed: {exc}")


def queue_stats() -> dict:
    celery_ready = False
    if settings.use_celery:
        try:
            from recombyn_intelligence_service.vision.infra.celery_app import celery_app

            celery_ready = celery_app is not None
        except Exception:
            celery_ready = False
    return {
        "max_workers": settings.max_job_workers,
        "use_celery": settings.use_celery,
        "celery_ready": celery_ready,
        "redis": redis_ping(),
    }
