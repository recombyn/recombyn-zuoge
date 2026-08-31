"""Append-only session log — zuoge Harness model trace lane + UI replay lane."""
from __future__ import annotations

from typing import Any, Literal

from recombyn_agent_sdk.session_events import (
    SessionEventKind,
    model_event,
)

SessionLane = Literal["model", "ui"]


def append(task_id: str, event: dict[str, Any], *, lane: SessionLane = "ui") -> int | None:
    """Persist a session event. UI lane uses compact replay rules; model lane keeps trace."""
    tid = str(task_id or "").strip()
    if not tid or not isinstance(event, dict):
        return None
    if lane == "model":
        from app.services.design.admin.task_store import append_trace_event

        return append_trace_event(tid, event)
    from app.services.design.admin.task_store import append_task_event

    return append_task_event(tid, event)


def _log_model(task_id: str, kind: SessionEventKind, **fields: Any) -> None:
    append(task_id, model_event(kind, **fields), lane="model")


def log_turn_start(task_id: str, *, trace_id: str | None = None, profile_id: str | None = None) -> None:
    _log_model(task_id, SessionEventKind.TURN_START, trace_id=trace_id, profile_id=profile_id)


def log_turn_end(task_id: str, *, status: str, intent: str | None = None) -> None:
    _log_model(task_id, SessionEventKind.TURN_END, status=status, intent=intent)


def log_stage_decision(task_id: str, stage: str, **fields: Any) -> None:
    _log_model(task_id, SessionEventKind.STAGE_DECISION, stage=stage, **fields)


def log_llm_request(task_id: str, stage: str, **fields: Any) -> None:
    _log_model(task_id, SessionEventKind.LLM_REQUEST, stage=stage, **fields)


def log_llm_response(task_id: str, stage: str, **fields: Any) -> None:
    _log_model(task_id, SessionEventKind.LLM_RESPONSE, stage=stage, **fields)


def log_tool_ops_emit(task_id: str, *, stage: str, ops_count: int, **fields: Any) -> None:
    _log_model(task_id, SessionEventKind.TOOL_OPS_EMIT, stage=stage, ops_count=ops_count, **fields)


def log_scene_feedback(task_id: str, **fields: Any) -> None:
    _log_model(task_id, SessionEventKind.SCENE_FEEDBACK, **fields)


def get_trace(task_id: str, *, after_seq: int = 0, limit: int = 256) -> dict[str, Any]:
    from app.services.design.admin.task_store import get_task_trace

    return get_task_trace(task_id, after_seq=after_seq, limit=limit)
