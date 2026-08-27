"""Tool ops pipeline — zuoge Harness pre hooks, validate, post hooks."""
from __future__ import annotations

from typing import Any

from app.services.design.ops.tool_ops_contract import assess_tool_ops_result
from app.services.design.runtime.agent_profile import resolve_tool_host
from app.services.design.runtime.seams.context import (
    pipeline_context_from_fields,
    pipeline_context_from_runtime,
)
from app.services.design.runtime.seams.registry import DEFAULT_HOOK_REGISTRY, HookRegistry
from app.services.design.runtime.seams.types import ToolPipelineContext


def validate_runtime_ops(
    rt: Any,
    st: Any,
    ops_raw: Any,
    *,
    stage: str,
    intent: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate ops through zuoge Harness pipeline for LangGraph nodes."""
    return validate_ops(pipeline_context_from_runtime(rt, st, stage=stage, intent=intent), ops_raw)


def validate_fields_ops(
    ops_raw: Any,
    *,
    stage: str,
    task_id: str = "",
    intent: str = "edit",
    scene_key: str = "",
    scene_nodes: list[Any] | None = None,
    scene_frames: list[Any] | None = None,
    rules: dict[str, Any] | None = None,
    skills_loaded: list[str] | None = None,
    prompt: str = "",
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate ops for standalone jobs (img_layers) without AgentRunState."""
    ctx = pipeline_context_from_fields(
        task_id=task_id,
        stage=stage,
        intent=intent,
        scene_key=scene_key,
        scene_nodes=scene_nodes,
        scene_frames=scene_frames,
        rules=rules,
        skills_loaded=skills_loaded,
        prompt=prompt,
    )
    return validate_ops(ctx, ops_raw)


def _skill_handler_pre(ctx: ToolPipelineContext, value: Any) -> Any:
    """Optional skill ``handler.py`` short-circuit before LLM paint."""
    if value is not None:
        return value
    from app.services.design.prompts.skill_store.ops_runner import try_skill_ops_for_paint

    ops, skill_key, err = try_skill_ops_for_paint(
        skill_keys=list(ctx.skills_loaded or []),
        prompt=str(ctx.prompt or ""),
        scene_key=str(ctx.scene_key or ""),
        scene_nodes=list(ctx.scene_nodes or []),
        scene_frames=list(ctx.scene_frames or []),
        design_brief=ctx.design_brief if isinstance(ctx.design_brief, dict) else None,
    )
    if ops is None:
        return None
    ctx.metadata["skill_ops_runner"] = skill_key
    if err:
        ctx.metadata["skill_ops_runner_error"] = err
    return ops


def _register_builtins(registry: HookRegistry, skill_keys: list[str] | None = None) -> None:
    if not registry.has_pre("skill_handler"):
        registry.register_pre("skill_handler", _skill_handler_pre, priority=10)
    keys = list(skill_keys or [])
    if not keys:
        return
    try:
        from app.services.design.prompts.skill_store.hooks_loader import (
            register_skill_pipeline_hooks,
        )

        register_skill_pipeline_hooks(registry, keys)
    except Exception:
        pass


def validate_ops(
    ctx: ToolPipelineContext,
    ops_raw: Any,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate tool_ops and apply density gate."""
    if not ops_raw:
        return [], []
    skills = list(ctx.skills_loaded or [])
    scene = ctx.scene_key or ""
    step_ops, op_errors = resolve_tool_host().validate_ops(
        ops_raw,
        scene_nodes=ctx.scene_nodes,
        scene_frames=ctx.scene_frames,
        rules=ctx.rules,
        skill_keys=skills,
        scene=scene,
        runtime=ctx.runtime,
    )
    errors = list(op_errors or [])
    if not step_ops:
        return [], errors
    # Skill handler short-circuit: keep validated ops; density gate is LLM-oriented.
    if ctx.metadata.get("skill_ops_runner"):
        return step_ops, errors
    dense_ok, dense_reason = assess_tool_ops_result(
        step_ops,
        intent=ctx.intent,
        scene=scene,
        nodes=ctx.scene_nodes,
        rules=ctx.rules,
        skill_keys=skills,
    )
    if not dense_ok:
        return [], errors + [dense_reason or "density_gate"]
    return step_ops, errors


def run_pipeline(
    ctx: ToolPipelineContext,
    ops_raw: Any,
    *,
    registry: HookRegistry | None = None,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    """Run pre hooks → validate → post hooks. Returns (ops, errors, metadata)."""
    reg = registry or DEFAULT_HOOK_REGISTRY
    _register_builtins(reg, list(ctx.skills_loaded or []))
    merged = reg.run_pre(ctx, ops_raw)
    step_ops, op_errors = validate_ops(ctx, merged)
    if step_ops:
        post = reg.run_post(ctx, step_ops)
        if isinstance(post, list):
            step_ops = [x for x in post if isinstance(x, dict)]
    return step_ops, op_errors, dict(ctx.metadata)


_register_builtins(DEFAULT_HOOK_REGISTRY, [])
