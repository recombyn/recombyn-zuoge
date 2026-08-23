"""Unit tests for mockup BFF routing."""

from __future__ import annotations


def test_mockup_enabled_follows_intelligence(monkeypatch):
    from app.services.mockup.mockup_client import mockup_enabled

    monkeypatch.setattr("app.services.mockup.mockup_client.ilp_enabled", lambda: False)
    assert mockup_enabled() is False
    monkeypatch.setattr("app.services.mockup.mockup_client.ilp_enabled", lambda: True)
    assert mockup_enabled() is True
