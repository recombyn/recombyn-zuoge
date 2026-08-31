from __future__ import annotations

import asyncio
import json
from typing import Any

import logging

from langgraph.graph import END
from langgraph.types import Command

from app.services.design.admin.task_store import _update_task
from app.services.design.prompts.prompt_build import _finalize_memory_patch
from app.services.design.prompts.rules_text import exec_trace
from app.services.design.runtime.graph.state import AgentRuntime, GraphState
from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.graph.scene_log import (
    _bump,
    _persist_task_meta,
)
from app.services.design.runtime.graph.turns import (
    _resolve_paint_want,
)
from app.services.design.runtime.models_route import CANVAS_WORK_INTENTS, normalize_user_intent
from app.services.wallet.db import get_user_credits

_log = logging.getLogger(__name__)


def _taste_notes_from_rt(rt: AgentRuntime) -> list[str]:
    """Intelligence Client taste/memory notes already applied onto Runtime flags."""
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    out: list[str] = []
    for key in ("memory_notes", "taste_principles"):
        raw = flags.get(key)
        if not isinstance(raw, list):
            continue
        for item in raw:
            text = str(item or "").strip()
            if text and text not in out:
                out.append(text[:160])
    write = flags.get("intelligence_principle_write")
    if isinstance(write, dict):
        for item in list(write.get("principles") or []):
            text = str(item or "").strip()
            if text and text not in out:
                out.append(text[:160])
    return out[:16]


def _merge_taste_into_user_layer(
    user: dict[str, Any], notes: list[str]
) -> dict[str, Any]:
    """Bridge private Taste KG notes into public design.user memory (no Private import)."""
    out = dict(user or {})
    accepted = [
        str(x).strip()
        for x in list(out.get("accepted_patterns") or [])
        if str(x).strip()
    ]
    rejected = [
        str(x).strip()
        for x in list(out.get("rejected_patterns") or [])
        if str(x).strip()
    ]
    pref = (
        dict(out.get("preference") or {})
        if isinstance(out.get("preference"), dict)
        else {}
    )
    for note in notes:
        low = note.lower()
        if low.startswith("research:avoid:") or "avoid:" in low[:24]:
            tip = note.split(":", 1)[-1].strip() if note.lower().startswith("avoid:") else note
            tip = tip.replace("research:", "", 1).strip()
            if tip.startswith("avoid:"):
                tip = tip.split(":", 1)[-1].strip()
            if tip and tip not in rejected:
                rejected.append(tip[:120])
            continue
        if note not in accepted and (
            note.startswith("taste:")
            or note.startswith("thesis:")
            or note.startswith("research:")
            or note.startswith("preference:")
            or note.startswith("governance:")
        ):
            accepted.append(note[:160])
        if "premium" in low:
            pref.setdefault(
                "premium_restraint",
                {"kind": "preference", "text": "premium_restraint", "source": "taste"},
            )
        if "whitespace" in low or "留白" in note:
            pref.setdefault(
                "high_whitespace",
                {"kind": "preference", "text": "high_whitespace", "source": "taste"},
            )
        if "glow" in low or "editorial_not_glow" in low:
            pref.setdefault(
                "anti_glow",
                {"kind": "preference", "text": "anti_glow", "source": "taste"},
            )
    out["accepted_patterns"] = accepted[:24]
    out["rejected_patterns"] = rejected[:24]
    out["preference"] = pref
    return out


def _design_memory_patch_from_rt(rt: AgentRuntime, *, painted: bool) -> dict[str, Any]:
    from app.services.agent_memory.schema import build_design_memory_patch
    from app.services.design.runtime.graph.state import (
        accumulate_preference_candidate,
        analyze_edit_preference,
        apply_committed_preferences_to_brief,
    )

    flags = rt.flags if isinstance(rt.flags, dict) else {}
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    review = flags.get("review") if isinstance(flags.get("review"), dict) else None
    medium = rt.mem_medium if isinstance(rt.mem_medium, dict) else {}
    design = medium.get("design") if isinstance(medium.get("design"), dict) else {}
    user = design.get("user") if isinstance(design.get("user"), dict) else {}
    signal = analyze_edit_preference(str(getattr(rt, "prompt", "") or ""))
    user, commits = accumulate_preference_candidate(user, signal)
    user = _merge_taste_into_user_layer(user, _taste_notes_from_rt(rt))
    if commits:
        rt.flags["preference_commits"] = commits
    if isinstance(brief, dict):
        brief = apply_committed_preferences_to_brief(brief, user)
        rt.design_brief = brief
    return build_design_memory_patch(
        medium=medium,
        brief=brief,
        review=review,
        reference_dna=getattr(rt, "reference_dna", None),
        painted=painted,
        user_layer=user,
    )


def _persist_preference_commits(user_id: str, commits: list[dict[str, Any]]) -> None:
    """Write committed prefs to long-term. Never called for uncommitted evidence."""
    from app.services.agent_memory.long_term import insert_long_memory

    uid = str(user_id or "").strip()
    if not uid:
        return
    for cand in commits:
        if not isinstance(cand, dict) or not cand.get("committed"):
            continue
        kind = "rejected" if str(cand.get("direction") or "") == "avoid" else "preference"
        try:
            body = json.dumps(
                {
                    "signal": cand.get("signal"),
                    "direction": cand.get("direction"),
                    "target": cand.get("target"),
                    "preferred_range": cand.get("preferred_range"),
                    "committed": True,
                },
                ensure_ascii=False,
            )[:2000]
            insert_long_memory(uid, kind=kind, text=body)
        except Exception:
            _log.debug("preference commit persist failed", exc_info=True)


def _persist_taste_notes_long_term(user_id: str, notes: list[str]) -> None:
    """Mirror transferable taste lines into public long-term memory."""
    from app.services.agent_memory.long_term import insert_long_memory

    uid = str(user_id or "").strip()
    if not uid:
        return
    for note in notes[:8]:
        text = str(note or "").strip()
        if not text:
            continue
        low = text.lower()
        if not (
            text.startswith("taste:")
            or text.startswith("thesis:")
            or text.startswith("preference:")
            or text.startswith("research:")
        ):
            continue
        kind = "rejected" if "avoid:" in low[:40] else "accepted"
        try:
            insert_long_memory(uid, kind=kind, text=text[:500])
        except Exception:
            _log.debug("taste note long-term persist failed", exc_info=True)


async def _sync_intelligence_knowledge(rt: AgentRuntime) -> None:
    """Final write_principle after governance — Private Taste KG + Runtime flags."""
    from app.services.design.intelligence_runtime import get_design_intelligence_client

    try:
        await get_design_intelligence_client().write_principle(rt)
    except Exception:
        _log.debug("intelligence write_principle at settle failed", exc_info=True)


async def _node_settle(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    # P41 — quality gate already ran at the end of Review (design intent).
    # Chat / canvas_op never enter Review, so they never show the checklist.
    gov = getattr(rt, "design_governance", None)
    if not isinstance(gov, dict):
        gov = {}
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    governance_failed = str(gov.get("status") or "") == "fail"
    # Outcome-aware Taste KG write (Private via Client; BasicLocal no-op).
    await _sync_intelligence_knowledge(rt)
    if governance_failed:
        st.push_log(
            phase="settle",
            summary="blocked by governance FAIL → Explain → Repair",
            governance="fail",
        )
        _emit(
            {
                "type": "settle_blocked",
                "reason": "governance_fail",
                "explain": list(gov.get("explain") or [])[:8],
            }
        )
        # Do not claim design success; surface repair draft.
        from app.services.design.runtime.graph.nodes.governance import (
            format_governance_fail_reply,
        )
        from app.services.design.runtime.host.prompts import locale_for_runtime

        st.reply = format_governance_fail_reply(
            gov, locale=locale_for_runtime(rt)
        )
        if "governance_fail" not in (st.errors or []):
            try:
                st.note_error("governance_fail")
            except Exception:
                pass

    # Lazy import — build.py imports nodes; avoid cycle.
    from app.services.design.runtime.graph.build import _design_settle_hold_fn
    from app.services.design.admin.task_store import (
        get_design_task,
        get_run_lifecycle,
        merge_task_meta,
        parse_task_meta,
        build_run_lifecycle,
    )
    from app.services.design.runtime.graph.build import _design_thread_id

    prior = await asyncio.to_thread(get_design_task, st.task_id)
    prior_charged = int((prior or {}).get("charged_credits") or 0)
    prior_lc = get_run_lifecycle(parse_task_meta((prior or {}).get("meta_json")))
    already_settled = prior_charged > 0 or bool(prior_lc.get("settled"))

    if already_settled:
        spend = prior_charged
        _log.debug("settle idempotent skip task=%s charged=%s", st.task_id, spend)
    elif governance_failed:
        # Governance FAIL: release authorize hold — do not capture design success.
        spend = 0
        try:
            from app.services.design.runtime.graph.build import _design_refund_hold_fn

            refund_fn = _design_refund_hold_fn(rt)
            if callable(refund_fn) and int(rt.hold or 0) > 0:
                await asyncio.to_thread(refund_fn, rt.user_id, int(rt.hold or 0), task_id=st.task_id)
        except Exception:
            _log.debug("governance_fail refund hold failed", exc_info=True)
        rt.hold = 0
    else:
        from app.services.llm import is_byok_model_ref

        meters = dict(st.billing_meters or {})
        if st.total_tokens and "llm.tokens_out" not in meters:
            meters["llm.tokens_out"] = float(st.total_tokens)
        if st.images_hydrated and "image.gen" not in meters:
            meters["image.gen"] = float(st.images_hydrated)
        if "agent.steps" not in meters:
            meters["agent.steps"] = 3.0 if (rt.mode or "agent") == "agent" else 1.0

        spend = await asyncio.to_thread(
            _design_settle_hold_fn(rt),
            rt.user_id,
            hold=rt.hold,
            actual_tokens=st.total_tokens,
            detail=f"design_settle:{rt.mode}:{st.task_id}",
            rules=rt.rules,
            free_daily=rt.free_daily,
            images_hydrated=st.images_hydrated,
            byok=is_byok_model_ref(rt.user_selected_model),
            mode=rt.mode or "agent",
            meters=meters,
            task_id=st.task_id,
        )
    # Contract: settle_hold_fn (via _design_settle_hold_fn) always returns int.
    spend = int(spend)
    has_proposal = bool(st.proposed_ops)
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    scene_unconfirmed = bool(flags.get("scene_unconfirmed"))
    tool_ops_confirmed = bool(st.painted) and not scene_unconfirmed
    settle_intent = normalize_user_intent(rt.classified_intent)
    settle_lane = (
        _resolve_paint_want(rt)
        if settle_intent in CANVAS_WORK_INTENTS
        else None
    )
    rt.decision.apply(
        intent=settle_intent,
        paint_lane=settle_lane or None,
        tool_ops_applied=tool_ops_confirmed,
        edit_in_place=bool(rt.scene_nodes) and settle_lane == "edit",
        is_chitchat=not st.painted
        and not has_proposal
        and st.intent in ("chat", "ask", "done"),
        route=(
            f"agent_graph:v{rt.flow_version}"
            if st.painted
            else (
                f"agent_graph_ask:v{rt.flow_version}"
                if has_proposal
                else f"agent_graph_chat:v{rt.flow_version}"
            )
        ),
    )
    failed_attempt = (
        governance_failed
        or scene_unconfirmed
        or (bool(st.errors) and not st.painted and not has_proposal)
    )
    settle_status = "error" if failed_attempt else "success"
    await asyncio.to_thread(_persist_task_meta, st.task_id, decision=rt.decision, state=st)
    await asyncio.to_thread(
        merge_task_meta,
        st.task_id,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=_design_thread_id(st.task_id),
                resumable=False,
                interrupt_kind=None,
                settled=True,
            ),
            "billing_meters": dict(st.billing_meters or {}),
            "usage_events": list(st.usage_events or [])[:64],
            "governance_failed": bool(governance_failed),
            "scene_unconfirmed": scene_unconfirmed,
            "charged_credits": spend,
        },
    )
    await asyncio.to_thread(
        _update_task,
        st.task_id,
        status=settle_status,
        charged_credits=spend,
        total_tokens=st.total_tokens,
        result_svg="",
    )
    exec_payload = st.to_execution_log()
    balance = await asyncio.to_thread(get_user_credits, rt.user_id)
    _emit({"type": "execution_log", **exec_payload})
    fail_summary = ""
    if scene_unconfirmed:
        fail_summary = "Canvas changes could not be confirmed."
    elif failed_attempt and st.errors:
        fail_summary = str(st.errors[-1])[:240]
    hist = flags.get("optimization_history")
    snap = rt.visual_snapshot if isinstance(rt.visual_snapshot, dict) else {}
    diff = rt.visual_diff if isinstance(rt.visual_diff, dict) else {}
    deltas = diff.get("deltas") if isinstance(diff.get("deltas"), dict) else {}
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else {}
    judge = rt.judge_verdict if isinstance(rt.judge_verdict, dict) else {}
    thesis = str(brief.get("visual_thesis") or "").strip()
    why_bits = [
        str(brief.get(k) or "").strip()
        for k in ("purpose", "audience", "emotion")
        if str(brief.get(k) or "").strip()
    ]
    strengths = [
        str(x).strip()
        for x in list(judge.get("strengths") or [])[:4]
        if str(x).strip()
    ]
    weaknesses = [
        str(x).strip()
        for x in list(judge.get("weaknesses") or [])[:4]
        if str(x).strip()
    ]
    next_steps: list[str] = []
    for row in list(judge.get("top_issues") or [])[:5]:
        if not isinstance(row, dict):
            continue
        fix = str(row.get("fix") or "").strip()
        issue = str(row.get("issue") or "").strip()
        if fix:
            next_steps.append(fix)
        elif issue:
            next_steps.append(issue)
    market_gap = str(judge.get("market_gap") or "").strip()
    summary_payload: dict[str, Any] = {
        "type": "design_summary",
        "visibility": "user",
        "thesis": thesis[:240] or None,
        "purpose": str(brief.get("purpose") or "").strip()[:160] or None,
        "audience": str(brief.get("audience") or "").strip()[:120] or None,
        "emotion": str(brief.get("emotion") or "").strip()[:120] or None,
        "why": " · ".join(why_bits)[:280] or None,
        "strengths": strengths or None,
        "weaknesses": weaknesses or None,
        "next_steps": next_steps[:5] or None,
        "market_gap": market_gap[:280] or None,
        "source": "settle",
    }
    if isinstance(hist, list) and hist:
        scores = [int(x.get("overall") or 0) for x in hist if isinstance(x, dict)]
        removed = 0
        try:
            first_n = len((hist[0] or {}).get("nodes") or [])
            last_n = len((hist[-1] or {}).get("nodes") or [])
            removed = max(0, first_n - last_n)
        except Exception:
            removed = 0
        hero = snap.get("hero_coverage")
        white = snap.get("whitespace_ratio")
        if hero is None and deltas.get("hero_coverage") is not None:
            hero = deltas.get("hero_coverage")
        summary_payload.update(
            {
                "iterations": len(hist),
                "removed": removed,
                "score_from": scores[0] if scores else None,
                "score_to": scores[-1] if scores else None,
                "whitespace": round(float(white), 4)
                if isinstance(white, (int, float))
                else None,
                "hero_dominance": round(float(hero), 4)
                if isinstance(hero, (int, float))
                else None,
                "timeline": [
                    {
                        "iteration": int(x.get("iteration") or i),
                        "overall": int(x.get("overall") or 0),
                    }
                    for i, x in enumerate(hist)
                    if isinstance(x, dict)
                ][:8],
            }
        )
    # Always emit when we have something user-readable (brief and/or review).
    if any(
        summary_payload.get(k)
        for k in (
            "thesis",
            "why",
            "strengths",
            "weaknesses",
            "next_steps",
            "market_gap",
            "iterations",
        )
    ):
        _emit(summary_payload)
    _emit(
        {
            "type": "result",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "status": settle_status,
            "svg": "",
            "summary": (st.reply[:500] if st.reply else "") or fail_summary,
            "charged_credits": spend,
            "total_tokens": st.total_tokens,
            "tool_ops_applied": tool_ops_confirmed,
            **({"error_code": "scene_unconfirmed"} if scene_unconfirmed else {}),
            "intent": rt.decision.intent,
            "edit_in_place": rt.decision.edit_in_place,
            **({"proposed_ops": st.proposed_ops} if st.proposed_ops else {}),
            **({"proposal_id": st.proposal_id} if st.proposal_id else {}),
            **({"choice_ui": st.choice_ui} if st.choice_ui else {}),
            **({"errors": list(st.errors)[-5:]} if failed_attempt else {}),
            "balance": balance,
            "decision_log": rt.decision.to_log(),
            "execution_log": exec_payload
        }
    )
    try:
        from app.services.agent_memory.episodes import maybe_write_episode

        await asyncio.to_thread(
            maybe_write_episode,
            user_id=rt.user_id,
            session_id=rt.session_id,
            project_id=rt.project_id,
            task_id=st.task_id,
            scene=rt.scene_key or "",
            goal=rt.prompt,
            summary=(st.reply or st.reflect_note or "")[:400],
            applied_ops=list(st.applied_ops),
            observe={
                "ops_applied": st.painted,
                "route": "langgraph",
                "trace_id": st.trace_id,
                "errors": list(st.errors),
                "rounds": st.round + 1
            },
            outcome="failed" if failed_attempt else "success",
            chat_only=not st.painted and not failed_attempt,
            tool_ops_applied=tool_ops_confirmed,
            has_reflexion_errors=bool(st.errors),
            rules=rt.rules,
        )
    except Exception:
        _log.exception("episode write failed task=%s", st.task_id)

    try:
        from app.services.agent_memory.kg import record_design_chain

        flags = rt.flags if isinstance(rt.flags, dict) else {}
        medium = rt.mem_medium if isinstance(rt.mem_medium, dict) else {}
        design = medium.get("design") if isinstance(medium.get("design"), dict) else {}
        session_layer = (
            design.get("session") if isinstance(design.get("session"), dict) else {}
        )
        await asyncio.to_thread(
            record_design_chain,
            user_id=rt.user_id,
            brief=rt.design_brief
            if isinstance(rt.design_brief, dict)
            else None,
            observe_facts=rt.observe_facts
            if isinstance(rt.observe_facts, dict)
            else None,
            review=flags.get("review") if isinstance(flags.get("review"), dict) else None,
            scene=rt.scene_key or "",
            skills=list(st.skills_loaded or []),
            painted=bool(st.painted),
            prev_review=session_layer.get("review")
            if isinstance(session_layer.get("review"), dict)
            else None,
            flags=flags,
            rules=rt.rules,
        )
    except Exception:
        _log.exception("design chain kg write failed task=%s", st.task_id)

    if rt.session_id:
        patch = await asyncio.to_thread(
            _finalize_memory_patch,
            user_id=rt.user_id,
            session_id=rt.session_id,
            project_id=rt.project_id,
            medium=rt.mem_medium,
            task_id=st.task_id,
            intent=normalize_user_intent(rt.classified_intent),
            edit_in_place=bool(rt.scene_nodes)
            and _resolve_paint_want(rt) == "edit",
            blank_artboard=False,
            summary=st.reply[:400],
            tool_ops_applied=tool_ops_confirmed,
            critique_notes="; ".join(st.errors[-3:]) if st.errors else None,
            scene_key=rt.scene_key,
            canvas_size=f"{rt.w}x{rt.h}" if rt.w and rt.h else (rt.canvas_size or ""),
            user_prompt=rt.prompt,
            assistant_reply=st.reply,
            short_turns=list(rt.mem_short_all or rt.mem_short or []),
            rules=rt.rules,
            await_user=bool(rt.flags.get("await_user") or has_proposal),
            design_patch=_design_memory_patch_from_rt(rt, painted=st.painted),
        )
        _emit({"type": "memory_patch", **patch})
        commits = list(rt.flags.get("preference_commits") or [])
        if commits:
            rt.flags.pop("preference_commits", None)
            await asyncio.to_thread(_persist_preference_commits, rt.user_id, commits)
        taste_notes = _taste_notes_from_rt(rt)
        if taste_notes and st.painted and not governance_failed:
            await asyncio.to_thread(
                _persist_taste_notes_long_term, rt.user_id, taste_notes
            )
    if not st.painted and not st.proposed_ops:
        _emit({"type": "chat_done"})
    from app.services.design.runtime.session_log import log_turn_end

    log_turn_end(
        st.task_id,
        status=settle_status,
        intent=str(st.intent or ""),
    )
    exec_trace(
        rt.t0,
        "DONE",
        mode="langgraph",
        tokens=st.total_tokens,
        ops=len(st.applied_ops),
        intent=st.intent,
        errors=len(st.errors),
        trace_id=st.trace_id,
    )
    return Command(update=_bump(rt), goto=END)

