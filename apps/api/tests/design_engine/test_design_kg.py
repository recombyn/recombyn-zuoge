"""P25 — Design KG chain: Principle → Pattern → Context → Execution → Issue → Correction → Outcome."""
from __future__ import annotations

from app.services.agent_memory.kg import (
    DESIGN_CHAIN_PREDICATES,
    _allowed_predicates,
    extract_design_chain_triples,
    format_kg_block,
    record_design_chain,
    score_triple_for_retrieve,
)


_SPEC_BRIEF = {
    "purpose": "festival poster",
    "composition": {"archetype": "center_hero", "rules": {"hero_coverage": "70%"}},
}


def test_spec_example_records_full_chain():
    triples = extract_design_chain_triples(
        brief=_SPEC_BRIEF,
        observe_facts={"hero_coverage": 0.42},
        review={
            "total": 91,
            "action": "repair",
            "must_fix": True,
            "summary": "secondary clutter",
            "correction": "reduce_secondary",
        },
        prev_review={"total": 78},
        skills=["poster_craft"],
        scene="poster",
    )
    assert triples == [
        ("principle:single_focus", "has_pattern", "hero_coverage:70%"),
        ("pattern:hero_coverage:70%", "in_context", "poster"),
        ("context:poster", "executed_as", "hero_coverage:42%"),
        ("execution:hero_coverage:42%", "had_issue", "secondary clutter"),
        ("issue:secondary clutter", "corrected_by", "reduce_secondary"),
        ("correction:reduce_secondary", "yielded_outcome", "78→91"),
    ]


def test_missing_hops_are_skipped():
    triples = extract_design_chain_triples(
        brief={
            "purpose": "poster",
            "composition": {"archetype": "center_hero", "rules": {"hero_coverage": "70%"}},
        },
        skills=["poster_craft"],
    )
    assert triples == [
        ("principle:single_focus", "has_pattern", "hero_coverage:70%"),
        ("pattern:hero_coverage:70%", "in_context", "poster"),
    ]
    assert not any(p == "had_issue" for _s, p, _o in triples)
    assert not any(p == "yielded_outcome" for _s, p, _o in triples)


def test_pass_review_skips_issue_and_links_outcome_to_execution():
    triples = extract_design_chain_triples(
        brief=_SPEC_BRIEF,
        observe_facts={"hero_coverage": 0.72},
        review={"total": 93, "action": "pass", "must_fix": False, "summary": "ok"},
        skills=["poster_craft"],
    )
    preds = [p for _s, p, _o in triples]
    assert "had_issue" not in preds
    assert "corrected_by" not in preds
    assert ("execution:hero_coverage:72%", "yielded_outcome", "93") in triples


def test_chat_prompt_is_not_a_chain():
    assert extract_design_chain_triples() == []
    assert extract_design_chain_triples(brief=None, review=None, observe_facts=None) == []


def test_polish_flag_defaults_to_reduce_secondary():
    triples = extract_design_chain_triples(
        brief=_SPEC_BRIEF,
        observe_facts={"hero_coverage": 0.42},
        review={"total": 91, "action": "repair", "must_fix": True, "summary": "clutter"},
        prev_review={"total": 78},
        flags={"polish": True},
        skills=["poster_craft"],
    )
    assert ("issue:clutter", "corrected_by", "reduce_secondary") in triples
    assert ("correction:reduce_secondary", "yielded_outcome", "78→91") in triples


def test_subtraction_actions_are_the_correction():
    triples = extract_design_chain_triples(
        brief=_SPEC_BRIEF,
        observe_facts={"hero_coverage": 0.42},
        review={
            "total": 91,
            "action": "pass",
            "must_fix": False,
            "issues": ["secondary clutter"],
            "subtraction_actions": ["drop extra badges"],
        },
        prev_review={"total": 78},
        flags={"polish": True},
        skills=["poster_craft"],
    )
    assert ("issue:secondary clutter", "corrected_by", "drop extra badges") in triples
    assert ("correction:drop extra badges", "yielded_outcome", "78→91") in triples


def test_format_kg_block_surfaces_design_chain():
    block = format_kg_block(
        [
            {
                "s": "principle:single_focus",
                "p": "has_pattern",
                "o": "hero_coverage:70%",
                "weight": 1,
            },
            {
                "s": "correction:reduce_secondary",
                "p": "yielded_outcome",
                "o": "78→91",
                "weight": 2,
            },
            {"s": "scene:poster", "p": "has_goal", "o": "make a poster", "weight": 1},
        ]
    )
    assert "Design chain: Principle → Pattern → Context → Execution" in block
    assert "Issue → Correction → Outcome" in block
    assert "principle:single_focus" in block
    assert "78→91" in block
    assert "Other priors" in block
    assert "has_goal" in block


def test_retrieve_boosts_design_chain_over_factual():
    chain = score_triple_for_retrieve(
        subject="correction:reduce_secondary",
        predicate="yielded_outcome",
        obj="78→91",
        weight=1.0,
        source="design_chain",
    )
    factual = score_triple_for_retrieve(
        subject="scene:poster",
        predicate="has_goal",
        obj="make a poster",
        weight=1.0,
        source="episode",
    )
    assert chain > factual
    assert "yielded_outcome" in DESIGN_CHAIN_PREDICATES
    assert "yielded_outcome" in _allowed_predicates(None)


def test_record_design_chain_skips_without_user():
    assert (
        record_design_chain(
            user_id="",
            brief=_SPEC_BRIEF,
            painted=True,
        )
        == 0
    )


def test_record_design_chain_respects_kg_disabled():
    n = record_design_chain(
        user_id="u1",
        brief=_SPEC_BRIEF,
        painted=True,
        rules={"memory.kg.enabled": "0"},
    )
    assert n == 0
