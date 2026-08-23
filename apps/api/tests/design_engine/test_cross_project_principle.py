"""P40 — Cross-project Principle: migrate Principle, never client/brand specifics."""
from __future__ import annotations

from app.services.agent_memory.kg import (
    CROSS_PROJECT_PREDICATES,
    abstract_outcome_to_principle,
    cross_project_transferables,
    extract_cross_project_principle,
    format_kg_block,
    is_project_specific_memory,
    migrate_principle_across_projects,
)


def test_rejects_client_120px_preference():
    """Spec anti-example: must NOT remember 「客户喜欢 120px 标题」."""
    assert is_project_specific_memory("这个客户喜欢 120px 标题") is True
    bad = abstract_outcome_to_principle(
        evidence="这个客户喜欢 120px 标题",
        composition_class="editorial",
    )
    assert bad is not None
    assert bad["ok"] is False
    assert bad["reason"] == "project_specific"
    assert bad["principle"] == ""


def test_abstracts_large_title_plus_whitespace_to_principle():
    """Spec: 大标题 + 大留白 → Editorial typography contrast ↔ negative-space."""
    good = abstract_outcome_to_principle(
        evidence="大标题 + 大留白效果很好",
        composition_class="editorial",
    )
    assert good is not None
    assert good["ok"] is True
    text = good["principle"]
    assert "Editorial" in text or "editorial" in text.lower()
    assert "typography contrast" in text.lower()
    assert "negative-space" in text.lower()
    assert "120px" not in text
    assert "客户" not in text


def test_migrate_principle_a_to_b_without_brand_copy():
    from_a = extract_cross_project_principle(
        project_id="project-a",
        evidence="大标题 + 大留白效果很好",
        composition_class="editorial",
        outcome_score=92,
    )
    assert from_a["ok"] is True
    assert from_a["transferable"] is True
    migrated = migrate_principle_across_projects(from_a, to_project="project-b")
    assert migrated["ok"] is True
    assert migrated["to_project"] == "project-b"
    assert migrated["payload"]["brand"] is None
    assert migrated["payload"]["colors"] == []
    assert migrated["payload"]["font_px"] is None
    preds = {p for _s, p, _o in migrated["triples"]}
    assert "applies_in" in preds
    assert preds <= CROSS_PROJECT_PREDICATES | {"applies_in", "abstracted_from"}
    # No brand hex / px in migrated principle text.
    assert "#" not in migrated["principle"]
    assert "px" not in migrated["principle"].lower()


def test_transferables_filter_drops_project_specific():
    rows = [
        {
            "ok": True,
            "transferable": True,
            "principle": (
                "In Editorial composition, high typography contrast "
                "correlates with high negative-space ratio."
            ),
        },
        {
            "ok": True,
            "transferable": True,
            "principle": "这个客户喜欢 120px 标题",
        },
        {"ok": False, "principle": "ignored"},
    ]
    kept = cross_project_transferables(rows)
    assert len(kept) == 1
    assert "typography contrast" in kept[0]["principle"]


def test_format_kg_block_surfaces_cross_project():
    block = format_kg_block(
        [
            {
                "s": "principle:In Editorial composition…",
                "p": "applies_in",
                "o": "project:project-b",
                "weight": 1,
            }
        ]
    )
    assert "Cross-project Principles" in block
    assert "applies_in" in block
