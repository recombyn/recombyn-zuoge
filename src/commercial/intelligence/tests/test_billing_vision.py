"""Vision billing quote tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recombyn_intelligence_service.app import _production_guard, app


def test_billing_quote_vision_remove_bg():
    client = TestClient(app)
    res = client.post("/billing/quote", json={"mode": "removeBg"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("credits_to_charge") == 2
    assert body.get("authorize_high") == 2
    assert body.get("source") == "intelligence.vision"
    assert "marginFactor" not in body


def test_billing_quote_vision_edit_elements():
    client = TestClient(app)
    res = client.post("/billing/quote", json={"mode": "vision_editElements"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("credits_to_charge") == 4


def test_production_guard_requires_api_key(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_PRODUCTION", "1")
    monkeypatch.delenv("INTELLIGENCE_SERVICE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="INTELLIGENCE_PRODUCTION"):
        _production_guard()
