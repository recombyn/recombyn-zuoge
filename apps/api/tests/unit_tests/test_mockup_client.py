"""Unit tests for mockup BFF routing."""

from __future__ import annotations

import asyncio


def test_mockup_enabled_follows_intelligence(monkeypatch):
    from app.services.mockup.mockup_client import mockup_enabled

    monkeypatch.setattr("app.services.mockup.mockup_client.ilp_enabled", lambda: False)
    assert mockup_enabled() is False
    monkeypatch.setattr("app.services.mockup.mockup_client.ilp_enabled", lambda: True)
    assert mockup_enabled() is True


def test_auto_bake_proxies_intelligence(monkeypatch):
    from app.services.mockup import mockup_client as mod

    class _Resp:
        status_code = 200
        text = ""

        def json(self):
            return {
                "uvBase64": "AAAA",
                "base": "data:image/png;base64,xx",
                "mask": "data:image/png;base64,yy",
                "width": 10,
                "height": 10,
            }

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            assert url.endswith("/api/v1/mockup/auto-bake")
            assert isinstance(json, dict) and "image" in json
            return _Resp()

    async def _load(_ref):
        return b"\x89PNG\r\n\x1a\n" + b"\x00" * 20, "a.png"

    monkeypatch.setattr(mod, "_base_url", lambda: "http://intel.test")
    monkeypatch.setattr(mod, "_headers", lambda: {})
    monkeypatch.setattr(mod, "_load_bytes", _load)
    monkeypatch.setattr(mod.httpx, "AsyncClient", _Client)

    out = asyncio.run(mod.auto_bake_mockup_via_intelligence("data:image/png;base64,aaa", scale=0.5))
    assert out["uvBase64"] == "AAAA"
