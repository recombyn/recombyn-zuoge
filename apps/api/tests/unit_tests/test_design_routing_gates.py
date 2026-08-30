"""Runtime gates that remain in the live path (no soft prompt?scene invent)."""

from __future__ import annotations

import pytest

from app.services.design.admin.admin_store import STAGE_RULE_DEFAULTS, ensure_stage_rules
from app.services.design.readpath.catalog import ensure_design_catalog, get_global_rules
from app.services.design.runtime.decision_log import probe_has_target_chip
from app.services.design.readpath.canvas_scene import resolve_agent_scene


@pytest.fixture(scope="module", autouse=True)
def _catalog():
    ensure_design_catalog(force=True)
    ensure_stage_rules()
    yield

def test_probe_target_chip_detects_payload_only():
    prompt = "[Target element: rect-1]\n?????8px"
    assert probe_has_target_chip(prompt)
    assert not probe_has_target_chip("??")


def test_scene_follows_ui_tab_only():
    rules = get_global_rules() or dict(STAGE_RULE_DEFAULTS)
    if "canvas.scene_keys" not in rules:
        rules = dict(STAGE_RULE_DEFAULTS)
    key, overridden = resolve_agent_scene("website", "???????", rules=rules)
    assert key == "website"
    assert overridden is False
    key2, _ = resolve_agent_scene("mobile", "????????", rules=rules)
    assert key2 == "mobile"
    # Empty tab ? Admin default only (no prompt soft invent).
    key3, _ = resolve_agent_scene(None, "???? app ???", rules=rules)
    assert key3 == "website"
