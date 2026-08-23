"""PR0 — existing tool_ops must keep working under Design Engine V3."""
from __future__ import annotations

import json
from pathlib import Path

from app.services.design.ops.tool_ops_contract import (
    TOOL_OPS_SCHEMA_VERSION,
    allowed_canvas_tool_keys,
    normalize_agent_tool_ops,
)

_FIX = Path(__file__).resolve().parent / "fixtures"


def _load_fixture(name: str) -> dict:
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def test_schema_version_stable_prefix():
    assert TOOL_OPS_SCHEMA_VERSION.startswith("2026-")


def test_core_canvas_tools_still_allowed():
    keys = allowed_canvas_tool_keys()
    for name in (
        "create_frame",
        "create_text",
        "create_shape",
        "create_image",
        "update_node",
        "delete_nodes",
        "align_nodes",
        "reorder_nodes",
    ):
        assert name in keys, f"missing tool {name}"


def test_create_update_delete_on_empty_canvas():
    scene = _load_fixture("empty_canvas.json")
    ops_in = [
        {"name": "create_frame", "args": {"id": "f1", "width": 1080, "height": 1920}},
        {
            "name": "create_shape",
            "args": {
                "id": "r1",
                "frameId": "f1",
                "shapeType": "rect",
                "x": 40,
                "y": 40,
                "w": 200,
                "h": 120,
                "fill": "#222222",
            },
        },
        {
            "name": "create_text",
            "args": {
                "id": "t1",
                "frameId": "f1",
                "x": 60,
                "y": 60,
                "text": "Hello",
                "fontSize": 32,
                "fill": "#FFFFFF",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        ops_in,
        scene_nodes=list(scene.get("nodes") or []),
        scene_frames=list(scene.get("frames") or []),
        classified_intent="create",
    )
    assert not any("tool_not_allowed" in e for e in errs), errs
    names = [str(o.get("name") or "") for o in ops]
    assert "create_frame" in names
    assert "create_shape" in names
    assert "create_text" in names


def test_poster_base_update_move_resize_delete():
    """Move/resize are update_node x/y/w/h — not separate tool names."""
    scene = _load_fixture("poster_base.json")
    ops, errs = normalize_agent_tool_ops(
        [
            {"name": "update_node", "args": {"nodeId": "title", "fontSize": 72}},
            {"name": "update_node", "args": {"nodeId": "hero", "y": 400}},
            {"name": "update_node", "args": {"nodeId": "hero", "w": 700, "h": 1080}},
            {"name": "delete_nodes", "args": {"nodeIds": ["bg"]}},
        ],
        scene_nodes=list(scene.get("nodes") or []),
        scene_frames=list(scene.get("frames") or []),
        classified_intent="edit",
    )
    assert not errs, errs
    names = [str(o.get("name") or "") for o in ops]
    assert "update_node" in names
    assert "delete_nodes" in names
    assert len(ops) >= 3


def test_landing_base_create_section_text():
    scene = _load_fixture("landing_base.json")
    ops, errs = normalize_agent_tool_ops(
        [
            {
                "name": "create_text",
                "args": {
                    "id": "proof",
                    "frameId": "frame_landing",
                    "x": 80,
                    "y": 520,
                    "text": "Trusted by teams",
                    "fontSize": 28,
                    "fill": "#333333",
                },
            },
            {"name": "update_node", "args": {"nodeId": "cta", "cornerRadius": 12}},
        ],
        scene_nodes=list(scene.get("nodes") or []),
        scene_frames=list(scene.get("frames") or []),
        classified_intent="edit",
    )
    assert not errs, errs
    assert len(ops) == 2
