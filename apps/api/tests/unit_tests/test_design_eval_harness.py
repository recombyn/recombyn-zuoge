# -*- coding: utf-8 -*-
"""Eval harness regressions: critique / spatial / ask proposal / lease / chat persist."""
from __future__ import annotations

import json

from app.services import chat_store
from app.services.design.admin import task_store as ts
from app.services.design.runtime.graph.nodes import observe as observe_mod
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime
from app.services.design.runtime.decision_log import DesignRunDecision
from tests.design_harness import (
    agent_trace_metrics,
    critique_ok,
    eval_checkpoint,
    event_types,
    proposed_ops,
)


def _stub_intent_model(monkeypatch, intent_mod) -> None:
    """Intent node resolves model before classify; tests lock a concrete id."""
    monkeypatch.setattr(
        intent_mod,
        "resolve_model_for_skill",
        lambda **_k: ("deepseek-chat", "test"),
    )


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
        persona="",
        defer_tools=False,
        max_rounds=4,
        spatial_summary=None,
    )
    for k, v in kwargs.items():
        setattr(rt, k, v)
    return rt


def test_eval_checkpoint_shape():
    events = [
        {"type": "tool_ops", "ops": [{"name": "create_text"}]},
        {"type": "critique_done", "ok": False, "reason": "empty"},
        {
            "type": "result",
            "status": "success",
            "proposed_ops": [{"name": "create_text"}],
            "proposal_id": "prop_abc",
        },
    ]
    cp = eval_checkpoint(events)
    assert cp["has_tool_ops"] is True
    assert cp["critique_ok"] is False
    assert cp["proposed_ops_n"] == 1
    assert cp["proposal_id"] == "prop_abc"
    assert critique_ok(events) is False
    assert len(proposed_ops(events)) == 1
    assert "tool_ops" in event_types(events)


def test_agent_trace_metrics_measures_receipts_and_visible_wait():
    events = [
        {
            "type": "tool_ops",
            "ops": [{"op_id": "a", "name": "create_text"}, {"op_id": "b", "name": "update_node"}],
            "agent_event": {"elapsed_ms": 0},
        },
        {
            "type": "scene_feedback",
            "op_results": [
                {"op_id": "a", "ok": True},
                {"op_id": "b", "ok": False},
            ],
            "agent_event": {"elapsed_ms": 1800},
        },
        {"type": "result", "status": "error", "error_code": "scene_unconfirmed", "agent_event": {"elapsed_ms": 2600}},
    ]

    metrics = agent_trace_metrics(events)

    assert metrics["completed"] is False
    assert metrics["emitted_ops"] == 2
    assert metrics["receipt_coverage"] == 1
    assert metrics["operation_correctness"] == 0.5
    assert metrics["max_visible_silence_ms"] == 1800


def test_spatial_stacked_creates(monkeypatch):
    monkeypatch.setattr(observe_mod, "_critique_enabled", lambda: True)
    rt = _rt(
        spatial_summary={
            "empty_rects": [
                {"x": 0, "y": 0, "w": 40, "h": 40},
                {"x": 80, "y": 0, "w": 40, "h": 40},
                {"x": 160, "y": 0, "w": 40, "h": 40},
                {"x": 240, "y": 0, "w": 40, "h": 40},
            ],
            "suggested_place": {"x": 200, "y": 200},
            "viewport": {"x": 0, "y": 0, "w": 800, "h": 600},
        },
        paint_ops=[
            {"name": "create_text", "args": {"x": 10, "y": 10}},
            {"name": "create_rect", "args": {"x": 12, "y": 12}},
        ],
    )
    issues = observe_mod._spatial_grounding_issues(rt)
    assert any("stacked" in x for x in issues)
    assert not any("cramped" in x for x in issues)


def test_operation_receipts_require_every_emitted_op_and_reject_unknown_ids():
    emitted = [
        {"name": "create_text", "op_id": "create-1", "args": {}},
        {"name": "update_node", "op_id": "update-1", "args": {"nodeId": "title"}},
    ]

    missing = observe_mod._op_receipt_issues(
        emitted,
        [{"op_id": "create-1", "name": "create_text", "ok": True}],
    )
    assert any("update_node (update-1)" in issue for issue in missing)

    unknown = observe_mod._op_receipt_issues(
        emitted,
        [
            {"op_id": "create-1", "name": "create_text", "ok": True},
            {"op_id": "update-1", "name": "update_node", "ok": True},
            {"op_id": "not-emitted", "name": "delete_nodes", "ok": True},
        ],
    )
    assert any("unknown operation receipts" in issue for issue in unknown)

    assert observe_mod._op_receipt_issues(
        emitted,
        [
            {"op_id": "create-1", "name": "create_text", "ok": True},
            {"op_id": "update-1", "name": "update_node", "ok": True},
        ],
    ) == []


def test_ask_proposal_resolve_roundtrip(monkeypatch):
    store = {
        "P1": {
            "id": "P1",
            "meta_json": json.dumps(
                {
                    "ask_proposal": {
                        "id": "prop_1",
                        "ops": [{"name": "create_text", "args": {"x": 1}}],
                        "expires_at": 9e12,
                    }
                }
            ),
        }
    }
    monkeypatch.setattr(ts, "get_design_task", lambda tid: store.get(tid))
    ops = ts.resolve_ask_proposal_ops("P1", "prop_1")
    assert ops and ops[0]["name"] == "create_text"
    assert ts.resolve_ask_proposal_ops("P1", "wrong") is None
    assert ts.resolve_ask_proposal_ops("missing", "prop_1") is None


def test_normalize_proposal_action():
    from app.services.design.runtime.models_route import normalize_proposal_action

    assert normalize_proposal_action("apply", has_pending=True) == "apply"
    assert normalize_proposal_action("DISMISS", has_pending=True) == "dismiss"
    assert normalize_proposal_action("revise", has_pending=True) == "revise"
    assert normalize_proposal_action("apply", has_pending=False) == ""
    assert normalize_proposal_action("nope", has_pending=True) == ""
    assert normalize_proposal_action("", has_pending=True) == ""


def test_scene_target_catalog_includes_live_ids():
    from app.services.design.runtime.models_route import scene_target_catalog

    catalog = scene_target_catalog(
        [
            {"id": "title", "type": "text", "text": "Summer sale", "x": 24, "y": 48},
            {"id": "card", "type": "rect", "w": 320, "h": 180, "fill": "#fff"},
        ]
    )

    assert "title" in catalog
    assert "card" in catalog


def test_direct_edit_design_plan_keeps_only_the_selected_live_target():
    from app.services.design.runtime.models_route import build_design_plan

    plan = build_design_plan(
        prompt="改成红色\n\n[Target element — selected from clarification]\nid: title_top",
        intent="canvas_op",
        paint_lane="edit",
        focus_frame_id="frame-a",
        scene_nodes=[{"id": "title_top"}, {"id": "title_bottom"}],
    )

    assert plan is not None
    assert "title_top" in plan.target_node_ids
    assert "title_bottom" not in plan.target_node_ids


def test_canvas_topology_audit_distinguishes_registered_stages_from_optional_modules():
    from app.services.design.runtime.graph.build import audit_canvas_ops_v1_topology

    audit = audit_canvas_ops_v1_topology()

    assert audit["registered_nodes"]["design_agent"] == "decide"
    assert "review" in audit["registered_modules"]
    assert "candidates" in audit["unregistered_modules"]
    assert "autonomous" in audit["unregistered_modules"]


def test_normalize_clarification_keeps_verified_target_ids():
    from app.services.design.runtime.models_route import normalize_clarification

    ok, _question, options = normalize_clarification(
        True,
        "要改哪一个标题？",
        [
            {"label": "顶部标题", "target_id": "title_top"},
            {"label": "页脚标题", "target_id": "title_footer"},
        ],
        has_target=False,
        intent="canvas_op",
        scene_nodes=[
            {"id": "title_top", "type": "text"},
            {"id": "title_footer", "type": "text"},
        ],
    )

    ids = {str(item.get("target_id") or "") for item in options}
    assert ok is True
    assert ids == {"title_top", "title_footer"}


def test_bind_pending_ask_proposal(monkeypatch):
    from app.services.design.runtime.graph.build import _bind_pending_ask_proposal

    monkeypatch.setattr(
        "app.services.design.admin.task_store.resolve_ask_proposal_ops",
        lambda tid, pid: [{"name": "create_text", "args": {"text": "hi"}}]
        if tid == "T1" and pid == "prop_x"
        else None,
    )
    rt = _rt(prompt="确认")
    # Chip path: apply_ops present → skip bind.
    _bind_pending_ask_proposal(
        rt,
        proposal_id="prop_x",
        proposal_task_id="T1",
        apply_list=[{"name": "create_text"}],
    )
    assert "pending_proposal" not in rt.flags

    _bind_pending_ask_proposal(
        rt,
        proposal_id="prop_x",
        proposal_task_id="T1",
        apply_list=[],
    )
    pending = rt.flags.get("pending_proposal")
    assert isinstance(pending, dict)
    assert pending["id"] == "prop_x"
    assert pending["ops"][0]["name"] == "create_text"


def test_intent_classify_apply_pending_routes_to_apply_confirm(monkeypatch):
    import asyncio

    from app.services.design.runtime.graph.nodes import intent as intent_mod
    from app.services.design.runtime.models_route import IntentClassifyDecision

    async def _classify(**_kwargs):
        return IntentClassifyDecision(
            intent="chat",
            paint_lane="",
            proposal_action="apply",
            reply="",
            rationale="user_confirmed",
        )

    monkeypatch.setattr(intent_mod, "classify_user_intent", _classify)
    _stub_intent_model(monkeypatch, intent_mod)
    monkeypatch.setattr(intent_mod, "_clear_ask_proposal_meta", lambda tid: None)
    monkeypatch.setattr(intent_mod, "_emit", lambda *_a, **_k: None)
    monkeypatch.setattr(intent_mod, "_emit_design_loading_artboard", lambda *_a, **_k: None)

    rt = _rt(prompt="确认")
    rt.flags["mode"] = "ask"
    rt.flags["pending_proposal"] = {
        "id": "prop_1",
        "task_id": "T1",
        "ops": [{"name": "create_text", "args": {"text": "Hi"}}],
        "detail": "create_text",
    }
    cmd = asyncio.run(intent_mod._node_intent_classify({"rt": rt}))
    assert cmd.goto == "apply_confirm"
    assert rt.apply_ops and rt.apply_ops[0]["name"] == "create_text"
    assert "pending_proposal" not in rt.flags


def test_intent_classify_dismiss_pending_settles(monkeypatch):
    import asyncio

    from app.services.design.runtime.graph.nodes import intent as intent_mod
    from app.services.design.runtime.models_route import IntentClassifyDecision

    async def _classify(**_kwargs):
        return IntentClassifyDecision(
            intent="chat",
            paint_lane="",
            proposal_action="dismiss",
            reply="已取消这次改动",
            rationale="user_cancelled",
        )

    monkeypatch.setattr(intent_mod, "classify_user_intent", _classify)
    _stub_intent_model(monkeypatch, intent_mod)
    cleared: list[str] = []
    monkeypatch.setattr(
        intent_mod, "_clear_ask_proposal_meta", lambda tid: cleared.append(tid)
    )
    monkeypatch.setattr(intent_mod, "_emit", lambda *_a, **_k: None)

    rt = _rt(prompt="取消")
    rt.flags["mode"] = "ask"
    rt.flags["pending_proposal"] = {
        "id": "prop_1",
        "task_id": "T1",
        "ops": [{"name": "create_text"}],
        "detail": "create_text",
    }
    cmd = asyncio.run(intent_mod._node_intent_classify({"rt": rt}))
    assert cmd.goto == "__settle__"
    assert rt.run.reply == "已取消这次改动"
    assert cleared == ["T1"]
    assert "pending_proposal" not in rt.flags


def test_intent_classify_ambiguous_edit_asks_before_paint(monkeypatch):
    import asyncio

    from app.services.design.runtime.graph.nodes import intent as intent_mod
    from app.services.design.runtime.models_route import IntentClassifyDecision

    async def _classify(**_kwargs):
        return IntentClassifyDecision(
            intent="canvas_op",
            paint_lane="edit",
            needs_clarification=True,
            clarification="你想修改哪一个标题？",
            clarification_options=[
                {"label": "顶部标题", "target_id": "title_top"},
                {"label": "页脚标题", "target_id": "title_footer"},
            ],
            rationale="two_text_targets",
        )

    events: list[dict] = []
    monkeypatch.setattr(intent_mod, "classify_user_intent", _classify)
    _stub_intent_model(monkeypatch, intent_mod)
    monkeypatch.setattr(intent_mod, "_emit", lambda event: events.append(event))
    monkeypatch.setattr(intent_mod, "_emit_design_loading_artboard", lambda *_a, **_k: None)

    rt = _rt(
        prompt="把标题改成红色",
        scene_nodes=[
            {"id": "title_top", "type": "text"},
            {"id": "title_footer", "type": "text"},
        ],
    )
    cmd = asyncio.run(intent_mod._node_intent_classify({"rt": rt}))

    assert cmd.goto == "__settle__"
    assert rt.flags["await_user"] is True
    assert all(event.get("type") != "tool_ops" for event in events)


def test_intent_classify_create_ignores_clarification(monkeypatch):
    import asyncio

    from app.services.design.runtime.graph.nodes import intent as intent_mod
    from app.services.design.runtime.models_route import IntentClassifyDecision

    async def _classify(**_kwargs):
        return IntentClassifyDecision(
            intent="canvas_op",
            paint_lane="create",
            needs_clarification=True,
            clarification="你想添加在哪个区域？",
            clarification_options=[
                {"label": "顶部", "target_id": "top"},
                {"label": "底部", "target_id": "bottom"},
            ],
            rationale="create_shape",
        )

    monkeypatch.setattr(intent_mod, "classify_user_intent", _classify)
    _stub_intent_model(monkeypatch, intent_mod)
    monkeypatch.setattr(intent_mod, "_emit", lambda *_a, **_k: None)
    monkeypatch.setattr(intent_mod, "_emit_design_loading_artboard", lambda *_a, **_k: None)

    rt = _rt(prompt="添加一个红色矩形")
    cmd = asyncio.run(intent_mod._node_intent_classify({"rt": rt}))

    assert cmd.goto == "paint_ops"
    assert rt.run.choice_ui is None


def test_chat_persists_ask_fields():
    session = chat_store.upsert_session(
        "u_ask",
        "proj_1",
        title="ask",
        messages=[
            {
                "id": "a1",
                "role": "assistant",
                "content": "确认？",
                "proposedOps": [{"name": "create_text", "args": {"x": 1}}],
                "proposalId": "prop_z",
                "designTaskId": "task_z",
                "choiceUi": {
                    "mode": "confirm",
                    "options": [
                        {"label": "应用", "action": "apply"},
                        {"label": "取消", "action": "dismiss"},
                    ],
                },
            }
        ],
    )
    msgs = session.get("messages") or []
    assert msgs
    m = msgs[0]
    assert m.get("proposalId") == "prop_z"
    assert m.get("designTaskId") == "task_z"
    assert m.get("proposedOps")
    assert m.get("choiceUi", {}).get("mode") == "confirm"


def test_intent_chat_with_images_runs_vision_reply(monkeypatch):
    """Selection crop Q&A must not settle on a blind text-only chat reply."""
    import asyncio

    from app.services.design.runtime.graph.nodes import intent as intent_mod
    from app.services.design.runtime.models_route import IntentClassifyDecision

    async def _classify(**_kwargs):
        return IntentClassifyDecision(
            intent="chat",
            paint_lane="",
            reply="目前还没有看到具体的问题哦",
            rationale="blind_chat",
        )

    async def _vision(_rt):
        return "答案是 4"

    monkeypatch.setattr(intent_mod, "classify_user_intent", _classify)
    _stub_intent_model(monkeypatch, intent_mod)
    monkeypatch.setattr(intent_mod, "_vision_chat_reply", _vision)
    monkeypatch.setattr(intent_mod, "_emit", lambda *_a, **_k: None)
    monkeypatch.setattr(intent_mod, "_emit_design_loading_artboard", lambda *_a, **_k: None)

    rt = _rt(
        prompt="[Target element]\nid: shape1\nUser request:\n告诉我答案",
        images=["data:image/png;base64,abc"],
    )
    cmd = asyncio.run(intent_mod._node_intent_classify({"rt": rt}))
    assert cmd.goto == "__settle__"
    assert rt.run.reply == "答案是 4"
    assert "没有看到" not in (rt.run.reply or "")
