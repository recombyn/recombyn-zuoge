"""Project ACL for MCP canvas calls."""
from __future__ import annotations

from typing import Any

from app.services import projects as project_store
from app.services.projects import ProjectForbiddenError, ProjectNotFoundError


def load_writable_project(user_id: str, project_id: str) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    if not pid:
        raise ProjectNotFoundError("")
    row = project_store.get_project(user_id, pid)
    if not row:
        raise ProjectNotFoundError(pid)
    return row


def project_revision(row: dict[str, Any]) -> int:
    return int(row.get("revision") or 1)
