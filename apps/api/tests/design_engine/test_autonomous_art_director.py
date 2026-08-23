"""P42 — Autonomous Art Director: goal-only OS orchestration; never paints."""
from __future__ import annotations

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.autonomous import (
    apply_autonomous_to_runtime,
    build_autonomous_plan,
    classify_autonomous_mode,
    format_autonomous_for_decide,
    is_goal_only_prompt,
    sync_autonomous_hops,
)
from app.services.design.runtime.graph.state import (
    AUTONOMOUS_HOPS,
    AgentRunState,
    AgentRuntime,
)


def _rt(*, prompt: str, intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_ad", goal=prompt[:80])
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt=prompt,
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="landing",
        scene_nodes=[],
        scene_frames=[],
        focus_id="",
        images=[],
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=1080,
        h=1920,
        run=run,
        decision=DesignRunDecision(),
        flags={},
        classified_intent=intent,
    )


_SPEC_GOAL = "我要一个能让产品显得更贵、更专业、更有科技感的官网。"
_SPEC_MICRO = "帮我调整标题。"


def test_autonomous_hops_cover_spec_chain():
    assert "intent" in AUTONOMOUS_HOPS
    assert "research" in AUTONOMOUS_HOPS
    assert "strategy" in AUTONOMOUS_HOPS
    assert "candidates" in AUTONOMOUS_HOPS
    assert "tournament" in AUTONOMOUS_HOPS
    assert "governance" in AUTONOMOUS_HOPS
    assert "final" in AUTONOMOUS_HOPS
    assert AUTONOMOUS_HOPS.index("research") < AUTONOMOUS_HOPS.index("strategy")
    assert AUTONOMOUS_HOPS.index("tournament") < AUTONOMOUS_HOPS.index("execution")
    assert AUTONOMOUS_HOPS.index("governance") < AUTONOMOUS_HOPS.index("final")


def test_spec_goal_activates_autonomous():
    assert is_goal_only_prompt(_SPEC_GOAL, classified_intent="design")
    assert classify_autonomous_mode(_SPEC_GOAL, classified_intent="design") == "goal"
    plan = build_autonomous_plan(prompt=_SPEC_GOAL, intent="design")
    assert plan["active"] is True
    assert plan["mode"] == "goal"
    assert len(plan["hops"]) == len(AUTONOMOUS_HOPS)
    ids = [h["id"] for h in plan["hops"]]
    assert ids == list(AUTONOMOUS_HOPS)


def test_micro_edit_does_not_activate():
    assert (
        classify_autonomous_mode(_SPEC_MICRO, classified_intent="canvas_op")
        == "micro_edit"
    )
    assert not is_goal_only_prompt(_SPEC_MICRO, classified_intent="canvas_op")
    plan = build_autonomous_plan(prompt=_SPEC_MICRO, intent="edit")
    assert plan["active"] is False
    assert all(h["status"] == "skipped" for h in plan["hops"])


def test_autonomous_without_intent_is_idle():
    assert classify_autonomous_mode(_SPEC_GOAL) == "idle"
    assert not is_goal_only_prompt(_SPEC_GOAL)


def test_sync_marks_intelligence_hops_done_never_paints():
    rt = _rt(prompt=_SPEC_GOAL)
    plan = build_autonomous_plan(prompt=_SPEC_GOAL, intent="design")
    apply_autonomous_to_runtime(rt, plan)
    rt.design_research = {"anti_category": ["purple gradient"]}
    rt.design_strategy = {"positioning": "premium technical"}
    rt.design_candidates = {"candidates": [{"id": "A"}]}
    rt.design_tournament = {"winner_id": "A"}
    rt.design_brief = {"visual_thesis": "premium tech landing"}
    synced = sync_autonomous_hops(plan, rt=rt)
    by_id = {h["id"]: h for h in synced["hops"]}
    assert by_id["research"]["status"] == "done"
    assert by_id["strategy"]["status"] == "done"
    assert by_id["candidates"]["status"] == "done"
    assert by_id["tournament"]["status"] == "done"
    assert by_id["final"]["status"] == "done"
    assert by_id["execution"]["status"] == "deferred"
    assert rt.apply_ops == []
    assert rt.scene_nodes == []
    block = format_autonomous_for_decide(synced)
    assert "AUTONOMOUS_ART_DIRECTOR" in block
    assert "research: done" in block
