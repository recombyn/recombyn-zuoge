"""PR17–PR19 — Eval rubric, 40-task dataset, skill-regression compare."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import pytest

from app.services.design.runtime.graph.nodes.review import _apply_score_gate
from app.services.design.runtime.graph.state import (
    REVIEW_PASS_SCORE,
    REVIEW_REWORK_SCORE,
    REVIEW_SCORE_CAPS,
    clamp_review_scores,
    sum_review_scores,
)

_REPO = Path(__file__).resolve().parents[4]
_EVAL = _REPO / "eval" / "design-agent"
_FAMILY_SKILL = {
    "poster": "poster_craft",
    "landing": "landing_page",
    "dashboard": "dashboard_ui",
    "image": "image_gen",
}
_COMPARE = _EVAL / "compare.mjs"
_REGRESSION = Path(__file__).resolve().parent / "fixtures" / "eval_regression"


def _rubric() -> dict:
    path = _EVAL / "rubric.json"
    assert path.is_file(), f"missing {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_rubric_caps_match_runtime_review():
    rubric = _rubric()
    caps = rubric.get("caps") or {}
    assert caps == dict(REVIEW_SCORE_CAPS)
    assert sum(caps.values()) == 100
    assert int(rubric["gates"]["rebuild_below"]) == REVIEW_REWORK_SCORE
    assert int(rubric["gates"]["pass_at"]) == REVIEW_PASS_SCORE


def test_runtime_sum_ignores_invented_total():
    scores = clamp_review_scores(
        {
            "composition": 18,
            "hierarchy": 17,
            "typography": 14,
            "color": 14,
            "consistency": 13,
            "content": 5,
            "originality": 4,
            "extra": 99,
        }
    )
    assert sum_review_scores(scores) == 85
    _passed, _must, action = _apply_score_gate(
        scores=scores,
        total=85,
        issues=[],
        anti_slop_hits=[],
        passed=True,
        must_fix=False,
    )
    assert action == "repair"


def test_eval_layout_has_tasks_and_refs():
    families = set(_FAMILY_SKILL)
    tasks = sorted((_EVAL / "tasks").glob("*.json"))
    assert len(tasks) == 40, f"first-phase dataset is 40 tasks, got {len(tasks)}"
    seen_ids: set[str] = set()
    seen_prompts: set[str] = set()
    family_counts: Counter[str] = Counter()
    skill_roots = [
        _REPO / "skills" / "foundation",
        _REPO / "skills" / "domains",
        _REPO / "apps" / "api" / "seeds" / "design_skills",
    ]

    def _skill_md(name: str) -> Path | None:
        for root in skill_roots:
            path = root / name / "SKILL.md"
            if path.is_file():
                return path
        return None

    for path in tasks:
        row = json.loads(path.read_text(encoding="utf-8"))
        tid = str(row.get("id") or "").strip()
        prompt = str(row.get("prompt") or "").strip()
        family = str(row.get("family") or "").strip()
        skill = str(row.get("skill") or "").strip()
        assert tid and prompt and skill, path.name
        assert path.name == f"{tid}.json", path.name
        assert tid not in seen_ids, tid
        assert prompt not in seen_prompts, tid
        seen_ids.add(tid)
        seen_prompts.add(prompt)
        assert family in families, family
        assert skill == _FAMILY_SKILL[family], (tid, skill)
        family_counts[family] += 1
        assert _skill_md(skill) is not None, skill
        helpers = row.get("helpers") or []
        assert isinstance(helpers, list)
        for helper in helpers:
            assert isinstance(helper, str) and helper.strip(), tid
            assert _skill_md(helper) is not None, f"{tid}:{helper}"
        for key in ("ref_good", "ref_bad"):
            rel = str(row.get(key) or "")
            assert rel, f"{tid} missing {key}"
            assert (_EVAL / rel).is_file(), rel
    assert set(family_counts) == families
    assert all(family_counts[f] == 10 for f in families), dict(family_counts)


def test_score_gate_bands_match_rubric():
    rubric = _rubric()
    rebuild_below = int(rubric["gates"]["rebuild_below"])
    pass_at = int(rubric["gates"]["pass_at"])

    def band(total: int) -> str:
        _, _, action = _apply_score_gate(
            scores={"composition": total},
            total=total,
            issues=[],
            anti_slop_hits=[],
            passed=False,
            must_fix=False,
        )
        return action

    assert band(rebuild_below - 1) == "rebuild"
    assert band(rebuild_below) == "repair"
    assert band(pass_at - 1) == "repair"
    assert band(pass_at) == "pass"


def test_eval_baseline_thresholds_and_key_tasks():
    path = _EVAL / "baseline.json"
    assert path.is_file(), path
    row = json.loads(path.read_text(encoding="utf-8"))
    assert int(row.get("version") or 0) == 3
    assert float(row["thresholds"]["avg_drop"]) == 3
    assert float(row["thresholds"]["key_task_drop"]) == 5
    assert row["key_tasks"] == [
        "poster-001",
        "landing-001",
        "dashboard-001",
        "image-001",
    ]
    for tid in row["key_tasks"]:
        assert (_EVAL / "tasks" / f"{tid}.json").is_file(), tid


def _run_compare(current_name: str) -> subprocess.CompletedProcess[str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node required for compare.mjs")
    with tempfile.TemporaryDirectory() as td:
        out = str(Path(td) / "compare.json")
        return subprocess.run(
            [
                node,
                str(_COMPARE),
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


def test_skill_regression_compare_pass():
    proc = _run_compare("current_pass.json")
    assert proc.returncode == 0, proc.stderr or proc.stdout
    report = json.loads(proc.stdout)
    assert report["fail"] is False
    assert report["compared"] == 4
    assert report["avg_drop"] is not None and report["avg_drop"] <= 3


def test_skill_regression_compare_fails_on_avg_drop():
    proc = _run_compare("current_avg_drop.json")
    assert proc.returncode == 1, proc.stdout
    report = json.loads(proc.stdout)
    assert report["fail"] is True
    assert any("avg_drop" in r for r in report["reasons"])
    assert report["avg_drop"] > 3


def test_skill_regression_compare_fails_on_key_task_drop():
    proc = _run_compare("current_key_drop.json")
    assert proc.returncode == 1, proc.stdout
    report = json.loads(proc.stdout)
    assert report["fail"] is True
    assert any("poster-001" in r for r in report["reasons"])
    poster = next(t for t in report["tasks"] if t["id"] == "poster-001")
    assert poster["skill"] == "poster_craft"
    assert poster["score"] == 82
    assert poster["baseline"] == 88
