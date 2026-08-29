"""Animation path paint kit — tool whitelist + MOTION_BRIEF helpers."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.graph.paint_kit import (
    _format_motion_brief_for_paint,
    _is_animation_paint_turn,
    _paint_tool_keys_for_turn,
)


def _rt(*, intent: str = "animation", lane: str = "create", flags: dict | None = None):
    return SimpleNamespace(
        classified_intent=intent,
        classified_paint_lane=lane,
        flags=flags or {},
        images=None,
        scene_nodes=[],
        scene_key="",
        run=SimpleNamespace(skills_loaded=[], tools_loaded=[], intent=lane),
    )


def test_animation_paint_turn_flag_or_intent():
    assert _is_animation_paint_turn(_rt(intent="animation")) is True
    assert _is_animation_paint_turn(_rt(intent="design", flags={"animation_path": True})) is True
    assert _is_animation_paint_turn(_rt(intent="design")) is False
    assert _is_animation_paint_turn(_rt(intent="canvas_op")) is False


def test_animation_tool_keys_create_lottie_only():
    keys = _paint_tool_keys_for_turn(_rt(intent="animation", lane="create"))
    assert keys == ["create_lottie"]


def test_animation_tool_keys_edit_allows_update():
    rt = _rt(intent="animation", lane="edit")
    rt.scene_nodes = [{"id": "n1"}]
    keys = _paint_tool_keys_for_turn(rt)
    assert keys == ["create_lottie", "update_node"]


def test_format_motion_brief_for_paint():
    text = _format_motion_brief_for_paint(
        {"goal": "loading spinner", "loop": True, "tempo": "calm", "movers": 1}
    )
    assert "goal: loading spinner" in text
    assert "loop: True" in text
    assert "tempo: calm" in text
    assert _format_motion_brief_for_paint(None) == ""
    assert _format_motion_brief_for_paint({}) == ""
