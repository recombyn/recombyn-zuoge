"""Build ToolPipelineContext from LangGraph runtime (zuoge Harness seams)."""
from __future__ import annotations

from typing import Any

from app.services.design.runtime.agent_profile import active_profile_id
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime
from app.services.design.runtime.seams.types import ToolPipelineContext


def _profile_id(explicit: str | None = None) -> str:
    return str(explicit or "").strip() or active_profile_id() or "design.canvas"


def _as_dict(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def pipeline_context_from_fields(
    *,
    task_id: str = "",
    stage: str,
    intent: str = "edit",
    scene_key: str = "",
    profile_id: str | None = None,
    skills_loaded: list[str] | None = None,
    scene_nodes: list[Any] | None = None,
    scene_frames: list[Any] | None = None,
    rules: dict[str, Any] | None = None,
    runtime: Any = None,
    prompt: str = "",
    design_brief: dict[str, Any] | None = None,
) -> ToolPipelineContext:
    """Context for graph nodes or standalone jobs (img_layers)."""
    return ToolPipelineContext(
        task_id=str(task_id or "").strip(),
        stage=str(stage or "paint_ops").strip() or "paint_ops",
        profile_id=_profile_id(profile_id),
        intent=str(intent or "edit").strip() or "edit",
        scene_key=str(scene_key or ""),
        skills_loaded=list(skills_loaded or []),
        scene_nodes=list(scene_nodes or []),
        scene_frames=list(scene_frames or []),
        rules=_as_dict(rules),
        runtime=runtime,
        prompt=str(prompt or ""),
        design_brief=design_brief if isinstance(design_brief, dict) else None,
    )


def pipeline_context_from_runtime(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    stage: str,
    intent: str | None = None,
) -> ToolPipelineContext:
    resolved = str(
        intent or st.intent or getattr(rt, "classified_intent", None) or "create"
    ).strip()
    return pipeline_context_from_fields(
        task_id=st.task_id,
        stage=stage,
        intent=resolved,
        scene_key=str(rt.scene_key or ""),
        skills_loaded=list(st.skills_loaded or []),
        scene_nodes=list(rt.scene_nodes or []),
        scene_frames=list(rt.scene_frames or []),
        rules=_as_dict(rt.rules),
        runtime=rt,
        prompt=str(rt.prompt or ""),
        design_brief=rt.design_brief if isinstance(rt.design_brief, dict) else None,
    )
