"""Unit tests for chunked upload jobs."""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator
from unittest.mock import MagicMock

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


@contextmanager
def _auth_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.api.routes import upload_jobs
    from app.services.auth import SessionUser

    app = FastAPI()
    app.include_router(upload_jobs.router, prefix="/api/v1/uploads")
    app.dependency_overrides[deps.get_current_user] = lambda: SessionUser(
        id="u1",
        email="t@example.com",
        name="t",
        avatar=None,
        provider="email",
        role="user",
    )
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_create_upload_session(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.core.config import settings
    from app.services.job_store import job_key

    with _memory_job_store(monkeypatch) as redis_store:
        monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
        monkeypatch.setattr(settings, "max_upload_mb", 0)

        with _auth_client(monkeypatch) as client:
            res = client.post(
                "/api/v1/uploads/jobs/session",
                json={"filename": "photo.png", "content_type": "image/png", "total_size": 128},
            )
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["part_count"] == 1

            raw = redis_store.get(job_key(body["job_id"], kind="upload"))
            assert raw is not None
            payload = json.loads(raw)
            assert payload["status"] == "uploading"
            assert payload["user_id"] == "u1"


def test_complete_upload_job_enqueues_worker(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes import upload_jobs as route_mod
    from app.core.config import settings
    from app.services import upload_job_store as store

    with _memory_job_store(monkeypatch):
        monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
        monkeypatch.setattr(settings, "upload_chunk_size_mb", 1)
        monkeypatch.setattr(settings, "max_upload_mb", 0)

        mock_run = MagicMock()
        monkeypatch.setattr(route_mod, "run_upload_job", mock_run)

        sess = store.create_upload_session(
            "u1",
            filename="photo.png",
            content_type="image/png",
            total_size=10,
        )
        store.save_upload_part("u1", sess["job_id"], 1, b"1234567890")

        with _auth_client(monkeypatch) as client:
            res = client.post(f"/api/v1/uploads/jobs/{sess['job_id']}/complete")
            assert res.status_code == 200, res.text
            mock_run.delay.assert_called_once_with(sess["job_id"])


def test_get_upload_job_ok(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import upload_jobs as route_mod

    monkeypatch.setattr(
        route_mod,
        "get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "progress": 100,
            "user_id": "u1",
            "result": {"item": {"url": "https://cdn.example/a.png", "key": "uploads/u1/a.png"}},
            "error": None,
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/uploads/jobs/abc123")
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "done"


def test_execute_upload_job_pushes_to_storage(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes.upload_jobs import execute_upload_job

    temp = tmp_path / "assembled.bin"
    temp.write_bytes(b"hello")

    monkeypatch.setattr(
        "app.services.uploads.upload_user_file_from_path",
        lambda user_id, path, filename, content_type: {
            "url": "https://cdn.example/x.png",
            "key": f"uploads/{user_id}/x.png",
        },
    )
    monkeypatch.setattr(
        "app.api.routes.upload_jobs.job_store.cleanup_upload_job_files",
        lambda *a, **k: None,
    )

    out = execute_upload_job(
        {
            "job_id": "j1",
            "user_id": "u1",
            "temp_path": str(temp),
            "filename": "x.png",
            "content_type": "image/png",
        }
    )
    assert out["item"]["url"] == "https://cdn.example/x.png"
