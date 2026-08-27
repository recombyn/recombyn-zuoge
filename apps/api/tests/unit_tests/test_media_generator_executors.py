"""Executor-level tests for audio / video / lottie generator jobs."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import MagicMock

import pytest


def test_execute_audio_generate_persists_asset(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes.chat_audio_jobs import execute_audio_generate

    async def _gen(**_kwargs):
        return {
            "bytes": b"ID3mock",
            "mime": "audio/mpeg",
            "model": "or-gemini-3-1-flash-tts",
            "voice": "Zephyr",
        }

    monkeypatch.setattr("app.services.llm.audio.generate_audio", _gen)
    monkeypatch.setattr("app.services.llm.set_byok_user_id", lambda _uid: MagicMock())
    monkeypatch.setattr("app.services.llm.reset_byok_user_id", lambda _t: None)
    monkeypatch.setattr(
        "app.services.llm.usage_log.usage_context",
        lambda **_k: MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None),
    )
    monkeypatch.setattr(
        "app.services.assets.create_asset_from_bytes",
        lambda *_a, **_k: {"url": "https://cdn.example/a.mp3", "id": "asset_a"},
    )

    out = asyncio.run(
        execute_audio_generate("u1", prompt="hello", model_id="or-gemini-3-1-flash-tts")
    )
    assert out["audios"] == ["https://cdn.example/a.mp3"]
    assert "bytes" not in out


def test_execute_video_generate_rehosts_urls(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes.chat_video_jobs import execute_video_generate

    async def _gen(**_kwargs):
        return {"videos": ["https://openrouter.example/v.mp4"], "model": "mock-video"}

    monkeypatch.setattr("app.services.llm.video.generate_video", _gen)
    monkeypatch.setattr("app.services.llm.set_byok_user_id", lambda _uid: MagicMock())
    monkeypatch.setattr("app.services.llm.reset_byok_user_id", lambda _t: None)
    monkeypatch.setattr(
        "app.services.llm.usage_log.usage_context",
        lambda **_k: MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None),
    )
    monkeypatch.setattr(
        "app.services.assets.create_asset_from_url",
        lambda *_a, **_k: {"url": "https://cdn.example/v.mp4", "id": "asset_v"},
    )

    out = asyncio.run(
        execute_video_generate("u1", prompt="clip", model_id="mock-video")
    )
    assert out["videos"] == ["https://cdn.example/v.mp4"]


def test_execute_lottie_generate_persists_json(monkeypatch: pytest.MonkeyPatch):
    from app.api.routes.chat_lottie_jobs import execute_lottie_generate

    anim = {"v": "5.5.2", "fr": 30, "w": 128, "h": 128, "layers": []}

    async def _gen(**_kwargs):
        return anim

    monkeypatch.setattr(
        "app.services.design.ops.lottie_hydrate.generate_lottie_animation",
        _gen,
    )
    monkeypatch.setattr(
        "app.services.assets.create_asset_from_bytes",
        lambda *_a, **_k: {"url": "https://cdn.example/l.json", "id": "asset_l"},
    )

    out = asyncio.run(
        execute_lottie_generate(
            "u1",
            prompt="bounce",
            width=128,
            height=128,
            duration_sec=2,
        )
    )
    assert out["animationData"]["w"] == 128
    assert out["asset"]["url"] == "https://cdn.example/l.json"
    raw = json.dumps(anim, separators=(",", ":")).encode("utf-8")
    assert len(raw) > 0
