"""Resource deferral helpers — avoid decide spin on already-loaded skills."""

from __future__ import annotations

from app.services.design.runtime.host.resources import _fresh_skill_keys


def test_fresh_skill_keys_empty_when_already_loaded():
    assert _fresh_skill_keys(
        ["landing_page", "image_gen"],
        skills_loaded=["landing_page", "image_gen", "react"],
    ) == []


def test_fresh_skill_keys_only_missing():
    assert _fresh_skill_keys(
        ["landing_page", "poster_craft"],
        skills_loaded=["landing_page"],
    ) == ["poster_craft"]
