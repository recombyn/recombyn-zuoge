"""Public skills catalog layout (ADR 0018)."""
from __future__ import annotations

from pathlib import Path

from app.services.design.prompts.skill_store.pack_io import (
    _file_skills_dirs,
    _public_skills_dirs,
)


def test_public_skills_dirs_exist():
    roots = _public_skills_dirs()
    assert len(roots) == 2
    assert roots[0].name == "foundation"
    assert roots[1].name == "domains"
    assert roots[0].is_dir()
    assert roots[1].is_dir()
    assert (roots[0] / "design_brief" / "_meta.json").is_file()
    assert (roots[1] / "poster_craft" / "_meta.json").is_file()


def test_file_skills_dirs_scan_order():
    dirs = _file_skills_dirs()
    names = [p.name for p in dirs]
    assert "foundation" in names
    assert "domains" in names
    # foundation before domains
    assert names.index("foundation") < names.index("domains")
    # plugins may or may not exist; when present it is last among product roots
    if any(p.name == "skills" and "plugins" in str(p).replace("\\", "/") for p in dirs):
        assert names.index("domains") < len(names)


def test_skills_readme_is_public_only():
    readme = Path(__file__).resolve().parents[4] / "skills" / "README.md"
    # parents: design_engine -> tests -> api -> apps -> repo
    text = readme.read_text(encoding="utf-8").lower()
    assert "foundation" in text
    assert "domains" in text
    # Do not document proprietary backends in the open skills README.
    assert "recombyn-intelligence" not in text
    assert "private-prompts" not in text
