"""Medium-term task state — session meta + snapshot table."""

from __future__ import annotations

import json
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.agent_memory.schema import normalize_task_state
from app.services.db import init_schema


def _parse_meta(raw: Any) -> dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(str(raw))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def load_task_state_from_session(
    user_id: str,
    session_id: str,
    *,
    project_id: str = "",
) -> dict[str, Any] | None:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    init_schema()
    with Session(engine) as session:
        row = crud.get_chat_session_owned(
            session=session, session_id=sid, user_id=user_id
        )
        if not row:
            return None
        meta = _parse_meta(row.meta_json)
    ts = meta.get("task_state")
    if not isinstance(ts, dict):
        return None
    return normalize_task_state(ts, session_id=sid, project_id=project_id, user_id=user_id)


def save_task_state_to_session(
    user_id: str,
    session_id: str,
    task_state: dict[str, Any],
) -> None:
    sid = str(session_id or "").strip()
    if not sid:
        return
    init_schema()
    now = time.time()
    payload = json.dumps({"task_state": task_state}, ensure_ascii=False)
    with Session(engine) as session:
        crud.update_chat_session_meta_json(
            session=session,
            session_id=sid,
            user_id=user_id,
            meta_json=payload,
            updated_at=now,
        )


def upsert_session_snapshot(
    user_id: str,
    session_id: str,
    project_id: str,
    task_state: dict[str, Any],
) -> None:
    sid = str(session_id or "").strip()
    if not sid:
        return
    init_schema()
    now = time.time()
    blob = json.dumps(task_state, ensure_ascii=False)
    pid = str(project_id or "").strip() or "__none__"
    with Session(engine) as session:
        crud.upsert_agent_session_snapshot(
            session=session,
            session_id=sid,
            user_id=user_id,
            project_id=pid,
            task_state_json=blob,
            updated_at=now,
            created_at=now,
        )


def persist_medium_term(
    user_id: str,
    session_id: str,
    project_id: str,
    task_state: dict[str, Any],
) -> None:
    save_task_state_to_session(user_id, session_id, task_state)
    upsert_session_snapshot(user_id, session_id, project_id, task_state)


def project_design_from_task_state(raw: Any) -> dict[str, Any]:
    from app.services.agent_memory.schema import empty_design_memory, normalize_design_memory

    if not isinstance(raw, dict):
        return empty_design_memory()["project"]
    return normalize_design_memory(raw.get("design"))["project"]


def load_project_design_memory(
    user_id: str,
    project_id: str,
    *,
    exclude_session_id: str = "",
) -> dict[str, Any]:
    """Latest project-layer DNA/system from another session of the same project."""
    from app.services.agent_memory.schema import empty_design_memory

    empty = empty_design_memory()["project"]
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if not uid or not pid or pid == "__none__":
        return empty
    init_schema()
    try:
        with Session(engine) as session:
            row = crud.get_latest_agent_session_snapshot_for_project(
                session=session,
                user_id=uid,
                project_id=pid,
                exclude_session_id=exclude_session_id,
            )
            if not row or not str(row.task_state_json or "").strip():
                return empty
            try:
                blob = json.loads(str(row.task_state_json))
            except Exception:
                return empty
            return project_design_from_task_state(blob)
    except Exception:
        return empty
