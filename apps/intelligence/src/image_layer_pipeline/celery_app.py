"""可选 Celery worker（需 Redis + USE_CELERY=1）。"""

from __future__ import annotations

import os
from pathlib import Path

from image_layer_pipeline.jobs import JobStore
from image_layer_pipeline.types import PipelineConfig
from image_layer_pipeline.worker import run_job

try:
    from celery import Celery
except ImportError:  # pragma: no cover
    Celery = None  # type: ignore


def make_celery() -> "Celery":
    if Celery is None:
        raise RuntimeError("请先 pip install celery redis")
    broker = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    app = Celery("image_layer_pipeline", broker=broker, backend=broker)
    app.conf.task_track_started = True
    return app


celery_app = make_celery() if Celery is not None and os.environ.get("REDIS_URL") else None

if celery_app is not None:

    @celery_app.task(name="image_layer_pipeline.process_job")
    def process_job(job_id: str) -> str:
        root = Path(os.environ.get("ILP_WORKSPACE", "workspace"))
        store = JobStore(root / "jobs")
        cfg_path = Path(os.environ.get("ILP_CONFIG", "configs/default.yaml"))
        cfg = PipelineConfig.from_yaml(cfg_path)
        run_job(job_id, store, cfg)
        return job_id
else:

    def process_job(job_id: str) -> str:  # type: ignore[misc]
        raise RuntimeError("Celery 未启用")
