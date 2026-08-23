"""Subagent spawn helpers — parse, catalog, background (mocked LLM)."""

from __future__ import annotations

import asyncio

import pytest

from app.services.design.runtime.agent_profile import (
    clear_agent_profile_cache,
    load_agent_profile,
)
from app.services.design.runtime.subagent import (
    SubAgentResult,
    clear_subagent_background_jobs,
    format_subagent_results,
    get_subagent_job,
    harvest_background_jobs,
    parse_need_subagents,
    spawn_subagent_background,
)


@pytest.fixture(autouse=True)
def _reset():
    clear_agent_profile_cache()
    clear_subagent_background_jobs()
    yield
    clear_subagent_background_jobs()
    clear_agent_profile_cache()


def test_parse_need_subagents_shapes():
    assert parse_need_subagents(None) == []
    assert parse_need_subagents("vision_scout")[0]["id"] == "vision_scout"
    jobs = parse_need_subagents(
        [
            "vision_scout",
            {"id": "review", "task": "check", "background": True},
            {"job_id": "abc123"},
        ]
    )
    assert jobs[0]["id"] == "vision_scout"
    assert jobs[1]["background"] is True and jobs[1]["task"] == "check"
    assert jobs[2]["job_id"] == "abc123" and not jobs[2]["id"]


def test_format_subagent_results():
    text = format_subagent_results(
        [
            SubAgentResult(
                agent_id="vision_scout",
                ok=True,
                summary="warm palette",
                payload={"palette": ["#f00"], "subjects": ["cup"]},
            )
        ]
    )
    assert "vision_scout" in text
    assert "warm palette" in text
    assert "#f00" in text


def test_resolve_auto_need_subagents_noop():
    from app.services.design.runtime.agent_profile import load_agent_profile
    from app.services.design.runtime.subagent import resolve_auto_need_subagents

    prof = load_agent_profile("design.canvas")
    with_img = resolve_auto_need_subagents(
        profile=prof,
        has_images=True,
        empty_canvas=True,
        intent="create",
        prompt_chars=20,
        already=[],
        existing=[],
    )
    assert with_img == []

    text_only = resolve_auto_need_subagents(
        profile=prof,
        has_images=False,
        empty_canvas=True,
        intent="create",
        prompt_chars=20,
        already=[],
        existing=[],
    )
    assert text_only == []

    kept = resolve_auto_need_subagents(
        profile=prof,
        has_images=True,
        empty_canvas=True,
        intent="create",
        prompt_chars=20,
        already=[],
        existing=[{"id": "review", "task": "x", "background": False}],
    )
    assert len(kept) == 1 and kept[0]["id"] == "review"


def test_background_spawn_and_harvest(monkeypatch):
    async def fake_run_subagent(**kwargs):
        await asyncio.sleep(0.01)
        return SubAgentResult(
            agent_id=str(kwargs.get("agent_id") or ""),
            ok=True,
            summary="bg-done",
            payload={"summary": "bg-done"},
        )

    monkeypatch.setattr(
        "app.services.design.runtime.subagent.run_subagent",
        fake_run_subagent,
    )

    async def _run() -> None:
        jid = spawn_subagent_background(
            agent_id="review",
            task="check",
            rules={"agent.review.model": "review-x"},
            profile=load_agent_profile("design.canvas"),
        )
        assert jid
        got: list[SubAgentResult] = []
        for _ in range(50):
            got = await harvest_background_jobs([jid])
            if got:
                break
            await asyncio.sleep(0.02)
        assert got and got[0].ok and got[0].summary == "bg-done"
        assert get_subagent_job(jid) is not None

    asyncio.run(_run())


def test_background_result_redis_roundtrip(monkeypatch):
    from app.services.design.runtime import subagent as sa

    store: dict[str, str] = {}

    class _FakeRedis:
        def setex(self, key, ttl, value):
            store[str(key)] = str(value)

        def get(self, key):
            return store.get(str(key))

    monkeypatch.setattr(sa, "_bg_redis", lambda: _FakeRedis())
    res = SubAgentResult(
        agent_id="review",
        ok=True,
        summary="ok",
        payload={"verdict": "pass"},
        job_id="jobdeadbeef",
    )
    sa._persist_bg_result("jobdeadbeef", res)
    clear_subagent_background_jobs()
    loaded = get_subagent_job("jobdeadbeef")
    assert loaded is not None
    assert loaded.ok and loaded.agent_id == "review"
    assert loaded.payload.get("verdict") == "pass"


def test_canvas_ops_graph_includes_review_node():
    from app.services.design.runtime.graph.build import (
        invalidate_agent_graph_cache,
        resolve_topology_graph,
    )

    invalidate_agent_graph_cache()
    g = resolve_topology_graph(load_agent_profile("design.canvas"))
    nodes = set(getattr(g, "nodes", {}) or {})
    assert "review" in nodes
    assert "observe" in nodes
    assert "design_agent" in nodes
    invalidate_agent_graph_cache()
