from __future__ import annotations

import asyncio

from langgraph.types import Command

from app.services.agent_memory.service import memory_service
from app.services.design.runtime.graph.nodes.bootstrap import _hydrate_pinned_skills
from app.services.design.runtime.graph.state import GraphState
from app.services.design.runtime.graph.llm_io import _clip_llm_raw
from app.services.design.runtime.graph.scene_log import (
    _goto_cmd,
)
from app.services.design.runtime.models_route import apply_classified_model_route


async def _node_memory(state: GraphState) -> Command:
    rt = state["rt"]
    st = rt.run
    await apply_classified_model_route(rt)
    mem_bundle = await asyncio.to_thread(
        memory_service.load,
        user_id=rt.user_id,
        session_id=rt.session_id,
        project_id=rt.project_id,
        memory_in=rt.memory_in,
        rules=rt.rules,
        query=rt.prompt,
        scene=rt.scene_key or "",
    )
    rt.mem_blocks = mem_bundle.blocks or ""
    rt.mem_short = list(mem_bundle.short or [])
    rt.mem_short_all = list(mem_bundle.short_all or mem_bundle.short or [])
    rt.mem_medium = mem_bundle.medium if isinstance(mem_bundle.medium, dict) else {}
    if rt.mem_blocks or rt.mem_short:
        st.push_log(
            phase="memory",
            memory_injected=True,
            detail_chars=len(rt.mem_blocks or ""),
            short_turns=len(rt.mem_short or []),
            summary=(
                f"memory injected chars={len(rt.mem_blocks or '')}"
                f" / short={len(rt.mem_short or [])}"
            ),
            llm_user=_clip_llm_raw(rt.mem_blocks or "", limit=6000),
            llm_raw=_clip_llm_raw(
                "\n".join(str(x)[:200] for x in list(rt.mem_short or [])[:8]),
                limit=2000,
            ),
        )
    rt.decision.memory_injected = bool(rt.mem_blocks)
    rt.decision.memory_blocks_chars = len(rt.mem_blocks or "")
    rt.decision.short_turns = len(rt.mem_short)
    return _goto_cmd(rt, frm="memory", to="intent_classify")

