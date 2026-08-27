"""Tool pipeline context types."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

ToolOpsHook = Callable[["ToolPipelineContext", Any], Any]


@dataclass
class ToolPipelineContext:
    task_id: str
    stage: str
    profile_id: str
    intent: str
    scene_key: str
    skills_loaded: list[str] = field(default_factory=list)
    scene_nodes: list[Any] = field(default_factory=list)
    scene_frames: list[Any] = field(default_factory=list)
    rules: dict[str, Any] = field(default_factory=dict)
    runtime: Any = None
    prompt: str = ""
    design_brief: dict[str, Any] | None = None
    ops_raw: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)
