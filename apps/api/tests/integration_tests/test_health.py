"""Integration: HTTP health / root endpoints."""

from __future__ import annotations

from unittest.mock import patch


def test_root_service_meta(client):
    res = client.get("/")
    assert res.status_code == 200
    body = res.json()
    assert body.get("service") == "recombyn-api"
    assert "docs" in body


def test_health_api_check_always_ok(client):
    with (
        patch("app.api.routes.health._check_redis", return_value=False),
        patch("app.api.routes.health._check_worker", return_value=False),
        patch("app.api.routes.health._check_ocr", return_value=False),
        patch("app.api.routes.health._check_db", return_value={"ok": True, "dialect": "mysql"}),
    ):
        res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["checks"]["api"] is True
    assert body["checks"]["redis"] is False
    assert body["checks"]["database"]["ok"] is True
