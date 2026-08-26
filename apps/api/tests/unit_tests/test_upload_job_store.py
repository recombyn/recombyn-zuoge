"""Chunked upload job store."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import pytest


@contextmanager
def _memory_job_store(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, str]]:
    from app.services import job_store

    store: dict[str, str] = {}

    class _Fake:
        def set(self, key: str, value: str, ex: int | None = None) -> None:
            store[key] = value

        def get(self, key: str) -> str | None:
            return store.get(key)

    monkeypatch.setattr(job_store, "_client", lambda: _Fake())
    yield store


def test_upload_session_parts_and_assemble(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.core.config import settings
    from app.services import upload_job_store as store

    with _memory_job_store(monkeypatch):
        monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
        monkeypatch.setattr(settings, "upload_chunk_size_mb", 1)
        monkeypatch.setattr(settings, "max_upload_mb", 0)

        data = b"x" * (1024 * 1024 + 512)
        sess = store.create_upload_session(
            "user-1",
            filename="big.png",
            content_type="image/png",
            total_size=len(data),
        )
        job_id = sess["job_id"]
        part_size = sess["part_size"]
        store.save_upload_part("user-1", job_id, 1, data[:part_size])
        store.save_upload_part("user-1", job_id, 2, data[part_size:])
        assembled = store.assemble_upload_job("user-1", job_id)
        assert assembled.is_file()
        assert assembled.stat().st_size == len(data)
