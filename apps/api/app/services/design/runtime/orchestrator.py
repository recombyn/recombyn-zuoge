"""Design job orchestrator — permission gate then LangGraph agent (or partial).

SSE: status | decision | skill_start | skill_progress | skill_done | analysis |
  thinking | tool_ops | activity | scene_feedback_request | result |
  memory_patch | token | chat_done | error
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.services.agent_memory.service import memory_service
from app.services.design.readpath.canvas_scene import (
    parse_size as _parse_size,
    scene_key as _scene_key,
)
from app.services.design.readpath.catalog import get_global_rules
from app.services.design.runtime.agent_profile import apply_profile_rules
from app.services.design.runtime.decision_log import (
    DesignRunDecision,
    focus_frame_from_medium,
    probe_has_target_chip,
)
from app.services.design.runtime.llm_step import stream_skill_step
from app.services.design.runtime.models_route import (
    apply_user_route_overrides,
    pin_user_locked_model_routes,
    resolve_model_for_skill,
    sanitize_model_ref_for_openrouter_region,
    sanitize_rules_for_openrouter_region,
)
from app.services.design.runtime.pipeline_support import (
    _normalize_ref_images,
    _run_error_code,
    _user_facing_run_error,
)
from app.services.design.prompts.prompt_build import (
    _edit_context_block,
    _finalize_memory_patch,
)
from app.services.design.prompts.rules_text import _as_text, _rule_text, _stage, exec_trace
from app.services.design.admin.task_store import _insert_task, _lock_layers, _update_task
from app.services.design.ops.tool_ops_contract import (
    TOOL_OPS_SCHEMA_VERSION,
    extract_and_validate_tool_ops,
    format_canvas_tools_for_model,
    tool_ops_activity_events as _tool_ops_activity_events,
    tool_ops_for_sse,
    validation_failure_reason,
)
from app.services.wallet.billing import (
    byok_agent_fee_credits,
    estimate_design_hold_credits,
    settle_token_hold,
)
from app.services.wallet.db import (
    consume_free_daily_quota,
    grant_credits,
    free_daily_remaining,
    get_user_credits,
    is_wallet_billing_enabled,
    spend_credits,
)

_log = logging.getLogger(__name__)

# Fallback authorize ceilings if TaskPricing import fails.
AGENT_HOLD = 30
PARTIAL_HOLD = 10
SINGLE_HOLD = 20


def _platform_rules_with_profile() -> dict[str, str]:
    """Global KV rules with active AgentProfile policy overlaid."""
    return apply_profile_rules(get_global_rules())


def _authorize_need(
    mode: str,
    *,
    model: str | None = None,
    rules: dict[str, str] | None = None,
) -> int:
    """TaskPricing authorize ceiling; BYOK → agent fee; cloud may quote."""
    from app.services.llm import is_byok_model_ref

    if is_byok_model_ref(model):
        return max(0, byok_agent_fee_credits(rules))
    try:
        from app.services.design.intelligence_runtime import quote_remote_task_credits

        quoted = quote_remote_task_credits({"mode": mode, "byok": False})
        if isinstance(quoted, dict):
            hi = int(quoted.get("authorize_high") or 0)
            if hi > 0:
                return hi
    except Exception:
        pass
    try:
        return estimate_design_hold_credits(mode, rules=rules)
    except Exception:
        if mode == "agent":
            return AGENT_HOLD
        if mode == "partial":
            return PARTIAL_HOLD
        return SINGLE_HOLD


def _reserve_design_hold(
    user_id: str,
    hold: int,
    *,
    mode: str,
    model: str | None = None,
) -> tuple[int, bool]:
    """
    Authorize ``hold`` credits, or free daily when balance is short.
    Returns (hold_to_settle, free_daily). free_daily ⇒ hold 0 and force Auto.
    BYOK still authorizes Agent fee (provider $ waived at settle).
    """
    if not is_wallet_billing_enabled():
        return 0, False

    need = max(0, int(hold or 0))
    if need <= 0:
        return 0, False
    bal = get_user_credits(user_id)
    if bal >= need:
        spend_credits(user_id, need, detail=f"design_hold:{mode}")
        return need, False
    if consume_free_daily_quota(user_id):
        return 0, True
    raise ValueError("insufficient_credits")


def _refund_hold(user_id: str, hold: int, *, task_id: str) -> None:
    if hold > 0:
        grant_credits(user_id, hold, detail=f"design_refund:{task_id}")


def _image_extra_credits(rules: dict[str, str] | None, images_hydrated: int) -> int:
    """Seedream hydrate → wallet credits (元/张 × count)."""
    n = max(0, int(images_hydrated or 0))
    if n <= 0:
        return 0
    from app.services.wallet.billing import image_model_credit_cost

    mid = ""
    if isinstance(rules, dict):
        mid = str(rules.get("assets.image_default_model") or "").strip()
    return image_model_credit_cost(mid or None, count=n, rules=rules)


def _settle_hold(
    user_id: str,
    *,
    hold: int,
    actual_tokens: int,
    detail: str,
    rules: dict[str, str] | None,
    free_daily: bool = False,
    images_hydrated: int = 0,
    byok: bool = False,
    mode: str = "agent",
    meters: dict[str, Any] | None = None,
    task_id: str = "",
) -> int:
    if free_daily or hold <= 0:
        return 0
    return settle_token_hold(
        user_id,
        hold=hold,
        actual_tokens=actual_tokens,
        detail=detail,
        rules=rules,
        extra_credits=_image_extra_credits(rules, images_hydrated),
        byok=byok,
        mode=mode,
        images_hydrated=images_hydrated,
        meters=meters,
        task_id=task_id,
    )


def _resolve_scene_frames(
    scene_frames: list[dict[str, Any]] | None,
    medium: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Prefer FE snapshot; fall back to task_state memory frames."""
    if scene_frames:
        return [
            dict(f)
            for f in scene_frames
            if isinstance(f, dict) and f.get("id")
        ][:32]
    canvas = medium.get("canvas") if isinstance(medium, dict) and isinstance(medium.get("canvas"), dict) else {}
    frames = canvas.get("frames") if isinstance(canvas.get("frames"), list) else []
    return [
        dict(f) for f in frames if isinstance(f, dict) and f.get("id")
    ][:32]




async def run_design_job(
    *,
    user_id: str,
    run_mode: str,
    prompt: str,
    scene: str | None = None,
    style_group_id: int | None = None,
    user_selected_model: str | None = "auto",
    canvas_id: str | None = None,
    canvas_size: str | None = None,
    target_layer_id: str | None = None,
    layer_ids: list[str] | None = None,
    current_svg: str | None = None,
    scene_nodes: list[dict[str, Any]] | None = None,
    scene_frames: list[dict[str, Any]] | None = None,
    spatial_summary: dict[str, Any] | None = None,
    focus_frame_id: str | None = None,
    images: list[str] | None = None,
    ref_image_sizes: list[str] | None = None,
    is_premium: bool = False,
    session_id: str | None = None,
    project_id: str | None = None,
    memory: dict[str, Any] | None = None,
    route_overrides: dict[str, Any] | None = None,
    apply_ops: list[dict[str, Any]] | None = None,
    proposal_id: str | None = None,
    proposal_task_id: str | None = None,
    interaction_mode: str | None = None,
    client_country: str | None = None,
    skill_refs: list[str] | None = None,
    paint_mode: str | None = None,
    locale: str | None = None,
    design_intensity: str | None = None,
    task_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """LangGraph agent loop. Chat vs design from model intent / ops."""
    del is_premium  # reserved
    mode = _as_text(run_mode or "agent").strip().lower()
    if mode not in ("agent", "single_model", "partial"):
        yield {"type": "error", "code": "invalid_run_mode", "message": "invalid_run_mode"}
        return

    ui_mode = _as_text(interaction_mode or "agent").strip().lower()
    if ui_mode not in ("agent", "ask"):
        ui_mode = "agent"

    from app.services.design.board_modes import is_img_layers_mode

    use_img_layers = (
        is_img_layers_mode(paint_mode)
        and mode in ("agent", "single_model")
        and ui_mode == "agent"
        and not apply_ops
    )

    prompt = _as_text(prompt).strip()
    if not prompt and not apply_ops:
        yield {"type": "error", "code": "prompt_required", "message": "prompt_required"}
        return
    if not prompt and apply_ops:
        prompt = "确认执行"

    t0 = time.time()
    exec_trace(
        t0,
        "BEGIN",
        mode="orchestrator",
        prompt=prompt[:80],
        model=user_selected_model,
        canvas=canvas_size,
        run_mode=mode,
        refs=len(images or []),
    )
    await asyncio.sleep(0)

    # —— Agent / single_model: permission → ReAct controller ——
    if mode in ("agent", "single_model"):
        from app.services.llm import is_byok_model_ref

        byok_run = is_byok_model_ref(user_selected_model)
        skip_wallet = not is_wallet_billing_enabled()
        hold_need = _authorize_need(mode, model=user_selected_model)
        bal = int(get_user_credits(user_id) or 0)
        free_left = int(free_daily_remaining(user_id) or 0)
        can = skip_wallet or bal >= hold_need or free_left > 0 or hold_need <= 0
        yield {
            "type": "permission",
            "can_call_llm": bool(can),
            "balance": bal,
            "need": 0 if skip_wallet else hold_need,
            "free_daily": free_left > 0,
            "byok": bool(byok_run),
        }

        if not can:
            yield {
                "type": "error",
                "code": (
                    "free_daily_exhausted"
                    if bal < hold_need
                    else "insufficient_credits"
                ),
                "message": (
                    "free_daily_exhausted"
                    if bal < hold_need
                    else "insufficient_credits"
                ),
                "balance": bal,
                "need": hold_need,
            }
            exec_trace(t0, "DONE", mode="permission", can_call_llm=False, balance=bal)
            return

        platform_rules = _platform_rules_with_profile()
        user_selected_model = sanitize_model_ref_for_openrouter_region(
            user_selected_model,
            platform_rules=platform_rules,
            country=client_country,
        )
        rules = pin_user_locked_model_routes(
            sanitize_rules_for_openrouter_region(
                apply_user_route_overrides(platform_rules, route_overrides),
                platform_rules=platform_rules,
                country=client_country,
            ),
            user_selected_model,
        )
        hold_need = _authorize_need(
            mode, model=user_selected_model, rules=rules
        )
        free_daily = False
        try:
            hold, free_daily = _reserve_design_hold(
                user_id, hold_need, mode=mode, model=user_selected_model
            )
        except ValueError:
            yield {
                "type": "error",
                "code": (
                    "free_daily_exhausted"
                    if bal < hold_need
                    else "insufficient_credits"
                ),
                "message": (
                    "free_daily_exhausted"
                    if bal < hold_need
                    else "insufficient_credits"
                ),
                "balance": bal,
                "need": hold_need,
            }
            return
        if free_daily:
            from app.services.llm import is_byok_model_ref

            # BYOK uses the user's own key — do not force platform auto model.
            if not is_byok_model_ref(user_selected_model):
                user_selected_model = "auto"

        scene_nodes_gate = [
            n for n in (scene_nodes or []) if isinstance(n, dict) and n.get("id")
        ][:120]
        # Light memory load for frame resolve only
        sid = _as_text(session_id).strip()
        pid = _as_text(project_id or canvas_id).strip() or "__none__"
        mem_preview = memory or {}
        medium = mem_preview.get("medium") if isinstance(mem_preview, dict) else None
        scene_frames_gate = _resolve_scene_frames(
            scene_frames,
            medium if isinstance(medium, dict) else None,
        )

        from app.services.llm import reset_byok_user_id, set_byok_user_id

        byok_token = set_byok_user_id(user_id)
        try:
            if use_img_layers:
                from app.services.design.img_layers import run_img_layers_job

                async for ev in run_img_layers_job(
                    user_id=user_id,
                    prompt=prompt,
                    rules=rules,
                    canvas_size=canvas_size,
                    images=images,
                    session_id=sid,
                    project_id=pid,
                    hold=hold,
                    free_daily=free_daily,
                    t0=t0,
                    settle_hold_fn=_settle_hold,
                    refund_hold_fn=_refund_hold,
                    scene=scene,
                ):
                    yield ev
            else:
                from app.services.design.runtime.design_run import design_stream

                async for ev in design_stream(
                    user_id=user_id,
                    mode=mode,
                    prompt=prompt,
                    rules=rules,
                    user_selected_model=user_selected_model,
                    canvas_id=canvas_id,
                    canvas_size=canvas_size,
                    scene=scene,
                    scene_nodes=scene_nodes_gate,
                    scene_frames=scene_frames_gate,
                    spatial_summary=spatial_summary if isinstance(spatial_summary, dict) else None,
                    focus_frame_id=focus_frame_id,
                    images=images,
                    memory_in=memory,
                    session_id=sid,
                    project_id=pid,
                    hold=hold,
                    free_daily=free_daily,
                    t0=t0,
                    reserve_hold_fn=_reserve_design_hold,
                    settle_hold_fn=_settle_hold,
                    refund_hold_fn=_refund_hold,
                    task_id=task_id,
                    apply_ops=apply_ops,
                    proposal_id=proposal_id,
                    proposal_task_id=proposal_task_id,
                    interaction_mode=ui_mode,
                    skill_refs=skill_refs,
                    locale=locale,
                    design_intensity=design_intensity,
                ):
                    yield ev
        finally:
            reset_byok_user_id(byok_token)
        return

    platform_rules = _platform_rules_with_profile()
    user_selected_model = sanitize_model_ref_for_openrouter_region(
        user_selected_model,
        platform_rules=platform_rules,
        country=client_country,
    )
    rules = pin_user_locked_model_routes(
        sanitize_rules_for_openrouter_region(
            apply_user_route_overrides(platform_rules, route_overrides),
            platform_rules=platform_rules,
            country=client_country,
        ),
        user_selected_model,
    )

    # Partial path below (unchanged lean tool_ops).
    ref_images = _normalize_ref_images(images, rules=rules)
    sid = _as_text(session_id).strip()
    pid = _as_text(project_id or canvas_id).strip() or "__none__"
    exec_trace(t0, "memory_load_start", mode="orchestrator")
    mem_bundle = memory_service.load(
        user_id=user_id,
        session_id=sid,
        project_id=pid,
        memory_in=memory,
        rules=rules,
        query=prompt,
        scene=_scene_key(scene) or "",
    )
    exec_trace(
        t0,
        "memory_load_done",
        mode="orchestrator",
        blocks_chars=len(mem_bundle.blocks or ""),
        short=len(mem_bundle.short),
        long=len(mem_bundle.long_hits),
        episodes=len(mem_bundle.episodes),
        kg=len(mem_bundle.kg_triples),
    )
    trace_id = str(uuid.uuid4())
    has_target = probe_has_target_chip(prompt)
    scene_nodes_gate = [
        n for n in (scene_nodes or []) if isinstance(n, dict) and n.get("id")
    ][:120]
    scene_frames_gate = _resolve_scene_frames(scene_frames, mem_bundle.medium)
    focus_id = (
        _as_text(focus_frame_id).strip()
        or focus_frame_from_medium(mem_bundle.medium)
    )
    has_focus = bool(focus_id)
    has_canvas_gate = bool(
        (current_svg or "").strip() or scene_nodes_gate or has_focus
    )
    decision = DesignRunDecision(
        trace_id=trace_id,
        session_id=sid or None,
        focus_frame_id=focus_id,
        memory_injected=bool(mem_bundle.blocks),
        memory_blocks_chars=len(mem_bundle.blocks or ""),
        short_turns=len(mem_bundle.short),
        content_pack_version=_rule_text(rules, "content_pack_version") or None,
        probe_len=len(prompt),
        has_target_chip=has_target,
        has_ref_images=bool(ref_images),
        has_scene_nodes=bool(scene_nodes_gate),
        wants_pipeline=False,
        blank_artboard_only=False,
        intent=None,
        is_chitchat=False,
    )
    if mode == "partial":
        async for ev in _run_partial(
            user_id=user_id,
            prompt=prompt,
            rules=rules,
            user_selected_model=user_selected_model,
            canvas_id=canvas_id,
            canvas_size=canvas_size,
            target_layer_id=target_layer_id,
            layer_ids=layer_ids,
            current_svg=current_svg or "",
            scene_nodes=scene_nodes_gate,
            scene=scene,
            ref_images=ref_images,
            mem_bundle=mem_bundle,
            sid=sid,
            pid=pid,
            decision=decision,
            t0=t0,
            task_id=task_id,
        ):
            yield ev
        return
    yield {"type": "error", "code": "invalid_run_mode", "message": "invalid_run_mode"}


async def run_design_job_from_snapshot(
    *,
    user_id: str,
    snapshot: dict[str, Any],
    task_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Execute the versioned request DTO shared by HTTP and Celery adapters."""
    if int(snapshot.get("version") or 0) != 2:
        yield {"type": "error", "code": "snapshot_unavailable", "message": "snapshot_unavailable"}
        return

    def value(name: str, expected: type) -> Any:
        item = snapshot.get(name)
        return item if isinstance(item, expected) else None

    async for event in run_design_job(
        user_id=user_id,
        run_mode=str(snapshot.get("mode") or "agent"),
        prompt=str(snapshot.get("prompt") or ""),
        scene=value("scene", str),
        style_group_id=value("style_group_id", int),
        user_selected_model=str(snapshot.get("user_selected_model") or "auto"),
        canvas_id=value("canvas_id", str),
        canvas_size=value("canvas_size", str),
        ref_image_sizes=value("ref_image_sizes", list),
        target_layer_id=value("target_layer_id", str),
        layer_ids=value("layer_ids", list),
        current_svg=value("current_svg", str),
        scene_nodes=value("scene_nodes", list),
        scene_frames=value("scene_frames", list),
        spatial_summary=value("spatial_summary", dict),
        focus_frame_id=value("focus_frame_id", str),
        images=value("images", list),
        session_id=value("session_id", str),
        project_id=value("project_id", str),
        memory=value("memory", dict),
        route_overrides=value("route_overrides", dict),
        apply_ops=value("apply_ops", list),
        proposal_id=value("proposal_id", str),
        proposal_task_id=value("proposal_task_id", str),
        interaction_mode=value("interaction_mode", str),
        client_country=value("client_country", str),
        skill_refs=value("skill_refs", list),
        paint_mode=value("paint_mode", str),
        locale=value("locale", str),
        design_intensity=value("design_intensity", str),
        task_id=task_id,
    ):
        yield event


async def _run_partial(
    *,
    user_id: str,
    prompt: str,
    rules: dict[str, str],
    user_selected_model: str | None,
    canvas_id: str | None,
    canvas_size: str | None,
    target_layer_id: str | None,
    layer_ids: list[str] | None,
    current_svg: str,
    scene_nodes: list[dict[str, Any]],
    scene: str | None,
    ref_images: list[str],
    mem_bundle: Any,
    sid: str,
    pid: str,
    decision: DesignRunDecision,
    t0: float,
    task_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    hold_need = _authorize_need("partial", model=user_selected_model, rules=rules)
    bal = get_user_credits(user_id)
    free_daily = False
    try:
        hold, free_daily = _reserve_design_hold(
            user_id, hold_need, mode="partial", model=user_selected_model
        )
    except ValueError:
        yield {
            "type": "error",
            "code": (
                "free_daily_exhausted"
                if bal < hold_need
                else "insufficient_credits"
            ),
            "message": (
                "free_daily_exhausted"
                if bal < hold_need
                else "insufficient_credits"
            ),
            "balance": bal,
            "need": hold_need,
        }
        return
    if free_daily:
        user_selected_model = "auto"


    task_id = str(task_id or uuid.uuid4())
    scene_key = _scene_key(scene) or str(rules.get("canvas.default_scene") or "").strip()
    w, h = _parse_size(canvas_size, scene_key, rules)
    if w <= 0 or h <= 0:
        yield {
            "type": "error",
            "code": "invalid_canvas_size",
            "message": "invalid_canvas_size",
            "detail": "Admin default_size_* / canvas chip missing — runtime does not invent size",
        }
        return
    if canvas_id and layer_ids and target_layer_id:
        _lock_layers(canvas_id, target_layer_id, layer_ids)

    _insert_task(
        {
            "id": task_id,
            "user_id": user_id,
            "canvas_id": canvas_id,
            "scene": scene_key,
            "skill_group_id": None,
            "task_type": "partial",
            "user_selected_model": user_selected_model,
            "actual_models": "[]",
            "target_layer_id": target_layer_id,
            "current_skill_index": 0,
            "status": "running",
            "hold_credits": hold,
            "charged_credits": 0,
            "total_tokens": 0,
            "prompt": prompt,
            "canvas_size": canvas_size or f"{w}x{h}",
            "result_svg": None,
            "error_message": None,
            "meta_json": json.dumps({"control": "partial_loop"}, ensure_ascii=False),
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    )

    try:
        family, reason = resolve_model_for_skill(
            skill={
                "category": "refine",
                "default_model": "doubao",
                "name": "partial",
                "skill_key": "partial",
            },
            user_selected_model=user_selected_model,
            run_mode="partial",
            prompt=prompt,
            rules=rules,
            scene=scene_key,
            attempt=0,
            has_images=bool(ref_images),
        )
        tools_block = format_canvas_tools_for_model()
        partial_system = _rule_text(rules, "agent.prompt.partial_system").strip()
        system = "\n".join(
            p
            for p in [
                partial_system,
                tools_block,
                _rule_text(rules, "edit.tool_ops"),
                f"Canvas {w}x{h}.",
            ]
            if p
        )
        user_msg = (
            f"USER_PROMPT:\n{prompt}\n\nTARGET_LAYER: {target_layer_id or '-'}\n\n"
            + _edit_context_block(
                rules,
                current_svg,
                include_full_svg=False,
                scene_nodes=scene_nodes,
            )
        )
        yield {
            "type": "skill_start",
            "index": 0,
            "skill_id": None,
            "skill_key": "partial",
            "skill_name": "partial",
            "category": "refine",
            "model": family,
            "model_reason": reason,
        }
        content = ""
        used = 0
        async for kind, piece in stream_skill_step(
            model_family=family,
            system=system,
            user=user_msg,
            max_tokens=2048,
            images=ref_images or None,
            enable_thinking=False,
            rules=rules,
            allow_vision_switch=True,
        ):
            if kind == "model" and isinstance(piece, str) and piece.strip():
                family = piece.strip()
                continue
            if kind == "usage":
                used = int(piece) if isinstance(piece, int) else used
                continue
            if kind == "token" and isinstance(piece, str):
                content += piece
        if used <= 0:
            used = max(1, len(content) // 3)
        step_ops, op_errors = extract_and_validate_tool_ops(
            content, scene_nodes=scene_nodes, rules=rules
        )
        if not step_ops:
            raise RuntimeError(
                validation_failure_reason(op_errors)
                if op_errors
                else "missing_tool_ops"
            )
        yield {
            "type": "tool_ops",
            "index": 0,
            "skill_key": "partial",
            "skill_name": "partial",
            "schema_version": TOOL_OPS_SCHEMA_VERSION,
            "ops": tool_ops_for_sse(step_ops),
        }
        for act in _tool_ops_activity_events(
            batch=step_ops,
            totals={"created": 0, "updated": 0, "deleted": 0},
            skill_index=0,
        ):
            yield act
        yield {
            "type": "skill_done",
            "index": 0,
            "skill_key": "partial",
            "skill_name": "partial",
            "tokens": used,
        }
        from app.services.llm import is_byok_model_ref

        spend_confirm = _settle_hold(
            user_id,
            hold=hold,
            actual_tokens=used,
            detail=f"design_settle:partial:{task_id}",
            rules=rules,
            free_daily=free_daily,
            byok=is_byok_model_ref(user_selected_model),
            mode="partial",
        )
        _update_task(
            task_id,
            status="success",
            charged_credits=spend_confirm,
            total_tokens=used,
            result_svg="",
        )
        yield {
            "type": "result",
            "task_id": task_id,
            "status": "success",
            "svg": "",
            "charged_credits": spend_confirm,
            "total_tokens": used,
            "tool_ops_applied": True,
            "intent": "edit",
            "edit_in_place": True,
        }
        try:
            from app.services.agent_memory.episodes import maybe_write_episode

            maybe_write_episode(
                user_id=user_id,
                session_id=sid,
                project_id=pid,
                task_id=task_id,
                scene="",
                goal=prompt,
                summary="",
                applied_ops=list(step_ops or []),
                observe={"ops_applied": True, "route": "partial"},
                outcome="success",
                chat_only=False,
                tool_ops_applied=True,
                rules=rules,
            )
        except Exception:
            _log.exception("episode write failed partial task=%s", task_id)
        if sid:
            yield {
                "type": "memory_patch",
                **_finalize_memory_patch(
                    user_id=user_id,
                    session_id=sid,
                    project_id=pid,
                    medium=mem_bundle.medium,
                    task_id=task_id,
                    intent="edit",
                    edit_in_place=True,
                    blank_artboard=False,
                    summary="",
                    tool_ops_applied=True,
                    critique_notes=None,
                    scene_key=scene_key,
                    canvas_size=f"{w}x{h}",
                ),
            }
        _stage(t0, "partial done", ops=len(step_ops))
    except Exception as err:  # noqa: BLE001
        try:
            _refund_hold(user_id, hold, task_id=task_id)
        except Exception:
            pass
        _update_task(task_id, status="error", error_message=str(err)[:800])
        yield {
            "type": "error",
            "code": _run_error_code(err),
            "message": _user_facing_run_error(err, rules=rules),
            "task_id": task_id,
            "refunded_credits": hold,
        }


async def resume_design_job(
    *,
    user_id: str,
    task_id: str,
    resume_token: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Resume a checkpointed LangGraph design run (rebinds wallet side-effects)."""
    from app.services.design.runtime.graph.build import resume_agent_graph
    from app.services.llm import reset_byok_user_id, set_byok_user_id

    byok_token = set_byok_user_id(user_id)
    try:
        async for ev in resume_agent_graph(
            task_id=task_id,
            user_id=user_id,
            settle_hold_fn=_settle_hold,
            refund_hold_fn=_refund_hold,
            resume_token=resume_token,
        ):
            yield ev
    finally:
        reset_byok_user_id(byok_token)
