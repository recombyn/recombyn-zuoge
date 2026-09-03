"""Eval layout boundary — suite in-tree; no separate private-eval tree."""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]  # resume-creation-web


def test_public_eval_layout_exists():
    assert (_ROOT / "eval" / "design-agent" / "suite.json").is_file()
    assert (_ROOT / "eval" / "design-agent" / "rubric.json").is_file()
    assert (_ROOT / "eval" / "design-agent" / "baseline.json").is_file()
    assert (_ROOT / "packages" / "eval-framework" / "package.json").is_file()
    assert (_ROOT / "eval" / "public" / "README.md").is_file()
    assert (_ROOT / "eval" / "README.md").is_file()


def test_no_private_eval_tree_in_repo():
    """Product is fully open; do not reintroduce a private-eval dual tree."""
    forbidden_dirs = (
        _ROOT / "private-eval",
        _ROOT / "eval" / "private",
        _ROOT / "eval" / "private-eval",
        _ROOT / "eval" / "design-agent" / "private",
    )
    for path in forbidden_dirs:
        assert not path.exists(), f"forbidden private-eval path: {path}"


def test_no_human_ranking_artifacts_committed():
    bad_names = {
        "human_rankings.json",
        "human_rankings.csv",
        "private_rubric_weights.json",
        "closed_corpus.json",
    }
    scan_roots = [
        _ROOT / "eval",
        _ROOT / "packages" / "eval-framework",
    ]
    found: list[str] = []
    for root in scan_roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.name.lower() in bad_names:
                found.append(str(path.relative_to(_ROOT)))
    assert not found, f"unexpected ranking artifacts under eval/: {found}"
