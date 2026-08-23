"""P23 — Design Memory three layers (User / Project / Session)."""
from __future__ import annotations

from app.services.agent_memory.compose import compose_memory_blocks, format_design_memory_block
from app.services.agent_memory.medium_term import project_design_from_task_state
from app.services.agent_memory.schema import (
    build_design_memory_patch,
    empty_design_memory,
    empty_task_state,
    merge_user_design_layers,
    normalize_task_state,
    overlay_project_design,
    slim_brief_for_memory,
    user_design_from_long_hits,
)
from app.services.agent_memory.service import memory_service


_BRIEF = {
    "purpose": "promote a greatsword",
    "audience": "xianxia players",
    "emotion": ["solemn"],
    "visual_thesis": "museum relic sword, not game loot",
    "visual_hero": "greatsword",
    "composition": {"archetype": "center_hero"},
    "avoid": ["HUD"],
    "reference_lock": {
        "allow": ["content"],
        "forbid": ["changing core visual language"],
        "composition": {"type": "asymmetric_editorial"},
    },
    "reference_dna": {"visual_dna": {"minimalism": 0.87, "editorial": 0.91}},
}


def test_normalize_keeps_subgoals_and_layers():
    raw = {
        "design": {
            "subgoals": [{"id": "sg_1", "text": "lock hero", "status": "todo"}],
            "await_user": True,
            "session": {"iteration": "2"},
        }
    }
    merged = normalize_task_state(raw, user_id="u", project_id="p", session_id="s")
    design = merged["design"]
    assert set(design) >= {"user", "project", "session", "subgoals", "await_user"}
    assert design["session"]["iteration"] == 2
    assert design["user"]["preference"] == {}
    assert design["subgoals"][0]["text"] == "lock hero"


def test_patch_writes_session_and_project_increments_iteration():
    medium = empty_task_state(user_id="u", project_id="p", session_id="s")
    patch = build_design_memory_patch(
        medium=medium,
        brief=_BRIEF,
        review={"scores": {"composition": 18}, "total": 91, "action": "pass", "summary": "ok"},
        reference_dna=_BRIEF["reference_dna"],
        painted=True,
    )
    assert patch["session"]["iteration"] == 1
    assert patch["session"]["brief"]["visual_thesis"] == "museum relic sword, not game loot"
    assert patch["session"]["review"]["total"] == 91
    assert patch["project"]["reference_dna"]["visual_dna"]["minimalism"] == 0.87
    again = build_design_memory_patch(
        medium={"design": patch},
        brief=_BRIEF,
        painted=True,
    )
    assert again["session"]["iteration"] == 2
    skipped = build_design_memory_patch(medium={"design": patch}, painted=False)
    assert skipped["session"]["iteration"] == 1


def test_chat_run_does_not_increment_iteration():
    medium = empty_task_state()
    patch = build_design_memory_patch(medium=medium, painted=False)
    assert patch["session"]["iteration"] == 0


def test_user_layer_from_long_hits_does_not_treat_one_note_as_commit_gate():
    user = user_design_from_long_hits(
        [
            {"kind": "preference", "text": "smaller headlines", "score": 0.4},
            {"kind": "rejected", "text": "glassmorphism"},
            {"kind": "accepted", "text": "editorial split"},
        ]
    )
    assert "smaller headlines" in user["preference"]
    assert "glassmorphism" in user["rejected_patterns"]
    assert "editorial split" in user["accepted_patterns"]
    merged = merge_user_design_layers(
        {"preference": {}, "rejected_patterns": ["neon glow"], "accepted_patterns": []},
        user,
    )
    assert "neon glow" in merged["rejected_patterns"]
    assert "glassmorphism" in merged["rejected_patterns"]


def test_project_overlay_fills_empty_session_keeps_current():
    stored = {
        "brand_dna": {"hex": ["#111"]},
        "design_system": {},
        "reference_dna": {"visual_dna": {"density": 0.3}},
    }
    current = {"brand_dna": {}, "design_system": {}, "reference_dna": {}}
    filled = overlay_project_design(current, stored)
    assert filled["reference_dna"]["visual_dna"]["density"] == 0.3
    assert filled["brand_dna"]["hex"] == ["#111"]
    current_dna = {
        "brand_dna": {},
        "design_system": {},
        "reference_dna": {"visual_dna": {"density": 0.9}},
    }
    kept = overlay_project_design(current_dna, stored)
    assert kept["reference_dna"]["visual_dna"]["density"] == 0.9
    assert kept["brand_dna"]["hex"] == ["#111"]


def test_project_design_from_task_state():
    blob = {"design": {"project": {"reference_dna": {"visual_dna": {"editorial": 0.8}}}}}
    proj = project_design_from_task_state(blob)
    assert proj["reference_dna"]["visual_dna"]["editorial"] == 0.8
    assert project_design_from_task_state(None)["reference_dna"] == {}


def test_compose_design_memory_omits_dna_axis_numbers():
    design = empty_design_memory()
    design["project"]["reference_dna"] = {"visual_dna": {"minimalism": 0.87}}
    design["session"]["brief"] = slim_brief_for_memory(_BRIEF)
    design["session"]["iteration"] = 2
    design["session"]["review"] = {"total": 91, "action": "pass"}
    block = format_design_memory_block(design)
    assert "[Design memory]" in block
    assert "reference_dna locked" in block
    assert "iteration=2" in block
    assert "review=91 pass" in block
    assert "0.87" not in block
    assert "minimalism" not in block
    empty_block = format_design_memory_block(empty_design_memory())
    assert empty_block == ""
    text = compose_memory_blocks(
        medium={"design": design},
        short=[],
        long_hits=[],
        rules={},
    )
    assert "[Design memory]" in text


def test_build_run_patch_merges_three_layers():
    medium = empty_task_state(user_id="u", project_id="p", session_id="s")
    design_patch = build_design_memory_patch(
        medium=medium,
        brief=_BRIEF,
        review={"total": 88, "action": "repair"},
        reference_dna={"visual_dna": {"editorial": 0.7}},
        painted=True,
    )
    out = memory_service.build_run_patch(
        medium,
        task_id="t1",
        intent="design",
        edit_in_place=False,
        blank_artboard=True,
        summary="poster",
        tool_ops_applied=True,
        critique_notes=None,
        scene_key="website",
        canvas_size="1080x1920",
        design_patch=design_patch,
    )
    design = out["medium"]["design"]
    assert design["session"]["iteration"] == 1
    assert design["session"]["review"]["total"] == 88
    assert design["project"]["reference_dna"]["visual_dna"]["editorial"] == 0.7
    assert design["user"]["preference"] == {}
