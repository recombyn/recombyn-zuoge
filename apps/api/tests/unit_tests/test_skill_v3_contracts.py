"""Skill V3 contracts: brief P0 gate, review score sum, extends expand."""
from __future__ import annotations

import pytest

from app.services.design.prompts.skill_store.pack_io import (
    SkillDependencyCycleError,
    _SKILL_GRAPH,
    _load_file_skills,
    detect_skill_extends_cycles,
)
from app.services.design.prompts.skill_store.runtime import expand_skill_extends
from app.services.design.runtime.graph.nodes.review import _parse_review_structured
from app.services.design.runtime.graph.state import (
    DESIGN_BRIEF_P0_FIELDS,
    clamp_review_scores,
    design_brief_p0_missing,
    parse_design_brief,
    sum_review_scores,
)


def test_design_brief_p0_missing_on_empty():
    assert design_brief_p0_missing(None) == list(DESIGN_BRIEF_P0_FIELDS)
    assert design_brief_p0_missing({}) == list(DESIGN_BRIEF_P0_FIELDS)


def test_design_brief_p0_accepts_structured():
    brief = parse_design_brief(
        {
            "purpose": "promote a greatsword",
            "audience": "xianxia players",
            "emotion": ["solemn", "cold"],
            "visual_thesis": "museum relic sword, not game loot",
            "visual_hero": "greatsword",
            "composition": {"archetype": "center_hero", "rules": {"hero_coverage": "70%"}},
            "avoid": ["purple gradient", "particles", "HUD"],
        }
    )
    assert brief is not None
    assert design_brief_p0_missing(brief) == []


def test_design_brief_p1_not_required():
    brief = parse_design_brief(
        {
            "purpose": "landing hero",
            "audience": "B2B buyers",
            "emotion": ["calm"],
            "visual_thesis": "cold white lab with one dense product shot",
            "visual_hero": "product UI",
            "composition": {"archetype": "left_text_right_visual"},
            "avoid": ["glass cards"],
        }
    )
    assert design_brief_p0_missing(brief) == []
    assert not brief.get("tokens")


def test_design_brief_plain_prose_rejected():
    brief = parse_design_brief("tall festival poster, warm night stage")
    assert brief is None


def test_review_runtime_owns_total():
    scores = clamp_review_scores(
        {
            "composition": 18,
            "hierarchy": 16,
            "typography": 14,
            "color": 12,
            "consistency": 12,
            "content": 9,
            "originality": 4,
            "extra": 99,
        }
    )
    assert scores["composition"] == 18
    assert scores["originality"] == 4
    assert "extra" not in scores
    assert sum_review_scores(scores) == 85


def test_review_parse_ignores_llm_total_and_gates():
    parsed = _parse_review_structured(
        {
            "pass": True,
            "must_fix": False,
            "summary": "ok",
            "scores": {
                "composition": 10,
                "hierarchy": 10,
                "typography": 8,
                "color": 8,
                "consistency": 8,
                "content": 5,
                "originality": 2,
            },
            "total": 99,
            "issues": [],
            "anti_slop_hits": [],
        }
    )
    assert parsed["total"] == 51
    assert parsed["pass"] is False
    assert parsed["must_fix"] is True
    assert parsed["review_action"] == "rebuild"


def test_review_band_repair_70_to_89():
    parsed = _parse_review_structured(
        {
            "pass": True,
            "must_fix": False,
            "scores": {
                "composition": 18,
                "hierarchy": 17,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 5,
                "originality": 4,
            },
            "total": 99,
            "issues": [],
            "anti_slop_hits": [],
        }
    )
    assert parsed["total"] == 85
    assert parsed["review_action"] == "repair"
    assert parsed["must_fix"] is True
    assert parsed["pass"] is False


def test_review_band_pass_at_90():
    parsed = _parse_review_structured(
        {
            "pass": False,
            "must_fix": True,
            "scores": {
                "composition": 18,
                "hierarchy": 18,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 9,
                "originality": 4,
            },
            "total": 1,
            "issues": [{"severity": "minor", "issue": "kerning nit"}],
            "anti_slop_hits": [],
        }
    )
    assert parsed["total"] == 90
    assert parsed["review_action"] == "pass"
    assert parsed["must_fix"] is False
    assert parsed["pass"] is True


def test_review_blocker_rebuilds_even_in_repair_band():
    parsed = _parse_review_structured(
        {
            "scores": {
                "composition": 18,
                "hierarchy": 17,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 5,
                "originality": 4,
            },
            "issues": [{"severity": "blocker", "issue": "hero missing"}],
        }
    )
    assert parsed["total"] == 85
    assert parsed["review_action"] == "rebuild"
    assert parsed["must_fix"] is True


def test_review_slop_forces_fix_even_if_high_scores():
    parsed = _parse_review_structured(
        {
            "pass": True,
            "scores": {
                "composition": 20,
                "hierarchy": 20,
                "typography": 15,
                "color": 15,
                "consistency": 15,
                "content": 10,
                "originality": 5,
            },
            "total": 100,
            "anti_slop_hits": ["glass_cards"],
            "issues": [],
        }
    )
    assert parsed["total"] == 100
    assert parsed["must_fix"] is True
    assert parsed["pass"] is False
    assert parsed["review_action"] == "repair"


def test_poster_craft_extends_expand():
    _load_file_skills()
    keys = expand_skill_extends(["poster_craft"], scene="website")
    assert "poster_craft" in keys
    for core in (
        "design_brief",
        "visual_direction",
        "composition",
        "design_system",
        "typography",
        "color",
        "imagery",
        "layout",
        "anti_ai_slop",
        "design_review",
        "polish",
    ):
        assert core in keys
    assert keys.index("design_brief") < keys.index("poster_craft")
    assert keys.index("poster_craft") < keys.index("anti_ai_slop")


def test_landing_page_extends_expand():
    _load_file_skills()
    keys = expand_skill_extends(["landing_page"], scene="website")
    assert "landing_page" in keys
    for core in (
        "design_brief",
        "visual_direction",
        "composition",
        "design_system",
        "typography",
        "color",
        "imagery",
        "layout",
        "anti_ai_slop",
        "design_review",
        "polish",
        "responsive",
    ):
        assert core in keys
    assert keys.index("design_brief") < keys.index("responsive") < keys.index("landing_page")
    assert keys.index("landing_page") < keys.index("anti_ai_slop")
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["landing_page"]


def test_dashboard_ui_extends_expand():
    _load_file_skills()
    keys = expand_skill_extends(["dashboard_ui"], scene="website")
    assert "dashboard_ui" in keys
    for core in (
        "design_brief",
        "visual_direction",
        "composition",
        "design_system",
        "typography",
        "color",
        "imagery",
        "layout",
        "anti_ai_slop",
        "design_review",
        "polish",
        "responsive",
    ):
        assert core in keys
    assert keys.index("design_brief") < keys.index("responsive") < keys.index("dashboard_ui")
    assert keys.index("dashboard_ui") < keys.index("anti_ai_slop")
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["dashboard_ui"]


def test_image_gen_extends_expand_with_poster():
    _load_file_skills()
    keys = expand_skill_extends(["image_gen"], scene="website")
    assert "image_gen" in keys
    for core in ("design_brief", "visual_direction", "composition", "anti_ai_slop", "imagery", "layout"):
        assert core in keys
    assert keys.index("design_brief") < keys.index("image_gen")
    assert keys.index("image_gen") < keys.index("anti_ai_slop")
    both = expand_skill_extends(["poster_craft", "image_gen"], scene="website")
    assert "poster_craft" in both and "image_gen" in both
    assert both.index("image_gen") < both.index("poster_craft")


def test_skill_extends_cycle_detection():
    _SKILL_GRAPH.clear()
    _SKILL_GRAPH["a"] = {"extends": ["b"], "category": "surface"}
    _SKILL_GRAPH["b"] = {"extends": ["a"], "category": "craft"}
    with pytest.raises(SkillDependencyCycleError):
        detect_skill_extends_cycles()
    _load_file_skills()  # restore real graph
