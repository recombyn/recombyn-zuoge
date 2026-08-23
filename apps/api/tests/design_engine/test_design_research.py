"""P32 — Design Research Pipeline + ANTI-CATEGORY STRATEGY. Never paints."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.research import (
    apply_research_to_runtime,
    format_research_for_decide,
    run_design_research_pipeline,
    should_run_design_research,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime


def _rt(*, prompt: str, intent: str = "design", scene_key: str = "") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_res", goal=prompt)
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


def test_ai_landing_anti_category_avoids_purple_glass():
    report = run_design_research_pipeline(
        prompt="AI landing page，不能千篇一律，不要跟别人一样",
        scene_key="website",
    )
    assert report["category"] == "ai_landing"
    common = " ".join(report["common_patterns"]).lower()
    assert "purple" in common or "gradient" in common
    assert "glass" in common or "glow" in common
    anti = " ".join(report["anti_category_strategy"]).lower()
    assert "avoid:" in anti
    assert "purple" in anti or "glass" in anti
    assert "adopt:" in anti
    assert "editorial" in anti or "asymmetric" in anti
    assert report["why_effective"]
    assert "tool_ops" not in report
    assert "nodes" not in report


def test_poster_why_effective_and_hero_hypotheses():
    report = run_design_research_pipeline(
        prompt="做一张武侠海报，要有差异化",
        scene_key="poster",
    )
    assert report["category"] == "poster"
    why = " ".join(report["why_effective"]).lower()
    assert "hero" in why or "60" in why or "thesis" in why
    anti = " ".join(report["anti_category_strategy"]).lower()
    assert "avoid:" in anti and "adopt:" in anti
    assert "particle" in anti or "hud" in anti
    assert "focal" in anti or "hero" in anti or "empty" in anti


def test_should_run_skips_chat():
    rt = SimpleNamespace(
        classified_intent="chat",
        prompt="设计一个 AI 落地页",
        scene_key="website",
        run=SimpleNamespace(intent="chat"),
    )
    assert should_run_design_research(rt) is False


def test_should_run_on_design_intent():
    rt = SimpleNamespace(
        classified_intent="design",
        prompt="AI SaaS landing，不要千篇一律",
        scene_key="website",
        run=SimpleNamespace(intent="design"),
    )
    assert should_run_design_research(rt) is True


def test_brief_avoid_merge_from_research():
    rt = _rt(prompt="AI landing 不能千篇一律", intent="design", scene_key="website")
    rt.design_brief = {
        "purpose": "saas landing",
        "audience": "founders",
        "emotion": ["confident"],
        "visual_thesis": "product first",
        "visual_hero": "product shot",
        "composition": {"archetype": "asymmetric"},
        "avoid": ["stock handshake"],
    }
    report = run_design_research_pipeline(prompt=rt.prompt, scene_key=rt.scene_key)
    apply_research_to_runtime(rt, report)
    assert rt.design_research is not None
    avoid = list(rt.design_brief["avoid"])
    assert "stock handshake" in avoid
    assert any("purple" in str(x).lower() or "glass" in str(x).lower() for x in avoid)
    assert rt.design_brief["design_strategy"]["differentiation"] == "anti_category"
    block = format_research_for_decide(rt.design_research)
    assert "ANTI-CATEGORY STRATEGY" in block
    assert "avoid:" in block


def test_pipeline_never_returns_scene_ops():
    report = run_design_research_pipeline(prompt="dashboard KPI overview")
    dumped = str(report)
    assert "create_node" not in dumped
    assert "tool_ops" not in dumped
