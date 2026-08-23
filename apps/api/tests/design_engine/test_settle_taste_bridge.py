"""Settle bridges Intelligence taste notes into public design memory."""
from __future__ import annotations

from app.services.design.runtime.graph.nodes.settle import (
    _merge_taste_into_user_layer,
    _taste_notes_from_rt,
)


def test_merge_taste_into_user_layer_accepts_and_rejects():
    user = {
        "preference": {},
        "accepted_patterns": ["keep me"],
        "rejected_patterns": [],
    }
    notes = [
        "taste:ai_landing:editorial_not_glow — no glow",
        "thesis:editorial product",
        "research:avoid: purple gradient",
        "preference:premium_restraint",
    ]
    out = _merge_taste_into_user_layer(user, notes)
    assert "keep me" in out["accepted_patterns"]
    assert any("editorial_not_glow" in x for x in out["accepted_patterns"])
    assert any("thesis:editorial product" == x for x in out["accepted_patterns"])
    assert any("purple" in x.lower() for x in out["rejected_patterns"])
    assert "premium_restraint" in out["preference"]
    assert "anti_glow" in out["preference"]


def test_taste_notes_from_rt_flags():
    class _RT:
        flags = {
            "memory_notes": ["taste:poster:hero_60_80"],
            "taste_principles": ["thesis:museum sword"],
            "intelligence_principle_write": {
                "principles": ["research:avoid: particles"],
                "written": True,
            },
        }

    notes = _taste_notes_from_rt(_RT())
    assert "taste:poster:hero_60_80" in notes
    assert "thesis:museum sword" in notes
    assert "research:avoid: particles" in notes
