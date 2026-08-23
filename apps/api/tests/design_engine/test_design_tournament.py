"""P35 — Design Tournament: multi-dim bracket → Winner / Runner-up / Alternative."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.candidates import run_multi_candidate_pipeline
from app.services.design.runtime.graph.nodes.research import run_design_research_pipeline
from app.services.design.runtime.graph.nodes.strategy import run_design_strategy_pipeline
from app.services.design.runtime.graph.nodes.tournament import (
    apply_tournament_to_runtime,
    format_tournament_for_decide,
    run_design_tournament_pipeline,
    should_run_design_tournament,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    tournament_dim_total,
    tournament_match_prefers,
)


def _rt(*, prompt: str = "AI landing", intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_tourney", goal=prompt)
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


def _bundle():
    research = run_design_research_pipeline(
        prompt="AI landing page，不能千篇一律",
        scene_key="website",
    )
    strategy = run_design_strategy_pipeline(
        prompt="AI landing page，不能千篇一律",
        research=research,
    )
    bundle = run_multi_candidate_pipeline(strategy=strategy, research=research)
    return research, strategy, bundle


def test_dim_wins_beat_higher_total():
    """Not「谁 total 高」: fewer total but more dim wins still wins the match."""
    high_total = {
        "composition": 70,
        "typography": 70,
        "brand": 70,
        "originality": 70,
        "user_fit": 70,
        "technical": 92,  # total 442
    }
    dim_leader = {
        "composition": 80,
        "typography": 80,
        "brand": 80,
        "originality": 80,
        "user_fit": 60,
        "technical": 60,  # total 440 — lower total, 4 dim wins
    }
    assert tournament_dim_total(high_total) > tournament_dim_total(dim_leader)
    prefers, dim_map, reason = tournament_match_prefers(dim_leader, high_total)
    assert prefers is True
    assert reason.startswith("dim_wins")
    assert dim_map["composition"] == "challenger"
    assert dim_map["technical"] == "incumbent"


def test_bracket_produces_winner_runner_alternative():
    research, _strategy, bundle = _bundle()
    result = run_design_tournament_pipeline(
        candidates_bundle=bundle, research=research
    )
    assert result["winner_id"] in {"A", "B", "C", "D", "E"}
    assert result["runner_up_id"]
    assert result["alternative_id"]
    assert result["winner_id"] != result["runner_up_id"]
    assert result["source"] == "bracket"
    assert result["bracket"]
    assert result["scores"][result["winner_id"]]["composition"] >= 0
    assert "tool_ops" not in str(result)


def test_user_pick_overrides_winner():
    research, _strategy, bundle = _bundle()
    result = run_design_tournament_pipeline(
        candidates_bundle=bundle,
        research=research,
        user_pick="E",
    )
    assert result["winner_id"] == "E"
    assert result["source"] == "user"
    assert result["user_pick"] == "E"


def test_apply_promotes_winner_without_ops():
    research, _strategy, bundle = _bundle()
    rt = _rt()
    rt.design_candidates = bundle
    rt.design_brief = {"visual_thesis": "", "avoid": []}
    result = run_design_tournament_pipeline(
        candidates_bundle=bundle, research=research
    )
    apply_tournament_to_runtime(rt, result)
    assert rt.design_tournament is not None
    assert rt.apply_ops == []
    assert rt.design_candidates["primary_id"] == result["winner_id"]
    selected = [c for c in rt.design_candidates["candidates"] if c.get("selected")]
    assert len(selected) == 1
    assert selected[0]["id"] == result["winner_id"]
    block = format_tournament_for_decide(rt.design_tournament)
    assert "Winner:" in block
    assert "not raw total" in block.lower() or "Multi-dim" in block


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_candidates={"candidates": [{"id": "A"}]},
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_design_tournament(rt) is False
