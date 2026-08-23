"""P22 — Reference Intelligence: analyze → DNA → lock → Brief. No live LLM."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.decide import (
    _stash_design_brief,
    apply_reference_intelligence,
    ingest_reference_images,
    should_run_reference_intelligence,
)
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    compile_reference_intelligence,
    derive_reference_dna,
    format_design_brief_for_paint,
    format_design_brief_for_prompt,
    merge_reference_into_brief,
    parse_design_brief,
)

_ANALYZE = {
    "composition": {
        "type": "asymmetric_editorial",
        "balance": "dynamic",
        "axis": "diagonal",
        "focal_position": "upper_left",
    },
    "hierarchy": {"primary": "hero", "secondary": "headline", "tertiary": "supporting_copy"},
    "density": 0.32,
    "palette": {
        "dominant": ["#F3F1EA"],
        "secondary": ["#151515"],
        "accent": ["#D84A32"],
    },
    "typography": {"scale": "large", "contrast": "high", "alignment": "left"},
    "imagery": {
        "style": "editorial_photography",
        "depth": "shallow",
        "lighting": "soft_directional",
    },
}

_P0_BRIEF = {
    "purpose": "promote a greatsword",
    "audience": "xianxia players",
    "emotion": ["solemn"],
    "visual_thesis": "museum relic sword, not game loot",
    "visual_hero": "greatsword",
    "composition": {"archetype": "center_hero"},
    "avoid": ["HUD"],
}


def _rt(*, images: list[str] | None = None, intent: str = "design") -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_ref", goal="poster")
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="poster from this ref",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="website",
        scene_nodes=[],
        scene_frames=[],
        focus_id="",
        images=list(images or []),
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=1080,
        h=1920,
        run=run,
        decision=DesignRunDecision(),
        flags={},
        classified_intent=intent,
    )


def test_skip_when_no_reference_images():
    rt = SimpleNamespace(images=[], classified_intent="design", reference_dna=None)
    assert ingest_reference_images(rt) == []
    assert should_run_reference_intelligence(rt) is False


def test_skip_chat_intent_even_with_images():
    rt = SimpleNamespace(
        images=["data:image/png;base64,abc"],
        classified_intent="chat",
        reference_dna=None,
    )
    assert ingest_reference_images(rt) == ["data:image/png;base64,abc"]
    assert should_run_reference_intelligence(rt) is False


def test_compile_analyze_to_dna_lock():
    compiled = compile_reference_intelligence(_ANALYZE)
    assert compiled["analyze"]["composition"]["type"] == "asymmetric_editorial"
    assert compiled["segments"]["hierarchy"]["primary"] == "hero"
    assert compiled["features"]["palette"]["accent"] == ["#D84A32"]
    dna = compiled["dna"]["visual_dna"]
    assert 0.0 <= dna["density"] <= 1.0
    assert dna["density"] == 0.32
    assert dna["asymmetry"] > 0.6
    assert dna["editorial"] > 0.6
    assert dna["decoration"] < 0.3
    assert dna["minimalism"] > 0.6
    lock = compiled["lock"]
    assert "content" in lock["allow"]
    assert "changing core visual language" in lock["forbid"]
    assert lock["composition"]["type"] == "asymmetric_editorial"
    assert "visual_dna" not in lock


def test_llm_dna_overlays_derived_axes():
    compiled = compile_reference_intelligence(
        _ANALYZE, {"visual_dna": {"minimalism": 0.99, "decoration": 0.05}}
    )
    dna = compiled["dna"]["visual_dna"]
    assert dna["minimalism"] == 0.99
    assert dna["decoration"] == 0.05
    assert dna["density"] == 0.32


def test_derive_dna_clamps_density():
    dna = derive_reference_dna({"density": 1.7, "composition": {"type": "center_hero"}})
    axes = dna["visual_dna"]
    assert axes["density"] == 1.0
    assert axes["asymmetry"] < 0.4


def test_merge_fills_p1_without_clobbering_p0():
    compiled = compile_reference_intelligence(_ANALYZE)
    merged = merge_reference_into_brief(
        _P0_BRIEF,
        analyze=compiled["analyze"],
        dna=compiled["dna"],
        lock=compiled["lock"],
    )
    assert merged["visual_thesis"] == "museum relic sword, not game loot"
    assert merged["reference_dna"]["visual_dna"]["density"] == 0.32
    assert merged["reference_lock"]["forbid"]
    assert merged["style_dna"]["density"] == "low"
    hexes = list((merged.get("palette") or {}).get("hex") or [])
    assert "#F3F1EA" in hexes
    kept = merge_reference_into_brief(
        {**_P0_BRIEF, "reference_lock": {"allow": ["content"], "forbid": ["custom"]}},
        analyze=compiled["analyze"],
        dna=compiled["dna"],
        lock=compiled["lock"],
    )
    assert kept["reference_lock"]["forbid"] == ["custom"]


def test_paint_formatter_omits_dna_keeps_lock():
    compiled = compile_reference_intelligence(_ANALYZE)
    brief = merge_reference_into_brief(
        _P0_BRIEF,
        analyze=compiled["analyze"],
        dna=compiled["dna"],
        lock=compiled["lock"],
    )
    review = format_design_brief_for_prompt(brief)
    paint = format_design_brief_for_paint(brief)
    assert "reference_dna" in review
    assert "minimalism" in review
    assert "reference_lock" in paint
    assert "changing core visual language" in paint
    assert "reference_dna" not in paint
    assert "minimalism" not in paint


def test_stash_brief_keeps_dna_on_runtime():
    rt = _rt(images=["data:image/png;base64,abc"])
    compiled = compile_reference_intelligence(_ANALYZE)
    apply_reference_intelligence(rt, compiled)
    text = _stash_design_brief(rt, {"design_brief": _P0_BRIEF}, round_i=0)
    assert text
    assert "minimalism" not in text
    assert "changing core visual language" in text
    stored = rt.design_brief
    assert stored["reference_dna"]["visual_dna"]["editorial"] > 0.6
    assert parse_design_brief(stored)["visual_thesis"] == _P0_BRIEF["visual_thesis"]
