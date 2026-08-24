"""Unit tests for media job SSE helpers."""

from __future__ import annotations

import asyncio
import json

import pytest


def test_stream_media_job_events_emits_terminal_done(monkeypatch: pytest.MonkeyPatch):
    from app.services import job_events as mod

    states = [
        {"status": "queued", "progress": 0, "result": None, "error": None},
        {"status": "processing", "progress": 35, "result": None, "error": None},
        {
            "status": "done",
            "progress": 100,
            "result": {"images": ["https://x/a.png"]},
            "error": None,
        },
    ]
    calls = {"n": 0}

    def _get_job(job_id: str, *, kind: str = "import"):
        assert job_id == "j1"
        assert kind == "image"
        idx = min(calls["n"], len(states) - 1)
        calls["n"] += 1
        return {"job_id": job_id, **states[idx]}

    monkeypatch.setattr(mod, "get_job", _get_job)

    async def _noop_sleep(*_a, **_k):
        return None

    monkeypatch.setattr(mod.asyncio, "sleep", _noop_sleep)

    async def _collect() -> list[str]:
        return [f async for f in mod.stream_media_job_events("j1", kind="image", poll_interval=0)]

    frames = asyncio.run(_collect())
    assert len(frames) == 3
    assert frames[0].startswith("event: job\n")
    last = json.loads(frames[-1].split("data: ", 1)[1].strip())
    assert last["status"] == "done"
    assert last["result"]["images"] == ["https://x/a.png"]


def test_stream_media_job_events_not_found(monkeypatch: pytest.MonkeyPatch):
    from app.services import job_events as mod

    monkeypatch.setattr(mod, "get_job", lambda *_a, **_k: None)

    async def _collect() -> list[str]:
        return [f async for f in mod.stream_media_job_events("missing", kind="image")]

    frames = asyncio.run(_collect())
    assert len(frames) == 1
    assert "event: error" in frames[0]
