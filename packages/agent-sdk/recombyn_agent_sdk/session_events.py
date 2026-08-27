"""Design Agent session event vocabulary (zuoge Harness model trace + UI replay)."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

SessionLane = Literal["model", "ui"]


class SessionEventKind(str, Enum):
    """Durable model-visible events for run trace / eval / debug."""

    TURN_START = "turn/start"
    TURN_END = "turn/end"
    STEP_START = "step/start"
    STAGE_DECISION = "stage/decision"
    LLM_REQUEST = "llm/request"
    LLM_RESPONSE = "llm/response"
    TOOL_OPS_EMIT = "tool/ops_emit"
    SCENE_FEEDBACK = "scene/feedback"


MODEL_TRACE_EVENT_TYPES: frozenset[str] = frozenset(k.value for k in SessionEventKind)


def model_event(kind: SessionEventKind | str, **payload: Any) -> dict[str, Any]:
    """Build a model-lane session event dict."""
    key = kind.value if isinstance(kind, SessionEventKind) else str(kind or "").strip()
    if not key:
        raise ValueError("session event kind is required")
    out: dict[str, Any] = {"type": key}
    for name, value in payload.items():
        if value is None:
            continue
        out[str(name)] = value
    return out
