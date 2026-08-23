# -*- coding: utf-8 -*-
"""Verify helpers that remain on the live code-path (no published-graph runtime)."""
from __future__ import annotations

from app.services.design.runtime.graph.paint_kit import (
    _ops_patch_too_broad,
    _structure_verify_issues,
)


def test_structure_verify_empty_canvas():
    issues = _structure_verify_issues(
        nodes=[], frames=[], painted=True, intent="create"
    )
    assert issues


def test_structure_verify_empty_but_create_ops_ok_is_lag():
    """FE said creates applied — empty inventory must not force re-paint."""
    issues = _structure_verify_issues(
        nodes=[],
        frames=[],
        painted=True,
        intent="create",
        paint_ops=[
            {"name": "create_text", "op_id": "a1", "args": {"text": "hi"}},
            {"name": "create_shape", "op_id": "a2", "args": {"shapeType": "rect"}},
        ],
        op_results=[
            {"op_id": "a1", "name": "create_text", "ok": True},
            {"op_id": "a2", "name": "create_shape", "ok": True},
        ],
    )
    assert issues == []


def test_structure_verify_ok_nodes():
    issues = _structure_verify_issues(
        nodes=[{"id": "n1", "w": 100, "h": 40}],
        frames=[{"id": "f1", "is_empty": False}],
        painted=True,
        intent="create",
    )
    assert not issues


def test_patch_too_broad_wipe():
    broad, reason = _ops_patch_too_broad(
        [{"name": "clear_canvas"}],
        [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}],
        intent="edit",
    )
    assert broad
    assert reason


def test_patch_create_not_broad():
    broad, _ = _ops_patch_too_broad(
        [{"name": "clear_canvas"}],
        [{"id": "a"}],
        intent="create",
    )
    assert not broad
