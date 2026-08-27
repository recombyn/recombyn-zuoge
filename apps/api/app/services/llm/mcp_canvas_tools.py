"""LangChain tools — MCP canvas control for Design Agent (react mode)."""
from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def mcp_canvas_langchain_tools(*, user_id: str, project_id: str | None = None) -> list[Any]:
    """Server-side canvas read/write via MCP dispatch when enabled."""
    from app.core.config import settings

    if not settings.mcp_canvas_enabled:
        return []

    from langchain_core.tools import StructuredTool

    from app.services.mcp.dispatch import McpCanvasError, call_mcp_canvas_tool

    uid = str(user_id or "").strip()
    default_pid = str(project_id or "").strip()

    def _run(tool: str, arguments: dict[str, Any] | None = None) -> str:
        args = dict(arguments or {})
        if default_pid and not args.get("project_id") and not args.get("projectId"):
            args["project_id"] = default_pid
        try:
            result = call_mcp_canvas_tool(user_id=uid, tool=tool, arguments=args)
            return json.dumps(result, ensure_ascii=False)
        except McpCanvasError as exc:
            return json.dumps({"error": str(exc), "code": exc.code}, ensure_ascii=False)

    class ProjectIdArgs(BaseModel):
        model_config = ConfigDict(extra="forbid")
        project_id: str | None = Field(default=None, description="Recombyn project id")

    class ApplyOpsArgs(BaseModel):
        model_config = ConfigDict(extra="forbid")
        project_id: str | None = Field(default=None)
        ops: list[dict[str, Any]] = Field(description="Canvas tool_ops batch")

    tools: list[Any] = [
        StructuredTool.from_function(
            func=lambda project_id=None: _run(
                "get_scene_summary", {"project_id": project_id or default_pid}
            ),
            name="canvas_get_scene_summary",
            description="Read Recombyn canvas summary for a project (frames, nodes, types).",
            args_schema=ProjectIdArgs,
        ),
        StructuredTool.from_function(
            func=lambda project_id=None, ops=None: _run(
                "apply_tool_ops",
                {"project_id": project_id or default_pid, "ops": ops or []},
            ),
            name="canvas_apply_tool_ops",
            description="Apply validated canvas tool_ops to a Recombyn project (MCP dispatch).",
            args_schema=ApplyOpsArgs,
        ),
    ]
    return tools
