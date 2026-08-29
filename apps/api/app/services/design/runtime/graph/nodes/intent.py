from __future__ import annotations

import json
import time
from typing import Any

from langgraph.types import Command

from app.services.design.runtime.graph.state import AgentRuntime, GraphState
from app.services.design.runtime.graph.emit_sse import (
    _emit,
    _emit_design_loading_artboard,
)
from app.services.design.runtime.graph.llm_io import (
    _clip_llm_raw,
    _emit_ux_tip,
    _stream_llm_text,
)
from app.services.design.runtime.graph.scene_log import _goto_cmd
from app.services.design.runtime.models_route import (
    IntentClassifyError,
    build_design_plan,
    classify_user_intent,
    normalize_intent_decision,
    normalize_paint_lane,
    normalize_proposal_action,
    normalize_session_action,
    normalize_user_intent,
    paint_ops_intent,
)


def _pending_proposal_flag(rt: AgentRuntime) -> dict[str, Any] | None:
    raw = rt.flags.get("pending_proposal")
    if not isinstance(raw, dict) or not raw.get("ops") or not raw.get("id"):
        return None
    return raw


def _release_ambient_focus_for_new_design(rt: AgentRuntime) -> None:
    """Drop ambient/memory FOCUS so Host can open a shimmer sibling and bind it.

    Only for LLM intent=design create (no user @). canvas_op never opens a
    sibling plate — infinite-canvas catalog tools place freely.
    """
    from app.services.design.runtime.decision_log import probe_has_target_chip

    intent = normalize_user_intent(getattr(rt, "classified_intent", None))
    if intent != "design":
        return
    lane = normalize_paint_lane(
        getattr(rt, "classified_paint_lane", None),
        intent=intent,
    )
    if paint_ops_intent(intent, lane) != "create":
        return
    if probe_has_target_chip(rt.prompt or ""):
        return
    rt.focus_id = ""
    rt.flags.pop("artboard_frame_id", None)
    rt.flags.pop("artboard_opened", None)
    rt.flags.pop("artboard_size", None)


def _clear_ask_proposal_meta(proposal_task_id: str) -> None:
    tid = str(proposal_task_id or "").strip()
    if not tid:
        return
    try:
        from app.services.design.admin.task_store import merge_task_meta

        merge_task_meta(tid, {"ask_proposal": None})
    except Exception:
        pass


def _drop_pending(rt: AgentRuntime) -> None:
    rt.flags.pop("pending_proposal", None)


async def _vision_chat_reply(rt: AgentRuntime) -> str:
    """Answer chat turns that include attached canvas/reference images.

    Intent classify is text-only; when the user asks about a selection crop
    (e.g. handwritten ``2+2=?`` + 「告诉我答案」), this vision turn owns the reply.
    """
    images = [
        str(u).strip()
        for u in list(getattr(rt, "images", None) or [])
        if isinstance(u, str) and str(u).strip()
    ]
    if not images:
        return ""
    from app.services.design.runtime.models_route import (
        resolve_vision_model,
        router_model_id,
    )

    model = resolve_vision_model(rt.rules) or router_model_id(rt.rules)
    if not model:
        return ""
    system = (
        "You are a helpful design-canvas assistant. The user attached image(s) "
        "from the canvas or as references. Look at every image carefully and "
        "answer their question. If an image shows a math problem, quiz, or "
        "puzzle, solve it and give the answer. Reply in the user's language. "
        "Be concise — do not claim you cannot see the image."
    )
    user = (rt.prompt or "").strip()[:4000]
    if not user:
        user = "Look at the attached image(s) and answer any question they contain."
    try:
        _family, content, _used, events, _thinking = await _stream_llm_text(
            model_family=model,
            system=system,
            user=user,
            rules=rt.rules if isinstance(rt.rules, dict) else {},
            images=images[:4],
            max_tokens=768,
            live_emit=True,
        )
        for ev in events:
            if isinstance(ev, dict) and ev.get("phase") == "model_switch":
                _emit({"type": "activity", "kind": "model", **ev})
        return str(content or "").strip()
    except Exception as err:
        raise RuntimeError(f"vision_chat_failed: {err}") from err


async def _node_intent_classify(state: GraphState) -> Command:
    """Cheap intent gate: chat → end; canvas_op → paint; design → decide; animation → animation_decide.

    With Ask PENDING_PROPOSAL: proposal_action apply|dismiss|revise routes first.
    """
    rt = state["rt"]
    st = rt.run
    pending = _pending_proposal_flag(rt)
    dial_lines: list[str] = []
    for t in list(getattr(rt, "mem_short", None) or [])[-4:]:
        if not isinstance(t, dict):
            continue
        role = "User" if str(t.get("role") or "") == "user" else "Assistant"
        text = str(t.get("text") or "").strip()
        if text:
            dial_lines.append(f"{role}: {text[:280]}")
    t_intent = time.perf_counter()
    decision = await classify_user_intent(
        prompt=rt.prompt,
        rules=rt.rules,
        has_images=bool(rt.images),
        canvas_node_count=len(rt.scene_nodes or []),
        scene=rt.scene_key,
        scene_nodes=rt.scene_nodes,
        interaction_mode=str(rt.flags.get("mode") or rt.mode or ""),
        pending_proposal=pending,
        recent_dialogue="\n".join(dial_lines),
    )
    intent_ms = max(0, int((time.perf_counter() - t_intent) * 1000))
    intent, paint_lane = normalize_intent_decision(
        decision.intent, decision.paint_lane
    )
    action = normalize_proposal_action(
        decision.proposal_action, has_pending=bool(pending)
    )
    session_action = normalize_session_action(
        getattr(decision, "session_action", None)
    )
    reply = (decision.reply or "").strip()
    needs_clarification = bool(
        getattr(decision, "needs_clarification", False) and paint_lane == "edit"
    )
    clarification = str(getattr(decision, "clarification", "") or "").strip()
    clarification_options = [
        {
            "label": str(getattr(option, "label", "") or "").strip(),
            "target_id": str(getattr(option, "target_id", "") or "").strip(),
        }
        for option in list(getattr(decision, "clarification_options", None) or [])[:4]
        if str(getattr(option, "label", "") or "").strip()
        and str(getattr(option, "target_id", "") or "").strip()
    ]
    if len(clarification_options) < 2:
        needs_clarification = False
    if session_action:
        intent = "chat"
        paint_lane = ""
    elif intent == "chat" and not reply and action != "apply" and not rt.images:
        raise IntentClassifyError("intent_classify: chat intent but model returned no reply")
    rt.classified_intent = intent
    rt.classified_paint_lane = paint_lane
    rt.classified_reply = reply
    from app.services.design.runtime.host.prompts import normalize_locale

    rt.flags["output_locale"] = normalize_locale(
        str(getattr(decision, "output_locale", "") or "").strip() or None,
        default="zh-CN",
    )
    st.intent = (
        paint_ops_intent(intent, paint_lane) if intent != "chat" else "chat"
    )
    rt.flags["gate_intent"] = intent
    plan = build_design_plan(
        prompt=rt.prompt,
        intent=intent,
        paint_lane=paint_lane,
        focus_frame_id=rt.focus_id,
        scene_nodes=rt.scene_nodes,
    )
    if plan is not None:
        rt.design_plan = plan.model_dump()
    else:
        rt.design_plan = None
    if session_action:
        rt.flags["session_action"] = session_action
    from app.services.design.runtime.session_log import log_stage_decision

    log_stage_decision(
        st.task_id,
        "intent",
        intent=intent,
        paint_lane=paint_lane or None,
        proposal_action=action or None,
        session_action=session_action or None,
    )

    st.push_log(
        phase="intent_classify",
        intent=intent,
        paint_lane=paint_lane or None,
        proposal_action=action or None,
        session_action=session_action or None,
        needs_clarification=needs_clarification or None,
        reply=(
            reply[:500]
            if intent == "chat" or action == "dismiss" or session_action
            else None
        ),
        summary=(
            f"intent={intent}"
            + (f"/{paint_lane}" if paint_lane else "")
            + (f" · proposal={action}" if action else "")
            + (f" · session={session_action}" if session_action else "")
            + (f" · {(decision.rationale or '')[:80]}" if decision.rationale else "")
        ),
        duration_ms=intent_ms,
        llm_raw=_clip_llm_raw(
            json.dumps(
                {
                    "intent": intent,
                    "paint_lane": paint_lane,
                    "proposal_action": action,
                    "session_action": session_action,
                    "needs_clarification": needs_clarification,
                    "clarification": clarification[:240] if needs_clarification else "",
                    "clarification_options": clarification_options
                    if needs_clarification
                    else [],
                    "rationale": (decision.rationale or "")[:400],
                    "reply": reply[:400]
                    if intent == "chat" or action == "dismiss" or session_action
                    else "",
                },
                ensure_ascii=False,
            ),
            limit=1200,
        ),
    )
    _emit(
        {
            "type": "activity",
            "id": f"intent-{st.task_id[:8]}",
            "kind": "thought",
            "status": "done",
            "stage": intent,
        }
    )

    if action == "apply" and pending:
        ops = [o for o in (pending.get("ops") or []) if isinstance(o, dict)]
        if ops:
            rt.apply_ops = ops[:48]
            rt.flags["apply_ops"] = True
            _drop_pending(rt)
            return _goto_cmd(rt, frm="intent_classify", to="apply_confirm")

    if action == "dismiss" and pending:
        if not reply:
            _emit_ux_tip(rt, "ask_dismissed")
        else:
            st.reply = reply
            _emit({"type": "token", "text": reply})
        _clear_ask_proposal_meta(str(pending.get("task_id") or ""))
        _drop_pending(rt)
        return _goto_cmd(rt, frm="intent_classify", to="__settle__")

    # revise / no action — continue normal gate; drop pending so this run won't re-apply.
    if pending:
        _drop_pending(rt)

    if session_action:
        if reply:
            st.reply = reply
            _emit({"type": "token", "text": reply})
        _emit({"type": "session_control", "action": session_action})
        return _goto_cmd(rt, frm="intent_classify", to="__settle__")

    if intent == "chat":
        vision_streamed = False
        if rt.images and not session_action:
            # Classifier never saw pixels — regenerate with vision before settle.
            vision_reply = await _vision_chat_reply(rt)
            if vision_reply:
                reply = vision_reply
                vision_streamed = True
                st.reply = reply
                rt.classified_reply = reply
                st.push_log(
                    phase="intent_vision_chat",
                    intent="chat",
                    summary=f"vision_chat images={len(rt.images)}",
                    reply=reply[:500],
                )
            elif not reply:
                raise IntentClassifyError(
                    "intent_classify: chat with images but vision reply empty"
                )
        if reply and not vision_streamed:
            st.reply = reply
            _emit({"type": "token", "text": reply})
        elif reply and vision_streamed:
            st.reply = reply
        return _goto_cmd(rt, frm="intent_classify", to="__settle__")

    if needs_clarification:
        # Choice labels become the user's next message and pass through this same
        # intent gate with the live scene again; no speculative canvas operation.
        st.reply = clarification
        st.choice_ui = {
            "mode": "single",
            "options": [
                {
                    "label": option["label"],
                    "action": "reply",
                    "value": option["target_id"],
                }
                for option in clarification_options
            ],
        }
        rt.flags["await_user"] = True
        _emit({"type": "token", "text": clarification})
        return _goto_cmd(rt, frm="intent_classify", to="__settle__")

    # New design create without @ must not inherit memory/ambient FOCUS —
    # otherwise early-open / paint rewrites the previous plate.
    _release_ambient_focus_for_new_design(rt)

    # Design-only shimmer: animation never opens a poster loading artboard.
    if intent == "design":
        _emit_design_loading_artboard(rt)

    if intent == "canvas_op":
        return _goto_cmd(rt, frm="intent_classify", to="paint_ops")
    if intent == "animation":
        return _goto_cmd(rt, frm="intent_classify", to="animation_decide")
    return _goto_cmd(rt, frm="intent_classify", to="design_agent")
