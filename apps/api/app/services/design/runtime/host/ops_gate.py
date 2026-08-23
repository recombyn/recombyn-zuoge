"""Paint ops validation gate (contract + skill allowlist + placement)."""
from __future__ import annotations

from typing import Any

from app.services.design.ops.tool_ops_contract import (
    _require_create_frame_for_auto_new_design,
    extract_and_validate_tool_ops,
)
from app.services.design.prompts.skill_store import filter_ops_by_skill_allowlist
from app.services.design.runtime.models_route import (
    normalize_paint_lane,
    normalize_user_intent,
    paint_ops_intent,
)

def _validate_ops_payload(
    raw: Any,
    *,
    nodes: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    rules: dict[str, str],
    skill_keys: list[str] | None = None,
    scene: str = "website",
    paint_lane: str | None = None,
    classified_intent: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    step_ops, op_errors = extract_and_validate_tool_ops(
        _normalize_ops_payload(raw),
        scene_nodes=nodes,
        scene_frames=frames,
        rules=rules,
        paint_lane=paint_lane,
        classified_intent=classified_intent,
    )
    if not step_ops and isinstance(raw, str):
        step_ops, op_errors = extract_and_validate_tool_ops(
            raw,
            scene_nodes=nodes,
            scene_frames=frames,
            rules=rules,
            paint_lane=paint_lane,
            classified_intent=classified_intent,
        )
    if skill_keys:
        step_ops, allow_errs = filter_ops_by_skill_allowlist(
            step_ops, skill_keys=skill_keys, scene=scene
        )
        op_errors = list(op_errors or []) + list(allow_errs or [])
    return step_ops, op_errors


def _op_name(op: dict[str, Any]) -> str:
    return str(op.get("name") or "").strip()


def _normalize_ops_payload(raw: Any) -> Any:
    """Pass through a tool_ops list or ``{tool_ops: [...]}`` envelope."""
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        inner = raw.get("tool_ops")
        if isinstance(inner, list):
            return {"tool_ops": _normalize_ops_payload(inner)}
        return raw
    return raw



def validate_paint_ops(
    raw_ops: Any,
    *,
    scene_nodes: list[dict[str, Any]],
    scene_frames: list[dict[str, Any]],
    rules: dict[str, str],
    skill_keys: list[str] | None = None,
    scene: str = "website",
    runtime: Any = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate paint ops (allowlist / fields / ids / dedupe + optional placement)."""
    from app.services.design.runtime.host.placement import placement_errors_for_free_creates

    paint_lane = None
    classified_intent = None
    if runtime is not None:
        paint_lane = (
            str(getattr(runtime, "classified_paint_lane", None) or "").strip()
            or str((getattr(runtime, "flags", None) or {}).get("paint_lane") or "").strip()
            or None
        )
        classified_intent = str(
            getattr(runtime, "classified_intent", None) or ""
        ).strip() or None

    step_ops, op_errors = _validate_ops_payload(
        raw_ops,
        nodes=scene_nodes,
        frames=scene_frames,
        rules=rules,
        skill_keys=skill_keys,
        scene=scene,
        paint_lane=paint_lane,
        classified_intent=classified_intent,
    )
    errors = list(op_errors or [])
    if step_ops and runtime is not None:
        intent = normalize_user_intent(classified_intent)
        lane = normalize_paint_lane(paint_lane, intent=intent or "chat")
        if paint_ops_intent(intent, lane) == "create" and intent == "design":
            flags = getattr(runtime, "flags", None) or {}
            host_ready = bool(flags.get("artboard_opened")) or str(
                getattr(runtime, "focus_id", "") or ""
            ).strip().startswith("ab_")
            size_errs = _require_create_frame_for_auto_new_design(
                step_ops,
                canvas_size=getattr(runtime, "canvas_size", None),
                host_plate_ready=host_ready,
            )
            if size_errs:
                return [], errors + list(size_errs)
        place_errs = placement_errors_for_free_creates(runtime, step_ops)
        if place_errs:
            return [], errors + list(place_errs)
    return step_ops, errors
