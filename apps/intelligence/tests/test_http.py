"""HTTP surface smoke tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from recombyn_intelligence_service.app import app


def test_health():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("service") == "recombyn-intelligence"
    assert body.get("status") in {"ok", "degraded"}
    assert "models" in body.get("vision", {})
    assert "sam" in body["vision"]["models"]


def test_research_via_http():
    client = TestClient(app)
    res = client.post(
        "/v1/research",
        json={"prompt": "SaaS landing premium", "scene_key": "landing", "flags": {}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("provider") == "private-research"
    assert body.get("category")


def test_govern_via_http():
    client = TestClient(app)
    res = client.post("/v1/govern", json={"prompt": "x", "flags": {}, "apply_ops": []})
    assert res.status_code == 200
    assert res.json().get("provider") == "private-governance"
