from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from langgraph.types import Command
from recombyn_protocol import new_design_transaction, resolve_transaction_phase

from app.services.design.ops.tool_ops_contract import (
    tool_ops_activity_events as _tool_ops_activity_events,
    tool_ops_for_sse,
    validation_failure_reason,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    GraphState,
    _SCENE_WAIT_SEC,
)
from app.services.design.runtime.graph.emit_sse import (
    _emit,
    _emit_canvas_size_from_ops,
    _emit_deferred_paint_reply,
)
from app.services.design.runtime.graph.llm_io import _emit_ux_tip
from app.services.design.runtime.graph.paint_kit import (
    _ops_for_log,
    _ops_have_create_frame,
    _paint_ops_for_host,
)
from app.services.design.runtime.graph.scene_log import (
    _bump,
    _hydrate_log_kwargs,
)
from app.services.design.runtime.graph.turns import (
    _ask_propose_user_text,
    _ensure_propose_choice_ui,
)
from app.services.design.runtime.seams.context import pipeline_context_from_runtime
from app.services.design.runtime.seams.tool_pipeline import run_pipeline
from app.services.design.runtime.session_log import log_tool_ops_emit


def _emit_hydrate_job_progress(rt: AgentRuntime, progress: int, status: str) -> None:
    st = rt.run
    done = status in ("done", "failed")
    _emit(
        {
            "type": "activity",
            "id": f"hydrate-job-{st.task_id}",
            "kind": "tool",
            "status": "done" if done else "running",
            "count": int(progress),
            "detail": f"image hydrate {int(progress)}%",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "stage": "ops",
        }
    )


def _op_id_of(op: dict[str, Any]) -> str:
    raw = op.get("op_id") or ""
    oid = str(raw).strip()
    if oid:
        return oid
    # Stable fingerprint so resume can still skip ops that lack an explicit id.
    try:
        payload = json.dumps(op, sort_keys=True, ensure_ascii=False, default=str)
        return "fp:" + hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]
    except Exception:
        return ""


def _filter_unemitted_ops(st: AgentRunState, ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop ops already sent on a prior run (resume / retry safety)."""
    seen = {str(x).strip() for x in (st.emitted_op_ids or []) if str(x).strip()}
    if not seen:
        return list(ops)
    out: list[dict[str, Any]] = []
    for op in ops:
        oid = _op_id_of(op)
        if oid and oid in seen:
            continue
        out.append(op)
    return out


def _mark_ops_emitted(st: AgentRunState, ops: list[dict[str, Any]]) -> None:
    seen = {str(x).strip() for x in (st.emitted_op_ids or []) if str(x).strip()}
    for op in ops:
        oid = _op_id_of(op)
        if not oid or oid in seen:
            continue
        st.emitted_op_ids.append(oid)
        seen.add(oid)


def _chunk_ops(ops: list[dict[str, Any]], *, chunk_size: int = 12) -> list[list[dict[str, Any]]]:
    """Split ops into SSE chunks (one transaction, many chunks)."""
    size = max(1, int(chunk_size or 12))
    if len(ops) <= size:
        return [list(ops)]
    return [list(ops[i : i + size]) for i in range(0, len(ops), size)]


def _emit_design_transaction(
    rt: AgentRuntime,
    *,
    paint_ops: list[dict[str, Any]],
    round_i: int,
    skill_key: str = "react",
    skill_name: str = "Design Agent",
) -> str:
    """BEGIN → transaction chunks → COMMIT. Returns transaction_id."""
    st = rt.run
    phase = resolve_transaction_phase(rt)
    base_rev = 0
    try:
        base_rev = int(
            (rt.flags or {}).get("base_revision")
            or (rt.flags or {}).get("scene_revision")
            or 0
        )
    except (TypeError, ValueError):
        base_rev = 0
    tx = new_design_transaction(
        task_id=st.task_id,
        turn_id=str(round_i),
        phase=phase,
        intent=str(st.intent or rt.classified_intent or ""),
        base_revision=base_rev,
        ops_count=len(paint_ops),
    )
    st.active_transaction_id = tx.transaction_id
    st.active_transaction_phase = tx.phase
    st.active_transaction_base_revision = tx.base_revision
    _emit(
        {
            "type": "transaction.begin",
            "transaction_id": tx.transaction_id,
            "turn_id": tx.turn_id,
            "design_id": tx.design_id,
            "phase": tx.phase,
            "intent": tx.intent,
            "base_revision": tx.base_revision,
            "ops_count": tx.ops_count,
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "round": round_i,
        }
    )
    chunks = _chunk_ops(paint_ops)
    for ci, chunk in enumerate(chunks):
        sse_ops = tool_ops_for_sse(chunk)
        _emit(
            {
                "type": "transaction.chunk",
                "transaction_id": tx.transaction_id,
                "phase": tx.phase,
                "chunk_index": ci,
                "chunk_total": len(chunks),
                "ops": sse_ops,
                "task_id": st.task_id,
                "trace_id": st.trace_id,
                "round": round_i,
            }
        )
        for act in _tool_ops_activity_events(
            batch=chunk,
            totals={"created": 0, "updated": 0, "deleted": 0},
            skill_index=round_i,
        ):
            _emit(act)
    _emit(
        {
            "type": "transaction.commit",
            "transaction_id": tx.transaction_id,
            "phase": tx.phase,
            "ops_count": len(paint_ops),
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "round": round_i,
            # FE must ACK via scene_feedback with this transaction_id.
            "await_ack": True,
        }
    )
    st.push_log(
        phase="transaction",
        transaction_id=tx.transaction_id,
        transaction_phase=tx.phase,
        ops_count=len(paint_ops),
        chunks=len(chunks),
        base_revision=tx.base_revision or None,
        summary=f"tx {tx.transaction_id} {tx.phase} ×{len(paint_ops)}",
    )
    return tx.transaction_id


def _emit_transaction_rollback(
    rt: AgentRuntime,
    *,
    reason: str,
    round_i: int = 0,
) -> None:
    st = rt.run
    tid = str(st.active_transaction_id or "").strip()
    if not tid:
        return
    _emit(
        {
            "type": "transaction.rollback",
            "transaction_id": tid,
            "phase": st.active_transaction_phase or "paint",
            "reason": str(reason or "failed")[:240],
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "round": round_i,
        }
    )
    st.push_log(
        phase="transaction_rollback",
        transaction_id=tid,
        reason=str(reason or "")[:160],
        summary=f"rollback {tid}: {str(reason or '')[:80]}",
    )
    st.active_transaction_id = ""
    st.active_transaction_phase = ""
    st.active_transaction_base_revision = 0


from app.services.design.runtime.scene_feedback import begin_wait


async def _node_apply_confirm(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    ctx = pipeline_context_from_runtime(rt, st, stage="apply_confirm", intent="edit")
    step_ops, op_errors, _meta = run_pipeline(ctx, rt.apply_ops)
    if not step_ops:
        err = validation_failure_reason(op_errors) if op_errors else "missing_tool_ops"
        st.note_error(err)
        _emit_ux_tip(rt, "apply_confirm_failed", params={"error": err[:80]})
        rt.terminal = True
        return Command(update=_bump(rt), goto="__settle__")

    log_tool_ops_emit(
        st.task_id,
        stage="apply_confirm",
        ops_count=len(step_ops),
        source="user_apply",
    )

    from app.services.design.ops.image_hydrate import (
        _image_model_from_rules,
        hydrate_tool_ops_images,
    )
    from app.services.design.ops.animation_hydrate import hydrate_tool_ops_lottie

    # Size / shimmer before hydrate so the plate is visible while images generate.
    if _ops_have_create_frame(step_ops):
        _emit_canvas_size_from_ops(rt, step_ops)
    step_ops, n_img = await hydrate_tool_ops_images(
        step_ops,
        limit=6,
        policy="auto",
        rules=rt.rules,
        trace_id=st.trace_id,
        user_id=rt.user_id,
        on_progress=lambda progress, status: _emit_hydrate_job_progress(
            rt, progress, status
        ),
    )
    step_ops, n_lottie = await hydrate_tool_ops_lottie(step_ops, limit=4)
    img_mid = _image_model_from_rules(rt.rules) if n_img else ""
    if n_img and img_mid:
        st.note_images(img_mid, int(n_img))
        st.push_log(**_hydrate_log_kwargs(step_ops, img_mid=img_mid, n_img=n_img))
    if n_lottie:
        st.push_log(
            phase="hydrate",
            summary=f"Lottie hydrate ×{int(n_lottie)}",
            ops_count=int(n_lottie),
        )
    paint_ops = list(step_ops)
    if _ops_have_create_frame(step_ops):
        paint_ops = _paint_ops_for_host(step_ops)
    paint_ops = _filter_unemitted_ops(st, paint_ops)
    rt.paint_ops = paint_ops
    rt.step_ops = step_ops
    if not paint_ops:
        # Resume after prior emit — re-await FE feedback if already painted.
        if st.painted:
            rt.skip_loop = True
            await begin_wait(st.task_id, round_n=0)
            _emit(
                {
                    "type": "scene_feedback_request",
                    "task_id": st.task_id,
                    "trace_id": st.trace_id,
                    "round": 0,
                    "timeout_ms": int(_SCENE_WAIT_SEC * 1000),
                }
            )
            return Command(update=_bump(rt), goto="observe")
        return Command(update=_bump(rt), goto="__settle__")
    _emit_design_transaction(
        rt,
        paint_ops=paint_ops,
        round_i=0,
        skill_key="react",
        skill_name="Design Agent",
    )
    _mark_ops_emitted(st, paint_ops)
    _mark_ops_emitted(st, step_ops)
    st.applied_ops.extend(paint_ops)
    st.painted = True
    st.intent = "edit"
    if not (st.reply or "").strip():
        _emit_ux_tip(rt, "apply_ops_applied", params={"count": len(paint_ops)})
    else:
        st.reply = str(st.reply).strip()[:200]
        _emit({"type": "token", "text": st.reply})
    st.push_log(

        phase="action",
        ops=[str(o.get("name") or "") for o in paint_ops[:20]],
        ops_count=len(paint_ops),
        ops_detail=_ops_for_log(paint_ops),
        apply_confirm=True,
        model=st.family or None,
        reply=(st.reply or "")[:500] or None,
        transaction_id=st.active_transaction_id or None,
        **({"image_model": img_mid, "images_hydrated": int(n_img)} if n_img and img_mid else {}),
    )
    rt.skip_loop = True
    await begin_wait(st.task_id, round_n=0)
    _emit(
        {
            "type": "scene_feedback_request",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "round": 0,
            "timeout_ms": int(_SCENE_WAIT_SEC * 1000),
            "transaction_id": st.active_transaction_id or None,
        }
    )
    return Command(update=_bump(rt), goto="observe")


async def _node_propose(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    step_ops = rt.step_ops
    round_i = st.round
    import uuid as _uuid

    from app.services.design.ops.tool_ops_contract import tool_ops_batch_detail

    st.proposed_ops = tool_ops_for_sse(step_ops)
    st.proposal_id = f"prop_{_uuid.uuid4().hex[:16]}"
    try:
        from app.services.design.admin.task_store import merge_task_meta

        now = time.time()
        merge_task_meta(
            st.task_id,
            {
                "ask_proposal": {
                    "id": st.proposal_id,
                    "ops": list(st.proposed_ops)[:48],
                    "created_at": now,
                    "expires_at": now + 3600.0,
                }
            },
        )
    except Exception:
        pass
    ui = _ensure_propose_choice_ui(st)
    apply_label = next(
        (
            str(o.get("label") or "")
            for o in (ui.get("options") or [])
            if str(o.get("action") or "") == "apply"
        ),
        "",
    )
    detail = (tool_ops_batch_detail(step_ops) or "").strip()
    # Prefer paint-stage reply; otherwise fixed Ask propose copy (no UX LLM hop).
    text = (rt.turn.get("reply") or st.reply or "").strip()
    if not text:
        text = _ask_propose_user_text(
            model_reply="",
            detail=detail,
        )
    if text:
        st.reply = text
    st.push_log(

        phase="propose",
        ops_count=len(step_ops),
        ops=[str(o.get("name") or "") for o in step_ops[:20]],
        ops_detail=_ops_for_log(step_ops),
        tokens=rt.last_used,
        model=st.family,
        proposed=True,
        intent=st.intent,
        reply=(st.reply or "")[:2000] or None,
        summary=('propose confirm: ' + (apply_label or f"{len(step_ops)} ops"))[:120],
        **({"choice_ui": st.choice_ui} if st.choice_ui else {}),
    )
    if text:
        _emit({"type": "token", "text": text})
    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "react",
            "skill_name": "Design Agent",
            "tokens": rt.last_used
        }
    )
    rt.terminal = True
    return Command(update=_bump(rt), goto="__settle__")


async def _node_action(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    step_ops = rt.step_ops
    round_i = st.round
    from app.services.design.ops.image_hydrate import (
        _image_model_from_rules,
        hydrate_tool_ops_images,
    )
    from app.services.design.ops.animation_hydrate import hydrate_tool_ops_lottie

    # Safety net: size/shimmer before hydrate (paint_ops usually already did this).
    if _ops_have_create_frame(step_ops):
        _emit_canvas_size_from_ops(rt, step_ops)
    step_ops, n_img = await hydrate_tool_ops_images(
        step_ops,
        limit=6,
        policy="auto",
        rules=rt.rules,
        trace_id=st.trace_id,
        user_id=rt.user_id,
        on_progress=lambda progress, status: _emit_hydrate_job_progress(
            rt, progress, status
        ),
    )
    step_ops, n_lottie = await hydrate_tool_ops_lottie(step_ops, limit=4)
    rt.step_ops = step_ops
    img_mid = _image_model_from_rules(rt.rules) if n_img else ""
    if n_img and img_mid:
        st.note_images(img_mid, int(n_img))
        st.push_log(**_hydrate_log_kwargs(step_ops, img_mid=img_mid, n_img=n_img))
    if n_lottie:
        st.push_log(
            phase="hydrate",
            summary=f"Lottie hydrate ×{int(n_lottie)}",
            ops_count=int(n_lottie),
        )
    paint_ops = list(step_ops)
    if _ops_have_create_frame(step_ops):
        paint_ops = _paint_ops_for_host(step_ops)
    paint_ops = _filter_unemitted_ops(st, paint_ops)
    rt.paint_ops = paint_ops
    ops_sent = bool(paint_ops)
    if ops_sent:
        _emit_design_transaction(
            rt,
            paint_ops=paint_ops,
            round_i=round_i,
            skill_key="react",
            skill_name="Design Agent",
        )
        _mark_ops_emitted(st, paint_ops)
        _mark_ops_emitted(st, step_ops)
        st.applied_ops.extend(paint_ops)
        # Tentative until observe confirms op_results — cleared if all ops failed.
        st.painted = True
    elif st.painted:
        # Resume: batch already emitted — skip duplicate tool_ops, re-await FE.
        pass
    else:
        st.painted = False
        st.reply = ""
    # Reply only after real ops were pushed — never claim "added" with empty ops.
    _emit_deferred_paint_reply(st, ops_sent=ops_sent)
    st.push_log(
        phase="action",
        ops=[str(o.get("name") or "") for o in (paint_ops or step_ops)[:20]],
        ops_count=len(paint_ops) if ops_sent else len(step_ops),
        ops_detail=_ops_for_log(paint_ops if ops_sent else step_ops),
        tokens=rt.last_used,
        model=st.family,
        transaction_id=st.active_transaction_id or None,
        **({"image_model": img_mid, "images_hydrated": int(n_img)} if n_img and img_mid else {}),
        **({"ops_idempotent_skip": True} if (not ops_sent and st.painted) else {}),
    )
    if not ops_sent and not st.painted:
        return Command(update=_bump(rt), goto="__settle__")
    # Wait for FE scene_feedback (nodes + per-op ok/fail) before settle / retry.
    await begin_wait(st.task_id, round_n=round_i)
    _emit(
        {
            "type": "scene_feedback_request",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "round": round_i,
            "timeout_ms": int(_SCENE_WAIT_SEC * 1000),
            "transaction_id": st.active_transaction_id or None,
        }
    )
    return Command(update=_bump(rt), goto="observe")

