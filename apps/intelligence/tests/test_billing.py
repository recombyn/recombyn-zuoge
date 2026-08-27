"""Private billing HTTP smoke tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from recombyn_intelligence_service.app import app


def test_billing_quote_no_margin_leak():
    client = TestClient(app)
    res = client.post("/billing/quote", json={"mode": "agent"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("authorize_high") == 30
    assert body.get("credits_to_charge") >= 1
    assert "marginFactor" not in body
    assert "margin_factor" not in body
    assert "internal_cost_micros" not in body
    assert "sell_cost_micros" not in body


def test_billing_quote_byok():
    client = TestClient(app)
    res = client.post("/billing/quote", json={"mode": "agent", "byok": True})
    assert res.status_code == 200
    body = res.json()
    assert body.get("byok") is True
    assert body.get("credits_to_charge") == body.get("authorize_high")


def test_billing_plans_no_margin_leak():
    client = TestClient(app)
    res = client.get("/billing/plans")
    assert res.status_code == 200
    body = res.json()
    assert "marginFactor" not in body
    plans = body.get("plans") or []
    plus = next(p for p in plans if p.get("planId") == "plus")
    assert int(plus.get("priceCny") or 0) == 49
    assert int(plus.get("creditsIncluded") or 0) == 340


def test_billing_commercial_has_margin():
    client = TestClient(app)
    res = client.get("/billing/commercial")
    assert res.status_code == 200
    body = res.json()
    assert body.get("marginFactor")
    assert isinstance(body.get("planEntitlements"), list)
    assert any(p.get("plan_id") == "ultra" for p in body["planEntitlements"])


def test_billing_commercial_put():
    client = TestClient(app)
    res = client.put(
        "/billing/commercial",
        json={"marginFactor": 3.0, "creditPolicy": {"byok_agent_fee_credits": 7}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("marginFactor") == 3.0
    assert body["creditPolicy"].get("byok_agent_fee_credits") == 7


def test_billing_cost_admin():
    client = TestClient(app)
    res = client.post(
        "/billing/cost",
        json={"tokens_in": 1000, "tokens_out": 500, "image_count": 1, "agent_steps": 2},
    )
    assert res.status_code == 200
    body = res.json()
    assert int(body.get("internal_cost_micros") or 0) > 0
    assert body.get("meta", {}).get("engine") == "intelligence.cost.v1"


def test_billing_cost_with_pricing_rates():
    client = TestClient(app)
    res = client.post(
        "/billing/cost",
        json={
            "tokens_in": 1000,
            "tokens_out": 0,
            "rates": [
                {
                    "metric": "input_tokens",
                    "unit": "per_1k_tokens",
                    "amount_micros": 1000,
                }
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("meta", {}).get("rates_source") == "pricing_rates"
    assert int(body.get("components_micros", {}).get("llm.tokens_in") or 0) == 1000


def test_billing_auth_required_when_key_set(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_SERVICE_API_KEY", "secret-test")
    client = TestClient(app)
    res = client.get("/billing/commercial")
    assert res.status_code == 401
    res_ok = client.get(
        "/billing/commercial",
        headers={"Authorization": "Bearer secret-test"},
    )
    assert res_ok.status_code == 200
