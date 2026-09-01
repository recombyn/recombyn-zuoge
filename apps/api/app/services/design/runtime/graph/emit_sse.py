from __future__ import annotations

"""SSE emit helpers and canvas chrome events for graph nodes."""

import logging
import uuid
from typing import Any
from langgraph.config import get_stream_writer
from app.services.design.prompts.rules_text import _as_text
from app.services.design.readpath.canvas_scene import explicit_canvas_size
from app.services.design.runtime.graph.state import AgentRunState

_log = logging.getLogger(__name__)


def _reserve_artboard_frame_id(rt: Any) -> str:
    """Stable plate id for this run — FE opens with it; paint sees FOCUS_FRAME_ID."""
    existing = str(rt.flags.get("artboard_frame_id") or "").strip()
    if existing:
        return existing
    frame_id = f"ab_{uuid.uuid4().hex[:12]}"
    rt.flags["artboard_frame_id"] = frame_id
    return frame_id


def _bind_host_artboard_focus(rt: Any, frame_id: str) -> None:
    """Host opened the shimmer plate — that id is FOCUS for the model (not ambient boards)."""
    fid = str(frame_id or "").strip()
    if not fid:
        return
    rt.flags["artboard_frame_id"] = fid
    rt.focus_id = fid


def _should_early_open_artboard(rt: Any) -> bool:
    """Open shimmer loading plate after LLM intent=design create (before paint).

    Chat / canvas_op / Ask / user @ board: never invent a sibling plate.
    Intent ownership is the classifier LLM — no length/keyword demotion here.
    Client size chip preferred; otherwise prompt WxH or scene stock.
    """
    if str(rt.flags.get("mode") or "") == "ask":
        return False
    if str(getattr(rt, "focus_id", "") or "").strip():
        return False
    from app.services.design.runtime.models_route import (
        normalize_user_intent,
        paint_ops_intent,
    )

    classified = normalize_user_intent(getattr(rt, "classified_intent", None))
    if classified != "design":
        return False
    lane = str(getattr(rt, "classified_paint_lane", None) or "").strip() or None
    want = paint_ops_intent(classified, lane)
    if want != "create":
        return False
    if explicit_canvas_size(getattr(rt, "canvas_size", None)):
        return True
    ow, oh = _resolve_loading_wh(rt)
    return ow > 0 and oh > 0


def _wh_from_user_prompt(prompt: str | None) -> tuple[int, int]:
    """First explicit WxH in the user prompt (e.g. 390x844 / 1080×1920)."""
    import re

    text = str(prompt or "")
    for m in re.finditer(r"(?<!\d)(\d{2,4})\s*[x×*]\s*(\d{2,4})(?!\d)", text, re.I):
        try:
            w, h = int(m.group(1)), int(m.group(2))
        except (TypeError, ValueError):
            continue
        if 64 <= w <= 8000 and 64 <= h <= 8000:
            return w, h
    return 0, 0


def _resolve_loading_wh(rt: Any) -> tuple[int, int]:
    """Concrete WxH for early loading plate (chip → prompt → scene stock)."""
    from app.services.design.runtime.graph.scene_log import _resolve_wh
    try:
        ow, oh = int(rt.w or 0), int(rt.h or 0)
    except (TypeError, ValueError):
        ow, oh = 0, 0
    if ow > 0 and oh > 0:
        return ow, oh
    if explicit_canvas_size(getattr(rt, "canvas_size", None)):
        return _resolve_wh(
            canvas_size=rt.canvas_size,
            scene_key=str(rt.scene_key or ""),
            rules=rt.rules or {},
            scene_frames=list(rt.scene_frames or []),
            focus_id=str(rt.focus_id or ""),
        )
    pw, ph = _wh_from_user_prompt(getattr(rt, "prompt", None))
    if pw > 0 and ph > 0:
        return pw, ph
    return _resolve_wh(
        canvas_size=rt.canvas_size,
        scene_key=str(rt.scene_key or ""),
        rules=rt.rules or {},
        scene_frames=list(rt.scene_frames or []),
        focus_id=str(rt.focus_id or ""),
    )


def _emit_canvas_size_step(
    rt: Any,
    *,
    ow: int,
    oh: int,
    design_loading: bool = True,
    reason: str = "size",
) -> bool:
    """SSE: open loading plate + process row (canvas size) so shimmer can start early."""
    if ow <= 0 or oh <= 0:
        return False
    if str(rt.flags.get("mode") or "") == "ask":
        return False
    st = rt.run
    size = f"{ow}x{oh}"
    prev = str(rt.flags.get("artboard_size") or "")
    already = bool(rt.flags.get("artboard_opened")) and prev == size
    frame_id = _reserve_artboard_frame_id(rt)
    # Always hand the Host plate to the model as FOCUS (even if ambient focus lingered).
    _bind_host_artboard_focus(rt, frame_id)
    if not already:
        _emit(
            {
                "type": "status",
                "task_id": st.task_id,
                "trace_id": st.trace_id,
                "open_artboard": True,
                "frame_id": frame_id,
                "canvas_width": ow,
                "canvas_height": oh,
                "canvas_size": size,
                "design_loading": bool(design_loading),
            }
        )
        rt.flags["artboard_opened"] = True
        rt.flags["artboard_size"] = size
    if not explicit_canvas_size(rt.canvas_size):
        rt.canvas_size = size
        rt.w, rt.h = ow, oh
    elif rt.w <= 0 or rt.h <= 0:
        rt.w, rt.h = ow, oh
    # One timeline row per size (skip duplicate same WxH).
    if prev != size:
        # FE i18n: explored + canvas_size: → activityCanvasSizeDone
        _emit(
            {
                "type": "activity",
                "id": f"canvas-size-{st.task_id[:8]}-{size}",
                "kind": "explored",
                "status": "done",
                "stage": "scene",
                "detail": f"canvas_size:{size}",
                "summary": size,
                "index": int(getattr(st, "round", 0) or 0),
            }
        )
        st.push_log(
            phase="canvas_size",
            intent=str(rt.classified_intent or ""),
            summary=f"canvas_size {size} frame_id={frame_id} ({reason})",
        )
    return True


def _emit_design_loading_artboard(rt: Any) -> bool:
    """Open artboard + shimmer as design loading (after intent, before paint/action)."""
    if str(rt.flags.get("mode") or "") == "ask":
        # Ask waits for user confirm — do not spawn a loading plate yet.
        return False
    if not _should_early_open_artboard(rt):
        return False
    ow, oh = _resolve_loading_wh(rt)
    return _emit_canvas_size_step(
        rt, ow=ow, oh=oh, design_loading=True, reason="intent"
    )

def _emit_canvas_size_from_ops(rt: Any, step_ops: list[dict[str, Any]]) -> bool:
    """Open an artboard only when ops include a single create_frame.

    Infinite canvas: create_shape / create_text / … do not need a frame plate.
    Multi create_frame (UI set / multi-poster): FE applies each plate — do not
    host-open one shimmer board that would collapse the set.
    """
    from app.services.design.runtime.graph.paint_kit import (
        _count_create_frame_ops,
        _is_multi_artboard_batch,
        _wh_from_create_frame_ops,
    )

    if _is_multi_artboard_batch(step_ops):
        st = rt.run
        n = _count_create_frame_ops(step_ops)
        _emit(
            {
                "type": "activity",
                "id": f"multi-artboard-{st.task_id[:8]}-{n}",
                "kind": "explored",
                "status": "done",
                "stage": "scene",
                "detail": f"multi_artboard:{n}",
                "summary": f"{n} artboards",
                "index": int(getattr(st, "round", 0) or 0),
            }
        )
        st.push_log(
            phase="canvas_size",
            intent=str(rt.classified_intent or ""),
            summary=f"multi_artboard {n} (paint_ops)",
        )
        return False
    ow, oh = _wh_from_create_frame_ops(step_ops)
    if ow <= 0 or oh <= 0:
        return False
    return _emit_canvas_size_step(
        rt, ow=ow, oh=oh, design_loading=True, reason="paint_ops"
    )

def _emit_tool_ops_validation_ui(
    rt: Any,
    errors: list[Any] | None,
    *,
    kept: int = 0,
) -> None:
    """Surface tool_ops validation failures in chat (not Admin-only)."""
    from app.services.design.runtime.graph.paint_kit import _op_error_codes
    errs = [str(e).strip() for e in list(errors or []) if str(e or "").strip()]
    if not errs:
        return
    codes = _op_error_codes(errs)
    code_hint = ", ".join(codes[:3]) if codes else "invalid_op"
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": f"validate-ops-{st.task_id[:8]}",
            "kind": "skipped",
            "status": "error",
            "stage": "validate",
            "count": len(errs),
            "code": "ops_validate_failed",
            # Machine codes only — FE i18n builds the user label.
            "detail": code_hint[:240],
            "summary": (
                f"kept {kept}; " if kept > 0 else ""
            )
            + "; ".join(errs[:6])[:800],
        }
    )

def _flush_host_events(state: AgentRunState, events: list[dict[str, Any]]) -> None:
    for ev in events or []:
        sk = _as_text(ev.get("switch_kind")).strip()
        reason = _as_text(ev.get("model_reason")).strip()
        if sk == "vision" or "vision" in reason:
            state.vision_used = True
        state.push_log(**ev)

def _emit(ev: dict[str, Any]) -> None:
    try:
        get_stream_writer()(ev)
    except Exception:
        pass


def _emit_chat_ui_done(rt: Any) -> None:
    """Release chat caret / stop button before settle's slow side effects."""
    flags = rt.flags if isinstance(getattr(rt, "flags", None), dict) else None
    if flags is None:
        _emit({"type": "chat_done"})
        return
    if flags.get("chat_ui_done"):
        return
    flags["chat_ui_done"] = True
    rt.flags = flags
    _emit({"type": "chat_done"})


def _paint_user_reply(raw: str | None, *, limit: int = 280) -> str:
    """User-facing post-paint line — strip tool/schema dumps, keep designer voice.

    Progress belongs in activity / analysis_delta / phase SSE only.
    Truncates overlong essays instead of discarding them entirely.
    """
    text = " ".join(str(raw or "").split()).strip()
    if not text:
        return ""
    banned = (
        "tool_ops",
        "create_shape",
        "create_text",
        "create_frame",
        "need_skills",
        "PaintOps",
        "schema",
    )
    low = text.lower()
    if any(b.lower() in low for b in banned):
        return ""
    return text[:limit]


def _design_assistant_reply(
    *,
    raw_reply: str | None,
    ops: list[dict[str, Any]] | None = None,
    locale: str = "zh-CN",
) -> str:
    """Warm designer close: cleaned model reply, or locale fallback + next steps."""
    cleaned = _paint_user_reply(raw_reply, limit=280)
    loc = str(locale or "zh-CN")
    zh = loc.startswith("zh")
    ja = loc.startswith("ja")

    if cleaned and len(cleaned) >= 6:
        # Model already wrote a user line — keep it (language layer should match locale).
        return cleaned

    detail = ""
    try:
        from app.services.design.ops.tool_ops_contract import tool_ops_batch_detail

        detail = (tool_ops_batch_detail(list(ops or []), limit=4) or "").strip()
    except Exception:
        detail = ""

    if zh:
        head = f"好的，已完成：{detail}。" if detail else "好的，我已经在画布完成这次操作。"
        tips = "下一步可以：调整颜色、添加文字，或微调布局。"
        return f"{head}\n{tips}"[:280]
    if ja:
        head = f"完了しました：{detail}。" if detail else "キャンバスへの反映が完了しました。"
        tips = "次は色調整・文字追加・レイアウト調整ができます。"
        return f"{head}\n{tips}"[:280]
    head = f"Done: {detail}." if detail else "Done — it's on the canvas."
    tips = "Next: tweak color, add text, or refine layout."
    return f"{head}\n{tips}"[:280]


def _emit_deferred_paint_reply(st: AgentRunState, *, ops_sent: bool) -> None:
    """Stream paint reply only after real tool_ops were pushed to the client."""
    if not ops_sent:
        st.reply = ""
        return
    text = _paint_user_reply(st.reply, limit=280)
    st.reply = text
    if not text:
        return
    _emit({"type": "token", "text": text})


__all__ = [
    '_reserve_artboard_frame_id',
    '_bind_host_artboard_focus',
    '_should_early_open_artboard',
    '_resolve_loading_wh',
    '_emit_canvas_size_step',
    '_emit_design_loading_artboard',
    '_emit_canvas_size_from_ops',
    '_emit_tool_ops_validation_ui',
    '_flush_host_events',
    '_emit',
    '_emit_chat_ui_done',
    '_paint_user_reply',
    '_design_assistant_reply',
    '_emit_deferred_paint_reply',
]
