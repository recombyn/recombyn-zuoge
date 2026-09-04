"""Free-plan lifetime vision toolbar quota (3 uses)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException


def test_require_free_vision_allows_when_cost_positive(monkeypatch):
    from app.api.routes import image_tools as mod

    monkeypatch.setattr(mod, "is_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr(mod, "get_user_plan", lambda _uid: "free")
    called = {"n": 0}

    def _consume(_uid: str) -> bool:
        called["n"] += 1
        return True

    monkeypatch.setattr(mod, "consume_free_vision_quota", _consume)
    mod._require_free_vision_quota("u1", cost=30, locale="en")
    assert called["n"] == 0


def test_require_free_vision_skips_paid_plan(monkeypatch):
    from app.api.routes import image_tools as mod

    monkeypatch.setattr(mod, "is_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr(mod, "get_user_plan", lambda _uid: "pro")
    called = {"n": 0}

    def _consume(_uid: str) -> bool:
        called["n"] += 1
        return True

    monkeypatch.setattr(mod, "consume_free_vision_quota", _consume)
    mod._require_free_vision_quota("u1", cost=0, locale="en")
    assert called["n"] == 0


def test_require_free_vision_exhausted_raises_402(monkeypatch):
    from app.api.routes import image_tools as mod

    monkeypatch.setattr(mod, "is_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr(mod, "get_user_plan", lambda _uid: "free")
    monkeypatch.setattr(mod, "consume_free_vision_quota", lambda _uid: False)

    with pytest.raises(HTTPException) as ei:
        mod._require_free_vision_quota("u1", cost=0, locale="zh-CN")
    assert ei.value.status_code == 402
    detail = ei.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "free_vision_exhausted"
    assert "3" in str(detail.get("message") or "")


def test_require_free_vision_consumes_when_available(monkeypatch):
    from app.api.routes import image_tools as mod

    monkeypatch.setattr(mod, "is_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr(mod, "get_user_plan", lambda _uid: "free")
    monkeypatch.setattr(mod, "consume_free_vision_quota", lambda _uid: True)
    mod._require_free_vision_quota("u1", cost=0, locale="en")
