"""Celery worker for mockup batch rendering (optional)."""

from __future__ import annotations

try:
  from celery import Celery
except ImportError:
  Celery = None  # type: ignore[misc, assignment]

from recombyn_intelligence_service.mockup.config import settings

celery_app = None

if Celery is not None:
  celery_app = Celery(
    "mockup_pipeline",
    broker=settings.redis_url,
    backend=settings.redis_url,
  )
  celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])

  @celery_app.task(name="mockup.process_batch_job", bind=True, max_retries=0)
  def process_mockup_batch_job(self, job_id: str) -> dict:
    from recombyn_intelligence_service.mockup.services.batch_service import execute_batch_job

    execute_batch_job(job_id)
    return {"job_id": job_id, "status": "done"}

else:

  def process_mockup_batch_job(job_id: str) -> None:
    raise RuntimeError("celery is not installed (pip install recombyn-intelligence-service[queue])")
