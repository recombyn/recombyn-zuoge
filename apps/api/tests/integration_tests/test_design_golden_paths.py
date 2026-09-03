"""Golden-path: agent permission gate + LangGraph agent (mocked LLM)."""

from __future__ import annotations

from typing import Any

import asyncio

import pytest

from app.services.design.runtime.graph.nodes.decide import IntelligenceTaskProfile
from app.services.design.runtime.graph.state import PaintOpsSchema
from app.services.design.runtime.graph.turns import _turn_from_structured
from app.services.design.readpath.catalog import ensure_design_catalog
from app.services.design.runtime.models_route import IntentClassifyDecision
from tests.design_harness import collect_design_events, events_by_type

TEST_USER = "user_eval_golden"

_P0_BRIEF = {
    "purpose": "poster",
    "audience": "general",
    "emotion": ["clear"],
    "visual_thesis": "clear title hierarchy",
    "visual_hero": "headline",
    "composition": {"archetype": "center_hero", "rules": {}},
    "avoid": ["clutter"],
}


@pytest.fixture(scope="module", autouse=True)
def _catalog():
    ensure_design_catalog(force=True)
    yield

@pytest.fixture(autouse=True)
def _wallet(monkeypatch):
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator.get_user_credits",
        lambda _uid: 200_000,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator.free_daily_remaining",
        lambda _uid: 0,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator._reserve_design_hold",
        lambda *_a, **_k: (100, False),
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator._settle_hold",
        lambda *_a, **_k: 10,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator._refund_hold",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.decide.intelligence_task_profile",
        lambda _rt: IntelligenceTaskProfile("direct", (), (), False, False),
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.state._SCENE_WAIT_SEC",
        0.05,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.apply._SCENE_WAIT_SEC",
        0.05,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.observe._SCENE_WAIT_SEC",
        0.05,
    )

    async def _fake_apply_route(rt: Any) -> None:
        rt.flags["route_lane"] = "standard"
        rt.run.task_tier = "standard"

    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.memory.apply_classified_model_route",
        _fake_apply_route,
    )


def _run(**kwargs):
    return asyncio.run(
        collect_design_events(user_id=TEST_USER, run_mode="agent", **kwargs)
    )


def _patch_decide_turn(monkeypatch: Any, **fields: Any) -> None:
    async def _fake(*_a: Any, **_k: Any) -> dict[str, Any]:
        turn = _turn_from_structured(fields)
        turn["tool_ops_raw"] = None
        return turn

    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.decide._decide_turn_from_llm",
        _fake,
    )


def _paint_structured(paint: Any):
    async def _structured(**_kwargs: Any) -> dict[str, Any]:
        if callable(paint):
            return await paint(**_kwargs)
        return {"structured": paint}

    return _structured


@pytest.mark.integration
def test_permission_gate_denies_when_broke(monkeypatch):
    # Platform credit gate only applies when wallet billing is on (SaaS).
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator.is_wallet_billing_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator.get_user_credits",
        lambda _uid: 0,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.orchestrator.free_daily_remaining",
        lambda _uid: 0,
    )
    events = _run(prompt="??")
    perms = [e for e in events if e.get("type") == "permission"]
    assert perms
    assert perms[0].get("can_call_llm") is False
    errs = events_by_type(events, "error")
    assert errs
    assert errs[0].get("code") in (
        "insufficient_credits",
        "free_daily_exhausted",
    )
    assert not events_by_type(events, "skill_start")


@pytest.mark.integration
def test_react_chat_hello(monkeypatch):
    """Chat short-circuits at intent_classify (no create_agent turn)."""

    async def _classify(**_kwargs: Any) -> IntentClassifyDecision:
        return IntentClassifyDecision(
            intent="chat",
            reply="????????????",
            rationale="greeting",
        )

    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.intent.classify_user_intent",
        _classify,
    )
    events = _run(prompt="??")
    perms = [e for e in events if e.get("type") == "permission"]
    assert perms and perms[0].get("can_call_llm") is True
    tokens = events_by_type(events, "token")
    assert tokens and "??" in (tokens[0].get("text") or "")
    assert events_by_type(events, "chat_done")
    assert events_by_type(events, "result")
    assert not events_by_type(events, "tool_ops")
    assert not events_by_type(events, "skill_start")


@pytest.mark.integration
def test_react_edit_emits_tool_ops(monkeypatch):
    """design/edit ? decide ? paint_ops structured tool_ops ? action SSE."""

    async def _classify(**_kwargs: Any) -> IntentClassifyDecision:
        return IntentClassifyDecision(
            intent="design",
            paint_lane="edit",
            reply="",
            rationale="edit title",
        )

    paint = PaintOpsSchema(
        intent="edit",
        reply="加标题",
        tool_ops=[
            {
                "name": "create_text",
                "args": {
                    "text": "Hi",
                    "x": 40,
                    "y": 40,
                    "w": 400,
                    "h": 80,
                },
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.intent.classify_user_intent",
        _classify,
    )
    _patch_decide_turn(
        monkeypatch,
        thought="改标题",
        intent="edit",
        reply="准备改",
        design_brief=_P0_BRIEF,
    )
    monkeypatch.setattr(
        "app.services.llm.agent.ainvoke_structured",
        _paint_structured(paint),
    )

    events = _run(
        prompt="????",
        canvas_size="800x600",
        scene_frames=[{"id": "f1", "name": "Board", "w": 800, "h": 600}],
        scene_nodes=[],
        focus_frame_id="f1",
    )
    assert events_by_type(events, "skill_start")
    ops = events_by_type(events, "transaction.chunk")
    assert ops, events
    assert ops[0].get("ops")
    assert events_by_type(events, "result")


@pytest.mark.integration
def test_paint_retries_exhausted_emits_execution_errors(monkeypatch):
    """Paint LLM always fails → retries_exhausted lands in execution_log."""
    from tests.design_harness import last_execution_log, resilience_signals

    async def _classify(**_kwargs: Any) -> IntentClassifyDecision:
        return IntentClassifyDecision(
            intent="design",
            paint_lane="edit",
            reply="",
            rationale="edit",
        )

    async def _paint_timeout(**_kwargs: Any) -> dict[str, Any]:
        raise TimeoutError("paint_ops:t:a0 timed out after 1s")

    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.intent.classify_user_intent",
        _classify,
    )
    _patch_decide_turn(
        monkeypatch,
        thought="x",
        intent="edit",
        reply="",
        design_brief=_P0_BRIEF,
    )
    monkeypatch.setattr(
        "app.services.llm.agent.ainvoke_structured",
        _paint_structured(_paint_timeout),
    )
    # Keep paint attempt budget tiny so the suite stays fast.
    monkeypatch.setattr(
        "app.core.config.settings.design_paint_attempt_timeout_sec",
        0.2,
        raising=False,
    )

    events = _run(
        prompt="make a title",
        canvas_size="800x600",
        scene_frames=[{"id": "f1", "name": "Board", "w": 800, "h": 600}],
        scene_nodes=[],
        focus_frame_id="f1",
    )
    assert events_by_type(events, "result")
    assert not events_by_type(events, "transaction.chunk")
    sig = resilience_signals(last_execution_log(events))
    assert sig["retries_exhausted"] or sig["paint_timeout"], (
        last_execution_log(events),
        events_by_type(events, "error"),
    )


def _ask_run(**kwargs):
    return asyncio.run(
        collect_design_events(
            user_id=TEST_USER, run_mode="agent", interaction_mode="ask", **kwargs
        )
    )


@pytest.mark.integration
def test_ask_clarify_emits_choice_ui(monkeypatch):
    """Ask mode: intent=ask + choice_ui → settle without tool_ops."""

    async def _classify(**_kwargs: Any) -> IntentClassifyDecision:
        return IntentClassifyDecision(
            intent="design",
            paint_lane="create",
            reply="",
            rationale="need size",
        )

    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.intent.classify_user_intent",
        _classify,
    )
    _patch_decide_turn(
        monkeypatch,
        thought="缺尺寸",
        intent="ask",
        reply="要哪种画布尺寸？",
        choice_ui={
            "mode": "buttons",
            "options": [
                {"label": "1920x1080", "action": "reply"},
                {"label": "1080x1920", "action": "reply"},
                {"label": "自定义", "action": "reply"},
            ],
        },
        done=True,
    )

    events = _ask_run(prompt="帮我做一张海报")
    assert not events_by_type(events, "tool_ops"), events
    results = events_by_type(events, "result")
    assert results
    res = results[-1]
    ui = res.get("choice_ui") or {}
    opts = ui.get("options") or []
    assert ui.get("mode") in ("buttons", "single", "confirm")
    assert any(str(o.get("action")) == "reply" for o in opts if isinstance(o, dict))


@pytest.mark.integration
def test_ask_propose_holds_ops_until_confirm(monkeypatch):
    """Ask mode: paint ops → propose (proposed_ops + confirm chips), not immediate apply."""

    async def _classify(**_kwargs: Any) -> IntentClassifyDecision:
        return IntentClassifyDecision(
            intent="design",
            paint_lane="edit",
            reply="",
            rationale="edit title",
        )

    paint = PaintOpsSchema(
        intent="edit",
        reply="将添加标题文字",
        tool_ops=[
            {
                "name": "create_text",
                "args": {
                    "text": "Hello",
                    "x": 40,
                    "y": 40,
                    "w": 400,
                    "h": 80,
                },
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.design.runtime.graph.nodes.intent.classify_user_intent",
        _classify,
    )
    _patch_decide_turn(
        monkeypatch,
        thought="改标题",
        intent="edit",
        reply="准备改标题",
        design_brief=_P0_BRIEF,
    )
    monkeypatch.setattr(
        "app.services.llm.agent.ainvoke_structured",
        _paint_structured(paint),
    )

    events = _ask_run(
        prompt="加个标题 Hello",
        canvas_size="800x600",
        scene_frames=[{"id": "f1", "name": "Board", "w": 800, "h": 600}],
        scene_nodes=[],
        focus_frame_id="f1",
    )
    # Propose path: ops held — no live transaction.chunk apply SSE (or empty).
    tool = events_by_type(events, "transaction.chunk")
    results = events_by_type(events, "result")
    assert results, events
    res = results[-1]
    proposed = res.get("proposed_ops") or []
    assert proposed, res
    ui = res.get("choice_ui") or {}
    assert ui.get("mode") == "confirm" or any(
        str(o.get("action")) == "apply"
        for o in (ui.get("options") or [])
        if isinstance(o, dict)
    )
    # Ask propose must not have already applied as live paint (tool_ops may be absent).
    assert not tool or not tool[0].get("ops")
