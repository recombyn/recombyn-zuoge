# -*- coding: utf-8 -*-
"""Session trace lane persistence."""
from __future__ import annotations

import json

from recombyn_agent_sdk.session_events import SessionEventKind, model_event

from app.services.design.admin import task_store as ts
from app.services.design.runtime import session_log


def test_trace_event_types_exported():
    assert SessionEventKind.TURN_START.value == "turn/start"
    assert "turn/end" in ts._TRACE_EVENT_TYPES


def test_safe_trace_event_strips_canvas_payload():
    safe = ts._safe_trace_event(
        {
            "type": "tool/ops_emit",
            "stage": "paint_ops",
            "ops": [{"name": "create_rect"}],
            "ops_count": 1,
        }
    )
    assert safe is not None
    assert "ops" not in safe
    assert safe["type"] == "tool/ops_emit"


def test_trace_replay_filters_model_lane(monkeypatch):
    from app.repositories import design_tasks

    events: list[dict] = []
    monkeypatch.setattr(design_tasks, "get_design_task", lambda **_kwargs: object())

    def append(*, event_json, **_kwargs):
        events.append({"id": len(events) + 1, "event_json": event_json, "created_at": 1.0})
        return len(events)

    def list_events(*, after_id, limit, **_kwargs):
        return [type("Event", (), item)() for item in events if item["id"] > after_id][:limit]

    monkeypatch.setattr(design_tasks, "append_design_task_event", append)
    monkeypatch.setattr(design_tasks, "list_design_task_events", list_events)

    ts.append_trace_event("T1", model_event(SessionEventKind.TURN_START, trace_id="tr1"))
    ts.append_task_event("T1", {"type": "activity", "kind": "thought"})
    ts.append_trace_event("T1", model_event(SessionEventKind.STAGE_DECISION, stage="intent", intent="design"))

    trace = ts.get_task_trace("T1")
    assert len(trace["items"]) == 2
    assert all(
        str(item["event"]["type"]) in ts._TRACE_EVENT_TYPES for item in trace["items"]
    )
    ui = ts.get_task_events("T1")
    assert len(ui["items"]) == 1
    assert ui["items"][0]["event"]["type"] == "activity"


def test_ui_lane_advances_past_model_only_window(monkeypatch):
    """Empty UI page must still advance next_seq past scanned model rows."""
    from app.repositories import design_tasks

    events: list[dict] = []
    monkeypatch.setattr(design_tasks, "get_design_task", lambda **_kwargs: object())

    def append(*, event_json, **_kwargs):
        events.append({"id": len(events) + 1, "event_json": event_json, "created_at": 1.0})
        return len(events)

    def list_events(*, after_id, limit, **_kwargs):
        return [type("Event", (), item)() for item in events if item["id"] > after_id][:limit]

    monkeypatch.setattr(design_tasks, "append_design_task_event", append)
    monkeypatch.setattr(design_tasks, "list_design_task_events", list_events)

    for _ in range(5):
        ts.append_trace_event("T2", model_event(SessionEventKind.LLM_REQUEST, stage="paint_ops"))
    page = ts.get_task_events("T2", after_seq=0, limit=2)
    assert page["items"] == []
    assert page["next_seq"] == 5
    ts.append_task_event("T2", {"type": "activity", "kind": "thought"})
    page2 = ts.get_task_events("T2", after_seq=page["next_seq"], limit=2)
    assert [item["event"]["type"] for item in page2["items"]] == ["activity"]
    assert page2["next_seq"] == 6


def test_session_log_model_lane_routes_to_trace(monkeypatch):
    captured: list[tuple[str, dict]] = []

    def fake_append_trace(task_id: str, event: dict):
        captured.append((task_id, event))
        return len(captured)

    monkeypatch.setattr(ts, "append_trace_event", fake_append_trace)

    session_log.log_stage_decision("task-1", "intent", intent="canvas_op")
    assert captured
    assert captured[0][0] == "task-1"
    assert captured[0][1]["type"] == "stage/decision"
    assert captured[0][1]["intent"] == "canvas_op"
