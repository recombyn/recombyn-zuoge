"""Design Engine V3 — 10 acceptance items (Phase 1 gate before Phase 2).

01 Create poster          02 Edit poster
03 Review <70 rebuild     04 Review 70–89 repair     05 Review >=90 pass
06 AI Transaction undo    07 Mid-fail rollback       (06/07 FE also in web vitest)
08 Revision conflict      09 Yjs + AI                (08/09 in web vitest)
10 Skill eval score compare
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.services.design.ops.tool_ops_contract import normalize_agent_tool_ops
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes import apply as apply_mod
from app.services.design.runtime.graph.nodes.review import (
    _parse_review_structured,
    _retry_paint_from_review,
    _try_polish_command,
    _try_repair_plan_command,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    resolve_transaction_phase,
)

_FIX = Path(__file__).resolve().parent / "fixtures"
_REPO = Path(__file__).resolve().parents[4]
_EVAL = _REPO / "eval" / "design-agent"
_REGRESSION = Path(__file__).resolve().parent / "fixtures" / "eval_regression"


def _load(name: str) -> dict:
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def _rt(*, scene_name: str = "poster_base.json") -> AgentRuntime:
    scene = _load(scene_name)
    run = AgentRunState(trace_id="tr", task_id="task_accept", goal="poster")
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
        scene_nodes=list(scene["nodes"]),
        scene_frames=list(scene["frames"]),
        focus_id=str(scene.get("focusId") or ""),
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
        w=int(scene.get("w") or 1080),
        h=int(scene.get("h") or 1920),
        run=run,
        decision=DesignRunDecision(),
        flags={},
    )


def _scores(*, total_target: str) -> dict[str, int]:
    if total_target == "rebuild":
        return {
            "composition": 10,
            "hierarchy": 10,
            "typography": 8,
            "color": 8,
            "consistency": 8,
            "content": 5,
            "originality": 2,
        }
    if total_target == "repair":
        return {
            "composition": 18,
            "hierarchy": 17,
            "typography": 14,
            "color": 14,
            "consistency": 13,
            "content": 5,
            "originality": 4,
        }
    return {
        "composition": 18,
        "hierarchy": 18,
        "typography": 14,
        "color": 14,
        "consistency": 13,
        "content": 9,
        "originality": 4,
    }


def test_01_create_poster_via_tool_ops():
    scene = _load("empty_canvas.json")
    ops, errs = normalize_agent_tool_ops(
        [
            {
                "name": "create_frame",
                "args": {"id": "frame_poster", "width": 1080, "height": 1920},
            },
            {
                "name": "create_image",
                "args": {
                    "id": "hero",
                    "frameId": "frame_poster",
                    "x": 180,
                    "y": 420,
                    "w": 720,
                    "h": 1100,
                    "src": "https://example.com/sword.png",
                },
            },
            {
                "name": "create_text",
                "args": {
                    "id": "title",
                    "frameId": "frame_poster",
                    "x": 80,
                    "y": 120,
                    "text": "大荒龙脊",
                    "fontSize": 84,
                    "fill": "#D5D8D4",
                },
            },
        ],
        scene_nodes=list(scene.get("nodes") or []),
        scene_frames=list(scene.get("frames") or []),
        classified_intent="create",
    )
    assert not any("tool_not_allowed" in e for e in errs), errs
    names = [str(o.get("name") or "") for o in ops]
    assert names == ["create_frame", "create_image", "create_text"]
    assert all("type" not in o or o.get("type") != "editor/setNodes" for o in ops)


def test_02_edit_poster_via_update_node():
    scene = _load("poster_base.json")
    ops, errs = normalize_agent_tool_ops(
        [{"name": "update_node", "args": {"nodeId": "title", "fontSize": 72, "text": "神兵"}}],
        scene_nodes=list(scene["nodes"]),
        scene_frames=list(scene["frames"]),
        classified_intent="edit",
    )
    assert not errs, errs
    assert ops[0]["name"] == "update_node"
    assert ops[0]["args"]["nodeId"] == "title"
    assert ops[0]["args"]["fontSize"] == 72


def test_03_review_below_70_rebuilds_not_repair():
    parsed = _parse_review_structured(
        {
            "pass": True,
            "must_fix": False,
            "scores": _scores(total_target="rebuild"),
            "total": 99,
            "issues": [
                {
                    "severity": "major",
                    "target": "title",
                    "issue": "composition collapsed",
                    "action": "reduce_size",
                    "patch": {"fontSize": 72},
                }
            ],
        }
    )
    assert parsed["total"] == 51
    assert parsed["review_action"] == "rebuild"
    rt = _rt()
    cmd = asyncio.run(
        _retry_paint_from_review(rt, rt.run, round_i=1, verdict=parsed)
    )
    assert cmd.goto == "paint_ops"
    assert rt.flags["review_action"] == "rebuild"
    assert resolve_transaction_phase(rt) == "paint"
    assert rt.step_ops == []


def test_04_review_70_to_89_auto_repair():
    parsed = _parse_review_structured(
        {
            "pass": True,
            "must_fix": False,
            "scores": _scores(total_target="repair"),
            "total": 99,
            "issues": [
                {
                    "severity": "major",
                    "area": "hierarchy",
                    "target": "title",
                    "issue": "标题抢夺 Hero",
                    "action": "reduce_size",
                    "patch": {"fontSize": 72},
                }
            ],
        }
    )
    assert parsed["total"] == 85
    assert parsed["review_action"] == "repair"
    rt = _rt()
    cmd = _try_repair_plan_command(rt, rt.run, round_i=1, verdict=parsed)
    assert cmd is not None
    assert cmd.goto == "action"
    assert rt.step_ops[0]["name"] == "update_node"
    assert not any(str(o.get("name") or "").startswith("create_") for o in rt.step_ops)
    assert rt.flags["review_action"] == "repair"
    assert resolve_transaction_phase(rt) == "correction"


def test_05_review_at_90_passes_then_polish_once():
    parsed = _parse_review_structured(
        {
            "pass": False,
            "must_fix": True,
            "scores": _scores(total_target="pass"),
            "total": 1,
            "issues": [],
            "anti_slop_hits": [],
        }
    )
    assert parsed["total"] == 90
    assert parsed["review_action"] == "pass"
    assert parsed["must_fix"] is False
    rt = _rt(scene_name="poster_clutter.json")
    cmd = _try_polish_command(rt, rt.run, round_i=2, verdict=parsed)
    assert cmd is not None
    assert cmd.goto == "action"
    assert rt.flags["polish_done"] is True
    assert resolve_transaction_phase(rt) == "polish"
    assert all(not str(o.get("name") or "").startswith("create_") for o in rt.step_ops)


def test_07_ai_mid_fail_emits_transaction_rollback(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(apply_mod, "_emit", lambda ev: emitted.append(ev))
    rt = _rt()
    rt.run.active_transaction_id = "tx_fail"
    rt.run.active_transaction_phase = "paint"
    apply_mod._emit_transaction_rollback(rt, reason="apply_failed", round_i=1)
    assert rt.run.active_transaction_id == ""
    assert emitted[0]["type"] == "transaction.rollback"
    assert emitted[0]["transaction_id"] == "tx_fail"


def test_10_skill_eval_score_compare_fails_on_drop():
    node = shutil.which("node")
    if not node:
        pytest.skip("node required for compare.mjs")

    def run_compare(current_name: str) -> subprocess.CompletedProcess[str]:
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            out = tmp.name
        return subprocess.run(
            [
                node,
                str(_EVAL / "compare.mjs"),
                "--baseline",
                str(_REGRESSION / "baseline.json"),
                "--current",
                str(_REGRESSION / current_name),
                "--out",
                out,
                "--require-baseline",
                "--require-current",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )

    fail_proc = run_compare("current_avg_drop.json")
    assert fail_proc.returncode == 1, fail_proc.stdout
    report = json.loads(fail_proc.stdout)
    assert report["fail"] is True
    assert report["avg_drop"] > 3
    pass_proc = run_compare("current_pass.json")
    assert pass_proc.returncode == 0, pass_proc.stderr or pass_proc.stdout
