# -*- coding: utf-8 -*-
"""Skill hooks.py loader."""
from __future__ import annotations

from app.services.design.runtime.seams.registry import HookRegistry


def test_register_skill_pipeline_hooks_no_hooks(tmp_path, monkeypatch):
    registry = HookRegistry()
    root = tmp_path / "skills"
    pack = root / "demo_skill"
    pack.mkdir(parents=True)
    (pack / "_meta.json").write_text('{"skill_key":"demo_skill"}', encoding="utf-8")
    monkeypatch.setattr(
        "app.services.design.prompts.skill_store.pack_io._file_skills_dirs",
        lambda: [root],
    )
    from app.services.design.prompts.skill_store.hooks_loader import (
        register_skill_pipeline_hooks,
    )

    register_skill_pipeline_hooks(registry, ["demo_skill"])
    assert registry._pre == []


def test_register_skill_pipeline_hooks_calls_register_pipeline(tmp_path, monkeypatch):
    registry = HookRegistry()
    root = tmp_path / "skills"
    pack = root / "demo_skill"
    pack.mkdir(parents=True)
    (pack / "hooks.py").write_text(
        "def register_pipeline(reg):\n"
        "    reg.register_pre('demo', lambda ctx, v: v, priority=5)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "app.services.design.prompts.skill_store.pack_io._file_skills_dirs",
        lambda: [root],
    )
    monkeypatch.setattr(
        "app.services.design.prompts.skill_store.hooks_loader._LOADED_HOOK_SKILLS",
        set(),
    )
    from app.services.design.prompts.skill_store.hooks_loader import (
        register_skill_pipeline_hooks,
    )

    register_skill_pipeline_hooks(registry, ["demo_skill"])
    assert any(entry.name == "demo" for entry in registry._pre)
