"""Tests for renderable text node attrs (MCP headless / Agent parity)."""
from __future__ import annotations

import json

import pytest

from app.services.design.ops.text_node_attrs import (
    build_markdown_text_attrs,
    merge_text_node_attrs,
    text_plain_from_attrs,
    validate_create_text_op_args,
    validate_headless_patch,
    validate_renderable_text_node,
    validate_text_attrs_payload,
)
from app.services.design.ops.tool_ops_contract import extract_and_validate_tool_ops
from app.services.mcp.apply_headless import ops_to_document_patch
from app.services.mcp.dispatch import McpCanvasError, _persist_ops

def test_build_markdown_text_attrs_has_data_and_origin():
    attrs = build_markdown_text_attrs("Hello", {"fill": "#ffffff", "fontSize": 24, "fontWeight": "700"})
    assert "DATA" in attrs
    assert "ORIGIN_DATA" in attrs
    assert text_plain_from_attrs(attrs) == "Hello"
    origin = json.loads(attrs["ORIGIN_DATA"])
    assert origin[0]["children"][0]["text"] == "Hello"
    assert origin[0]["children"][0]["font-base"]["color"] == "#ffffff"
    assert origin[0]["children"][0]["bold"] is True


def test_headless_create_text_is_renderable():
    doc = {
        "pageChildren": [],
        "frames": [],
        "deltaSetLike": {"ROOT": {"id": "ROOT", "key": "entry", "children": []}},
    }
    patch = ops_to_document_patch(
        doc,
        [
            {
                "name": "create_text",
                "args": {
                    "text": "SUMMER\nFEST",
                    "x": 48,
                    "y": 120,
                    "width": 440,
                    "fontSize": 72,
                    "fontWeight": "700",
                    "fill": "#ffffff",
                },
            }
        ],
    )
    upsert = patch.get("upsertNodes") or {}
    text_node = next(v for k, v in upsert.items() if k != "ROOT" and v.get("key") == "text")
    assert validate_renderable_text_node(text_node) == []
    assert text_plain_from_attrs(text_node["attrs"]) == "SUMMER\nFEST"
    assert not patch.get("schemaWarnings")


def test_merge_text_node_preserves_text_when_changing_fill():
    base = build_markdown_text_attrs("Title", {"fill": "#ffffff", "fontSize": 24})
    merged = merge_text_node_attrs({"autoSize": "true", **base}, {"fill": "#ff0000"})
    assert text_plain_from_attrs(merged) == "Title"
    origin = json.loads(merged["ORIGIN_DATA"])
    assert origin[0]["children"][0]["font-base"]["color"] == "#ff0000"


def test_rejects_create_text_missing_xy():
    err = validate_create_text_op_args({"text": "Hi"})
    assert err and err[0] == "create_text_missing_xy"


def test_rejects_create_text_color_field():
    err = validate_create_text_op_args({"text": "Hi", "x": 1, "y": 2, "color": "#fff"})
    assert err and err[0] == "create_text_forbidden_field_color"


def test_rejects_invalid_text_fill():
    _, errs = extract_and_validate_tool_ops(
        [{"name": "create_text", "args": {"text": "Hi", "x": 1, "y": 2, "fill": "not-a-color"}}],
    )
    assert any("create_text_invalid_fill" in e for e in errs)


def test_rejects_legacy_text_attrs_payload():
    errors = validate_text_attrs_payload(
        {"text": "Hi", "color": "#fff", "DATA": "[]", "ORIGIN_DATA": "[]"}
    )
    assert "text_node_legacy_fields:text,color" in errors


def test_dispatch_rejects_invalid_headless_text_patch(monkeypatch):
    bad_patch = {
        "upsertNodes": {
            "t1": {
                "id": "t1",
                "key": "text",
                "x": 0,
                "y": 0,
                "width": 40,
                "height": 20,
                "attrs": {"text": "Hi", "color": "#ffffff"},
            }
        }
    }
    monkeypatch.setattr(
        "app.services.mcp.dispatch.ops_to_document_patch",
        lambda _doc, _ops: bad_patch,
    )
    monkeypatch.setattr(
        "app.services.mcp.dispatch.load_writable_project",
        lambda _uid, _pid: {"id": "p1", "revision": 1, "document": {}},
    )
    monkeypatch.setattr("app.services.mcp.dispatch.has_live_session", lambda _pid: False)
    monkeypatch.setattr(
        "app.services.mcp.dispatch.extract_and_validate_tool_ops",
        lambda *a, **k: ([{"name": "create_text", "args": {"text": "Hi", "x": 1, "y": 2}}], []),
    )

    with pytest.raises(McpCanvasError) as exc:
        _persist_ops("u1", "p1", [{"name": "create_text", "args": {"text": "Hi", "x": 1, "y": 2}}])
    assert exc.value.code == "schema_invalid"
    assert validate_headless_patch(bad_patch)