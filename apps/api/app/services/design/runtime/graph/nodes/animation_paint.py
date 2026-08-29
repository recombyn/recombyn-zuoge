"""Animation branch paint — same paint_ops engine, animation tool whitelist."""
from __future__ import annotations

from langgraph.types import Command

from app.services.design.runtime.graph.nodes.paint import _node_paint_ops
from app.services.design.runtime.graph.state import GraphState


async def _node_animation_paint(state: GraphState) -> Command:
    """Mark animation_path then reuse paint_ops (create_lottie whitelist)."""
    rt = state["rt"]
    rt.flags["animation_path"] = True
    rt.flags["skip_design_brief"] = True
    return await _node_paint_ops(state)
