"""Unit tests for async chat lottie jobs (ADR 0005)."""

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


def test_create_lottie_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_animation_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_chat_lottie_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/chat/lottie/jobs",
            json={"prompt": "bounce", "width": 200, "height": 200, "duration_sec": 2},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "lottie"
        assert saved["payload"]["prompt"] == "bounce"
        delay.assert_called_once()


def test_get_lottie_job_ok(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_animation_jobs as route_mod

    anim = {"v": "5.5.2", "fr": 30, "w": 200, "h": 200, "layers": []}

    def _fake_get(job_id: str, *, kind: str = "import"):
        return {
            "job_id": job_id,
            "status": "done",
            "progress": 100,
            "user_id": "u1",
            "result": {"animationData": anim, "w": 200, "h": 200},
            "error": None,
            "trace_id": "t-1",
        }

    monkeypatch.setattr("app.api.routes.chat_job_sse.get_job", _fake_get)
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/lottie/jobs/abc123")
        assert res.status_code == 200, res.text
        assert res.json()["result"]["animationData"]["w"] == 200


def test_get_lottie_job_wrong_owner(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_animation_jobs as route_mod

    monkeypatch.setattr(
        "app.api.routes.chat_job_sse.get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "user_id": "other",
            "result": {"animationData": {"w": 1, "h": 1, "layers": []}},
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/lottie/jobs/abc123")
        assert res.status_code == 404


def test_run_lottie_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "prompt": "bounce",
            "width": 200,
            "height": 200,
            "duration_sec": 2,
            "trace_id": "t1",
            "credits_charged": 0,
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "lottie"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "lottie"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    anim = {"v": "5.5.2", "fr": 30, "w": 200, "h": 200, "layers": []}

    async def _gen(*_a, **_k):
        return {
            "animationData": anim,
            "w": 200,
            "h": 200,
            "asset": {"url": "https://cdn.example/a.json", "id": "asset_1"},
            "assets": [{"url": "https://cdn.example/a.json", "id": "asset_1"}],
        }

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.chat_animation_jobs.execute_lottie_generate",
        _gen,
    )
    result = wt.run_chat_lottie_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["result"]["animationData"]["w"] == 200
