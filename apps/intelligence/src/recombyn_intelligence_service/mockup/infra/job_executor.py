"""Thread pool / Celery dispatch for mockup batch jobs."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from recombyn_intelligence_service.mockup.config import settings

_executor: ThreadPoolExecutor | None = None


def get_executor() -> ThreadPoolExecutor:
  global _executor
  if _executor is None:
    _executor = ThreadPoolExecutor(max_workers=settings.max_job_workers)
  return _executor


def submit_mockup_job(job_id: str) -> None:
  if settings.use_celery:
    try:
      from recombyn_intelligence_service.mockup.infra.celery_app import (
        celery_app,
        process_mockup_batch_job,
      )

      if celery_app is not None:
        process_mockup_batch_job.delay(job_id)
        return
    except Exception as exc:  # noqa: BLE001
      print(f"[mockup-queue] Celery unavailable, thread pool fallback: {exc}")
  get_executor().submit(_safe_run, job_id)


def _safe_run(job_id: str) -> None:
  from recombyn_intelligence_service.mockup.services.batch_service import execute_batch_job

  try:
    execute_batch_job(job_id)
  except Exception as exc:  # noqa: BLE001
    from recombyn_intelligence_service.mockup.infra.job_store import update_job

    update_job(job_id, status="failed", error=str(exc))
