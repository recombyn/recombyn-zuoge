"""P34 — Multi-Candidate: Strategy → V1–V5 plan variants. Unselected never paint."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.candidates import (
    apply_candidates_to_runtime,
    format_candidates_for_decide,
    run_multi_candidate_pipeline,
    should_run_multi_candidate,
)
from app.services.design.runtime.graph.nodes.research import run_design_research_pipeline
from app.services.design.runtime.graph.nodes.strategy import run_design_strategy_pipeline
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    parse_design_candidate_set,
)


def _rt(*, prompt: str, intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_cand", goal=prompt)
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


_LABELS = {
    "A": "Editorial",
    "B": "Minimal Product",
    "C": "Art Direction",
    "D": "Experimental",
    "E": "Brand-led",
}


def test_five_named_lanes_from_strategy():
    research = run_design_research_pipeline(
        prompt="AI landing page，不能千篇一律",
        scene_key="website",
    )
    strategy = run_design_strategy_pipeline(
        prompt="AI landing page，不能千篇一律",
        research=research,
    )
    bundle = run_multi_candidate_pipeline(strategy=strategy, research=research)
    assert bundle["count"] == 5
    ids = [c["id"] for c in bundle["candidates"]]
    assert ids == ["A", "B", "C", "D", "E"]
    labels = {c["id"]: c["label"] for c in bundle["candidates"]}
    assert labels == _LABELS
    compositions = {c["strategy"]["composition_strategy"] for c in bundle["candidates"]}
    assert len(compositions) >= 4
    assert bundle["primary_id"] == "A"
    selected = [c for c in bundle["candidates"] if c.get("selected")]
    assert len(selected) == 1 and selected[0]["id"] == "A"
    dumped = str(bundle)
    assert "tool_ops" not in dumped
    assert "create_node" not in dumped


def test_candidates_keep_anti_category_from_strategy():
    research = run_design_research_pipeline(
        prompt="AI landing 不能千篇一律", scene_key="website"
    )
    strategy = run_design_strategy_pipeline(prompt="AI landing", research=research)
    bundle = run_multi_candidate_pipeline(strategy=strategy, research=research)
    for row in bundle["candidates"]:
        anti = " ".join(row["strategy"].get("anti_category_strategy") or []).lower()
        assert "avoid:" in anti
        assert "purple" in anti or "glass" in anti


def test_unselected_not_applied_as_ops_only_primary_strategy():
    rt = _rt(prompt="AI SaaS landing 不能千篇一律")
    research = run_design_research_pipeline(prompt=rt.prompt, scene_key="website")
    strategy = run_design_strategy_pipeline(prompt=rt.prompt, research=research)
    rt.design_strategy = strategy
    rt.design_brief = {"visual_thesis": "", "avoid": []}
    bundle = run_multi_candidate_pipeline(strategy=strategy, research=research)
    apply_candidates_to_runtime(rt, bundle)
    assert rt.design_candidates is not None
    assert rt.design_candidates["count"] == 5
    assert rt.apply_ops == []
    assert rt.design_strategy["composition_strategy"] == bundle["candidates"][0][
        "strategy"
    ]["composition_strategy"]
    # B–E exist on Runtime but are not selected / not painted.
    assert sum(1 for c in rt.design_candidates["candidates"] if c.get("selected")) == 1
    block = format_candidates_for_decide(rt.design_candidates)
    assert "Unselected candidates must NOT write the user canvas" in block
    assert "Editorial" in block and "Brand-led" in block


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_strategy={"positioning": "x"},
        design_research=None,
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_multi_candidate(rt) is False


def test_parse_candidate_set_roundtrip():
    parsed = parse_design_candidate_set(
        {
            "design_candidates": {
                "candidates": [
                    {
                        "id": "A",
                        "label": "Editorial",
                        "strategy": {"positioning": "editorial premium"},
                        "selected": True,
                    }
                ],
                "primary_id": "A",
            }
        }
    )
    assert parsed["count"] == 1
    assert parsed["candidates"][0]["strategy"]["positioning"] == "editorial premium"
