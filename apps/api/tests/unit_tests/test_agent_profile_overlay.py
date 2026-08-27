# -*- coding: utf-8 -*-
"""AgentProfile overlay patches."""
from __future__ import annotations

from app.services.design.runtime.agent_profile import (
    _apply_profile_overlays,
    clear_agent_profile_cache,
    load_agent_profile,
)


def test_apply_profile_overlay_deep_merges_runtime_flags(tmp_path, monkeypatch):
    base = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "design.canvas",
        "metadata": {"version": 1, "status": "active"},
        "identity": {"displayName": "Canvas"},
        "runtime": {"flags": {"review_mode": "auto"}},
    }
    patch_dir = tmp_path / "overlays"
    patch_dir.mkdir()
    (patch_dir / "design.canvas.patch.yaml").write_text(
        'runtime:\n  flags:\n    review_mode: "off"\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.agents_data_dir",
        lambda: tmp_path,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.agent_overrides_dir",
        lambda: tmp_path / "missing",
    )
    merged = _apply_profile_overlays(base, "design.canvas")
    assert merged["runtime"]["flags"]["review_mode"] == "off"


def test_load_agent_profile_applies_overlay(monkeypatch, tmp_path):
    profiles = tmp_path / "profiles"
    profiles.mkdir(parents=True)
    (profiles / "design.canvas.yaml").write_text(
        """
apiVersion: recombyn.agent/v1
kind: AgentProfile
id: design.canvas
metadata: {version: 1, status: active}
identity:
  displayName: Canvas
  prompts:
    persona: {auto: p.auto, locked: p.locked}
    overlays: {ask: agent.prompt.ask_system, agent: agent.prompt.agent_system}
    stages:
      intent: agent.prompt.intent
      decide: agent.prompt.decide
      paint: agent.prompt.paint
      observe: agent.prompt.observe
      review: {protocol: agent.prompt.review, mode_overlay: false}
      settle: agent.prompt.settle
topology:
  template: canvas_ops_v1
  stages: [intent, decide, paint, observe, review, settle]
capabilities:
  tools: {catalog: canvas_actions, host: canvas_fe}
  skills: {catalog: design_skills}
""".strip(),
        encoding="utf-8",
    )
    overlays = tmp_path / "overlays"
    overlays.mkdir()
    (overlays / "design.canvas.patch.yaml").write_text(
        "runtime:\n  flags:\n    critique_enabled: false\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.agents_data_dir",
        lambda: tmp_path,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.profiles_dir",
        lambda: profiles,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.agent_overrides_dir",
        lambda: tmp_path / "agent-overrides",
    )
    clear_agent_profile_cache()
    try:
        prof = load_agent_profile("design.canvas", force=True)
        assert prof.runtime_flags.get("critique_enabled") is False
    finally:
        clear_agent_profile_cache()
