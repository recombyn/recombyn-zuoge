"""PR13 — Polish / subtraction: remove merge align reduce; never add."""
from __future__ import annotations

import json
from pathlib import Path

from app.services.design.ops.tool_ops_contract import normalize_agent_tool_ops
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.observe import compute_observe_facts
from app.services.design.runtime.graph.nodes.review import (
    _try_polish_command,
    compile_polish_ops,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    resolve_transaction_phase,
)

_FIX = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def _rt(*, scene_name: str = "poster_clutter.json") -> AgentRuntime:
    scene = _load(scene_name)
    run = AgentRunState(trace_id="tr", task_id="task_polish", goal="poster")
    run.painted = True
    run.reflect_left = 1
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="website",
        scene_nodes=list(scene["nodes"]),
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


def _deleted_ids(ops: list[dict]) -> set[str]:
    out: set[str] = set()
    for op in ops:
        if str(op.get("name") or "") != "delete_nodes":
            continue
        for nid in list((op.get("args") or {}).get("nodeIds") or []):
            if str(nid).strip():
                out.add(str(nid).strip())
    return out


def test_clean_poster_has_nothing_to_polish():
    scene = _load("poster_base.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        focus_frame_id="frame_poster",
    )
    assert ops == []


def test_removes_named_tiny_decoration_not_hero():
    scene = _load("poster_clutter.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        focus_frame_id="frame_poster",
    )
    names = [str(o.get("name") or "") for o in ops]
    assert "create_shape" not in names
    assert "create_text" not in names
    deleted = _deleted_ids(ops)
    assert "decoration_07" in deleted
    assert "hero" not in deleted
    assert "title" not in deleted
    assert "bg" not in deleted


def test_subtraction_cannot_delete_protected_hero_or_title():
    scene = _load("poster_clutter.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        subtraction_actions=["remove title", "remove hero", "remove bg", "drop decoration_07"],
        focus_frame_id="frame_poster",
    )
    deleted = _deleted_ids(ops)
    assert "title" not in deleted
    assert "hero" not in deleted
    assert "bg" not in deleted
    assert "decoration_07" in deleted


def test_never_emits_create_from_polish_issues():
    scene = _load("poster_clutter.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        issues=[
            {
                "severity": "minor",
                "area": "layout",
                "issue": "add sparkle",
                "target": "title",
                "action": "create_shape",
                "patch": {"w": 12},
            }
        ],
        focus_frame_id="frame_poster",
    )
    assert all(not str(o.get("name") or "").startswith("create_") for o in ops)


def test_aligns_near_miss_left_edges():
    scene = _load("poster_clutter.json")
    facts = compute_observe_facts(
        nodes=list(scene["nodes"]),
        frames=list(scene["frames"]),
        painted=True,
        focus_frame_id="frame_poster",
    )
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        observe_facts=facts,
        focus_frame_id="frame_poster",
    )
    aligns = [o for o in ops if o.get("name") == "align_nodes"]
    assert aligns
    ids = set(aligns[0]["args"]["nodeIds"])
    assert "title" in ids
    assert "kicker" in ids
    assert aligns[0]["args"]["mode"] == "left"


def test_reduce_skips_protected_title_but_patches_kicker():
    scene = _load("poster_clutter.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        issues=[
            {
                "severity": "minor",
                "area": "hierarchy",
                "issue": "kicker slightly loud",
                "target": "kicker",
                "action": "reduce_size",
            }
        ],
        focus_frame_id="frame_poster",
    )
    updates = [o for o in ops if o.get("name") == "update_node"]
    assert any(o["args"].get("nodeId") == "kicker" and o["args"].get("fontSize") == 20 for o in updates)
    assert all(o["args"].get("nodeId") != "title" for o in updates)


def test_polish_ops_validate_on_allowlist():
    scene = _load("poster_clutter.json")
    ops = compile_polish_ops(
        list(scene["nodes"]),
        list(scene["frames"]),
        focus_frame_id="frame_poster",
    )
    kept, errors = normalize_agent_tool_ops(
        ops,
        scene_nodes=list(scene["nodes"]),
        scene_frames=list(scene["frames"]),
        paint_lane="edit",
        classified_intent="edit",
    )
    assert errors == []
    assert kept
    assert all(o["name"] in ("update_node", "delete_nodes", "align_nodes") for o in kept)


def test_polish_command_sets_phase_and_goes_to_action():
    rt = _rt()
    cmd = _try_polish_command(
        rt,
        rt.run,
        round_i=2,
        verdict={"review_action": "pass", "must_fix": False, "issues": [], "subtraction_actions": []},
    )
    assert cmd is not None
    assert cmd.goto == "action"
    assert rt.flags["polish"] is True
    assert rt.flags["polish_done"] is True
    assert resolve_transaction_phase(rt) == "polish"
    assert all(not str(o.get("name") or "").startswith("create_") for o in rt.step_ops)


def test_polish_command_none_on_clean_poster():
    rt = _rt(scene_name="poster_base.json")
    cmd = _try_polish_command(
        rt,
        rt.run,
        round_i=2,
        verdict={"review_action": "pass", "must_fix": False, "issues": []},
    )
    assert cmd is None
    assert rt.step_ops == []
