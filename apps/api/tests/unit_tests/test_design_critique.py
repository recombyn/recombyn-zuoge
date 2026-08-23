# -*- coding: utf-8 -*-
"""Observe critique: host/structure only — craft lives in Skills + Review."""
from __future__ import annotations

import asyncio

from app.services.design.runtime.graph.nodes import observe as observe_mod
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime
from app.services.design.runtime.decision_log import DesignRunDecision


def _rt(**kwargs) -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="t", goal="g", painted=True, intent="create")
    rt = AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="800x600",
        scene_key="website",
        scene_nodes=[],
        scene_frames=[],
        focus_id=None,
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
        w=800,
        h=600,
        run=run,
        decision=DesignRunDecision(),
        system="",
        size_auto_hint="",
        chat_fallback_tmpl="",
        persona="",
        defer_tools=False,
        max_rounds=4,
        spatial_summary=None,
    )
    for k, v in kwargs.items():
        setattr(rt, k, v)
    return rt


def test_structure_critique_empty_artboard(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: emitted.append(ev))
    monkeypatch.setattr(observe_mod, "_critique_enabled", lambda *_a, **_k: True)
    rt = _rt(
        scene_nodes=[],
        scene_frames=[{"id": "f1", "is_empty": True}],
        paint_ops=[{"name": "create_text", "args": {}}],
    )
    issues = observe_mod._run_post_paint_critique(rt, rt.run, round_i=0)
    assert any("empty" in x.lower() for x in issues)
    assert any(e.get("type") == "critique_start" for e in emitted)
    assert any(e.get("type") == "critique_done" and e.get("ok") is False for e in emitted)


def test_critique_pass_when_nodes_present(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: emitted.append(ev))
    monkeypatch.setattr(observe_mod, "_critique_enabled", lambda *_a, **_k: True)
    monkeypatch.setattr(observe_mod, "_spatial_grounding_issues", lambda _rt: [])
    rt = _rt(
        scene_nodes=[{"id": "n1", "w": 100, "h": 40}],
        scene_frames=[{"id": "f1", "is_empty": False}],
        paint_ops=[{"name": "create_text", "args": {"x": 10, "y": 10}}],
    )
    issues = observe_mod._run_post_paint_critique(rt, rt.run, round_i=1)
    assert issues == []
    done = [e for e in emitted if e.get("type") == "critique_done"][-1]
    assert done.get("ok") is True


def test_spatial_no_longer_flags_cramped_taste():
    """Empty pockets are craft — Skills/Review; observe must not hard-fail them."""
    rt = _rt(
        spatial_summary={
            "empty_rects": [
                {"x": 0, "y": 0, "w": 10, "h": 10},
                {"x": 20, "y": 0, "w": 10, "h": 10},
                {"x": 40, "y": 0, "w": 10, "h": 10},
            ]
        },
        paint_ops=[
            {"name": "create_rect", "args": {"x": 100, "y": 100}},
            {"name": "create_text", "args": {"x": 200, "y": 200}},
        ],
    )
    issues = observe_mod._spatial_grounding_issues(rt)
    assert not any("cramped" in x for x in issues)


def test_spatial_flags_stacked_creates():
    rt = _rt(
        spatial_summary={},
        paint_ops=[
            {"name": "create_text", "args": {"x": 10, "y": 10}},
            {"name": "create_rect", "args": {"x": 12, "y": 12}},
        ],
    )
    issues = observe_mod._spatial_grounding_issues(rt)
    assert any("stacked" in x for x in issues)


def test_skip_review_for_canvas_op_lean():
    rt = _rt(classified_intent="canvas_op", prompt="加个红圆", images=None)
    assert observe_mod._should_route_to_review(rt) is False
    # Clean design first paint → auto mode skips Review (no retry / high-stakes).
    rt2 = _rt(classified_intent="design", prompt="画一张万圣节海报" * 5, images=None)
    assert observe_mod._should_route_to_review(rt2) is False


def test_review_auto_gates(monkeypatch):
    monkeypatch.setattr(observe_mod, "_review_stage_enabled", lambda: True)
    monkeypatch.setattr(observe_mod, "_review_mode", lambda *_a, **_k: "auto")

    long_prompt = (
        "Design a complete multi-section marketing landing page with nav, hero, "
        "three feature blocks, testimonials, pricing table, FAQ, and footer."
    )

    clean = _rt(classified_intent="design", prompt=long_prompt, images=None)
    assert observe_mod._should_route_to_review(clean) is False

    with_signals = _rt(classified_intent="design", prompt=long_prompt, images=None)
    assert observe_mod._should_route_to_review(with_signals) is False

    used = _rt(classified_intent="design", prompt=long_prompt, images=None)
    used.flags["review_repair_used"] = True
    used.flags["critique_failed"] = True
    used.images = ["https://example.com/a.png"]
    assert observe_mod._should_route_to_review(used) is False

    # Taste phrases must NOT force Review — intent LLM / signals only.
    taste = _rt(classified_intent="design", prompt="这个太丑了重新设计", images=None)
    assert observe_mod._should_route_to_review(taste) is False

    retry = _rt(classified_intent="design", prompt=long_prompt, images=None)
    retry.flags["critique_failed"] = True
    assert observe_mod._should_route_to_review(retry) is True

    refs = _rt(
        classified_intent="design",
        prompt="参考图风格做一张海报",
        images=["https://example.com/a.png"],
    )
    assert observe_mod._should_route_to_review(refs) is True

    monkeypatch.setattr(observe_mod, "_review_mode", lambda *_a, **_k: "off")
    assert observe_mod._should_route_to_review(taste) is False

    monkeypatch.setattr(observe_mod, "_review_mode", lambda *_a, **_k: "always")
    assert observe_mod._should_route_to_review(clean) is True
    lean = _rt(classified_intent="canvas_op", prompt="加个红圆", images=None)
    assert observe_mod._should_route_to_review(lean) is False
    lean_taste = _rt(classified_intent="canvas_op", prompt="这个太丑了", images=None)
    assert observe_mod._should_route_to_review(lean_taste) is False



def test_critique_disabled(monkeypatch):
    monkeypatch.setattr(observe_mod, "_critique_enabled", lambda *_a, **_k: False)
    rt = _rt(scene_nodes=[], scene_frames=[{"id": "f1", "is_empty": True}])
    assert observe_mod._run_post_paint_critique(rt, rt.run, round_i=0) == []


def test_format_critique_reflect_note_structural_only():
    note = observe_mod._format_critique_reflect_note(
        [
            "creates stacked (1 near-duplicate positions)",
            "placement_outside_viewport",
        ]
    )
    assert "CRITIQUE" in note
    assert "structural" in note.lower() or "Placement" in note
    assert "Visual craft" not in note
    assert "FOCUS_FRAME" in note or "frameId" in note
    assert "empty_rects" not in note
    assert "suggested_place" not in note


def test_critique_does_not_run_layout_craft(monkeypatch):
    """Clip/emoji/contrast taste must not live in observe kernel."""
    emitted: list[dict] = []
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: emitted.append(ev))
    monkeypatch.setattr(observe_mod, "_critique_enabled", lambda *_a, **_k: True)
    monkeypatch.setattr(observe_mod, "_spatial_grounding_issues", lambda _rt: [])
    rt = _rt(
        scene_frames=[{"id": "f1", "w": 300, "h": 400, "is_empty": False}],
        scene_nodes=[
            {
                "id": "t1",
                "type": "text",
                "x": 40,
                "y": 40,
                "w": 80,
                "h": 30,
                "fontSize": 20,
                "text": "TITLE",
                "fill": "#111111",
            }
        ],
    )
    issues = observe_mod._run_post_paint_critique(rt, rt.run, round_i=0)
    assert issues == []
    assert not hasattr(observe_mod, "_layout_craft_issues")
    assert not hasattr(observe_mod, "_poster_hero_issues")
    assert not hasattr(observe_mod, "_long_canvas_coverage_issues")


def test_retry_paint_from_critique_sets_reflect_note(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: emitted.append(ev))
    rt = _rt()
    rt.run.reflect_left = 2
    rt.run.painted = True

    async def _run():
        return await observe_mod._retry_paint_from_critique(
            rt,
            rt.run,
            round_i=1,
            issues=["artboard looks empty", "creates stacked (1 near-duplicate positions)"],
        )

    cmd = asyncio.run(_run())
    assert getattr(cmd, "goto", None) == "paint_ops"
    assert "CRITIQUE" in (rt.run.reflect_note or "")
    assert "Visual craft" not in (rt.run.reflect_note or "")
    assert rt.flags.get("critique_failed") is True
    assert rt.run.reflect_left == 1


def test_route_after_repair_settles_even_with_structure(monkeypatch):
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: None)
    monkeypatch.setattr(observe_mod, "_emit_ux_tip", lambda *_a, **_k: None)
    rt = _rt(classified_intent="design", images=["https://example.com/a.png"])
    rt.flags["review_repair_used"] = True
    rt.run.reflect_left = 2
    rt.run.painted = True

    async def _run():
        return await observe_mod._route_after_observe_facts(
            rt,
            rt.run,
            round_i=2,
            critique_issues=["overlap: a ∩ b (100px²)"],
            preview_image=None,
            observe_signals=["overlap = true"],
        )

    cmd = asyncio.run(_run())
    assert getattr(cmd, "goto", None) == "__settle__"


def test_route_high_stakes_without_structure_goes_review(monkeypatch):
    monkeypatch.setattr(observe_mod, "_emit", lambda ev: None)
    monkeypatch.setattr(observe_mod, "_review_stage_enabled", lambda: True)
    monkeypatch.setattr(observe_mod, "_review_mode", lambda *_a, **_k: "auto")
    rt = _rt(
        classified_intent="design",
        images=["https://example.com/a.png"],
        prompt="参考图做海报",
    )
    rt.run.painted = True

    async def _run():
        return await observe_mod._route_after_observe_facts(
            rt,
            rt.run,
            round_i=1,
            critique_issues=[],
            preview_image=None,
            observe_signals=[],
        )

    cmd = asyncio.run(_run())
    assert getattr(cmd, "goto", None) == "review"
