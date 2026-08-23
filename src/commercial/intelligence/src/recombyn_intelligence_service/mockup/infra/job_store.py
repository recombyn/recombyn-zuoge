"""Mockup batch job store (in-process; Redis optional for multi-worker)."""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def create_job(*, kind: str, payload: dict[str, Any]) -> str:
  job_id = uuid.uuid4().hex
  with _lock:
    _jobs[job_id] = {
      "id": job_id,
      "kind": kind,
      "status": "queued",
      "payload": payload,
      "result": None,
      "error": None,
      "created_at": time.time(),
      "updated_at": time.time(),
    }
  return job_id


def update_job(job_id: str, **fields: Any) -> None:
  with _lock:
    job = _jobs.get(job_id)
    if not job:
      return
    job.update(fields)
    job["updated_at"] = time.time()


def get_job(job_id: str) -> dict[str, Any] | None:
  with _lock:
    job = _jobs.get(job_id)
    return dict(job) if job else None
