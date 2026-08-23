# -*- coding: utf-8 -*-
"""Paint timeout abandon + metrics resilience counters."""
from __future__ import annotations

import asyncio
import time

from app.services.design.admin.admin_store import _accumulate_resilience
from app.services.design.runtime.graph.nodes.paint import _await_or_abandon


def test_await_or_abandon_returns_result():
    async def _ok():
        await asyncio.sleep(0.01)
        return {"ok": True}

    out = asyncio.run(_await_or_abandon(_ok(), timeout_sec=2.0, label="paint_test"))
    assert out == {"ok": True}


def test_await_or_abandon_times_out_without_waiting_cleanup():
    async def _hang():
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            # Mimic stubborn stream cleanup that ignores cancel for a bit.
            await asyncio.sleep(5)
            raise

    async def _run():
        t0 = time.monotonic()
        try:
            await _await_or_abandon(_hang(), timeout_sec=0.15, label="paint_ops:t:a0")
            raise AssertionError("expected TimeoutError")
        except TimeoutError as err:
            assert "timed out" in str(err)
        elapsed = time.monotonic() - t0
        # Must abandon promptly — not wait for the 5s cleanup.
        assert elapsed < 1.5

    asyncio.run(_run())


def test_accumulate_resilience_paint_timeout_and_retries():
    bag = {
        "paintTimeouts": 0,
        "retriesExhausted": 0,
        "reflectRounds": 0,
        "sceneTimeouts": 0,
        "opApplyFails": 0,
        "tasksWithResilienceSignal": 0,
    }
    _accumulate_resilience(
        bag,
        {
            "errors": [
                "paint_ops_llm_failed: paint_ops:t:a0 timed out after 75s",
                "paint_ops: retries_exhausted",
            ],
            "path": ["decide", "paint_ops", "paint_ops", "paint_ops"],
            "steps": [],
        },
    )
    assert bag["paintTimeouts"] == 1
    assert bag["retriesExhausted"] == 1
    assert bag["tasksWithResilienceSignal"] == 1


def test_accumulate_resilience_observe_signals():
    bag = {
        "paintTimeouts": 0,
        "retriesExhausted": 0,
        "reflectRounds": 0,
        "sceneTimeouts": 0,
        "opApplyFails": 0,
        "tasksWithResilienceSignal": 0,
    }
    _accumulate_resilience(
        bag,
        {
            "errors": [
                "scene_feedback_timeout: FE did not post scene; assume ops applied",
                "op_apply_failed: create_text missing",
            ],
            "path": ["observe", "reflect", "paint_ops"],
            "steps": [{"phase": "reflect", "reason": "op_apply_failed"}],
        },
    )
    assert bag["sceneTimeouts"] == 1
    assert bag["opApplyFails"] == 1
    assert bag["reflectRounds"] == 1
    assert bag["tasksWithResilienceSignal"] == 1


def test_accumulate_resilience_quiet_task():
    bag = {
        "paintTimeouts": 0,
        "retriesExhausted": 0,
        "reflectRounds": 0,
        "sceneTimeouts": 0,
        "opApplyFails": 0,
        "tasksWithResilienceSignal": 0,
    }
    _accumulate_resilience(
        bag,
        {"errors": [], "path": ["decide", "paint_ops", "observe"], "steps": []},
    )
    assert bag["tasksWithResilienceSignal"] == 0
