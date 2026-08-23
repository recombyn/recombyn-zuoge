"""P36 — Art Director Swarm: delegate specialists, resolve conflicts, never paint."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.candidates import run_multi_candidate_pipeline
from app.services.design.runtime.graph.nodes.research import run_design_research_pipeline
from app.services.design.runtime.graph.nodes.strategy import run_design_strategy_pipeline
from app.services.design.runtime.graph.nodes.swarm import (
    apply_swarm_to_runtime,
    format_swarm_for_decide,
    run_design_swarm_pipeline,
    should_run_design_swarm,
)
from app.services.design.runtime.graph.nodes.tournament import run_design_tournament_pipeline
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime


def _rt(*, prompt: str = "AI landing", intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_swarm", goal=prompt)
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt=prompt,
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="website",
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


def _chain():
    research = run_design_research_pipeline(
        prompt="AI landing page，不能千篇一律",
        scene_key="website",
    )
    strategy = run_design_strategy_pipeline(
        prompt="AI landing page，不能千篇一律",
        research=research,
    )
    candidates = run_multi_candidate_pipeline(strategy=strategy, research=research)
    tournament = run_design_tournament_pipeline(
        candidates_bundle=candidates, research=research
    )
    return research, strategy, tournament


def test_swarm_delegates_leads_and_craft():
    _research, strategy, tournament = _chain()
    result = run_design_swarm_pipeline(
        prompt="AI landing page，不能千篇一律",
        strategy=strategy,
        tournament=tournament,
    )
    ids = {p["agent_id"] for p in result["delegated"]}
    assert {"visual_lead", "ux_lead", "brand_lead", "composer", "imagery", "type", "color"} <= ids
    assert "art_director" in result["need_subagents"]
    assert "composer" in result["need_subagents"]
    assert "tool_ops" not in str(result)


def test_art_director_resolves_type_vs_composer():
    _research, strategy, tournament = _chain()
    result = run_design_swarm_pipeline(
        prompt="AI landing",
        strategy=strategy,
        tournament=tournament,
    )
    assert result["conflicts"]
    conflict = result["conflicts"][0]
    assert set(conflict["proposers"]) == {"type", "composer"}
    assert "keep type size" in conflict["resolution"].lower()
    assert "reposition" in conflict["resolution"].lower()
    assert conflict["resolved_by"] == "art_director"
    joined = " ".join(result["final_direction"]).lower()
    assert "keep title size" in joined or "reposition" in joined or "position" in joined


def test_apply_sets_need_subagents_without_ops():
    _research, strategy, tournament = _chain()
    rt = _rt()
    rt.design_strategy = strategy
    rt.design_tournament = tournament
    rt.design_brief = {"visual_thesis": "product first", "avoid": []}
    result = run_design_swarm_pipeline(
        prompt=rt.prompt, strategy=strategy, tournament=tournament
    )
    apply_swarm_to_runtime(rt, result)
    assert rt.design_swarm is not None
    assert rt.apply_ops == []
    assert rt.design_swarm.get("need_subagents")
    assert "ART_DIRECTOR_SWARM" in (rt.pending_subagent_details or "")
    assert any("keep title size" in str(x).lower() for x in (rt.design_brief or {}).get("avoid") or []) or any(
        "keep title size" in str(d).lower() for d in (rt.design_brief or {}).get("swarm_directions") or []
    )
    block = format_swarm_for_decide(rt.design_swarm)
    assert "CONFLICT" in block
    assert "FINAL DIRECTION" in block


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_strategy={"positioning": "x"},
        design_tournament=None,
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_design_swarm(rt) is False
