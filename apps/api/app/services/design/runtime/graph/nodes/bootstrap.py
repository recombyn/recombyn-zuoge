from __future__ import annotations

import asyncio
import json
import time

from langgraph.types import Command

from app.services.design.admin.task_store import initialize_design_task, build_worker_snapshot
from app.services.design.prompts.rules_text import _as_text
from app.services.design.readpath.canvas_scene import (
    early_status_canvas_fields,
    explicit_canvas_size,
)
from app.services.design.runtime.graph.state import AgentRuntime, GraphState
from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.graph.llm_io import _clip_llm_raw, _clip_urls
from app.services.design.runtime.graph.scene_log import (
    _goto_cmd,
    _persist_progress,
)
from app.services.design.runtime.models_route import (
    clamp_lane,
    enabled_lanes,
    heuristic_route_lane,
)


async def _node_bootstrap(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    # Sync MySQL / catalog must not block the ASGI event loop (Admin lists starve).
    await asyncio.to_thread(
        initialize_design_task,
        {
            "id": st.task_id,
            "user_id": rt.user_id,
            "canvas_id": rt.canvas_id,
            "scene": rt.scene_key or "",
            "skill_group_id": None,
            "task_type": rt.mode,
            "user_selected_model": rt.user_selected_model,
            "actual_models": "[]",
            "target_layer_id": rt.focus_id or None,
            "current_skill_index": 0,
            "status": "running",
            "hold_credits": rt.hold,
            "charged_credits": 0,
            "total_tokens": 0,
            "prompt": rt.prompt,
            "canvas_size": rt.canvas_size or (f"{rt.w}x{rt.h}" if rt.w and rt.h else ""),
            "result_svg": None,
            "error_message": None,
            "meta_json": json.dumps(
                {
                    "control": "langgraph",
                    "trace_id": st.trace_id,
                    "max_rounds": rt.max_rounds,
                    "decision_log": rt.decision.to_log(),
                    "execution_log": st.to_execution_log(),
                    "worker_snapshot": build_worker_snapshot(
                        mode=rt.mode,
                        prompt=rt.prompt,
                        canvas_id=rt.canvas_id,
                        canvas_size=rt.canvas_size,
                        scene=rt.scene_key,
                        focus_frame_id=rt.focus_id,
                        scene_nodes=rt.scene_nodes,
                        scene_frames=rt.scene_frames,
                        images=rt.images,
                        spatial_summary=rt.spatial_summary,
                        session_id=rt.session_id,
                        project_id=rt.project_id,
                        memory=rt.memory_in,
                        apply_ops=rt.apply_ops,
                        proposal_id=(rt.flags.get("pending_proposal") or {}).get("id"),
                        proposal_task_id=(rt.flags.get("pending_proposal") or {}).get("task_id"),
                        interaction_mode=rt.flags.get("mode"),
                        skill_refs=rt.flags.get("skill_refs"),
                        locale=rt.flags.get("output_locale"),
                        design_intensity=rt.flags.get("design_intensity"),
                    ),
                    "run_lifecycle": {
                        "thread_id": f"design:{st.task_id}",
                        "resumable": True,
                        "interrupt_kind": None,
                        "settled": False,
                    },
                    **({"apply_ops": True} if rt.apply_ops else {})
                },
                ensure_ascii=False,
            ),
            "created_at": time.time(),
            "updated_at": time.time()
        },
    )
    _emit(
        {
            "type": "status",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "run_mode": rt.mode,
            "scene": rt.scene_key or None,
            **early_status_canvas_fields(
                w=rt.w,
                h=rt.h,
                client_size_locked=explicit_canvas_size(rt.canvas_size),
                client_canvas_raw=rt.canvas_size,
            )
        }
    )
    _emit(rt.decision.to_event())
    if rt.apply_ops:
        rt.flags["apply_ops"] = True
        return _goto_cmd(rt, frm="bootstrap", to="apply_confirm")
    rt.flags["mode"] = rt.flags.get("mode") or "agent"
    _apply_task_route_flags(rt)
    await _hydrate_pinned_skills(rt)
    await _persist_progress(rt)
    return _goto_cmd(rt, frm="bootstrap", to="memory")


async def _hydrate_pinned_skills(rt: AgentRuntime) -> None:
    """Hard-load `/` chip skill refs into system + skills_loaded (ACL-scoped)."""
    refs = list(rt.flags.get("skill_refs") or [])
    if not refs:
        return
    from app.services.design.prompts.skill_store import (
        format_skills_details_checked,
        resolve_accessible_skill_keys,
    )

    keys = await asyncio.to_thread(
        resolve_accessible_skill_keys,
        user_id=str(rt.user_id or ""),
        refs=refs,
        scene=rt.scene_key or "",
    )
    if not keys:
        return
    details, errs = await asyncio.to_thread(
        format_skills_details_checked,
        keys=keys,
        scene=rt.scene_key or "",
        user_id=str(rt.user_id or "") or None,
    )
    st = rt.run
    if errs:
        st.push_log(phase="skill_pin_validate", errors=list(errs)[:8])
    if details:
        pin_block = "PINNED_SKILLS (user selected — follow these):\n" + details
        rt.system = ((rt.system or "").rstrip() + "\n\n" + pin_block).strip()
        rt.pending_skill_details = "SKILL_DETAILS:\n" + details
    for k in keys:
        if k not in st.skills_loaded:
            st.skills_loaded.append(k)
    st.push_log(
        phase="skill_pin",
        need_skills=list(keys),
        detail_chars=len(details or ""),
        summary="user pinned skills: " + ", ".join(keys),
    )
    _emit(
        {
            "type": "activity",
            "id": "skill-pin",
            "kind": "explored",
            "status": "done",
            "summary": (", ".join(keys))[:200],
            "index": 0,
        }
    )


def _apply_task_route_flags(rt: AgentRuntime) -> None:
    """Estimate route lane + mode flags."""
    st = rt.run
    st.task_tier = clamp_lane(
        heuristic_route_lane(
            rt.prompt,
            has_images=bool(rt.images),
            scene=rt.scene_key or None,
        ).lane,
        enabled_lanes(rt.rules),
    )
    tier_label = st.task_tier or "-"
    # Do not set vision_used here — only after pixels are actually sent to the LLM.
    st.push_log(
        phase="route",
        task_tier=st.task_tier or None,
        has_images=bool(rt.images) or None,
        vision=None,
        user_selected_model=(rt.user_selected_model or "auto"),
        run_mode=rt.mode,
        llm_image_urls=_clip_urls(rt.images) if rt.images else None,
        llm_user=_clip_llm_raw(rt.prompt, limit=4000),
        summary=(
            f"task_tier={tier_label}"
            + (" · images" if rt.images else "")
            + f" · mode={rt.mode}"
        ),
    )
    if _as_text(rt.flags.get("mode")).strip().lower() not in ("agent", "ask"):
        rt.flags["mode"] = "agent"
    rt.flags["task_tier"] = st.task_tier

