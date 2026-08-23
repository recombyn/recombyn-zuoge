"""P39 — Skill A/B: V12-A vs V12-B → winner candidate → human promote only."""
from __future__ import annotations

from pathlib import Path

from app.services.design.prompts.skill_store.pack_io import (
    build_skill_ab_candidate,
    build_skill_ab_experiment,
    compare_skill_ab,
    deploy_skill_proposal,
    promote_skill_ab_candidate,
)

_POSTER_MD = """# Poster

## Hard rules

1. Brief P0 before paint.
2. One thesis, one hero, one primary focal.

Hero should be visually dominant.

## Done when

Review total ≥ 90
"""


def _eval_with_avg(avg: float, *, n: int = 100, skill: str = "poster_craft") -> dict:
    """Synthetic eval doc whose mean review.total ≈ avg."""
    # Use identical totals for determinism (mean == avg).
    total = float(avg)
    return {
        "results": [
            {
                "caseId": f"poster-{i:03d}",
                "skill": skill,
                "review": {"total": total},
            }
            for i in range(1, n + 1)
        ]
    }


def test_ab_experiment_builds_v12_a_and_b_hero_bands():
    exp = build_skill_ab_experiment(
        skill_key="poster_craft",
        current_md=_POSTER_MD,
        base_version="12",
    )
    assert exp["status"] == "running"
    ids = [v["id"] for v in exp["variants"]]
    assert ids == ["V12-A", "V12-B"]
    assert "60–80%" in exp["variants"][0]["md"]
    assert "55–75%" in exp["variants"][1]["md"]
    assert "Hero should be visually dominant." not in exp["variants"][0]["md"]


def test_ab_compare_b_wins_spec_scores():
    """Spec: A=87.4, B=89.1 → B wins → V13 candidate."""
    exp = build_skill_ab_experiment(
        skill_key="poster_craft",
        current_md=_POSTER_MD,
        base_version="12",
    )
    compared = compare_skill_ab(
        exp,
        eval_a=_eval_with_avg(87.4, n=100),
        eval_b=_eval_with_avg(89.1, n=100),
        task_count=100,
    )
    assert compared["status"] == "compared"
    assert compared["task_count"] == 100
    assert compared["scores"]["V12-A"] == 87.4
    assert compared["scores"]["V12-B"] == 89.1
    assert compared["winner_id"] == "V12-B"
    candidate = build_skill_ab_candidate(compared, current_md=_POSTER_MD)
    assert candidate["ok"] is True
    assert candidate["status"] == "pending"
    assert candidate["next_version"] == "13"
    assert candidate["winner_id"] == "V12-B"
    assert "55–75%" in candidate["proposed_md"]
    assert candidate["approved_by"] is None


def test_ab_winner_does_not_auto_write_production(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    exp = build_skill_ab_experiment(
        skill_key="poster_craft",
        current_md=_POSTER_MD,
        base_version="12",
    )
    compared = compare_skill_ab(exp, score_a=87.4, score_b=89.1, task_count=100)
    candidate = build_skill_ab_candidate(compared, current_md=_POSTER_MD)
    # Candidate alone must not deploy.
    result = deploy_skill_proposal(
        candidate, pack_dir=pack, compare_report={"fail": False}
    )
    assert result["ok"] is False
    assert result["reason"] == "not_approved"
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD


def test_human_promote_then_regression_pass_deploys_winner(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    (pack / "_meta.json").write_text(
        '{"skill_key":"poster_craft","version":"12"}\n', encoding="utf-8"
    )
    exp = build_skill_ab_experiment(
        skill_key="poster_craft",
        current_md=_POSTER_MD,
        base_version="12",
    )
    compared = compare_skill_ab(exp, score_a=87.4, score_b=89.1, task_count=100)
    candidate = build_skill_ab_candidate(compared, current_md=_POSTER_MD)
    promoted = promote_skill_ab_candidate(candidate, by="art-director")
    assert promoted["status"] == "approved"
    assert promoted["approved_by"] == "art-director"
    # Still not written until deploy.
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD
    result = deploy_skill_proposal(
        promoted,
        pack_dir=pack,
        compare_report={"fail": False, "avg_drop": 0.2},
    )
    assert result["ok"] is True
    written = (pack / "SKILL.md").read_text(encoding="utf-8")
    assert "Hero should occupy 55–75% of the visual attention budget." in written
    meta = (pack / "_meta.json").read_text(encoding="utf-8")
    assert '"13"' in meta


def test_ab_tie_prefers_variant_a():
    exp = build_skill_ab_experiment(
        skill_key="poster_craft",
        current_md=_POSTER_MD,
        base_version="12",
    )
    compared = compare_skill_ab(exp, score_a=88.0, score_b=88.0, task_count=100)
    assert compared["winner_id"] == "V12-A"
