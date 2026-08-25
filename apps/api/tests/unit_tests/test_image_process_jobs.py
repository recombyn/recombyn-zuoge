"""Unit tests for async image toolbar jobs."""

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


def test_create_image_process_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import image_process_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_image_process_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/image/process/jobs",
            json={"kind": "removeBg", "image": "data:image/png;base64,abc"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "image_process"
        assert saved["payload"]["tool_kind"] == "removeBg"
        assert saved["payload"]["user_id"] == "u1"
        delay.assert_called_once()


def test_get_image_process_job_ok(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import image_process_jobs as route_mod

    monkeypatch.setattr(
        route_mod,
        "get_job",
        lambda job_id, *, kind="import": {
            "job_id": job_id,
            "status": "done",
            "progress": 100,
            "user_id": "u1",
            "result": {"image": "https://cdn.example/a.png", "kind": "removeBg"},
            "error": None,
            "trace_id": "t-1",
        },
    )
    with _auth_client(monkeypatch) as client:
        res = client.get("/api/v1/image/process/jobs/abc123")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "done"
        assert body["result"]["image"].endswith("a.png")


def test_run_image_process_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "tool_kind": "removeBg",
            "image": "data:image/png;base64,abc",
            "trace_id": "t1",
            "credits_charged": 0,
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "image_process"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "image_process"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    async def _run(_job: dict) -> dict:
        return {"image": "https://cdn.example/cutout.png", "kind": "removeBg", "credits": 0}

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.api.routes.image_process_jobs.execute_image_process",
        _run,
    )
    result = wt.run_image_process_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["status"] == "done"
    assert store["j1"]["result"]["image"].endswith("cutout.png")
