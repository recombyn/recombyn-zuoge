"""Public eval boundary — no private-eval corpora in this monorepo."""
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


def test_no_private_eval_tree_in_public_repo():
    """Closed rankings / datasets must not live under the Apache-2.0 tree."""
    forbidden_dirs = (
        _ROOT / "private-eval",
        _ROOT / "eval" / "private",
        _ROOT / "eval" / "private-eval",
        _ROOT / "eval" / "design-agent" / "private",
    )
    for path in forbidden_dirs:
        assert not path.exists(), f"forbidden private eval path: {path}"


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
    assert not found, f"private eval artifacts in public tree: {found}"
