"""Chat session persistence — MySQL/PostgreSQL via services.db."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.services.db import init_schema

_MAX_SESSIONS = 40
_MAX_MESSAGES = 200


def _pack_message_meta(m: dict[str, Any]) -> str | None:
    meta: dict[str, Any] = {}
    raw_meta = m.get("meta")
    if isinstance(raw_meta, dict):
        meta.update(raw_meta)
    if m.get("durationMs") is not None:
        try:
            meta["durationMs"] = int(m["durationMs"])
        except (TypeError, ValueError):
            pass
    intent = m.get("intent")
    if isinstance(intent, str) and intent.strip():
        meta["intent"] = intent.strip()
    steps = m.get("steps")
    if isinstance(steps, list) and steps:
        meta["steps"] = steps
    images = m.get("images")
    if isinstance(images, list) and images:
        cleaned = [str(u).strip() for u in images if isinstance(u, str) and str(u).strip()]
        if cleaned:
            meta["images"] = cleaned[:24]
    contexts = m.get("contexts")
    if isinstance(contexts, list) and contexts:
        meta["contexts"] = contexts
    content_marked = m.get("contentMarked")
    if isinstance(content_marked, str) and content_marked:
        meta["contentMarked"] = content_marked
    # Copy Ask / resume fields from the write payload.
    ask_fields = {
        "designTaskId": m.get("designTaskId"),
        "canResume": True if m.get("canResume") is True else None,
        "proposedOps": m.get("proposedOps"),
        "choiceUi": m.get("choiceUi"),
        "proposalId": m.get("proposalId"),
    }
    _copy_ask_fields({k: v for k, v in ask_fields.items() if v is not None}, meta)
    if not meta:
        return None
    try:
        return json.dumps(meta, ensure_ascii=False)
    except Exception:
        return None


def _unpack_message_meta(raw: Any) -> dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(str(raw))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _copy_ask_fields(src: dict[str, Any], dest: dict[str, Any]) -> None:
    """Copy Ask confirm / resume fields (already camelCase)."""
    if src.get("designTaskId"):
        dest["designTaskId"] = str(src["designTaskId"]).strip()[:64]
    if src.get("canResume") is True:
        dest["canResume"] = True
    if isinstance(src.get("proposedOps"), list) and src["proposedOps"]:
        dest["proposedOps"] = src["proposedOps"][:48]
    if isinstance(src.get("choiceUi"), dict) and src["choiceUi"]:
        dest["choiceUi"] = src["choiceUi"]
    if isinstance(src.get("proposalId"), str) and src["proposalId"].strip():
        dest["proposalId"] = src["proposalId"].strip()[:64]


def _message_public(m: dict[str, Any], *, sort_fallback: int = 0) -> dict[str, Any]:
    meta = _unpack_message_meta(m.get("meta_json"))
    # Flat fields on write payload also win when listing from in-memory upsert return.
    if m.get("durationMs") is not None and "durationMs" not in meta:
        try:
            meta["durationMs"] = int(m["durationMs"])
        except (TypeError, ValueError):
            pass
    if m.get("intent") and "intent" not in meta:
        meta["intent"] = m["intent"]
    if m.get("steps") and "steps" not in meta:
        meta["steps"] = m["steps"]
    if m.get("images") and "images" not in meta:
        meta["images"] = m["images"]
    if m.get("contexts") and "contexts" not in meta:
        meta["contexts"] = m["contexts"]
    if m.get("contentMarked") and "contentMarked" not in meta:
        meta["contentMarked"] = m["contentMarked"]
    _copy_ask_fields(m, meta)

    out: dict[str, Any] = {
        "id": (m.get("id") or "").strip() or f"msg_{sort_fallback}",
        "role": (m.get("role") or "user"),
        "content": m.get("content") or "",
    }
    thinking = m.get("thinking")
    if thinking:
        out["thinking"] = thinking
    if meta.get("durationMs") is not None:
        out["durationMs"] = meta["durationMs"]
    if meta.get("intent"):
        out["intent"] = meta["intent"]
    if isinstance(meta.get("steps"), list) and meta["steps"]:
        out["steps"] = meta["steps"]
    if isinstance(meta.get("images"), list) and meta["images"]:
        out["images"] = [
            str(u).strip() for u in meta["images"] if isinstance(u, str) and str(u).strip()
        ][:24]
    if isinstance(meta.get("contexts"), list) and meta["contexts"]:
        out["contexts"] = meta["contexts"]
    if isinstance(meta.get("contentMarked"), str) and meta["contentMarked"]:
        out["contentMarked"] = meta["contentMarked"]
    _copy_ask_fields(meta, out)
    return out


def list_sessions(user_id: str, project_id: str) -> list[dict[str, Any]]:
    """Return sessions for user/project, newest first, each with messages."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_schema()
    pid = (project_id or "").strip() or "__none__"
    with Session(engine) as session:
        rows = crud.list_chat_sessions(
            session=session, user_id=user_id, project_id=pid, limit=_MAX_SESSIONS
        )
        result: list[dict[str, Any]] = []
        for r in rows:
            msgs = crud.list_chat_messages(
                session=session, session_id=str(r.id), limit=_MAX_MESSAGES
            )
            result.append(
                {
                    "id": r.id,
                    "projectId": r.project_id,
                    "title": r.title or "",
                    "updatedAt": int(float(r.updated_at) * 1000),
                    "createdAt": int(float(r.created_at) * 1000),
                    "taskState": _unpack_session_task_state(r.meta_json),
                    "messages": [
                        _message_public(
                            {
                                "id": m.id,
                                "role": m.role,
                                "content": m.content,
                                "thinking": m.thinking,
                                "meta_json": m.meta_json,
                            },
                            sort_fallback=i,
                        )
                        for i, m in enumerate(msgs)
                    ],
                }
            )
    return result


def _unpack_session_task_state(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(str(raw)) if not isinstance(raw, dict) else raw
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    ts = data.get("task_state")
    return ts if isinstance(ts, dict) else None


def _pack_session_meta(task_state: dict[str, Any] | None) -> str | None:
    if not task_state or not isinstance(task_state, dict):
        return None
    try:
        return json.dumps({"task_state": task_state}, ensure_ascii=False)
    except Exception:
        return None


def upsert_session(
    user_id: str,
    project_id: str,
    *,
    session_id: str | None = None,
    title: str = "",
    messages: list[dict[str, Any]] | None = None,
    task_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create or replace a session and its messages. Enforces max 40 sessions."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_schema()
    pid = (project_id or "").strip() or "__none__"
    sid = (session_id or "").strip() or f"chat_{uuid.uuid4().hex[:16]}"
    title_n = (title or "").strip()[:255]
    now = time.time()
    msgs = (messages or [])[-_MAX_MESSAGES:]
    packed = _pack_session_meta(task_state)

    prepared: list[dict[str, Any]] = []
    for i, m in enumerate(msgs):
        mid = (m.get("id") or "").strip() or f"msg_{uuid.uuid4().hex[:12]}"
        role = (m.get("role") or "user").strip()[:16]
        prepared.append(
            {
                "id": mid,
                "role": role,
                "content": m.get("content") or "",
                "thinking": m.get("thinking"),
                "meta_json": _pack_message_meta(m),
                "created_at": now + (i * 0.001),
                "sort_order": i,
            }
        )

    with Session(engine) as session:
        existing = crud.get_chat_session_owned(
            session=session, session_id=sid, user_id=user_id
        )
        created = float(existing.created_at) if existing else now
        # Only write meta_json on update when packed is provided (preserve otherwise).
        meta_for_write = packed
        if existing and packed is None:
            meta_for_write = existing.meta_json
        crud.upsert_chat_session_with_messages(
            session=session,
            user_id=user_id,
            project_id=pid,
            session_id=sid,
            title=title_n,
            updated_at=now,
            created_at=created,
            meta_json=meta_for_write,
            messages=prepared,
            max_sessions=_MAX_SESSIONS,
        )

    out_task_state = task_state if isinstance(task_state, dict) else None
    return {
        "id": sid,
        "projectId": pid,
        "title": title_n,
        "updatedAt": int(now * 1000),
        "createdAt": int(created * 1000),
        "taskState": out_task_state,
        "messages": [_message_public(m, sort_fallback=i) for i, m in enumerate(msgs)],
    }


def delete_session(user_id: str, session_id: str) -> bool:
    """Delete a session owned by user. Returns False if not found."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_schema()
    with Session(engine) as session:
        return crud.delete_chat_session_owned(
            session=session, session_id=session_id, user_id=user_id
        )
