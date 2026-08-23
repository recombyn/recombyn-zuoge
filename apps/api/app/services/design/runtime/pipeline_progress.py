"""Shared user-visible progress state for local and Worker design SSE streams."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.services.design.runtime.progress_stages import (
    maybe_advance_stage,
    stage_for_event,
    thought_stage_event,
)

_DESIGN_ARM_STAGES = frozenset(
    {"lookup", "validate", "ops", "scene_check", "critic", "refine"}
)
_EARLY_EXPLORE_STAGES = frozenset(
    {"prompt", "prepare", "model_wait", "model_stream"}
)
_PAINT_EVENT_TYPES = frozenset({"tool_ops", "svg_delta", "drawing"})
_PAINT_ACTIVITY_KINDS = frozenset({"tool", "added", "updated", "deleted"})
_TERMINAL_STAGES = frozenset({"done", "failed"})
AGENT_EVENT_PROTOCOL = "agent_event.v1"


def _agent_event_kind(payload: dict[str, Any]) -> str:
    event_type = str(payload.get("type") or "event")
    if event_type == "tool_ops":
        return "tool_call"
    if event_type == "scene_feedback_request":
        return "scene_confirmation_requested"
    if event_type == "result":
        return "completed" if str(payload.get("status") or "") != "error" else "failed"
    if event_type == "error":
        return "failed"
    return event_type


@dataclass
class PipelineSseState:
    """Turn agent events into a monotonic, reconnect-safe progress timeline."""

    current_stage: str | None = None
    pipeline_armed: bool = False
    saw_paint: bool = False
    chat_divert: bool = False
    result_failed: bool = False
    task_id: str | None = None
    t0: float = field(default_factory=time.time)
    event_seq: int = 0

    def decorate(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Attach the stable AgentEvent envelope without changing payload shape."""
        self.remember_task_id(payload)
        self.event_seq += 1
        event_type = str(payload.get("type") or "event")
        stage = (
            str(payload.get("stage") or "").strip()
            or stage_for_event(payload)
            or self.current_stage
            or "prepare"
        )
        status = str(payload.get("status") or "").strip() or "running"
        terminal = event_type in {"result", "error"} or stage in _TERMINAL_STAGES
        return {
            **payload,
            "agent_event": {
                "protocol": AGENT_EVENT_PROTOCOL,
                "event_id": f"{self.task_id or 'run'}:{self.event_seq}",
                "kind": _agent_event_kind(payload),
                "phase": stage,
                "elapsed_ms": max(0, int((time.time() - self.t0) * 1000)),
                "can_cancel": not terminal,
                "resumable": bool(payload.get("resumable")),
            },
        }

    def arm(self, stage: str | None = "prepare") -> None:
        if not self.chat_divert and not self.pipeline_armed:
            self.pipeline_armed = True
            self.current_stage = stage or "prepare"

    def remember_task_id(self, payload: Any) -> None:
        if not isinstance(payload, dict) or self.task_id:
            return
        task_id = str(payload.get("task_id") or "").strip()
        if task_id:
            self.task_id = task_id

    def heartbeat_stage_event(self) -> dict[str, Any] | None:
        if (
            not self.pipeline_armed
            or self.chat_divert
            or not self.current_stage
            or self.current_stage in _TERMINAL_STAGES
        ):
            return None
        return {
            **thought_stage_event(self.current_stage, elapsed_s=int(time.time() - self.t0)),
            "heartbeat": True,
        }

    def terminal_stage_event(self) -> dict[str, Any] | None:
        if (
            not self.pipeline_armed
            or self.chat_divert
            or self.current_stage in _TERMINAL_STAGES
        ):
            return None
        if self.result_failed:
            self.current_stage = "failed"
            return thought_stage_event("failed", status="error")
        self.current_stage = "done"
        return thought_stage_event("done", status="done")

    def observe(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Consume one canonical agent event and return any timeline update."""
        self.remember_task_id(payload)
        if _should_chat_divert(payload):
            self.chat_divert = True
            self.current_stage = "done"
        if str(payload.get("type") or "") == "result" and str(
            payload.get("status") or ""
        ) == "error":
            self.result_failed = True
        self._maybe_arm(payload)
        extra = self._advance(payload)
        if _is_paint_signal(payload):
            self.saw_paint = True
        if str(payload.get("type") or "") == "result":
            terminal = self.terminal_stage_event()
            if terminal:
                extra.append(terminal)
        return extra

    def _maybe_arm(self, payload: dict[str, Any]) -> None:
        if self.chat_divert:
            return
        event_type = str(payload.get("type") or "")
        if event_type in _PAINT_EVENT_TYPES:
            self.arm("ops")
        elif event_type == "activity":
            stage = _arm_stage_from_activity(payload)
            if stage:
                self.arm(stage)

    def _advance(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.pipeline_armed or self.chat_divert:
            return []
        next_stage = maybe_advance_stage(self.current_stage, stage_for_event(payload))
        if not next_stage or next_stage == self.current_stage:
            return []
        self.current_stage = next_stage
        if next_stage == "done":
            if self.result_failed:
                self.current_stage = "failed"
                return [thought_stage_event("failed", status="error")]
            return [thought_stage_event("done", status="done")]
        if not self.saw_paint or next_stage in ("ops", "refine"):
            return [thought_stage_event(next_stage, elapsed_s=int(time.time() - self.t0))]
        return []


def _should_chat_divert(payload: dict[str, Any]) -> bool:
    event_type = str(payload.get("type") or "")
    if event_type == "chat_done":
        return True
    if event_type == "result":
        return str(payload.get("status") or "") != "error" and str(
            payload.get("intent") or ""
        ) == "chat"
    return event_type == "decision" and (
        payload.get("is_chitchat") is True
        or str(payload.get("route") or "") == "chitchat"
        or str(payload.get("intent") or "") == "chat"
    )


def _arm_stage_from_activity(payload: dict[str, Any]) -> str | None:
    kind = str(payload.get("kind") or "")
    stage = str(payload.get("stage") or "").strip()
    if kind in _PAINT_ACTIVITY_KINDS:
        return "ops"
    if stage in _DESIGN_ARM_STAGES:
        return stage
    if kind == "explored" and stage and stage not in _EARLY_EXPLORE_STAGES:
        return stage
    return None


def _is_paint_signal(payload: dict[str, Any]) -> bool:
    event_type = str(payload.get("type") or "")
    if event_type in _PAINT_EVENT_TYPES or event_type == "result":
        return True
    return event_type == "activity" and str(payload.get("kind") or "") in _PAINT_ACTIVITY_KINDS
