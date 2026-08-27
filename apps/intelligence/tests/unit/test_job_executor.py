"""Tests for job queue submission."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from recombyn_intelligence_service.vision.infra import job_executor


def test_submit_pipeline_job_uses_thread_pool_by_default(monkeypatch):
    monkeypatch.setattr(job_executor.settings, "use_celery", False)
    called: list[str] = []

    class FakeExecutor:
        def submit(self, fn, job_id):
            called.append(job_id)

    monkeypatch.setattr(job_executor, "get_executor", lambda: FakeExecutor())
    job_executor.submit_pipeline_job("abc123")
    assert called == ["abc123"]


def test_submit_pipeline_job_uses_celery_when_enabled(monkeypatch):
    monkeypatch.setattr(job_executor.settings, "use_celery", True)
    delay = MagicMock()

    with patch("recombyn_intelligence_service.vision.infra.celery_app.celery_app", object()):
        with patch(
            "recombyn_intelligence_service.vision.infra.celery_app.process_pipeline_job"
        ) as task:
            task.delay = delay
            job_executor.submit_pipeline_job("job-xyz")
    delay.assert_called_once_with("job-xyz")
