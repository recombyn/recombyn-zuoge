"""P29 — Optimization controller: stop / rollback / Pareto, not a single total."""
from __future__ import annotations

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.review import (
    attach_judge,
    compile_restore_ops,
    run_optimization_controller,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    compute_pareto_scores,
    optimization_controller_decide,
    pareto_explain,
    pareto_prefers,
)


def _rt(*, nodes: list | None = None) -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_opt", goal="poster")
    run.painted = True
    run.reflect_left = 2
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="poster",
        scene_nodes=list(nodes or []),
        scene_frames=[],
        focus_id="frame_poster",
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


def test_controller_pass_limit_rollback_continue():
    passed = optimization_controller_decide(scores_history=[76, 83, 91], iteration=3)
    assert passed["decision"] == "stop"
    assert passed["reason"] == "pass"

    limited = optimization_controller_decide(scores_history=[76, 80], iteration=4)
    assert limited["decision"] == "stop"
    assert limited["reason"] == "iteration_limit"

    rolled = optimization_controller_decide(scores_history=[76, 79, 78], iteration=2)
    assert rolled["decision"] == "rollback"
    assert rolled["restore_index"] == 1
    assert rolled["reason"] == "regression"

    cont = optimization_controller_decide(scores_history=[76, 83], iteration=1)
    assert cont["decision"] == "continue"
    assert cont["strategy"] == "subtractive"


def test_score_delta_and_issue_reduction_stop():
    stalled = optimization_controller_decide(
        scores_history=[76, 76],
        issue_counts=[4, 4],
        iteration=1,
    )
    assert stalled["decision"] == "stop"
    assert stalled["reason"] == "score_delta"

    worse = optimization_controller_decide(
        scores_history=[76, 76],
        issue_counts=[3, 5],
        iteration=1,
    )
    assert worse["decision"] == "stop"
    assert worse["reason"] == "issue_reduction"


def test_pareto_91_ops38_beats_92_ops100():
    cheap = compute_pareto_scores(
        overall=91, scores={"originality": 4, "consistency": 13}, ops_cost=38
    )
    heavy = compute_pareto_scores(
        overall=92, scores={"originality": 4, "consistency": 13}, ops_cost=100
    )
    assert pareto_prefers(cheap, heavy) is True
    assert pareto_prefers(heavy, cheap) is False
    note = pareto_explain(cheap, heavy)
    assert "quality 91 / ops 38" in note
    assert "quality 92 / ops 100" in note


def test_pareto_blocks_false_regression():
    cheap = compute_pareto_scores(
        overall=87, scores={"originality": 4, "consistency": 13}, ops_cost=38
    )
    heavy = compute_pareto_scores(
        overall=88, scores={"originality": 4, "consistency": 13}, ops_cost=100
    )
    kept = optimization_controller_decide(
        scores_history=[88, 87],
        iteration=1,
        pareto_history=[heavy, cheap],
        costs_history=[100, 38],
        cost=38,
    )
    assert kept["decision"] == "continue"
    assert kept["reason"] != "regression"


def test_regression_without_cost_win_still_rollbacks():
    rolled = optimization_controller_decide(
        scores_history=[76, 79, 78],
        iteration=2,
        costs_history=[12, 14, 13],
        pareto_history=[
            compute_pareto_scores(overall=76, ops_cost=12),
            compute_pareto_scores(overall=79, ops_cost=14),
            compute_pareto_scores(overall=78, ops_cost=13),
        ],
    )
    assert rolled["decision"] == "rollback"
    assert rolled["restore_index"] == 1


def test_restore_ops_update_and_delete_not_create():
    current = [
        {"id": "hero", "type": "image", "x": 100, "y": 400, "w": 900, "h": 1400},
        {"id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 120, "fontSize": 96},
        {"id": "spark", "type": "rect", "x": 40, "y": 40, "w": 80, "h": 80},
    ]
    v2 = [
        {"id": "hero", "type": "image", "x": 180, "y": 420, "w": 720, "h": 1100},
        {"id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 120, "fontSize": 84},
    ]
    ops = compile_restore_ops(current, v2)
    names = [str(o.get("name") or "") for o in ops]
    assert "update_node" in names
    assert "delete_nodes" in names
    assert not any(n.startswith("create_") for n in names)
    deleted = next(o for o in ops if o["name"] == "delete_nodes")
    assert "spark" in deleted["args"]["nodeIds"]
    hero = next(
        o for o in ops if o["name"] == "update_node" and o["args"].get("nodeId") == "hero"
    )
    assert hero["args"]["width"] == 720
    assert hero["args"]["height"] == 1100


def test_controller_eats_score_issues_diff_iteration_cost():
    decided = optimization_controller_decide(
        scores_history=[76, 83],
        issue_counts=[6, 3],
        iteration=1,
        diff={"deltas": {"hero_coverage": 0.26, "whitespace_ratio": 0.14}},
        cost=9,
    )
    assert decided["decision"] == "continue"
    assert decided["cost"] == 9
    assert decided["iteration"] == 1
    assert "increase_whitespace" in decided["targets"]


def test_runtime_records_history_and_judge_pareto():
    nodes_v1 = [
        {"id": "hero", "type": "image", "x": 180, "y": 420, "w": 720, "h": 1100},
        {"id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 120, "fontSize": 84},
    ]
    rt = _rt(nodes=nodes_v1)
    rt.paint_ops = [{"name": "create_shape"}] * 12
    rt.visual_snapshot = {
        "hero_coverage": 0.42,
        "whitespace_ratio": 0.18,
        "decoration_area": 0.21,
    }
    attach_judge(
        rt,
        {
            "scores": {
                "composition": 14,
                "hierarchy": 16,
                "typography": 12,
                "color": 12,
                "consistency": 12,
                "content": 8,
                "originality": 2,
            },
            "issues": [{"issue": "hero small", "severity": "major", "lane": "composition"}],
        },
    )
    first = run_optimization_controller(rt, {"issues": [{"issue": "hero small"}]})
    assert first["decision"] == "continue"
    assert rt.judge_verdict["pareto"]["quality"] == 76
    assert rt.flags["optimization_history"][0]["overall"] == 76

    rt.scene_nodes = [
        {"id": "hero", "type": "image", "x": 160, "y": 400, "w": 760, "h": 1180},
        {"id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 120, "fontSize": 72},
    ]
    rt.paint_ops = [{"name": "update_node"}] * 3
    attach_judge(
        rt,
        {
            "scores": {
                "composition": 16,
                "hierarchy": 16,
                "typography": 12,
                "color": 12,
                "consistency": 12,
                "content": 8,
                "originality": 3,
            },
            "issues": [{"issue": "still tight", "severity": "minor", "lane": "composition"}],
        },
    )
    second = run_optimization_controller(rt, {"issues": [{"issue": "still tight"}]})
    assert second["decision"] == "continue"
    assert len(rt.flags["optimization_history"]) == 2

    rt.scene_nodes = [
        {"id": "hero", "type": "image", "x": 80, "y": 200, "w": 400, "h": 600},
        {"id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 120, "fontSize": 96},
        {"id": "spark", "type": "rect", "x": 20, "y": 20, "w": 60, "h": 60},
    ]
    rt.paint_ops = [{"name": "update_node"}] * 4
    attach_judge(
        rt,
        {
            "scores": {
                "composition": 14,
                "hierarchy": 16,
                "typography": 12,
                "color": 12,
                "consistency": 12,
                "content": 8,
                "originality": 3,
            },
            "issues": [
                {"issue": "hero collapsed", "severity": "major", "lane": "composition"},
                {"issue": "title fights hero", "severity": "major", "lane": "hierarchy"},
            ],
        },
    )
    third = run_optimization_controller(
        rt,
        {
            "issues": [
                {"issue": "hero collapsed"},
                {"issue": "title fights hero"},
            ]
        },
    )
    assert third["decision"] == "rollback"
    assert third["restore_index"] == 1
    ops = compile_restore_ops(
        rt.scene_nodes,
        rt.flags["optimization_history"][1]["nodes"],
    )
    assert any(o.get("name") == "delete_nodes" for o in ops)
    assert rt.scene_nodes[-1]["id"] == "spark"
