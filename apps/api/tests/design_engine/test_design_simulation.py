"""P37 — Design Simulation: pre-paint Attention/Hierarchy prediction. Never mutates canvas."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.simulation import (
    apply_simulation_to_runtime,
    format_simulation_for_decide,
    run_design_simulation_pipeline,
    should_run_design_simulation,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime


def _rt(*, prompt: str = "landing page", intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_sim", goal=prompt)
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


def test_landing_attention_matches_spec_shape():
    """Spec example: Hero ~68 / Headline ~19 / CTA ~8 / Nav ~5 → CTA warning."""
    result = run_design_simulation_pipeline(
        prompt="marketing landing page",
        strategy={
            "positioning": "product-led",
            "composition_strategy": "hero + sections",
            "typography_strategy": "restrained type",
            "interaction_strategy": "",
        },
        scene_key="website",
    )
    att = result["attention"]
    assert round(att["hero"] * 100) == 68
    assert round(att["headline"] * 100) == 19
    assert round(att["cta"] * 100) == 8
    assert round(att["nav"] * 100) == 5
    assert any("CTA < 10%" in w for w in result["warnings"])
    assert result["attention_adjusted"] is not None
    assert result["attention_adjusted"]["cta"] >= 0.10
    assert result["hierarchy"] > 0
    assert result["readability"] > 0
    assert result["density"] > 0
    assert result["conversion"] > 0
    assert "tool_ops" not in str(result)


def test_cta_gate_pushes_brief_adjustment():
    rt = _rt(prompt="landing page")
    rt.design_strategy = {"composition_strategy": "hero + sections"}
    rt.design_brief = {"visual_thesis": "product", "avoid": []}
    result = run_design_simulation_pipeline(
        prompt=rt.prompt,
        strategy=rt.design_strategy,
        scene_key="website",
    )
    apply_simulation_to_runtime(rt, result)
    assert rt.design_simulation is not None
    assert rt.apply_ops == []
    assert rt.scene_nodes == []
    assert rt.design_brief["simulation_adjustments"]
    assert "CTA attention below 10%" in rt.design_brief["avoid"]
    block = format_simulation_for_decide(rt.design_simulation)
    assert "Predicted Attention" in block
    assert "WARNING:" in block
    assert "does not mutate canvas" in block


def test_observe_facts_blend_hero():
    baseline = run_design_simulation_pipeline(
        prompt="landing",
        strategy={"composition_strategy": "sections"},
        scene_key="website",
    )
    result = run_design_simulation_pipeline(
        prompt="landing",
        strategy={"composition_strategy": "sections"},
        observe_facts={"hero_coverage": 0.40, "whitespace_ratio": 0.45},
        scene_key="website",
    )
    # Blended toward observe hero 0.40 → below pure strategy baseline.
    assert result["attention"]["hero"] < baseline["attention"]["hero"]


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_strategy={"positioning": "x"},
        design_swarm=None,
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_design_simulation(rt) is False
