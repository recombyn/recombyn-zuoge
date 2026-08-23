"""Unit tests for async design export jobs (ADR 0005)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator
from unittest.mock import MagicMock

import pytest


def _sample_document() -> dict[str, Any]:
    return {
        "width": 200,
        "height": 100,
        "backgroundColor": "#ffffff",
        "frames": [
            {
                "id": "f1",
                "name": "Board",
                "x": 0,
                "y": 0,
                "width": 200,
                "height": 100,
                "backgroundColor": "#ffffff",
            }
        ],
        "activeFrameId": "f1",
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "children": ["r1"]},
            "r1": {
                "id": "r1",
                "key": "rect",
                "x": 10,
                "y": 10,
                "width": 40,
                "height": 20,
                "attrs": {"fill": "#ff0000"},
            },
        },
    }


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


def test_render_artboard_png_magic():
    from app.services.design.export_render import render_artboard_png

    png = render_artboard_png(_sample_document(), _sample_document()["frames"][0])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_artboard_png_draws_text():
    import json
    from io import BytesIO

    from PIL import Image

    from app.services.design.export_render import render_artboard_png

    chars = [
        {
            "char": c,
            "config": {
                "SIZE": 28,
                "COLOR": "#000000",
                "WEIGHT": "bold",
                "ALIGN": "left",
                "LINE_HEIGHT": 1.2,
            },
        }
        for c in "Hello"
    ]
    doc: dict[str, Any] = {
        "width": 200,
        "height": 100,
        "backgroundColor": "#ffffff",
        "frames": [
            {
                "id": "f1",
                "name": "Board",
                "x": 0,
                "y": 0,
                "width": 200,
                "height": 100,
                "backgroundColor": "#ffffff",
            }
        ],
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "children": ["t1"]},
            "t1": {
                "id": "t1",
                "key": "text",
                "x": 8,
                "y": 20,
                "z": 1,
                "width": 180,
                "height": 48,
                "attrs": {
                    "markdown": "Hello",
                    "DATA": json.dumps([{"chars": chars}], ensure_ascii=False),
                    "ORIGIN_DATA": json.dumps(
                        [
                            {
                                "children": [
                                    {
                                        "text": "Hello",
                                        "font-base": {"fontSize": 28, "color": "#000000"},
                                    }
                                ]
                            }
                        ],
                        ensure_ascii=False,
                    ),
                },
            },
        },
    }
    png = render_artboard_png(doc, doc["frames"][0])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    im = Image.open(BytesIO(png)).convert("RGB")
    raw = im.tobytes()
    dark = 0
    for i in range(0, len(raw), 3):
        if raw[i] < 80 and raw[i + 1] < 80 and raw[i + 2] < 80:
            dark += 1
    assert dark > 20


def test_render_and_store_rejects_non_png(monkeypatch: pytest.MonkeyPatch):
    from app.services.design import export_render as er

    monkeypatch.setattr(er, "put_bytes", lambda *_a, **_k: None)
    monkeypatch.setattr(er, "get_storage", lambda: MagicMock())
    with pytest.raises(ValueError, match="png"):
        er.render_and_store_export(
            document=_sample_document(),
            user_id="u1",
            job_id="j1",
            fmt="svg",
        )


def test_create_export_job_enqueues(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import design_export_jobs as route_mod

    saved: dict[str, Any] = {}

    def _save(job_id: str, payload: dict[str, Any], *, kind: str = "import"):
        saved["kind"] = kind
        saved["payload"] = payload

    delay = MagicMock()
    monkeypatch.setattr(
        route_mod,
        "get_project",
        lambda *_a, **_k: {"id": "p1", "document": _sample_document()},
    )
    monkeypatch.setattr(route_mod, "save_job", _save)
    monkeypatch.setattr(route_mod.run_design_export_job, "delay", delay)

    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/design/export/jobs",
            json={"projectId": "p1", "format": "png"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert saved["kind"] == "export"
        assert saved["payload"]["project_id"] == "p1"
        delay.assert_called_once()


def test_create_export_job_missing_project(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes import design_export_jobs as route_mod

    monkeypatch.setattr(route_mod, "get_project", lambda *_a, **_k: None)
    with _auth_client(monkeypatch) as client:
        res = client.post(
            "/api/v1/design/export/jobs",
            json={"projectId": "missing", "format": "png"},
        )
        assert res.status_code == 404


def test_run_export_job_persists(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "project_id": "p1",
            "format": "png",
            "trace_id": "t1",
        }
    }

    def _get(job_id: str, *, kind: str = "import"):
        assert kind == "export"
        return store.get(job_id)

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        assert kind == "export"
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    monkeypatch.setattr(wt, "get_job", _get)
    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.services.projects.get_project",
        lambda *_a, **_k: {"id": "p1", "document": _sample_document()},
    )
    monkeypatch.setattr(
        "app.services.design.export_render.render_and_store_export",
        lambda **_k: {"key": "k", "url": "u", "pages": 1, "format": "png", "bytes": 12},
    )
    result = wt.run_design_export_job.run("j1")
    assert result["status"] == "done"
    assert store["j1"]["status"] == "done"


def test_run_export_job_dlq(monkeypatch: pytest.MonkeyPatch):
    from worker import tasks as wt

    store: dict[str, dict[str, Any]] = {
        "j1": {
            "job_id": "j1",
            "user_id": "u1",
            "project_id": "p1",
            "format": "png",
            "trace_id": "t1",
        }
    }
    dlq: list[dict[str, Any]] = []

    monkeypatch.setattr(
        wt,
        "get_job",
        lambda job_id, *, kind="import": store.get(job_id),
    )

    def _update(job_id: str, *, kind: str = "import", **fields: Any):
        cur = store.setdefault(job_id, {"job_id": job_id})
        cur.update(fields)
        return cur

    monkeypatch.setattr(wt, "update_job", _update)
    monkeypatch.setattr(
        "app.services.projects.get_project",
        lambda *_a, **_k: {"id": "p1", "document": _sample_document()},
    )

    def _boom(**_k):
        raise RuntimeError("render failed")

    monkeypatch.setattr(
        "app.services.design.export_render.render_and_store_export",
        _boom,
    )
    monkeypatch.setattr(
        "app.services.job_store.push_dlq",
            lambda kind, entry: dlq.append(dict(entry)),
    )
    result = wt.run_design_export_job.run("j1")
    assert result.get("dlq") is True
    assert dlq and dlq[0]["job_id"] == "j1"
