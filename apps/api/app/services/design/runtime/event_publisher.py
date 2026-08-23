"""Shared durable publication for design-run output adapters."""
from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


def publish_design_output(task_id: str, event: dict[str, Any]) -> None:
    """Persist replayable UI events and canvas mutations using one policy."""
    tid = str(task_id or "").strip()
    if not tid or not isinstance(event, dict):
        return
    try:
        from app.services.design.admin.task_store import append_canvas_command, append_task_event

        append_task_event(tid, event)
        append_canvas_command(tid, event)
    except Exception:
        _log.exception("design output persistence failed task=%s type=%s", tid, event.get("type"))
