"""P38 — Counterfactual: virtual what-if → predict; never pollutes real canvas."""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.counterfactual import (
    apply_counterfactual_to_runtime,
    apply_hypothesis_virtual,
    format_counterfactual_for_decide,
    run_design_counterfactual_pipeline,
    score_snapshot,
    should_run_design_counterfactual,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime


def _rt(*, intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_cf", goal="poster")
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="poster",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="poster",
        scene_nodes=[{"id": "n1", "type": "rect"}],
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


def test_hero_shrink_20_matches_spec_deltas():
    """Spec: Hero 72→58, Whitespace 31→39, Hierarchy 89→92 (approx)."""
    snap = {
        "hero_coverage": 0.72,
        "whitespace_ratio": 0.31,
        "decoration_area": 0.12,
        "node_count": 10,
    }
    hyp = {
        "id": "H1",
        "kind": "resize",
        "target": "hero",
        "description": "Hero 缩小 20%",
        "params": {"scale": 0.8},
    }
    before_scores = score_snapshot(snap)
    assert round(before_scores["hero_dominance"]) == 72
    assert round(before_scores["whitespace"]) == 31
    virtual = apply_hypothesis_virtual(snap, hyp)
    after = score_snapshot(virtual)
    assert round(after["hero_dominance"]) == 58
    assert round(after["whitespace"]) == 39
    assert round(before_scores["hierarchy"]) == 89
    assert round(after["hierarchy"]) == 92
    assert after["hierarchy"] > before_scores["hierarchy"]
    # Original snapshot untouched.
    assert snap["hero_coverage"] == 0.72


def test_pipeline_never_mutates_canvas_nodes():
    rt = _rt()
    nodes_before = deepcopy(rt.scene_nodes)
    result = run_design_counterfactual_pipeline(
        observe_facts={
            "hero_coverage": 0.72,
            "whitespace_ratio": 0.31,
            "decoration_area": 0.15,
        }
    )
    apply_counterfactual_to_runtime(rt, result)
    assert rt.scene_nodes == nodes_before
    assert rt.apply_ops == []
    assert result["trials"]
    assert any(t["hypothesis_id"] == "H1" for t in result["trials"])
    assert "tool_ops" not in str(result)
    block = format_counterfactual_for_decide(result)
    assert "never mutates canvas" in block


def test_selected_hypothesis_becomes_repair_draft_not_ops():
    rt = _rt()
    result = run_design_counterfactual_pipeline(
        observe_facts={"hero_coverage": 0.72, "whitespace_ratio": 0.31},
        selected_id="H1",
    )
    apply_counterfactual_to_runtime(rt, result)
    assert result["selected_id"] == "H1"
    draft = result["repair_plan_draft"]
    assert draft is not None
    assert draft["applied"] is False
    assert draft["actions"]
    assert rt.design_counterfactual["repair_plan_draft"]["applied"] is False
    assert rt.apply_ops == []
    assert rt.scene_nodes == [{"id": "n1", "type": "rect"}]


def test_remove_decoration_raises_whitespace():
    result = run_design_counterfactual_pipeline(
        observe_facts={
            "hero_coverage": 0.60,
            "whitespace_ratio": 0.25,
            "decoration_area": 0.20,
        }
    )
    trial = next(t for t in result["trials"] if t["hypothesis_id"] == "H2")
    assert trial["scores_after"]["whitespace"] > trial["scores_before"]["whitespace"]
    assert trial["scores_after"]["decoration"] < trial["scores_before"]["decoration"]


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_simulation={"attention": {}},
        observe_facts=None,
        visual_snapshot=None,
        design_strategy=None,
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_design_counterfactual(rt) is False
