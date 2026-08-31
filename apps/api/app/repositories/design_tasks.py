"""Persistence operations for design-run tasks and their durable outboxes."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import delete, func, update as sa_update
from sqlmodel import Session, col, select

from app.models import DesignTask, DesignTaskCanvasCommand, DesignTaskEvent
_DESIGN_TASK_UPDATE_FIELDS = frozenset(
    {
        "user_id",
        "canvas_id",
        "scene",
        "skill_group_id",
        "task_type",
        "user_selected_model",
        "actual_models",
        "target_layer_id",
        "current_skill_index",
        "status",
        "hold_credits",
        "charged_credits",
        "total_tokens",
        "prompt",
        "canvas_size",
        "result_svg",
        "error_message",
        "meta_json",
    }
)
# NOT NULL integer columns — never persist None (IntegrityError).
_DESIGN_TASK_INT_FIELDS = frozenset(
    {
        "hold_credits",
        "charged_credits",
        "total_tokens",
        "current_skill_index",
    }
)


def get_design_task(*, session: Session, task_id: str) -> DesignTask | None:
    tid = (task_id or "").strip()
    if not tid:
        return None
    return session.get(DesignTask, tid)


def get_design_task_for_update(*, session: Session, task_id: str) -> DesignTask | None:
    """Load task row with ``FOR UPDATE`` when the dialect supports it."""
    tid = (task_id or "").strip()
    if not tid:
        return None
    stmt = select(DesignTask).where(DesignTask.id == tid)
    try:
        stmt = stmt.with_for_update()
        return session.exec(stmt).first()
    except Exception:
        return session.get(DesignTask, tid)


def create_design_task(*, session: Session, row: dict[str, Any]) -> DesignTask:
    task = DesignTask(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        canvas_id=row.get("canvas_id"),
        scene=row.get("scene"),
        skill_group_id=row.get("skill_group_id"),
        task_type=str(row["task_type"]),
        user_selected_model=row.get("user_selected_model"),
        actual_models=row.get("actual_models"),
        target_layer_id=row.get("target_layer_id"),
        current_skill_index=int(row.get("current_skill_index") or 0),
        status=str(row.get("status") or "queued"),
        hold_credits=int(row.get("hold_credits") or 0),
        charged_credits=int(row.get("charged_credits") or 0),
        total_tokens=int(row.get("total_tokens") or 0),
        prompt=row.get("prompt"),
        canvas_size=row.get("canvas_size"),
        result_svg=row.get("result_svg"),
        error_message=row.get("error_message"),
        meta_json=row.get("meta_json"),
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def update_design_task(
    *, session: Session, task_id: str, fields: dict[str, Any]
) -> DesignTask | None:
    if not fields:
        return get_design_task(session=session, task_id=task_id)
    row = get_design_task(session=session, task_id=task_id)
    if not row:
        return None
    for key, value in fields.items():
        if key not in _DESIGN_TASK_UPDATE_FIELDS:
            continue
        if key in _DESIGN_TASK_INT_FIELDS:
            try:
                value = int(value if value is not None else 0)
            except (TypeError, ValueError):
                value = 0
        setattr(row, key, value)
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def append_design_task_event(*, session: Session, task_id: str, event_json: str, created_at: float) -> int:
    row = DesignTaskEvent(task_id=task_id, event_json=event_json, created_at=created_at)
    session.add(row)
    session.commit()
    session.refresh(row)
    return int(row.id or 0)


def list_design_task_events(*, session: Session, task_id: str, after_id: int, limit: int) -> list[DesignTaskEvent]:
    return list(session.exec(
        select(DesignTaskEvent)
        .where(DesignTaskEvent.task_id == task_id, DesignTaskEvent.id > after_id)
        .order_by(DesignTaskEvent.id)
        .limit(limit)
    ).all())


def append_design_task_canvas_command(*, session: Session, task_id: str, command_json: str, created_at: float) -> int:
    row = DesignTaskCanvasCommand(task_id=task_id, command_json=command_json, created_at=created_at)
    session.add(row)
    session.commit()
    session.refresh(row)
    return int(row.id or 0)


def list_design_task_canvas_commands(*, session: Session, task_id: str, after_id: int, limit: int) -> list[DesignTaskCanvasCommand]:
    return list(session.exec(
        select(DesignTaskCanvasCommand)
        .where(
            DesignTaskCanvasCommand.task_id == task_id,
            DesignTaskCanvasCommand.id > after_id,
            DesignTaskCanvasCommand.acknowledged_at.is_(None),
        )
        .order_by(DesignTaskCanvasCommand.id)
        .limit(limit)
    ).all())


def acknowledge_design_task_canvas_commands(*, session: Session, task_id: str, through_id: int, acknowledged_at: float) -> None:
    session.exec(
        sa_update(DesignTaskCanvasCommand)
        .where(
            DesignTaskCanvasCommand.task_id == task_id,
            DesignTaskCanvasCommand.id <= through_id,
            DesignTaskCanvasCommand.acknowledged_at.is_(None),
        )
        .values(acknowledged_at=acknowledged_at)
    )
    session.commit()


def get_design_task_canvas_command_cursors(*, session: Session, task_id: str) -> tuple[int, int]:
    last_id = int(session.exec(
        select(func.coalesce(func.max(DesignTaskCanvasCommand.id), 0)).where(
            DesignTaskCanvasCommand.task_id == task_id
        )
    ).one() or 0)
    acked_id = int(session.exec(
        select(func.coalesce(func.max(DesignTaskCanvasCommand.id), 0)).where(
            DesignTaskCanvasCommand.task_id == task_id,
            DesignTaskCanvasCommand.acknowledged_at.is_not(None),
        )
    ).one() or 0)
    return last_id, acked_id


def prune_design_task_outboxes(*, session: Session, cutoff: float, statuses: list[str]) -> dict[str, int]:
    """Delete old replay rows only for non-active tasks."""
    if not statuses:
        return {"events": 0, "commands": 0}
    finished = select(DesignTask.id).where(DesignTask.status.in_(statuses))
    event_result = session.exec(
        delete(DesignTaskEvent).where(
            DesignTaskEvent.created_at < cutoff,
            DesignTaskEvent.task_id.in_(finished),
        )
    )
    command_result = session.exec(
        delete(DesignTaskCanvasCommand).where(
            DesignTaskCanvasCommand.created_at < cutoff,
            DesignTaskCanvasCommand.task_id.in_(finished),
        )
    )
    session.commit()
    return {
        "events": int(event_result.rowcount or 0),
        "commands": int(command_result.rowcount or 0),
    }


def list_stale_design_tasks(
    *,
    session: Session,
    statuses: list[str],
    cutoff: float,
    limit: int = 100,
) -> list[DesignTask]:
    lim = max(1, min(int(limit or 100), 500))
    return list(
        session.exec(
            select(DesignTask)
            .where(col(DesignTask.status).in_(statuses))
            .where(func.coalesce(DesignTask.updated_at, 0) < cutoff)
            .order_by(col(DesignTask.updated_at).asc())
            .limit(lim)
        ).all()
    )


