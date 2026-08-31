"""P2 helpers + eval-set metrics (mocked, no live LLM)."""

from __future__ import annotations

from app.services.design.ops.tool_ops_contract import (
    format_canvas_tools_catalog,
    format_canvas_tools_details,
    normalize_need_tools,
)


def test_normalize_need_tools_dedupe():
    got = normalize_need_tools(["create_text", "create_text", "create_text"])
    assert got == ["create_text"]


def test_tools_catalog_nonempty_shape():
    text = format_canvas_tools_catalog({})
    assert "catalog" in text.lower() or "`" in text
    details = format_canvas_tools_details(["create_text"])
    assert isinstance(details, str)
