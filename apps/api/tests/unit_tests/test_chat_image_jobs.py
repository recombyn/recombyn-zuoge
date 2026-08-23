"""Unit tests for async chat image-generation jobs (ADR 0005)."""

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


def test_create_image_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_image_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(
        "app.api.routes.chat._charge_image",
        lambda *_a, **_k: ("mock-model", 0),
    )
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_chat_image_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/chat/image/jobs",
            json={"prompt": "a cat", "model": "mock-model"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "image"
        assert saved["payload"]["prompt"] == "a cat"
        assert saved["payload"]["user_id"] == "u1"
        delay.assert_called_once()


def test_create_image_job_empty_prompt(monkeypatch: pytest.MonkeyPatch):
    with _auth_client(monkeypatch) as client:
        res = client.post("/api/v1/chat/image/jobs", json={"prompt": "   "})
        assert res.status_code == 422 or res.status_code == 400


def test_create_image_job_queue_unavailable(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_image_jobs as route_mod

    monkeypatch.setattr(
        "app.api.routes.chat._charge_image",
        lambda *_a, **_k: ("mock-model", 0),
    )

    def _boom(*_a, **_k):
        raise RuntimeError("redis down")

    monkeypatch.setattr(route_mod, "save_job", _boom)
    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/chat/image/jobs",
            json={"prompt": "a cat"},
        )
        assert res.status_code == 503


def test_get_image_job_ok(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_image_jobs as route_mod

    monkeypatch.setattr(
        route_mod,
        "get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "progress": 100,
            "user_id": "u1",
            "result": {"images": ["https://cdn.example/a.png"], "model": "m"},
            "error": None,
            "trace_id": "t-1",
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/image/jobs/abc123")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "done"
        assert body["result"]["images"][0].endswith("a.png")


def test_get_image_job_wrong_owner(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import chat_image_jobs as route_mod

    monkeypatch.setattr(
        route_mod,
        "get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "user_id": "other",
            "result": {"images": ["x"]},
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/chat/image/jobs/abc123")
        assert res.status_code == 404


def test_run_image_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "prompt": "cat",
            "model": "m",
            "trace_id": "t1",
            "credits_charged": 0,
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "image"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "image"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    async def _gen(*_a, **_k):
        return {"images": ["https://cdn.example/c.png"], "model": "m"}

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.chat_image_jobs.execute_image_generate",
        _gen,
    )
    result = wt.run_chat_image_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["status"] == "done"
    assert store["j1"]["result"]["images"][0].endswith("c.png")


def test_run_image_job_failure(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "prompt": "cat",
            "trace_id": "t1",
        }
    }

    monkeypatch.setattr(
        wt,
        "get_job",
        lambda job_id, *, kind="import": store.get(job_id),
    )

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    async def _boom(*_a, **_k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.chat_image_jobs.execute_image_generate",
        _boom,
    )
    result = wt.run_chat_image_job.run("j1")
    assert result["status"] == "failed"
    assert store["j1"]["status"] == "failed"
    assert "provider down" in str(store["j1"].get("error") or "")
