"""P2 helpers + eval-set metrics (mocked, no live LLM)."""

from __future__ import annotations

from app.services.design.runtime.graph.turns import _parse_agent_turn
from app.services.design.ops.tool_ops_contract import (
    format_canvas_tools_catalog,
    format_canvas_tools_details,
    normalize_need_tools,
)


def test_parse_need_tools_in_turn():
    turn = _parse_agent_turn(
        '{"thought":"加字","intent":"edit","need_tools":["create_text","update_node"],'
        '"tool_ops":[],"done":false}'
    )
    assert turn["intent"] == "edit"
    assert turn["need_tools"] == ["create_text", "update_node"]
    assert turn["done"] is False


def test_parse_need_skills_still_works():
    turn = _parse_agent_turn(
        '{"thought":"配色","intent":"create","need_skills":["poster_craft"],'
        '"tool_ops":[],"done":false}'
    )
    assert turn["need_skills"] == ["poster_craft"]


def test_parse_need_subagents_in_turn():
    turn = _parse_agent_turn(
        '{"thought":"读图","intent":"create",'
        '"need_subagents":["vision_scout",{"id":"vision_scout","task":"x","background":true}],'
        '"tool_ops":[],"done":false}'
    )
    jobs = turn["need_subagents"]
    assert isinstance(jobs, list)
    assert jobs[0]["id"] == "vision_scout"
    assert jobs[0]["background"] is False
    assert any(j.get("background") for j in jobs)


def test_normalize_need_tools_dedupe():
    got = normalize_need_tools(["create_text", "create_text", "create_text"])
    assert got == ["create_text"]


def test_tools_catalog_nonempty_shape():
    text = format_canvas_tools_catalog({})
    assert "catalog" in text.lower() or "`" in text
    details = format_canvas_tools_details(["create_text"])
    assert isinstance(details, str)


