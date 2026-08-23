"""Streaming tool_ops extraction + activity counts (backend-pushed)."""

from __future__ import annotations

from app.services.design.ops.tool_ops_contract import (
    extract_streaming_tool_ops,
    tool_ops_activity_counts,
)


def test_extract_streaming_complete_ops_from_partial_array():
    partial = (
        '{"tool_ops":['
        '{"name":"create_shape","args":{"shapeType":"rect","x":0,"y":0,"width":10,"height":10,"fill":"#fff"}},'
        '{"name":"create_text","args":{"text":"hi","x":1,"y":2,"fontSize":12}}'
    )
    ops, seen = extract_streaming_tool_ops(partial)
    assert len(ops) == 2
    assert tool_ops_activity_counts(ops) == (2, 0, 0)
    more, seen2 = extract_streaming_tool_ops(partial + "]}", already_ids=seen)
    assert more == []
    assert len(seen2) == 2


def test_extract_streaming_ignores_incomplete_trailing_object():
    partial = (
        '{"tool_ops":['
        '{"name":"create_shape","args":{"shapeType":"rect","x":0,"y":0,"width":10,"height":10,"fill":"#fff"}},'
        '{"name":"create_text","args":{"text":"hi"'
    )
    ops, _seen = extract_streaming_tool_ops(partial)
    assert len(ops) == 1
    assert ops[0]["name"] == "create_shape"
