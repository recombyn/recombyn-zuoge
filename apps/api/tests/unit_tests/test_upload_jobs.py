"""Unit tests for async upload jobs."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator
from unittest.mock import MagicMock

import pytest


@contextmanager
def _auth_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app
    from app.services.auth import SessionUser

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


def test_create_upload_job_enqueues(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes import upload_jobs as route_mod

    saved: dict[str, Any] = {}
    monkeypatch.setattr(route_mod, "_upload_job_temp_dir", lambda: tmp_path)

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_upload_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/uploads/jobs",
            files={"file": ("photo.png", b"png-bytes", "image/png")},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "upload"
        assert saved["payload"]["user_id"] == "u1"
        assert saved["payload"]["filename"] == "photo.png"
        delay.assert_called_once()


def test_create_upload_job_rejects_oversized_file(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes import upload_jobs as route_mod
    from app.core.config import settings

    monkeypatch.setattr(route_mod, "_upload_job_temp_dir", lambda: tmp_path)
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    monkeypatch.setattr(settings, "max_video_upload_mb", 2)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/uploads/jobs",
            files={"file": ("big.png", b"x" * (1024 * 1024 + 1), "image/png")},
        )
        assert res.status_code == 413, res.text
        assert "max 1MB" in res.json()["detail"]


def test_create_upload_job_allows_larger_video(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes import upload_jobs as route_mod
    from app.core.config import settings

    monkeypatch.setattr(route_mod, "_upload_job_temp_dir", lambda: tmp_path)
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    monkeypatch.setattr(settings, "max_video_upload_mb", 3)
    monkeypatch.setattr(route_mod, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(route_mod.run_upload_job, "delay", MagicMock())

    payload = b"v" * (2 * 1024 * 1024)
    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/uploads/jobs",
            files={"file": ("clip.mp4", payload, "video/mp4")},
        )
        assert res.status_code == 200, res.text


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
        body = res.json()
        assert body["status"] == "done"
        assert body["result"]["item"]["url"] == "https://cdn.example/a.png"


def test_upload_job_temp_dir_under_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes import upload_jobs as route_mod
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    dest = route_mod._upload_job_temp_dir()
    assert dest == (tmp_path / "upload_jobs").resolve()
    assert dest.is_dir()


def test_execute_upload_job_missing_temp_raises():
    from app.api.routes.upload_jobs import execute_upload_job

    with pytest.raises(RuntimeError, match="临时文件"):
        execute_upload_job(
            {
                "user_id": "u1",
                "temp_path": "/no/such/file",
                "filename": "x.png",
                "content_type": "image/png",
            }
        )


def test_execute_upload_job_pushes_to_storage(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from app.api.routes.upload_jobs import execute_upload_job

    temp = tmp_path / "job1"
    temp.write_bytes(b"hello")

    monkeypatch.setattr(
        "app.services.uploads.upload_user_files",
        lambda user_id, files: [
            {"url": "https://cdn.example/x.png", "key": f"uploads/{user_id}/x.png"}
        ],
    )

    out = execute_upload_job(
        {
            "user_id": "u1",
            "temp_path": str(temp),
            "filename": "x.png",
            "content_type": "image/png",
        }
    )
    assert out["item"]["url"] == "https://cdn.example/x.png"
    assert not temp.exists()
