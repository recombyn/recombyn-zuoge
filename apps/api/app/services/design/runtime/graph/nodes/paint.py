from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from langgraph.types import Command

import logging

from app.services.design.ops.tool_ops_contract import (
    assess_tool_ops_result,
    validation_failure_reason,
)
from app.services.design.prompts.rules_text import _as_text
from app.services.design.runtime.agent_profile import (
    resolve_contract_schema,
    resolve_tool_host,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    GraphState,
)
from app.services.design.runtime.graph.emit_sse import (
    _emit,
    _emit_canvas_size_from_ops,
    _emit_design_loading_artboard,
    _emit_tool_ops_validation_ui,
    _design_assistant_reply,
)
from app.services.design.runtime.graph.llm_io import (
    _clip_llm_raw,
    _emit_ux_tip,
    _llm_io_fields,
    _require_prompt_pack,
    _resolve_and_log_model,
    _stream_llm_text,
)
from app.services.design.runtime.graph.paint_kit import (
    _ensure_paint_tool_details,
    _is_lean_paint_turn,
    _op_errors_for_log,
    _paint_ops_system,
    _paint_ops_user,
    _prompt_compact_len,
)
from app.services.design.runtime.graph.scene_log import (
    _bump,
    _commit,
    _goto_cmd,
    _persist_progress,
)
from app.services.design.runtime.graph.turns import _resolve_paint_want

_log = logging.getLogger(__name__)


def _finish_paint_ops_success(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    intent: str,
    step_ops: list[dict[str, Any]],
    reply: str,
    tool_ops_raw: Any,
    extra_turn: dict[str, Any] | None = None,
) -> Command:
    """Shared ask vs apply exit after validated paint ops."""
    ask_mode = str(rt.flags.get("mode") or "") == "ask"
    _emit_canvas_size_from_ops(rt, step_ops)
    from app.services.design.runtime.host.prompts import locale_for_runtime

    st.reply = _design_assistant_reply(
        raw_reply=reply,
        ops=step_ops,
        locale=locale_for_runtime(rt),
    )
    st.intent = intent
    turn: dict[str, Any] = {
        "intent": intent,
        "reply": st.reply,
        "tool_ops_raw": tool_ops_raw,
    }
    if extra_turn:
        turn.update(extra_turn)
    rt.turn = turn
    if ask_mode:
        st.reply = ""
        return Command(update=_bump(rt), goto="propose")
    return Command(update=_bump(rt), goto="action")


def _validate_and_density_gate(
    rt: AgentRuntime,
    st: AgentRunState,
    ops_raw: Any,
    *,
    intent: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate tool_ops then clear sparse create batches."""
    if not ops_raw:
        return [], []
    step_ops, op_errors = resolve_tool_host().validate_ops(
        ops_raw,
        scene_nodes=rt.scene_nodes,
        scene_frames=rt.scene_frames,
        rules=rt.rules,
        skill_keys=list(st.skills_loaded or []),
        scene=rt.scene_key or "",
        runtime=rt,
    )
    if not step_ops:
        return [], list(op_errors or [])
    dense_ok, dense_reason = assess_tool_ops_result(
        step_ops,
        intent=intent,
        scene=rt.scene_key or "",
        nodes=rt.scene_nodes,
        rules=rt.rules,
        skill_keys=list(st.skills_loaded or []),
    )
    if dense_ok:
        return step_ops, list(op_errors or [])
    errs = list(op_errors or []) + [dense_reason]
    st.note_error(f"paint_ops density: {dense_reason}")
    # Never silent-settle a sparse create (dashboard one-rect case).
    return [], errs


async def _await_or_abandon(coro: Any, *, timeout_sec: float, label: str) -> Any:
    """Wait for an LLM call; abandon if it ignores CancelledError.

    ``asyncio.wait_for`` cancels then *awaits* cleanup. Some provider streams
    often ignore cancel until ``stream_chunk_timeout`` (default 120s), so a
    nominal 75s paint budget still burned ~120–180s. ``asyncio.wait`` + cancel
    without awaiting unblocks the paint retry loop immediately.
    """
    task = asyncio.create_task(coro)
    done, _pending = await asyncio.wait({task}, timeout=max(0.1, float(timeout_sec)))
    if done:
        return done.pop().result()
    task.cancel()
    _log.warning("%s timed out after %.1fs", label, timeout_sec)
    raise TimeoutError(f"{label} timed out after {timeout_sec:.0f}s")


async def _node_paint_ops(state: GraphState) -> Command:
    """Dedicated paint stage: structured tool_ops only → action."""
    rt = state["rt"]
    st = rt.run
    want = _resolve_paint_want(rt, st.intent)
    st.intent = want

    st.family, reason = _resolve_and_log_model(
        st,
        skill={
            "category": "agent",
            "default_model": "doubao",
            "name": "react",
            "skill_key": "react"
        },
        user_selected_model=rt.user_selected_model,
        run_mode=rt.mode,
        prompt=rt.prompt,
        rules=rt.rules,
        scene=rt.scene_key,
        attempt=st.round,
        has_images=bool(rt.images),
    )
    rt.last_reason = reason
    _ensure_paint_tool_details(rt)
    # Safety: if intent had no WxH yet / skipped, open loading plate before LLM paint.
    _emit_design_loading_artboard(rt)

    turn_images = list(rt.images or [])[:4] if rt.images else None
    if turn_images:
        st.vision_used = True
        rt.last_images = turn_images

    max_attempts = 3
    from app.services.llm import build_user_message_content
    from app.services.llm.agent import ainvoke_structured

    lean = _is_lean_paint_turn(rt)
    _log.debug(
        "paint_ops enter task=%s model=%s lean=%s intent=%s prompt_chars=%s "
        "images=%s tools=%s",
        st.task_id[:8],
        st.family,
        lean,
        want,
        _prompt_compact_len(rt.prompt),
        len(turn_images or []),
        list(st.tools_loaded or [])[:8],
    )

    # Opt-in skill handler.py → tool_ops (before LLM). Falls through on miss/error.
    try:
        from app.services.design.prompts.skill_store.ops_runner import (
            try_skill_ops_for_paint,
        )

        runner_ops, runner_skill, runner_err = try_skill_ops_for_paint(
            skill_keys=list(st.skills_loaded or []),
            prompt=str(rt.prompt or ""),
            scene_key=str(rt.scene_key or ""),
            scene_nodes=list(rt.scene_nodes or []),
            scene_frames=list(rt.scene_frames or []),
            design_brief=rt.design_brief
            if isinstance(rt.design_brief, dict)
            else None,
        )
    except Exception as exc:
        _log.warning("skill ops runner failed: %s", exc)
        runner_ops, runner_skill, runner_err = None, None, str(exc)

    if runner_ops is not None:
        step_ops, op_errors = resolve_tool_host().validate_ops(
            runner_ops,
            scene_nodes=rt.scene_nodes,
            scene_frames=rt.scene_frames,
            rules=rt.rules,
            skill_keys=list(st.skills_loaded or []),
            scene=rt.scene_key or "",
            runtime=rt,
        )
        rt.step_ops = step_ops
        rt.op_errors = list(op_errors or [])
        st.push_log(
            phase="paint_ops",
            intent=want,
            summary=(
                f"skill_ops_runner skill={runner_skill or '?'} "
                f"ops={len(step_ops)} err={runner_err or ''}"
            ),
            model="skill_ops_runner",
            ops_count=len(step_ops),
            attempt=0,
            **({"errors": _op_errors_for_log(op_errors)} if op_errors else {}),
        )
        if step_ops:
            return _finish_paint_ops_success(
                rt,
                st,
                intent=want,
                step_ops=step_ops,
                reply="",
                tool_ops_raw=runner_ops,
                extra_turn={"skill_ops_runner": runner_skill},
            )
        _log.info(
            "skill ops runner produced no valid ops skill=%s errors=%s — LLM paint",
            runner_skill,
            (op_errors or [])[:3],
        )

    for attempt in range(max_attempts):
        round_i = st.round
        _emit(
            {
                "type": "skill_start",
                "index": round_i,
                "skill_id": None,
                "skill_key": "paint_ops",
                "skill_name": "Paint",
                "category": "design",
                "model": st.family,
                "model_reason": rt.last_reason,
                "trace_id": st.trace_id
            }
        )
        _emit(
            {
                "type": "activity",
                "id": f"paint-ops-{round_i}-{attempt}",
                "kind": "thought",
                "status": "running",

                "index": round_i
            }
        )
        system = _paint_ops_system(rt)
        user_msg = _paint_ops_user(rt)
        if attempt > 0:
            user_msg = (
                f"{user_msg}\n\n"
                f"{_require_prompt_pack(rt.rules, 'agent.prompt.paint_retry')}"
            )
        t_llm = time.perf_counter()
        try:
            from app.core.config import settings as _paint_settings

            user_content = build_user_message_content(user_msg, turn_images)
            attempt_sec = float(
                getattr(_paint_settings, "design_paint_attempt_timeout_sec", 75.0)
                or 75.0
            )
            # Inter-chunk stall bound — langchain-openai default is 120s; that alone
            # made "add a rect" look hung after decide already finished.
            chunk_sec = min(45.0, attempt_sec) if attempt_sec > 0 else 45.0
            _log.debug(
                "paint_ops LLM start task=%s attempt=%s/%s model=%s "
                "sys_chars=%s user_chars=%s timeout=%.0fs chunk_timeout=%.0fs",
                st.task_id[:8],
                attempt + 1,
                max_attempts,
                st.family,
                len(system or ""),
                len(user_msg or ""),
                attempt_sec,
                chunk_sec,
            )

            async def _paint_structured() -> dict[str, Any]:
                return await ainvoke_structured(
                    schema=resolve_contract_schema("act"),
                    messages=[{"role": "user", "content": user_content}],
                    model=st.family,
                    system=system,
                    source="design",
                    run_name=f"paint_ops:{st.task_id[:8]}",
                    metadata={
                        "task_id": st.task_id,
                        "trace_id": st.trace_id,
                        "user_id": rt.user_id,
                        "scene": rt.scene_key or "",
                        "intent": want,
                        "round": round_i,
                        "attempt": attempt,
                        "has_images": bool(turn_images),
                        "stage": "paint_ops"
                    },
                    tags=["design", "lc_design", "paint_ops"],
                    timeout=attempt_sec if attempt_sec > 0 else None,
                    stream_chunk_timeout=chunk_sec,
                )

            if attempt_sec > 0:
                structured_out = await _await_or_abandon(
                    _paint_structured(),
                    timeout_sec=attempt_sec,
                    label=f"paint_ops:{st.task_id[:8]}:a{attempt}",
                )
            else:
                structured_out = await _paint_structured()
            structured = structured_out.get("structured")
            if hasattr(structured, "model_dump"):
                raw_obj = structured.model_dump()
            elif isinstance(structured, dict):
                raw_obj = structured
            else:
                raw_obj = {}
            ops_raw = raw_obj.get("tool_ops")
            reply = _as_text(raw_obj.get("reply")).strip()
            intent = str(raw_obj.get("intent") or want).strip().lower()
            if intent not in ("edit", "create"):
                intent = want
            content = json.dumps(raw_obj, ensure_ascii=False)[:8000]
            used_hint = max(1, len(content) // 3)
            st.total_tokens += used_hint
            st.note_tokens(used_hint, model_id=str(getattr(st, "family", "") or ""), source="paint")
            _log.debug(
                "paint_ops LLM ok task=%s attempt=%s model=%s elapsed=%.2fs "
                "ops_raw=%s reply_chars=%s",
                st.task_id[:8],
                attempt + 1,
                st.family,
                time.perf_counter() - t_llm,
                len(ops_raw) if isinstance(ops_raw, list) else 0,
                len(reply or ""),
            )
        except Exception as err:  # noqa: BLE001
            _log.warning(
                "paint_ops LLM fail task=%s attempt=%s model=%s err_type=%s err=%s",
                st.task_id[:8],
                attempt + 1,
                st.family,
                type(err).__name__,
                str(err)[:240],
            )
            st.note_error(f"paint_ops_llm_failed: {err}"[:240])
            st.push_log(
                phase="paint_ops",
                error=str(err)[:200],
                summary="paint turn failed",
                attempt=attempt,
                duration_ms=max(0, int((time.perf_counter() - t_llm) * 1000)),
                model=st.family,
            )
            _emit(
                {
                    "type": "skill_done",
                    "index": round_i,
                    "skill_key": "paint_ops",
                    "skill_name": "Paint",
                    "tokens": 0
                }
            )
            st.round = round_i + 1
            continue

        st.intent = intent
        step_ops, op_errors = _validate_and_density_gate(rt, st, ops_raw, intent=intent)
        rt.step_ops = step_ops
        rt.op_errors = list(op_errors or [])
        if not step_ops:
            _log.warning(
                "paint_ops empty/invalid task=%s attempt=%s model=%s errors=%s",
                st.task_id[:8],
                attempt + 1,
                st.family,
                (op_errors or ["missing_tool_ops"])[:4],
            )
        st.push_log(
            phase="paint_ops",
            intent=intent,
            summary=f"paint attempt={attempt + 1} ops={len(step_ops)}",
            model=st.family,
            reply=(reply[:200] if reply else None),
            tokens=used_hint,
            duration_ms=max(0, int((time.perf_counter() - t_llm) * 1000)),
            llm_raw=_clip_llm_raw(content, limit=4000),
            ops_count=len(step_ops),
            attempt=attempt,
            **_llm_io_fields(
                system=system, user=user_msg, images=turn_images, max_tokens=None
            ),
            **({"errors": _op_errors_for_log(op_errors)} if op_errors else {}),
        )
        _emit(
            {
                "type": "skill_done",
                "index": round_i,
                "skill_key": "paint_ops",
                "skill_name": "Paint",
                "tokens": used_hint
            }
        )
        # Show validation failures in chat when leaving paint (keep or exhaust).
        # Mid-retry: keep Admin/LAST_ERROR only so the model can fix quietly.
        will_keep = bool(step_ops)
        will_exhaust = (not will_keep) and (attempt >= max_attempts - 1)
        if op_errors and (will_keep or will_exhaust):
            _emit_tool_ops_validation_ui(rt, op_errors, kept=len(step_ops))

        if step_ops:
            return _finish_paint_ops_success(
                rt,
                st,
                intent=intent,
                step_ops=step_ops,
                reply=reply,
                tool_ops_raw=ops_raw,
            )

        err = validation_failure_reason(op_errors) if op_errors else "missing_tool_ops"
        st.note_error(f"paint_ops: {err}")
        st.round = round_i + 1

    st.note_error("paint_ops: retries_exhausted")
    _emit_ux_tip(rt, "paint_failed")
    rt.flags["await_user"] = True
    rt.terminal = True
    return Command(update=_bump(rt), goto="__settle__")

