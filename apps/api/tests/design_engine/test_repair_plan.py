"""PR12 — Review Repair Plan compiles to tool_ops; Review never mutates canvas."""
from __future__ import annotations

import json
from pathlib import Path

from app.services.design.ops.tool_ops_contract import normalize_agent_tool_ops
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.review import (
    _issues_as_dicts,
    _parse_review_structured,
    _try_repair_plan_command,
    compile_repair_plan_ops,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime

_FIX = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def _poster_nodes() -> list[dict]:
    return list(_load("poster_base.json")["nodes"])


def _rt(*, nodes: list[dict] | None = None) -> AgentRuntime:
    scene = _load("poster_base.json")
    run = AgentRunState(trace_id="tr", task_id="task_repair", goal="poster")
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
        scene_key="website",
        scene_nodes=nodes if nodes is not None else list(scene["nodes"]),
        scene_frames=list(scene["frames"]),
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


def test_spec_issue_compiles_update_node_on_living_title():
    issues = _issues_as_dicts(
        [
            {
                "severity": "major",
                "area": "hierarchy",
                "target": "title",
                "issue": "标题抢夺 Hero 注意力",
                "action": "reduce_size",
                "patch": {"fontSize": 72},
            }
        ]
    )
    ops = compile_repair_plan_ops(issues, _poster_nodes())
    assert len(ops) == 1
    assert ops[0]["name"] == "update_node"
    assert ops[0]["args"]["nodeId"] == "title"
    assert ops[0]["args"]["fontSize"] == 72
    kept, errors = normalize_agent_tool_ops(
        ops, scene_nodes=_poster_nodes(), paint_lane="edit", classified_intent="edit"
    )
    assert errors == []
    assert kept[0]["name"] == "update_node"


def test_unknown_target_is_skipped():
    ops = compile_repair_plan_ops(
        [
            {
                "severity": "major",
                "area": "hierarchy",
                "issue": "missing node",
                "target": "title_01",
                "action": "reduce_size",
                "patch": {"fontSize": 72},
            }
        ],
        _poster_nodes(),
    )
    assert ops == []


def test_never_emits_create_ops():
    ops = compile_repair_plan_ops(
        [
            {
                "severity": "major",
                "area": "layout",
                "issue": "add badge",
                "target": "title",
                "action": "create_text",
                "patch": {"text": "NEW"},
            }
        ],
        _poster_nodes(),
    )
    assert ops == []
    assert all(not str(o.get("name") or "").startswith("create_") for o in ops)


def test_reduce_size_without_patch_scales_existing_font():
    ops = compile_repair_plan_ops(
        [
            {
                "severity": "major",
                "area": "hierarchy",
                "issue": "title too loud",
                "target": "title",
                "action": "reduce_size",
            }
        ],
        _poster_nodes(),
    )
    assert ops[0]["args"]["nodeId"] == "title"
    assert ops[0]["args"]["fontSize"] == 71  # 84 * 0.85


def test_delete_action_and_subtraction_use_living_ids():
    ops = compile_repair_plan_ops(
        [
            {
                "severity": "major",
                "area": "content",
                "issue": "drop unused title",
                "target": "title",
                "action": "delete",
            }
        ],
        _poster_nodes(),
        subtraction_actions=["remove hero — it duplicates the sword"],
    )
    names = [o["name"] for o in ops]
    assert "create_shape" not in names
    assert "create_text" not in names
    deletes = [o for o in ops if o["name"] == "delete_nodes"]
    assert len(deletes) == 1
    ids = set(deletes[0]["args"]["nodeIds"])
    assert ids == {"title", "hero"}


def test_delete_wins_over_update_on_same_id():
    ops = compile_repair_plan_ops(
        [
            {
                "severity": "major",
                "area": "type",
                "issue": "shrink then drop",
                "target": "title",
                "action": "reduce_size",
                "patch": {"fontSize": 48},
            },
            {
                "severity": "major",
                "area": "content",
                "issue": "remove title",
                "target": "title",
                "action": "delete",
            },
        ],
        _poster_nodes(),
    )
    assert all(o["name"] != "update_node" for o in ops)
    assert ops[0]["name"] == "delete_nodes"
    assert ops[0]["args"]["nodeIds"] == ["title"]


def test_prose_only_issues_compile_empty():
    ops = compile_repair_plan_ops(
        [{"severity": "major", "area": "layout", "issue": "hero too small", "fix_hint": "enlarge"}],
        _poster_nodes(),
    )
    assert ops == []


def test_parse_preserves_repair_fields():
    parsed = _parse_review_structured(
        {
            "pass": False,
            "must_fix": True,
            "scores": {
                "composition": 18,
                "hierarchy": 17,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 5,
                "originality": 4,
            },
            "issues": [
                {
                    "severity": "major",
                    "area": "hierarchy",
                    "target": "title",
                    "issue": "标题抢夺 Hero 注意力",
                    "action": "reduce_size",
                    "patch": {"fontSize": 72},
                }
            ],
        }
    )
    assert parsed["review_action"] == "repair"
    issue = parsed["issues"][0]
    assert issue["severity"] == "major"
    assert issue["area"] == "hierarchy"
    assert issue["target"] == "title"
    assert issue["action"] == "reduce_size"
    assert issue["patch"]["fontSize"] == 72
    assert "抢夺" in issue["issue"]


def test_repair_command_goes_to_action_not_paint():
    rt = _rt()
    verdict = {
        "review_action": "repair",
        "summary": "title too loud",
        "fix_brief": "shrink title",
        "issues": [
            {
                "severity": "major",
                "area": "hierarchy",
                "issue": "标题抢夺 Hero 注意力",
                "target": "title",
                "action": "reduce_size",
                "patch": {"fontSize": 72},
            }
        ],
        "subtraction_actions": [],
        "total": 82,
    }
    cmd = _try_repair_plan_command(rt, rt.run, round_i=1, verdict=verdict)
    assert cmd is not None
    assert cmd.goto == "action"
    assert rt.step_ops
    assert rt.step_ops[0]["name"] == "update_node"
    assert rt.flags["review_action"] == "repair"
    assert rt.classified_paint_lane == "edit"


def test_repair_command_none_when_no_living_targets():
    rt = _rt()
    cmd = _try_repair_plan_command(
        rt,
        rt.run,
        round_i=1,
        verdict={
            "issues": [{"severity": "major", "area": "layout", "issue": "redo composition"}],
            "subtraction_actions": [],
        },
    )
    assert cmd is None
    assert rt.step_ops == []


def test_observe_after_repair_command_does_not_reenter_review(monkeypatch):
    import asyncio

    from app.services.design.runtime.graph.nodes import observe as observe_mod

    monkeypatch.setattr(observe_mod, "_emit", lambda ev: None)
    monkeypatch.setattr(observe_mod, "_emit_ux_tip", lambda *_a, **_k: None)
    rt = _rt()
    verdict = {
        "review_action": "repair",
        "summary": "title too loud",
        "fix_brief": "shrink title",
        "issues": [
            {
                "severity": "major",
                "area": "hierarchy",
                "issue": "标题抢夺 Hero 注意力",
                "target": "title",
                "action": "reduce_size",
                "patch": {"fontSize": 72},
            }
        ],
        "subtraction_actions": [],
        "total": 82,
    }
    cmd = _try_repair_plan_command(rt, rt.run, round_i=1, verdict=verdict)
    assert cmd is not None
    assert rt.flags["review_repair_used"] is True

    async def after_observe():
        return await observe_mod._route_after_observe_facts(
            rt,
            rt.run,
            round_i=2,
            critique_issues=["alignment: title/hero left edges 4px apart"],
            preview_image=None,
            observe_signals=["overlap = false"],
        )

    nxt = asyncio.run(after_observe())
    assert nxt.goto == "__settle__"
    assert observe_mod._should_route_to_review(rt) is False
