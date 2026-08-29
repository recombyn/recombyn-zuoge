"""Animation branch decide — short motion brief + animation_workbench skill only.

Does not run poster DesignBrief / design_agent methodology.
"""
from __future__ import annotations

import time

from langgraph.types import Command

from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.graph.scene_log import _bump, _goto_cmd
from app.services.design.runtime.graph.state import GraphState
from app.services.design.runtime.host.resources import load_deferred_resources
from app.services.design.runtime.models_route import (
    normalize_paint_lane,
    normalize_user_intent,
    paint_ops_intent,
)


def _motion_brief_from_prompt(prompt: str) -> dict[str, object]:
    text = str(prompt or "").strip()
    low = text.lower()
    loop = not any(
        k in low or k in text
        for k in ("一次", "one-shot", "oneshot", "success", "成功", "点赞完成")
    )
    return {
        "goal": text[:800],
        "loop": loop,
        "tempo": "calm",
        "movers": 1,
    }


async def _node_animation_decide(state: GraphState) -> Command:
    """Load animation_workbench skill, stash motion brief, go paint."""
    rt = state["rt"]
    st = rt.run
    intent = normalize_user_intent(getattr(rt, "classified_intent", None))
    if intent != "animation":
        # Safety: never leak into this node from another gate.
        return _goto_cmd(rt, frm="animation_decide", to="design_agent")

    lane = normalize_paint_lane(
        getattr(rt, "classified_paint_lane", None),
        intent=intent,
    )
    want = paint_ops_intent(intent, lane)
    st.intent = want
    rt.flags["animation_path"] = True
    rt.flags["skip_design_brief"] = True
    brief = _motion_brief_from_prompt(rt.prompt or "")
    rt.flags["motion_brief"] = brief

    turn = {
        "intent": want,
        "need_skills": ["animation_workbench"],
        "need_tools": [],
        "need_subagents": [],
        "reply": "",
        "tool_ops": [],
    }
    rt.turn = turn
    t0 = time.perf_counter()
    await load_deferred_resources(rt, turn)
    ms = max(0, int((time.perf_counter() - t0) * 1000))

    _emit(
        {
            "type": "activity",
            "id": f"anim-decide-{st.task_id[:8]}",
            "kind": "thought",
            "status": "done",
            "stage": "animation",
            "summary": f"motion brief · loop={brief.get('loop')}",
        }
    )
    st.push_log(
        phase="animation_decide",
        intent="animation",
        paint_lane=lane or None,
        summary=f"skill=animation_workbench · loop={brief.get('loop')}",
        duration_ms=ms,
    )
    return Command(update=_bump(rt), goto="animation_paint")
