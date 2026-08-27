"""任务模型与内存/磁盘作业存储。"""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    needs_review = "needs_review"
    refining = "refining"
    done = "done"
    failed = "failed"


@dataclass
class JobRecord:
    id: str
    status: JobStatus
    input_path: str
    output_dir: str
    created_at: float
    updated_at: float
    error: str | None = None
    artifacts: dict[str, str] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d


class JobStore:
    """简易作业存储（本地 JSON）；生产可替换为 Redis/DB。"""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def create(
        self,
        input_path: str,
        output_dir: str,
        meta: dict[str, Any] | None = None,
    ) -> JobRecord:
        now = time.time()
        job = JobRecord(
            id=uuid.uuid4().hex[:12],
            status=JobStatus.queued,
            input_path=str(input_path),
            output_dir=str(output_dir),
            created_at=now,
            updated_at=now,
            meta=meta or {},
        )
        self.save(job)
        return job

    def save(self, job: JobRecord) -> None:
        job.updated_at = time.time()
        with self._lock:
            self._path(job.id).write_text(
                json.dumps(job.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def get(self, job_id: str) -> JobRecord | None:
        p = self._path(job_id)
        if not p.exists():
            return None
        data = json.loads(p.read_text(encoding="utf-8"))
        return JobRecord(
            id=data["id"],
            status=JobStatus(data["status"]),
            input_path=data["input_path"],
            output_dir=data["output_dir"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            error=data.get("error"),
            artifacts=data.get("artifacts") or {},
            meta=data.get("meta") or {},
        )

    def list_jobs(self, limit: int = 50) -> list[JobRecord]:
        files = sorted(self.root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        out: list[JobRecord] = []
        for f in files[:limit]:
            job = self.get(f.stem)
            if job:
                out.append(job)
        return out

    def update_status(
        self,
        job_id: str,
        status: JobStatus,
        *,
        error: str | None = None,
        artifacts: dict[str, str] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> JobRecord | None:
        job = self.get(job_id)
        if not job:
            return None
        job.status = status
        if error is not None:
            job.error = error
        if artifacts:
            job.artifacts.update(artifacts)
        if meta:
            job.meta.update(meta)
        self.save(job)
        return job
