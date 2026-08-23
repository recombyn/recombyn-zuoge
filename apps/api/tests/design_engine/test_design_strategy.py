"""P33 — Design Strategy Engine: Research → Strategy → Brief. Never paints."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.research import run_design_research_pipeline
from app.services.design.runtime.graph.nodes.strategy import (
    apply_strategy_to_runtime,
    format_strategy_for_decide,
    run_design_strategy_pipeline,
    should_run_design_strategy,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime


def _rt(*, prompt: str, intent: str = "design", scene_key: str = "") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_str", goal=prompt)
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt=prompt,
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key=scene_key,
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


def test_ai_landing_strategy_matches_spec_example():
    research = run_design_research_pipeline(
        prompt="AI landing page，不能千篇一律",
        scene_key="website",
    )
    strategy = run_design_strategy_pipeline(
        prompt="AI landing page，不能千篇一律",
        research=research,
    )
    assert strategy["positioning"] == "premium technical"
    assert "AI" in strategy["differentiation"] or "avoid" in strategy["differentiation"].lower()
    assert "editorial" in strategy["composition_strategy"].lower() or "asymmetric" in (
        strategy["composition_strategy"].lower()
    )
    assert strategy["typography_strategy"]
    assert strategy["imagery_strategy"]
    assert "warm" in strategy["color_strategy"].lower() or "accent" in strategy[
        "color_strategy"
    ].lower()
    anti = " ".join(strategy["anti_category_strategy"]).lower()
    assert "avoid:" in anti
    assert "purple" in anti or "glass" in anti
    assert "tool_ops" not in strategy


def test_poster_strategy_hero_composition():
    research = run_design_research_pipeline(
        prompt="武侠海报，要有差异化",
        scene_key="poster",
    )
    strategy = run_design_strategy_pipeline(prompt="武侠海报", research=research)
    assert "hero" in strategy["composition_strategy"].lower() or "60" in strategy[
        "composition_strategy"
    ]
    assert strategy["visual_thesis"]
    assert strategy["anti_category_strategy"]


def test_strategy_merges_into_brief_thesis_and_avoid():
    rt = _rt(prompt="AI SaaS landing 不能千篇一律", intent="design", scene_key="website")
    research = run_design_research_pipeline(prompt=rt.prompt, scene_key=rt.scene_key)
    rt.design_research = research
    rt.design_brief = {
        "purpose": "saas",
        "audience": "founders",
        "emotion": ["confident"],
        "visual_thesis": "",
        "visual_hero": "product",
        "composition": {"archetype": "asymmetric"},
        "avoid": [],
    }
    strategy = run_design_strategy_pipeline(
        prompt=rt.prompt, research=research, brief=rt.design_brief
    )
    apply_strategy_to_runtime(rt, strategy)
    assert rt.design_strategy is not None
    assert rt.design_brief["design_strategy"]["positioning"] == "premium technical"
    assert str(rt.design_brief["visual_thesis"]).strip()
    assert rt.design_brief["avoid"]
    block = format_strategy_for_decide(rt.design_strategy)
    assert "Positioning:" in block
    assert "ANTI-CATEGORY STRATEGY" in block


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        design_research={"category": "ai_landing"},
        run=SimpleNamespace(intent="chat"),
        flags={},
    )
    assert should_run_design_strategy(rt) is False


def test_brief_existing_thesis_preserved():
    research = run_design_research_pipeline(
        prompt="AI landing 不能千篇一律", scene_key="website"
    )
    brief = {
        "visual_thesis": "museum relic product shot",
        "design_strategy": {"positioning": "custom brand voice"},
    }
    strategy = run_design_strategy_pipeline(
        prompt="AI landing", research=research, brief=brief
    )
    assert strategy["positioning"] == "custom brand voice"
    assert strategy["visual_thesis"] == "museum relic product shot"
