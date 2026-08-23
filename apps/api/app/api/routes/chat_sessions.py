"""Chat session CRUD API — persists agent conversations per user/project."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from app.api.deps import CurrentUser
from pydantic import BaseModel, Field

from app.services import chat_store

router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])






class ChatMessageIn(BaseModel):
    id: str | None = None
    role: str = "user"
    content: str = ""
    contexts: list[dict[str, Any]] | None = None
    contentMarked: str | None = None
    thinking: str | None = None
    durationMs: int | None = None
    intent: str | None = None
    steps: list[dict[str, Any]] | None = None
    images: list[str] | None = None


class UpsertSessionIn(BaseModel):
    projectId: str = Field(default="__none__", max_length=128)
    id: str | None = Field(default=None, max_length=64)
    title: str = Field(default="", max_length=255)
    messages: list[ChatMessageIn] = Field(default_factory=list)
    taskState: dict[str, Any] | None = Field(default=None, description="Agent task_state snapshot")


@router.get("/sessions")
def get_sessions(
    current_user: CurrentUser,
    projectId: str = "__none__",
) -> dict[str, Any]:
    sessions = chat_store.list_sessions(current_user.id, projectId)
    return {"sessions": sessions}


@router.put("/sessions")
def put_session(
    current_user: CurrentUser,
    body: UpsertSessionIn,
) -> dict[str, Any]:
    session = chat_store.upsert_session(
        current_user.id,
        body.projectId,
        session_id=body.id,
        title=body.title,
        messages=[m.model_dump() for m in body.messages],
        task_state=body.taskState,
    )
    return {"session": session}


@router.delete("/sessions/{session_id}")
def remove_session(
    current_user: CurrentUser,
    session_id: str,
) -> dict[str, Any]:
    ok = chat_store.delete_session(current_user.id, session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}
