"""任务队列：本地线程池；可选 Celery（REDIS_URL 存在时）。"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from image_layer_pipeline.jobs import JobStore
from image_layer_pipeline.types import PipelineConfig
from image_layer_pipeline.worker import run_job

_executor = ThreadPoolExecutor(max_workers=1)
_store: JobStore | None = None
_config: PipelineConfig | None = None


def init_runtime(
    workspace: Path,
    config: PipelineConfig | None = None,
) -> JobStore:
    global _store, _config
    workspace = Path(workspace)
    _store = JobStore(workspace / "jobs")
    _config = config
    return _store


def get_store() -> JobStore:
    if _store is None:
        raise RuntimeError("JobStore 未初始化，请先调用 init_runtime()")
    return _store


def enqueue(job_id: str) -> None:
    """投递任务。有 REDIS_URL 时可改为 Celery delay。"""
    if os.environ.get("REDIS_URL") and os.environ.get("USE_CELERY") == "1":
        try:
            from image_layer_pipeline.celery_app import process_job

            process_job.delay(job_id)
            return
        except Exception as exc:  # noqa: BLE001
            print(f"[queue] Celery 不可用，回退线程池: {exc}")

    store = get_store()
    cfg = _config

    def _run() -> None:
        run_job(job_id, store, cfg)

    _executor.submit(_run)
