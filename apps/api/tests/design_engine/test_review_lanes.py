"""P26 — Seven distinct Reviewer lanes. Host merges; anti_slop is hits, not a cap."""
from __future__ import annotations

from app.services.design.runtime.graph.nodes.review import (
    _build_review_user_msg,
    _excerpt_lane_sidecar,
    _parse_review_structured,
    content_score_from_issues,
    deterministic_lane_seed,
    merge_review_lanes,
    parse_review_lane,
)
from app.services.design.runtime.graph.state import (
    MULTI_REVIEW_LANES,
    REVIEW_LANE_CAPS,
    REVIEW_SCORE_CAPS,
    ReviewLaneSchema,
    sum_review_scores,
)
from app.services.design.runtime.agent_profile import ensure_contract_registry


_BRIEF = {
    "purpose": "festival poster",
    "avoid": ["HUD", "glassmorphism"],
    "composition": {"archetype": "center_hero", "rules": {"hero_coverage": "70%"}},
}


def test_seven_lanes_are_distinct_and_anti_slop_has_no_cap():
    assert MULTI_REVIEW_LANES == (
        "composition",
        "hierarchy",
        "typography",
        "color",
        "consistency",
        "anti_slop",
        "originality",
    )
    assert REVIEW_LANE_CAPS["anti_slop"] is None
    assert "anti_slop" not in REVIEW_SCORE_CAPS
    assert sum(v for v in REVIEW_LANE_CAPS.values() if v is not None) + REVIEW_SCORE_CAPS["content"] == 100
    assert "ReviewLane.v1" in ensure_contract_registry()
    assert ensure_contract_registry()["ReviewLane.v1"] is ReviewLaneSchema


def test_composition_seed_flags_hero_below_brief():
    seed = deterministic_lane_seed(
        "composition",
        brief=_BRIEF,
        observe_facts={"hero_coverage": 0.42},
    )
    assert seed["lane"] == "composition"
    assert seed["score"] == 8
    assert any("42%" in e for e in seed["evidence"])
    assert seed["issues"][0]["severity"] == "major"
    assert seed["issues"][0]["lane"] == "composition"


def test_anti_slop_lane_is_hits_not_a_score():
    seed = deterministic_lane_seed(
        "anti_slop",
        brief=_BRIEF,
        scene_text="HUD chrome and glassmorphism cards on a purple gradient",
    )
    assert seed["score"] is None
    assert "HUD" in seed["anti_slop_hits"]
    assert "glassmorphism" in seed["anti_slop_hits"]
    parsed = parse_review_lane("anti_slop", {"anti_slop_hits": ["particles"]}, seed=seed)
    assert parsed["score"] is None
    assert "particles" in parsed["anti_slop_hits"]


def test_merge_seven_lanes_runtime_owns_total():
    lanes = [
        parse_review_lane(
            "composition",
            {"score": 18, "evidence": ["hero 72%"]},
            seed=deterministic_lane_seed("composition"),
        ),
        parse_review_lane("hierarchy", {"score": 18, "evidence": ["one focal"]}),
        parse_review_lane("typography", {"score": 14}),
        parse_review_lane("color", {"score": 14}),
        parse_review_lane("consistency", {"score": 13}),
        parse_review_lane(
            "anti_slop",
            {"anti_slop_hits": []},
            seed=deterministic_lane_seed("anti_slop"),
        ),
        parse_review_lane("originality", {"score": 4}),
    ]
    merged = merge_review_lanes(lanes)
    assert [row["lane"] for row in merged["lanes"]] == list(MULTI_REVIEW_LANES)
    assert "anti_slop" not in merged["scores"]
    assert merged["scores"]["content"] == 10
    parsed = _parse_review_structured({**merged, "total": 1})
    assert parsed["total"] == sum_review_scores(parsed["scores"])
    assert parsed["total"] == 91
    assert parsed["review_action"] == "pass"
    assert parsed["lanes"]


def test_anti_slop_hits_block_pass_without_breaking_cap():
    lanes = [
        parse_review_lane("composition", {"score": 18}),
        parse_review_lane("hierarchy", {"score": 18}),
        parse_review_lane("typography", {"score": 14}),
        parse_review_lane("color", {"score": 14}),
        parse_review_lane("consistency", {"score": 13}),
        parse_review_lane("anti_slop", {"anti_slop_hits": ["glassmorphism"]}),
        parse_review_lane("originality", {"score": 4}),
    ]
    merged = merge_review_lanes(lanes)
    parsed = _parse_review_structured(merged)
    assert parsed["total"] == 91
    assert parsed["anti_slop_hits"] == ["glassmorphism"]
    assert parsed["review_action"] == "repair"
    assert parsed["must_fix"] is True


def test_hero_shortfall_merges_to_repair():
    seed = deterministic_lane_seed(
        "composition",
        brief=_BRIEF,
        observe_facts={"hero_coverage": 0.42},
    )
    merged = merge_review_lanes([parse_review_lane("composition", {}, seed=seed)])
    parsed = _parse_review_structured(merged)
    assert parsed["scores"]["composition"] == 8
    assert parsed["review_action"] == "repair"
    assert any("hero" in str(x.get("issue") or "").lower() for x in parsed["issues"])


def test_empty_lanes_fail_open_without_inventing_scores():
    merged = merge_review_lanes([])
    assert merged["scores"] == {}
    parsed = _parse_review_structured(merged)
    assert parsed["total"] == 0
    assert parsed["review_action"] == "pass"
    assert parsed["must_fix"] is False


def test_lane_score_clamped_to_cap():
    parsed = parse_review_lane("originality", {"score": 99, "evidence": ["distinct"]})
    assert parsed["score"] == 5
    parsed_typo = parse_review_lane("typography", {"score": -3})
    assert parsed_typo["score"] == 0


def test_content_score_from_content_issues_only():
    assert content_score_from_issues([]) == 10
    assert (
        content_score_from_issues(
            [{"area": "hierarchy", "severity": "major", "issue": "title competes"}]
        )
        == 10
    )
    assert (
        content_score_from_issues(
            [{"area": "content", "severity": "major", "issue": "wrong product name"}]
        )
        == 6
    )


def test_lane_user_msg_does_not_ask_all_dimensions():
    from app.services.design.runtime.decision_log import DesignRunDecision
    from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime

    run = AgentRunState(trace_id="tr", task_id="task_lanes", goal="poster")
    rt = AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="make a poster",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="poster",
        scene_nodes=[],
        scene_frames=[],
        focus_id="",
        images=[],
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=1080,
        h=1920,
        run=run,
        decision=DesignRunDecision(),
        flags={"design_brief": _BRIEF},
    )
    msg = _build_review_user_msg(
        rt, signals=[], has_preview=False, lane="hierarchy"
    )
    assert "LANE: hierarchy" in msg
    assert "You are the hierarchy reviewer only" in msg
    assert "Do not score other dimensions" in msg
    assert "Do not invent total" in msg
    assert "content/originality" not in msg


def test_review_user_does_not_dump_pending_skill_essays():
    from app.services.design.runtime.decision_log import DesignRunDecision
    from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime

    run = AgentRunState(trace_id="t", task_id="task", goal="poster")
    rt = AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="festival poster",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="poster",
        scene_nodes=[],
        scene_frames=[],
        focus_id="",
        images=[],
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=1080,
        h=1920,
        run=run,
        decision=DesignRunDecision(),
        flags={"design_brief": _BRIEF},
    )
    rt.design_brief = _BRIEF
    rt.pending_skill_details = "FULL_SKILL_ESSAY " + ("craft " * 80)
    msg = _build_review_user_msg(
        rt, signals=["overflow at n1"], has_preview=False
    )
    assert "FULL_SKILL_ESSAY" not in msg
    assert "DESIGN_BRIEF" in msg
    assert "OBSERVE_FACTS" in msg
    assert "overflow at n1" in msg


def test_sidecar_excerpt_is_per_lane():
    docs = (
        "### review/hierarchy-review.md\nFail when title and hero share equal weight.\n\n"
        "### review/anti-slop-review.md\nHits only — not a score cap.\n"
    )
    hier = _excerpt_lane_sidecar(docs, "hierarchy")
    slop = _excerpt_lane_sidecar(docs, "anti_slop")
    assert "title and hero" in hier
    assert "anti-slop-review.md" not in hier
    assert "Hits only" in slop
    assert _excerpt_lane_sidecar(docs, "color") == ""
