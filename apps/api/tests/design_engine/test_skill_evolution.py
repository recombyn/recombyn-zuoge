"""P30 — Skill evolution: mine failures → proposal diff → human approve → deploy.

AI must not overwrite production skills. Regression avg drop >3 or key drop >5 blocks deploy.
"""
from __future__ import annotations

from pathlib import Path

from app.services.design.prompts.skill_store.pack_io import (
    approve_skill_proposal,
    build_skill_proposal,
    deploy_skill_proposal,
    mine_skill_failures,
    reject_skill_proposal,
    regression_blocks_deploy,
)

_POSTER_MD = """# Poster

## Hard rules

1. Brief P0 before paint.
2. One thesis, one hero, one primary focal.

Hero should be visually dominant.

## Done when

Review total ≥ 90
"""


def _poster_eval(*, title: int, deco: int, focal: int) -> dict:
    results: list[dict] = []
    n = 0
    for _ in range(title):
        n += 1
        results.append(
            {
                "caseId": f"poster-{n:03d}",
                "skill": "poster_craft",
                "review": {"total": 72, "issues": ["title too large"]},
            }
        )
    for _ in range(deco):
        n += 1
        results.append(
            {
                "caseId": f"poster-{n:03d}",
                "skill": "poster_craft",
                "review": {"total": 74, "issues": ["decoration too much"]},
            }
        )
    for _ in range(focal):
        n += 1
        results.append(
            {
                "caseId": f"poster-{n:03d}",
                "skill": "poster_craft",
                "review": {"total": 70, "issues": ["weak focal point"]},
            }
        )
    return {"results": results}


def test_mine_counts_title_decoration_focal():
    mined = mine_skill_failures(_poster_eval(title=27, deco=21, focal=18))
    by_pattern = {row["pattern"]: row["count"] for row in mined}
    assert by_pattern["title too large"] == 27
    assert by_pattern["decoration too much"] == 21
    assert by_pattern["weak focal point"] == 18
    assert all(row["skill_key"] == "poster_craft" for row in mined)


def test_proposal_is_diff_and_does_not_write(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    (pack / "_meta.json").write_text('{"skill_key":"poster_craft","version":"3.0.0"}\n', encoding="utf-8")
    failures = mine_skill_failures(_poster_eval(title=27, deco=21, focal=18))
    proposal = build_skill_proposal(
        skill_key="poster_craft",
        failures=failures,
        current_md=_POSTER_MD,
        base_version="3.0.0",
    )
    assert proposal["status"] == "pending"
    assert proposal["next_version"] == "3.0.1"
    diff = proposal["diff"]
    assert "-Hero should be visually dominant." in diff
    assert "+Hero should occupy 60–80% of the visual attention budget." in diff
    assert "Secondary typography must remain at least one hierarchy level below hero." in proposal["proposed_md"]
    assert "Decorative elements must not compete with hero." in proposal["proposed_md"]
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD


def test_approve_without_deploy_leaves_production(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    proposal = build_skill_proposal(
        skill_key="poster_craft",
        failures=[{"skill_key": "poster_craft", "pattern": "title too large", "count": 27}],
        current_md=_POSTER_MD,
        base_version="3.0.0",
    )
    approved = approve_skill_proposal(proposal, by="reviewer")
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "reviewer"
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD


def test_deploy_without_approve_does_not_write(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    proposal = build_skill_proposal(
        skill_key="poster_craft",
        failures=[{"skill_key": "poster_craft", "pattern": "weak focal point", "count": 18}],
        current_md=_POSTER_MD,
        base_version="3.0.0",
    )
    result = deploy_skill_proposal(
        proposal,
        pack_dir=pack,
        compare_report={"fail": False},
    )
    assert result["ok"] is False
    assert result["reason"] == "not_approved"
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD


def test_deploy_blocked_by_regression(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    proposal = approve_skill_proposal(
        build_skill_proposal(
            skill_key="poster_craft",
            failures=[{"skill_key": "poster_craft", "pattern": "title too large", "count": 27}],
            current_md=_POSTER_MD,
            base_version="3.0.0",
        )
    )
    assert regression_blocks_deploy({"fail": True, "reasons": ["avg_drop 4.2 > 3"]}) is True
    result = deploy_skill_proposal(
        proposal,
        pack_dir=pack,
        compare_report={"fail": True, "reasons": ["avg_drop 4.2 > 3"]},
    )
    assert result["ok"] is False
    assert result["reason"] == "regression_fail"
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD


def test_human_approve_then_regression_pass_deploys(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    (pack / "_meta.json").write_text(
        '{"skill_key":"poster_craft","version":"3.0.0"}\n', encoding="utf-8"
    )
    proposal = approve_skill_proposal(
        build_skill_proposal(
            skill_key="poster_craft",
            failures=mine_skill_failures(_poster_eval(title=27, deco=21, focal=18)),
            current_md=_POSTER_MD,
            base_version="3.0.0",
        ),
        by="art-director",
    )
    result = deploy_skill_proposal(
        proposal,
        pack_dir=pack,
        compare_report={"fail": False, "avg_drop": 0.4},
    )
    assert result["ok"] is True
    written = (pack / "SKILL.md").read_text(encoding="utf-8")
    assert "Hero should occupy 60–80% of the visual attention budget." in written
    assert "Hero should be visually dominant." not in written
    meta = (pack / "_meta.json").read_text(encoding="utf-8")
    assert '"3.0.1"' in meta
    assert result["proposal"]["status"] == "deployed"


def test_reject_cannot_deploy(tmp_path: Path):
    pack = tmp_path / "poster_craft"
    pack.mkdir()
    (pack / "SKILL.md").write_text(_POSTER_MD, encoding="utf-8")
    rejected = reject_skill_proposal(
        build_skill_proposal(
            skill_key="poster_craft",
            failures=[{"skill_key": "poster_craft", "pattern": "decoration too much", "count": 21}],
            current_md=_POSTER_MD,
        )
    )
    approved = approve_skill_proposal(rejected)
    assert approved["status"] == "rejected"
    result = deploy_skill_proposal(
        approved, pack_dir=pack, compare_report={"fail": False}
    )
    assert result["ok"] is False
    assert (pack / "SKILL.md").read_text(encoding="utf-8") == _POSTER_MD
