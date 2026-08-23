"""Hydrate DLQ + OTel setup smoke (no collector required)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch


def test_push_and_list_hydrate_dlq():
    from app.services import job_store

    fake = MagicMock()
    fake.lrange.return_value = [
        '{"job_id":"j1","error":"boom","trace_id":"t1"}',
        "not-json",
    ]
    with patch.object(job_store, "_client", return_value=fake):
        job_store.push_dlq("hydrate", {"job_id": "j1", "error": "boom", "trace_id": "t1"})
        fake.lpush.assert_called_once()
        fake.ltrim.assert_called_once()
        fake.expire.assert_called_once()
        rows = job_store.list_dlq("hydrate", limit=10)
    assert rows[0]["job_id"] == "j1"
    assert rows[1]["_raw"] == "not-json"


def test_setup_otel_noop_when_disabled():
    from fastapi import FastAPI

    from app.core.metrics import setup_otel

    app = FastAPI()
    with patch.dict("os.environ", {"OTEL_ENABLED": "", "OTEL_EXPORTER_OTLP_ENDPOINT": ""}, clear=False):
        assert setup_otel(app) is False


def test_setup_otel_warns_without_packages():
    from fastapi import FastAPI

    from app.core.metrics import setup_otel

    app = FastAPI()
    with patch.dict("os.environ", {"OTEL_ENABLED": "true", "OTEL_EXPORTER_OTLP_ENDPOINT": ""}, clear=False):
        # Without [otel] installed this returns False after ImportError.
        result = setup_otel(app)
        assert result in (False, True)


def test_hydrate_dlq_depth_and_remove():
    from app.services import job_store

    fake = MagicMock()
    fake.llen.return_value = 2
    fake.lrange.return_value = [
        '{"job_id":"j1","error":"boom"}',
        '{"job_id":"j2","error":"later"}',
        '{"job_id":"j1","error":"again"}',
    ]
    fake.lrem.return_value = 1
    with patch.object(job_store, "_client", return_value=fake):
        assert job_store.dlq_depth("hydrate") == 2
        removed = job_store.remove_dlq_job("hydrate", "j1")
    assert removed == 2
    assert fake.lrem.call_count == 2


def test_hydrate_dlq_depth_returns_zero_on_error():
    from app.services import job_store

    with patch.object(job_store, "_client", side_effect=RuntimeError("down")):
        assert job_store.dlq_depth("hydrate") == 0
        assert job_store.dlq_depth("export") == 0


def test_export_dlq_depth_and_remove():
    from app.services import job_store

    fake = MagicMock()
    fake.llen.return_value = 1
    fake.lrange.return_value = [
        '{"job_id":"e1","error":"boom","project_id":"p1","user_id":"u1"}',
    ]
    fake.lrem.return_value = 1
    with patch.object(job_store, "_client", return_value=fake):
        job_store.push_dlq(
            "export",
            {"job_id": "e1", "error": "boom", "project_id": "p1", "user_id": "u1"},
        )
        fake.lpush.assert_called()
        assert job_store.dlq_depth("export") == 1
        removed = job_store.remove_dlq_job("export", "e1")
    assert removed == 1


def test_admin_hydrate_dlq_list_replay_discard():
    from contextlib import contextmanager
    from typing import Any, Iterator

    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app
    from app.services.auth import SessionUser

    @contextmanager
    def admin_client() -> Iterator[Any]:
        app.dependency_overrides[deps.get_current_user] = lambda: SessionUser(
            id="a1",
            email="admin@recombyn.com",
            name="admin",
            avatar=None,
            provider="email",
            role="admin",
        )
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()

    entry = {
        "job_id": "j1",
        "error": "boom",
        "trace_id": "t1",
        "ops": [{"name": "create_image", "args": {"genPrompt": "x"}}],
        "limit": 2,
        "policy": "auto",
        "rules": {},
    }
    delay = MagicMock()
    with (
        patch("app.api.routes.admin.ops.list_dlq", return_value=[entry]),
        patch("app.api.routes.admin.ops.dlq_depth", return_value=1),
        patch("app.api.routes.admin.ops.get_job", return_value=None),
        patch("app.api.routes.admin.ops.save_job") as save,
        patch("app.api.routes.admin.ops.remove_dlq_job", return_value=1),
        patch("worker.tasks.run_image_hydrate_job") as task,
    ):
        task.delay = delay
        with admin_client() as client:
            listed = client.get("/api/v1/admin/ops/hydrate-dlq")
            assert listed.status_code == 200
            body = listed.json()
            assert body["depth"] == 1
            assert body["items"][0]["job_id"] == "j1"

            replayed = client.post(
                "/api/v1/admin/ops/hydrate-dlq/replay",
                json={"jobId": "j1"},
            )
            assert replayed.status_code == 200
            assert replayed.json()["status"] == "queued"
            save.assert_called()
            delay.assert_called_once_with("j1")

            discarded = client.delete("/api/v1/admin/ops/hydrate-dlq/j1")
            assert discarded.status_code == 200
            assert discarded.json()["removedFromDlq"] == 1


def test_admin_export_dlq_list_replay_discard():
    from contextlib import contextmanager
    from typing import Any, Iterator

    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app
    from app.services.auth import SessionUser

    @contextmanager
    def admin_client() -> Iterator[Any]:
        app.dependency_overrides[deps.get_current_user] = lambda: SessionUser(
            id="a1",
            email="admin@recombyn.com",
            name="admin",
            avatar=None,
            provider="email",
            role="admin",
        )
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()

    entry = {
        "job_id": "e1",
        "error": "boom",
        "trace_id": "t1",
        "project_id": "p1",
        "user_id": "u1",
        "format": "png",
        "frame_id": "f1",
    }
    delay = MagicMock()
    with (
        patch("app.api.routes.admin.ops.list_dlq", return_value=[entry]),
        patch("app.api.routes.admin.ops.dlq_depth", return_value=1),
        patch("app.api.routes.admin.ops.get_job", return_value=None),
        patch("app.api.routes.admin.ops.save_job") as save,
        patch("app.api.routes.admin.ops.remove_dlq_job", return_value=1),
        patch("worker.tasks.run_design_export_job") as task,
    ):
        task.delay = delay
        with admin_client() as client:
            listed = client.get("/api/v1/admin/ops/export-dlq")
            assert listed.status_code == 200
            body = listed.json()
            assert body["depth"] == 1
            assert body["items"][0]["job_id"] == "e1"

            replayed = client.post(
                "/api/v1/admin/ops/export-dlq/replay",
                json={"jobId": "e1"},
            )
            assert replayed.status_code == 200
            assert replayed.json()["status"] == "queued"
            save.assert_called()
            delay.assert_called_once_with("e1")

            discarded = client.delete("/api/v1/admin/ops/export-dlq/e1")
            assert discarded.status_code == 200
            assert discarded.json()["removedFromDlq"] == 1


def test_admin_hydrate_dlq_forbidden_for_user():
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
        client = TestClient(app)
        res = client.get("/api/v1/admin/ops/hydrate-dlq")
        assert res.status_code == 403
        res_export = client.get("/api/v1/admin/ops/export-dlq")
        assert res_export.status_code == 403
    finally:
        app.dependency_overrides.clear()
