"""Unit tests for async chat video/audio jobs (ADR 0005)."""

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


def test_create_video_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_video_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(
        "app.api.routes.chat._charge_video",
        lambda *_a, **_k: ("mock-video", 0),
    )
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_chat_video_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/chat/video/jobs",
            json={"prompt": "a clip", "model": "mock-video"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "video"
        assert saved["payload"]["prompt"] == "a clip"
        delay.assert_called_once()


def test_create_audio_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_audio_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(
        "app.api.routes.chat._charge_audio",
        lambda *_a, **_k: ("mock-tts", 0),
    )
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_chat_audio_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/chat/audio/jobs",
            json={"prompt": "hello", "model": "mock-tts"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "audio"
        delay.assert_called_once()


def test_get_video_job_ok(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.api.routes.chat_job_sse.get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "progress": 100,
            "user_id": "u1",
            "result": {"videos": ["https://cdn.example/a.mp4"], "model": "m"},
            "error": None,
            "trace_id": "t-1",
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/video/jobs/abc123")
        assert res.status_code == 200, res.text
        assert res.json()["result"]["videos"][0].endswith("a.mp4")


def test_get_audio_job_wrong_owner(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.api.routes.chat_job_sse.get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "user_id": "other",
            "result": {"audios": ["x"]},
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/audio/jobs/abc123")
        assert res.status_code == 404


def test_run_video_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "prompt": "clip",
            "model": "m",
            "trace_id": "t1",
            "credits_charged": 0,
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "video"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "video"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    async def _gen(*_a, **_k):
        return {"videos": ["https://cdn.example/c.mp4"], "model": "m"}

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.chat_video_jobs.execute_video_generate",
        _gen,
    )
    result = wt.run_chat_video_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["result"]["videos"][0].endswith("c.mp4")


def test_run_audio_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "prompt": "hi",
            "model": "m",
            "trace_id": "t1",
            "credits_charged": 0,
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "audio"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "audio"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    async def _gen(*_a, **_k):
        return {"audios": ["https://cdn.example/a.mp3"], "model": "m", "mime": "audio/mpeg"}

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.chat_audio_jobs.execute_audio_generate",
        _gen,
    )
    result = wt.run_chat_audio_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["result"]["audios"][0].endswith("a.mp3")
