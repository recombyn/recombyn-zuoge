"""Seedream / WaveSpeed image refs must not send localhost to remote APIs."""

from __future__ import annotations

import asyncio
import base64

import pytest


def test_seedream_public_url_passed_through():
    from app.services.vision.providers.seedream import _ensure_image_ref

    out = asyncio.run(
        _ensure_image_ref("https://cdn.example.com/a.png", user_id="u1")
    )
    assert out == "https://cdn.example.com/a.png"


def test_seedream_rewrites_localhost_to_vision_public_base(monkeypatch):
    from app.services.vision.providers import seedream as mod

    monkeypatch.setattr(
        "app.core.config.settings.s3_public_base_url",
        "http://localhost:9000/recombyn",
    )
    monkeypatch.setattr(
        "app.core.config.settings.vision_public_base_url",
        "https://files.recombyn.com/recombyn",
    )
    out = asyncio.run(
        mod._ensure_image_ref(
            "http://localhost:9000/recombyn/uploads/user/a.png",
            user_id="u1",
        )
    )
    assert out == "https://files.recombyn.com/recombyn/uploads/user/a.png"


def test_seedream_localhost_inlined_when_no_public_base(monkeypatch):
    from app.services.vision.providers import seedream as mod
    from app.services.vision import rehost as rehost_mod

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    async def fake_download(_url: str) -> bytes:
        return png

    monkeypatch.setattr(
        "app.core.config.settings.s3_public_base_url",
        "http://localhost:9000/recombyn",
    )
    monkeypatch.setattr("app.core.config.settings.vision_public_base_url", "")
    monkeypatch.setattr(rehost_mod, "_download_image_bytes", fake_download)
    out = asyncio.run(
        mod._ensure_image_ref(
            "http://localhost:9000/recombyn/uploads/x.png",
            user_id="u1",
        )
    )
    assert out.startswith("data:image/png;base64,")
    assert base64.b64decode(out.split(",", 1)[1]) == png


def test_llm_refs_inline_localhost_like_seedream(monkeypatch):
    from app.services.vision import rehost as rehost_mod

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    async def fake_download(_url: str) -> bytes:
        return png

    monkeypatch.setattr(
        "app.core.config.settings.s3_public_base_url",
        "http://localhost:9000/recombyn",
    )
    monkeypatch.setattr("app.core.config.settings.vision_public_base_url", "")
    monkeypatch.setattr(rehost_mod, "_download_image_bytes", fake_download)
    out = asyncio.run(
        rehost_mod.ensure_remote_fetchable_image_refs(
            ["http://localhost:9000/recombyn/uploads/x.png"]
        )
    )
    assert len(out) == 1
    assert out[0].startswith("data:image/png;base64,")


def test_wavespeed_localhost_inlined_when_rehost_still_private(monkeypatch):
    from app.services.vision.providers import wavespeed as mod

    png = b"\x89PNG\r\n\x1a\n" + b"x" * 16

    async def fake_load(_ref: str) -> tuple[bytes, str]:
        return png, "image/png"

    monkeypatch.setattr(mod, "_load_image_bytes", fake_load)
    monkeypatch.setattr(
        mod,
        "rehost_image_bytes",
        lambda *_a, **_k: "http://127.0.0.1:9000/bucket/x.png",
    )
    out = asyncio.run(
        mod.ensure_public_image_url(
            "http://localhost:9000/recombyn/uploads/x.png",
            user_id="u1",
        )
    )
    assert out.startswith("data:image/png;base64,")


def test_wavespeed_keeps_public_http():
    from app.services.vision.providers.wavespeed import ensure_public_image_url

    out = asyncio.run(
        ensure_public_image_url("https://cdn.example.com/a.png", user_id="u1")
    )
    assert out == "https://cdn.example.com/a.png"
