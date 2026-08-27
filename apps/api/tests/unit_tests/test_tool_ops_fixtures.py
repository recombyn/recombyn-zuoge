"""Parametric headless tests driven by shared tests/fixtures/tool_ops/*.json."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.services.mcp.apply_headless import ops_to_document_patch
from app.services.projects import apply_document_patch

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "tool_ops"


def _load_fixture_cases() -> list[dict]:
    cases: list[dict] = []
    if not FIXTURE_DIR.is_dir():
        return cases
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and raw.get("id"):
            cases.append(raw)
    return cases


def _bound_nodes(doc: dict, frame_id: str) -> list[dict]:
    delta = doc.get("deltaSetLike") or {}
    out: list[dict] = []
    for nid, node in delta.items():
        if nid in ("ROOT", frame_id) or not isinstance(node, dict):
            continue
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        if str(attrs.get("frameId") or "") != frame_id:
            continue
        out.append({"id": str(nid), **node, "attrs": attrs})
    out.sort(key=lambda n: int(n.get("attrs", {}).get("frameOrder", 0)))
    return out


@pytest.mark.parametrize("case", _load_fixture_cases(), ids=lambda c: str(c.get("id")))
def test_tool_ops_fixture_headless(case: dict) -> None:
    doc = copy.deepcopy(case.get("doc") or {})
    ops = case.get("ops") or []
    expect = case.get("expect") or {}
    frame_id = str(expect.get("frameId") or "")

    patch = ops_to_document_patch(doc, ops)
    assert patch, f"fixture {case.get('id')} produced empty patch"
    merged = apply_document_patch(doc, patch)

    if "shapeCount" in expect:
        shapes = [
            n
            for n in _bound_nodes(merged, frame_id)
            if str(n.get("key") or "") == "shape"
        ]
        assert len(shapes) == int(expect["shapeCount"])
        shape = shapes[0]
        assert float(shape.get("x") or 0) == float(expect["worldX"])
        assert float(shape.get("y") or 0) == float(expect["worldY"])
        assert int(shape["attrs"].get("frameOrder", -1)) == int(expect["frameOrder"])
        if expect.get("inRoot"):
            root = (merged.get("deltaSetLike") or {}).get("ROOT") or {}
            assert shape["id"] in list(root.get("children") or [])

    if "createdCount" in expect:
        bound = _bound_nodes(merged, frame_id)
        assert len(bound) == int(expect["createdCount"])
        orders = [int(n["attrs"].get("frameOrder", -1)) for n in bound]
        assert orders == list(expect.get("frameOrders") or [])
        if expect.get("grouped"):
            group_ids = {n["attrs"].get("groupId") for n in bound}
            assert len(group_ids) == 1
            assert None not in group_ids
        if expect.get("inRoot"):
            root = (merged.get("deltaSetLike") or {}).get("ROOT") or {}
            children = set(root.get("children") or [])
            assert all(n["id"] in children for n in bound)
