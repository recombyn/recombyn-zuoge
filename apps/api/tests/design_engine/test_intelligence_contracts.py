"""P21 — Phase 2/3 intelligence contracts. Kernel Brief/Review behavior unchanged."""
from __future__ import annotations

from app.services.agent_memory.schema import empty_task_state, normalize_task_state
from app.services.design.runtime.graph.state import (
    DESIGN_BRIEF_P0_FIELDS,
    DESIGN_BRIEF_P1_FIELDS,
    MULTI_REVIEW_LANES,
    REFERENCE_DNA_AXES,
    REVIEW_SCORE_CAPS,
    compute_visual_diff,
    design_brief_p0_missing,
    judge_overall_from_scores,
    optimization_controller_decide,
    parse_design_brief,
    parse_design_strategy,
    parse_preference_signal,
    parse_reference_analyze,
    parse_reference_dna,
    preference_should_commit,
    sum_review_scores,
)


def test_brief_v2_p1_slots_optional_p0_unchanged():
    assert "reference_dna" in DESIGN_BRIEF_P1_FIELDS
    assert "design_strategy" in DESIGN_BRIEF_P1_FIELDS
    brief = parse_design_brief(
        {
            "purpose": "promote a greatsword",
            "audience": "xianxia players",
            "emotion": ["solemn"],
            "visual_thesis": "museum relic sword, not game loot",
            "visual_hero": "greatsword",
            "composition": {"archetype": "center_hero"},
            "avoid": ["HUD"],
            "reference_dna": {"visual_dna": {"minimalism": 0.9, "decoration": 0.1}},
            "design_strategy": {"positioning": "premium technical"},
        }
    )
    assert brief is not None
    assert design_brief_p0_missing(brief) == []
    assert brief["reference_dna"]["visual_dna"]["minimalism"] == 0.9
    assert brief["design_strategy"]["positioning"] == "premium technical"
    assert design_brief_p0_missing({}) == list(DESIGN_BRIEF_P0_FIELDS)


def test_reference_analyze_and_dna_clamp_axes():
    analyzed = parse_reference_analyze(
        {
            "composition": {
                "type": "asymmetric_editorial",
                "balance": "dynamic",
                "axis": "diagonal",
                "focal_position": "upper_left",
            },
            "hierarchy": {"primary": "hero", "secondary": "headline"},
            "density": 1.7,
            "palette": {"dominant": ["#F3F1EA"], "accent": ["#D84A32"]},
            "typography": {"scale": "large", "contrast": "high", "alignment": "left"},
            "imagery": {
                "style": "editorial_photography",
                "depth": "shallow",
                "lighting": "soft_directional",
            },
        }
    )
    assert analyzed["composition"]["type"] == "asymmetric_editorial"
    assert analyzed["density"] == 1.0
    dna = parse_reference_dna(
        {"visual_dna": {"minimalism": 0.87, "editorial": 1.4, "decoration": -0.2, "extra": 9}}
    )
    assert set(dna["visual_dna"]) == set(REFERENCE_DNA_AXES)
    assert dna["visual_dna"]["minimalism"] == 0.87
    assert dna["visual_dna"]["editorial"] == 1.0
    assert dna["visual_dna"]["decoration"] == 0.0
    assert "extra" not in dna["visual_dna"]


def test_design_strategy_schema_roundtrip():
    parsed = parse_design_strategy(
        {
            "design_strategy": {
                "positioning": "premium technical",
                "differentiation": "avoid standard AI visual language",
                "composition_strategy": "editorial asymmetry",
                "anti_category_strategy": ["purple gradient", "glass card"],
            }
        }
    )
    assert parsed["positioning"] == "premium technical"
    assert "purple gradient" in parsed["anti_category_strategy"]


def test_preference_one_edit_is_not_memory():
    once = parse_preference_signal(
        {
            "signal": "typography_scale",
            "direction": "decrease",
            "target": "headline",
            "strength": 0.8,
            "evidence": 1,
            "frequency": 1,
            "confidence": 0.3,
        }
    )
    assert preference_should_commit(once) is False
    repeat = parse_preference_signal(
        {
            **once,
            "evidence": 5,
            "frequency": 5,
            "confidence": 0.8,
        }
    )
    assert preference_should_commit(repeat) is True


def test_judge_runtime_owns_overall_ignores_llm_total():
    assert tuple(REVIEW_SCORE_CAPS)[:5] == (
        "composition",
        "hierarchy",
        "typography",
        "color",
        "consistency",
    )
    assert "anti_slop" in MULTI_REVIEW_LANES
    from app.services.design.runtime.graph.state import REVIEW_LANE_CAPS

    assert REVIEW_LANE_CAPS["anti_slop"] is None
    verdict = judge_overall_from_scores(
        {
            "scores": {
                "composition": 18,
                "hierarchy": 18,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 9,
                "originality": 4,
            },
            "overall": 12,
            "total": 12,
            "confidence": 0.92,
            "anti_slop_hits": ["glassmorphism"],
            "top_issues": [
                {
                    "priority": 1,
                    "issue": "headline competes with hero",
                    "evidence": ["title_area 0.29"],
                    "fix": "reduce headline dominance",
                    "lane": "hierarchy",
                }
            ],
        }
    )
    assert verdict["overall"] == 90
    assert verdict["overall"] == sum_review_scores(verdict["scores"])
    assert verdict["anti_slop_hits"] == ["glassmorphism"]
    assert verdict["top_issues"][0]["priority"] == 1


def test_visual_diff_reports_hero_dominance_delta():
    diff = compute_visual_diff(
        {
            "node_count": 12,
            "hero_coverage": 0.42,
            "title_area": 0.29,
            "decoration_area": 0.21,
            "whitespace_ratio": 0.18,
        },
        {
            "node_count": 8,
            "hero_coverage": 0.68,
            "title_area": 0.20,
            "decoration_area": 0.07,
            "whitespace_ratio": 0.32,
        },
    )
    assert round(diff["deltas"]["hero_coverage"], 2) == 0.26
    assert round(diff["deltas"]["decoration_area"], 2) == -0.14
    assert diff["pixel_available"] is False


def test_optimization_controller_stop_rollback_continue():
    passed = optimization_controller_decide(scores_history=[76, 83, 91], iteration=3)
    assert passed["decision"] == "stop"
    assert passed["reason"] == "pass"

    limited = optimization_controller_decide(scores_history=[76, 80], iteration=4)
    assert limited["decision"] == "stop"
    assert limited["reason"] == "iteration_limit"

    rolled = optimization_controller_decide(scores_history=[76, 79, 78], iteration=2)
    assert rolled["decision"] == "rollback"
    assert rolled["restore_index"] == 1

    cont = optimization_controller_decide(scores_history=[76, 83], iteration=1)
    assert cont["decision"] == "continue"
    assert cont["strategy"] == "subtractive"


def test_design_memory_three_layers_in_task_state():
    empty = empty_task_state(user_id="u", project_id="p", session_id="s")
    design = empty["design"]
    assert set(design) == {"user", "project", "session"}
    assert set(design["user"]) == {"preference", "rejected_patterns", "accepted_patterns"}
    assert set(design["project"]) == {"brand_dna", "design_system", "reference_dna"}
    assert design["session"]["iteration"] == 0
    merged = normalize_task_state({"design": {"session": {"iteration": 2}}}, user_id="u")
    assert merged["design"]["user"]["preference"] == {}
    assert merged["design"]["session"]["iteration"] == 2
