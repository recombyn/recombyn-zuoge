"""PR10 — Observe deterministic QA: facts only, no taste."""
from __future__ import annotations

import json
from pathlib import Path

from app.services.design.runtime.graph.nodes.observe import (
    _observe_retry_issues,
    compute_observe_facts,
    format_observe_facts,
)

_FIX = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def _poster_brief(**rules):
    return {
        "purpose": "promote a greatsword",
        "audience": "players",
        "emotion": ["solemn"],
        "visual_thesis": "museum relic sword",
        "visual_hero": "greatsword",
        "composition": {"archetype": "center_hero", "rules": rules or {"empty_space": "≥ 15%"}},
        "avoid": ["particles"],
    }


def test_poster_base_reports_metrics_without_fail():
    scene = _load("poster_base.json")
    facts = compute_observe_facts(
        nodes=list(scene["nodes"]),
        frames=list(scene["frames"]),
        painted=True,
        intent="create",
        design_brief=_poster_brief(),
        focus_frame_id="frame_poster",
    )
    assert facts.whitespace_ratio is not None
    assert facts.whitespace_ratio >= 0.15
    assert facts.whitespace_fail is False
    assert facts.overlap is False
    assert facts.overflow is False
    assert facts.edge_crowding is False
    lines = format_observe_facts(facts)
    assert any(s.startswith("hero coverage =") for s in lines)
    assert any(s.startswith("whitespace =") for s in lines)
    assert "overlap = false" in lines
    assert "edge crowding = false" in lines


def test_typography_hierarchy_insufficient_is_structure_retry():
    facts = compute_observe_facts(
        nodes=[
            {
                "id": "h1",
                "type": "text",
                "frameId": "f",
                "x": 40,
                "y": 40,
                "w": 200,
                "h": 50,
                "text": "Title",
                "fontSize": 42,
            },
            {
                "id": "h2",
                "type": "text",
                "frameId": "f",
                "x": 40,
                "y": 120,
                "w": 200,
                "h": 48,
                "text": "Sub",
                "fontSize": 40,
            },
        ],
        frames=[{"id": "f", "x": 0, "y": 0, "w": 400, "h": 400}],
        painted=True,
        intent="create",
    )
    assert facts.h1_size == 42
    assert facts.h2_size == 40
    assert facts.h1_h2_ratio == 1.05
    assert facts.typography_hierarchy_ok is False
    assert any("Typography hierarchy insufficient" in i for i in facts.issues)
    retry = _observe_retry_issues(facts)
    assert any("Typography" in i for i in retry)


def test_whitespace_below_skill_is_fail_not_retry():
    facts = compute_observe_facts(
        nodes=[
            {
                "id": "left",
                "type": "rect",
                "frameId": "f",
                "x": 8,
                "y": 8,
                "w": 95,
                "h": 185,
                "fill": "#111",
            },
            {
                "id": "right",
                "type": "rect",
                "frameId": "f",
                "x": 100,
                "y": 8,
                "w": 92,
                "h": 185,
                "fill": "#222",
            },
        ],
        frames=[{"id": "f", "x": 0, "y": 0, "w": 200, "h": 200}],
        painted=True,
        intent="create",
        design_brief=_poster_brief(empty_space="≥ 15%"),
        skills_loaded=["poster_craft"],
    )
    assert facts.whitespace_ratio is not None
    assert facts.whitespace_ratio < 0.15
    assert facts.whitespace_fail is True
    assert any("FAIL" in i and "whitespace" in i for i in facts.issues)
    retry = _observe_retry_issues(facts)
    assert not any("whitespace" in i.lower() for i in retry)


def test_overflow_is_structure_retry():
    facts = compute_observe_facts(
        nodes=[
            {
                "id": "title",
                "type": "text",
                "frameId": "f",
                "x": 20,
                "y": 20,
                "w": 200,
                "h": 40,
                "text": "Wide",
                "fontSize": 24,
            }
        ],
        frames=[{"id": "f", "x": 0, "y": 0, "w": 100, "h": 200}],
        painted=True,
        intent="create",
    )
    assert facts.overflow is True
    retry = _observe_retry_issues(facts)
    assert any(i.startswith("overflow") for i in retry)


def test_overlap_is_structure_retry_edge_crowding_is_fact():
    facts = compute_observe_facts(
        nodes=[
            {
                "id": "a",
                "type": "rect",
                "frameId": "f",
                "x": 2,
                "y": 2,
                "w": 80,
                "h": 80,
            },
            {
                "id": "b",
                "type": "rect",
                "frameId": "f",
                "x": 40,
                "y": 40,
                "w": 80,
                "h": 80,
            },
        ],
        frames=[{"id": "f", "x": 0, "y": 0, "w": 400, "h": 400}],
        painted=True,
        intent="create",
    )
    assert facts.overlap is True
    assert facts.edge_crowding is True
    retry = _observe_retry_issues(facts)
    assert any("overlap" in i.lower() for i in retry)
    assert not any("edge crowding" in i.lower() for i in retry)


def test_empty_board_still_structure_issue():
    facts = compute_observe_facts(
        nodes=[],
        frames=[],
        painted=True,
        intent="create",
    )
    assert facts.structure_issues
    assert _observe_retry_issues(facts)
