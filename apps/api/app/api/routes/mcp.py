"""MCP canvas control REST API."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.core.config import settings
from app.services.mcp.dispatch import McpCanvasError, call_mcp_canvas_tool
from app.services.mcp.push.channel import ack_pending_batches, fetch_pending_batches
from app.services.mcp.session import touch_live_session
from app.services.mcp.tool_registry import list_mcp_tool_definitions
from app.services.projects import ProjectForbiddenError, ProjectNotFoundError

router = APIRouter(prefix="/mcp/canvas", tags=["mcp-canvas"])


class McpToolCallIn(BaseModel):
    tool: str = Field(..., min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)


class McpHeartbeatIn(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=128)


class McpPendingAckIn(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=128)
    batch_ids: list[str] = Field(default_factory=list)


def _mcp_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, McpCanvasError):
        status = 400
        if exc.code in ("not_found",):
            status = 404
        elif exc.code in ("forbidden",):
            status = 403
        elif exc.code in ("revision_conflict",):
            status = 412
        return HTTPException(status_code=status, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, ProjectNotFoundError):
        return HTTPException(status_code=404, detail="Project not found")
    if isinstance(exc, ProjectForbiddenError):
        return HTTPException(status_code=403, detail="Forbidden")
    return HTTPException(status_code=500, detail=str(exc))


def _require_enabled() -> None:
    if not settings.mcp_canvas_enabled:
        raise HTTPException(status_code=503, detail="MCP canvas control is disabled")


@router.get("/tools")
def list_tools(current_user: CurrentUser) -> dict[str, Any]:
    _require_enabled()
    return {"tools": list_mcp_tool_definitions()}


@router.post("/call")
def call_tool(current_user: CurrentUser, body: McpToolCallIn) -> dict[str, Any]:
    _require_enabled()
    try:
        result = call_mcp_canvas_tool(
            user_id=current_user.id,
            tool=body.tool,
            arguments=body.arguments,
        )
        return {"ok": True, "result": result}
    except Exception as exc:
        raise _mcp_http_error(exc) from exc


@router.post("/session/heartbeat")
def session_heartbeat(current_user: CurrentUser, body: McpHeartbeatIn) -> dict[str, Any]:
    _require_enabled()
    touch_live_session(body.project_id, user_id=current_user.id)
    return {"ok": True, "projectId": body.project_id}


@router.get("/pending")
def list_pending(
    current_user: CurrentUser,
    project_id: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(8, ge=1, le=32),
) -> dict[str, Any]:
    _require_enabled()
    # ACL: must be able to read project
    from app.services.mcp.auth import load_writable_project

    load_writable_project(current_user.id, project_id)
    batches = fetch_pending_batches(project_id, limit=limit)
    return {"projectId": project_id, "batches": batches}


@router.post("/pending/ack")
def ack_pending(current_user: CurrentUser, body: McpPendingAckIn) -> dict[str, Any]:
    _require_enabled()
    from app.services.mcp.auth import load_writable_project

    load_writable_project(current_user.id, body.project_id)
    removed = ack_pending_batches(body.project_id, body.batch_ids)
    return {"ok": True, "removed": removed}
