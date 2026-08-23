"""Celery worker for vision pipeline jobs (optional — requires redis + celery)."""

from __future__ import annotations

try:
    from celery import Celery
except ImportError:  # pragma: no cover
    Celery = None  # type: ignore[misc, assignment]

from recombyn_intelligence_service.vision.config import settings

celery_app = None

if Celery is not None:
    celery_app = Celery(
        "recombyn_vision",
        broker=settings.redis_url,
        backend=settings.redis_url,
    )
    celery_app.conf.update(
        task_track_started=True,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        worker_prefetch_multiplier=1,
    )

    @celery_app.task(name="vision.process_pipeline_job", bind=True, max_retries=0)
    def process_pipeline_job(self, job_id: str) -> str:
        from recombyn_intelligence_service.vision.services.pipeline_runner import (
            execute_pipeline_job,
        )

        execute_pipeline_job(job_id)
        return job_id

else:  # pragma: no cover

    def process_pipeline_job(job_id: str) -> str:  # type: ignore[misc]
        raise RuntimeError("celery is not installed (pip install recombyn-intelligence-service[queue])")
