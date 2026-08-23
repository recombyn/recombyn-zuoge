"""PR0 — scene fixtures load; mutation path still goes through tool_ops contract."""
from __future__ import annotations

import json
from pathlib import Path

from app.services.design.ops.tool_ops_contract import normalize_agent_tool_ops

_FIX = Path(__file__).resolve().parent / "fixtures"


def test_fixtures_parse():
    for name in ("empty_canvas.json", "poster_base.json", "landing_base.json"):
        data = json.loads((_FIX / name).read_text(encoding="utf-8"))
        assert isinstance(data.get("nodes"), list)
        assert isinstance(data.get("frames"), list)


def test_scene_mutation_is_ops_not_direct_redux():
    """AI changes must be Tool Ops — Skill V3 must not invent new write paths."""
    scene = json.loads((_FIX / "poster_base.json").read_text(encoding="utf-8"))
    ops, errs = normalize_agent_tool_ops(
        [{"name": "update_node", "args": {"nodeId": "title", "text": "神兵"}}],
        scene_nodes=list(scene["nodes"]),
        scene_frames=list(scene["frames"]),
        classified_intent="edit",
    )
    assert not errs
    assert ops[0]["name"] == "update_node"
    # Contract never returns a Redux-shaped patch.
    assert "type" not in ops[0] or ops[0].get("type") != "editor/setNodes"
