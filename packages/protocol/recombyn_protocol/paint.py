"""Open Paint / Decide tool_ops contracts."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


def paint_op_name(d: dict[str, Any]) -> str:
    return str(d.get("name") or "").strip()


def merge_nested_op_args(d: dict[str, Any]) -> dict[str, Any]:
    nested = d.get("args")
    if isinstance(nested, dict):
        return dict(nested)
    return {}


def coalesce_paint_tool_op(data: Any) -> Any:
    """Normalize one tool_op envelope to ``{name, args, op_id?}``."""
    if not isinstance(data, dict):
        return data
    d = dict(data)
    args = merge_nested_op_args(d)
    args.pop("op_id", None)
    out: dict[str, Any] = {"name": paint_op_name(d), "args": args}
    op_id = d.get("op_id")
    if op_id is not None and str(op_id).strip():
        out["op_id"] = str(op_id).strip()
    return out


class PaintToolOp(BaseModel):
    """LangChain envelope for one canvas op — ``{name, args}`` plus optional ``op_id``."""

    name: str = Field(..., min_length=1)
    args: dict[str, Any] = Field(
        default_factory=dict,
        description="Canvas op arguments.",
    )

    model_config = {"extra": "allow"}

    @model_validator(mode="before")
    @classmethod
    def _coalesce_flat_op(cls, data: Any) -> Any:
        return coalesce_paint_tool_op(data)


class AgentTurnSchema(BaseModel):
    """LangChain structured agent turn (canvas tool_ops stay FE-applied)."""

    thought: str = ""
    intent: str = "chat"
    reply: str = ""
    tool_ops: list[PaintToolOp] = Field(default_factory=list)
    need_tools: list[Any] = Field(default_factory=list)
    need_skills: list[Any] = Field(default_factory=list)
    need_subagents: list[Any] = Field(default_factory=list)
    choice_ui: Any = None
    done: bool | None = None

    model_config = {"extra": "allow"}


class DecideTurnSchema(BaseModel):
    """Decision stage only — never emits canvas ops (paint_ops node does that)."""

    thought: str = ""
    intent: str = "chat"
    reply: str = ""
    need_tools: list[Any] = Field(default_factory=list)
    need_skills: list[Any] = Field(default_factory=list)
    need_subagents: list[Any] = Field(default_factory=list)
    choice_ui: Any = None
    design_brief: Any = None
    done: bool | None = None

    model_config = {"extra": "allow"}


class PaintOpsSchema(BaseModel):
    """Paint stage — LangChain validates op envelope; host validates canvas semantics."""

    tool_ops: list[PaintToolOp] = Field(default_factory=list)
    intent: str = "create"
    reply: str = ""

    model_config = {"extra": "allow"}

    @field_validator("tool_ops", mode="before")
    @classmethod
    def _coerce_tool_ops_list(cls, value: Any) -> Any:
        if value is None:
            return []
        return value
