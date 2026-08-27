from __future__ import annotations

import math
import shutil
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.job_store import get_job, save_job, update_job
from app.services.upload_limits import assert_upload_size_allowed, upload_chunk_part_bytes

_KIND = "upload"


def _parts_dir(user_id: str, job_id: str) -> Path:
    root = Path(settings.upload_dir).resolve() / "upload_jobs" / user_id / job_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def _assembled_path(user_id: str, job_id: str) -> Path:
    return _parts_dir(user_id, job_id) / "assembled.bin"


def _expected_part_size(sess: dict[str, Any], part_number: int) -> int:
    part_size = int(sess["part_size"])
    part_count = int(sess["part_count"])
    total = int(sess["total_size"])
    if part_number < part_count:
        return part_size
    return total - (part_count - 1) * part_size


def _upload_progress(received: int, part_count: int) -> int:
    if part_count <= 0:
        return 0
    return max(0, min(70, int((received / part_count) * 70)))


def create_upload_session(
    user_id: str,
    *,
    filename: str,
    content_type: str | None,
    total_size: int,
) -> dict[str, Any]:
    if total_size <= 0:
        raise ValueError("empty file")
    assert_upload_size_allowed(int(total_size), content_type)

    part_size = upload_chunk_part_bytes()
    part_count = max(1, math.ceil(total_size / part_size))
    job_id = uuid.uuid4().hex
    _parts_dir(user_id, job_id)

    save_job(
        job_id,
        {
            "job_id": job_id,
            "kind": _KIND,
            "user_id": user_id,
            "filename": filename or "upload.bin",
            "content_type": (content_type or "").split(";")[0].strip(),
            "total_size": int(total_size),
            "part_size": part_size,
            "part_count": part_count,
            "received_parts": [],
            "status": "uploading",
            "progress": 0,
            "temp_path": "",
            "result": None,
            "error": None,
        },
        kind=_KIND,
    )
    return {"job_id": job_id, "part_size": part_size, "part_count": part_count}


def save_upload_part(
    user_id: str,
    job_id: str,
    part_number: int,
    data: bytes,
) -> dict[str, Any]:
    sess = get_job(job_id, kind=_KIND)
    if not sess or str(sess.get("user_id") or "") != str(user_id):
        raise LookupError("job not found")
    if str(sess.get("status") or "") != "uploading":
        raise ValueError("job is not accepting parts")

    pn = int(part_number)
    part_count = int(sess["part_count"])
    if pn < 1 or pn > part_count:
        raise ValueError("invalid part number")

    expected = _expected_part_size(sess, pn)
    if len(data) != expected:
        raise ValueError(f"part size mismatch (expected {expected}, got {len(data)})")

    (_parts_dir(user_id, job_id) / f"part_{pn:05d}").write_bytes(data)

    received = {int(x) for x in (sess.get("received_parts") or [])}
    received.add(pn)
    progress = _upload_progress(len(received), part_count)
    update_job(
        job_id,
        kind=_KIND,
        received_parts=sorted(received),
        progress=progress,
    )
    return {
        "part_number": pn,
        "received": len(received),
        "part_count": part_count,
        "progress": progress,
    }


def assemble_upload_job(user_id: str, job_id: str) -> Path:
    sess = get_job(job_id, kind=_KIND)
    if not sess or str(sess.get("user_id") or "") != str(user_id):
        raise LookupError("job not found")
    if str(sess.get("status") or "") != "uploading":
        raise ValueError("job is not ready to assemble")

    part_count = int(sess["part_count"])
    received = {int(x) for x in (sess.get("received_parts") or [])}
    if len(received) != part_count:
        raise ValueError("incomplete upload")

    root = _parts_dir(user_id, job_id)
    assembled = _assembled_path(user_id, job_id)
    with assembled.open("wb") as out:
        for pn in range(1, part_count + 1):
            out.write((root / f"part_{pn:05d}").read_bytes())
    return assembled


def mark_upload_job_queued(user_id: str, job_id: str, temp_path: Path) -> None:
    update_job(
        job_id,
        kind=_KIND,
        status="queued",
        progress=75,
        temp_path=str(temp_path),
    )


def abort_upload_job(user_id: str, job_id: str) -> None:
    sess = get_job(job_id, kind=_KIND)
    if sess and str(sess.get("user_id") or "") != str(user_id):
        return
    root = Path(settings.upload_dir).resolve() / "upload_jobs" / user_id / job_id
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
    if sess:
        update_job(job_id, kind=_KIND, status="aborted", error="aborted")


def cleanup_upload_job_files(user_id: str, job_id: str) -> None:
    root = Path(settings.upload_dir).resolve() / "upload_jobs" / user_id / job_id
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
