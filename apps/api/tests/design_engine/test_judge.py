"""P27 — Judge: Runtime owns overall; top_issues carry priority / evidence / fix."""
from __future__ import annotations

from app.services.agent_memory.schema import slim_review_for_memory
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.review import (
    attach_judge,
    build_judge_top_issues,
    compose_judge_verdict,
    merge_review_lanes,
    parse_review_lane,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    judge_overall_from_scores,
    sum_review_scores,
)


_SCORES = {
    "composition": 18,
    "hierarchy": 18,
    "typography": 14,
    "color": 14,
    "consistency": 13,
    "content": 9,
    "originality": 4,
}


def _rt() -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_judge", goal="poster")
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
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
        flags={},
    )


def test_judge_ignores_llm_overall():
    verdict = compose_judge_verdict(
        scores=_SCORES,
        llm_overall=12,
        anti_slop_hits=[],
        issues=[],
        lanes=[],
    )
    assert verdict["overall"] == 90
    assert verdict["overall"] == sum_review_scores(verdict["scores"])
    assert verdict["overall"] != 12


def test_top_issues_have_priority_evidence_fix():
    top = build_judge_top_issues(
        lanes=[
            {
                "lane": "hierarchy",
                "score": 10,
                "evidence": ["title_area 0.29"],
                "issues": [],
            }
        ],
        issues=[
            {
                "severity": "major",
                "lane": "hierarchy",
                "issue": "headline competes with hero",
                "fix_hint": "reduce headline dominance",
            },
            {
                "severity": "minor",
                "lane": "typography",
                "issue": "tracking a bit tight",
                "fix_hint": "open letter-spacing",
            },
        ],
        anti_slop_hits=["glassmorphism"],
    )
    assert top[0]["priority"] == 1
    assert top[0]["lane"] == "anti_slop"
    assert top[0]["evidence"]
    assert top[0]["fix"]
    hier = next(x for x in top if x["lane"] == "hierarchy")
    assert hier["priority"] == 2
    assert "title_area 0.29" in hier["evidence"]
    assert hier["fix"] == "reduce headline dominance"
    assert all("tool_ops" not in x for x in top)


def test_blocker_ranks_above_major():
    top = build_judge_top_issues(
        issues=[
            {
                "severity": "major",
                "lane": "color",
                "issue": "second palette",
                "fix_hint": "drop the accent system",
            },
            {
                "severity": "blocker",
                "lane": "composition",
                "issue": "no hero",
                "fix_hint": "place a single hero",
            },
        ]
    )
    assert top[0]["issue"] == "no hero"
    assert top[0]["priority"] == 1
    assert top[1]["lane"] == "color"


def test_compose_from_merged_lanes_matches_runtime_total():
    lanes = [
        parse_review_lane("composition", {"score": 18, "evidence": ["hero 72%"]}),
        parse_review_lane("hierarchy", {"score": 18}),
        parse_review_lane("typography", {"score": 14}),
        parse_review_lane("color", {"score": 14}),
        parse_review_lane("consistency", {"score": 13}),
        parse_review_lane("anti_slop", {"anti_slop_hits": []}),
        parse_review_lane("originality", {"score": 4}),
    ]
    merged = merge_review_lanes(lanes)
    judge = compose_judge_verdict(
        scores=merged["scores"],
        lanes=merged["lanes"],
        issues=merged["issues"],
        anti_slop_hits=merged["anti_slop_hits"],
        llm_overall=3,
    )
    assert judge["overall"] == 91
    assert judge["overall"] == sum_review_scores(merged["scores"])


def test_attach_judge_writes_runtime_slot_not_canvas():
    rt = _rt()
    verdict = {
        "scores": _SCORES,
        "total": 12,
        "overall": 12,
        "issues": [
            {
                "severity": "major",
                "lane": "hierarchy",
                "issue": "headline competes with hero",
                "fix_hint": "reduce headline dominance",
                "evidence": ["title_area 0.29"],
            }
        ],
        "anti_slop_hits": ["glassmorphism"],
        "lanes": [{"lane": "hierarchy", "score": 10, "evidence": ["title_area 0.29"]}],
    }
    judge = attach_judge(rt, verdict)
    assert rt.judge_verdict is judge
    assert judge["overall"] == 90
    assert judge["top_issues"][0]["priority"] == 1
    assert verdict["judge"]["overall"] == 90
    assert rt.scene_nodes == []


def test_slim_review_keeps_overall_and_top_issues():
    slim = slim_review_for_memory(
        {
            "scores": _SCORES,
            "total": 90,
            "overall": 90,
            "action": "repair",
            "top_issues": [
                {
                    "priority": 1,
                    "issue": "headline competes with hero",
                    "fix": "reduce headline dominance",
                    "lane": "hierarchy",
                    "evidence": ["title_area 0.29"],
                }
            ],
        }
    )
    assert slim["overall"] == 90
    assert slim["top_issues"][0]["priority"] == 1
    assert slim["top_issues"][0]["lane"] == "hierarchy"


def test_judge_overall_from_scores_still_ignores_llm():
    verdict = judge_overall_from_scores(
        {"scores": _SCORES, "overall": 1, "total": 1, "top_issues": []}
    )
    assert verdict["overall"] == 90
