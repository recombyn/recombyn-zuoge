"""Wire-contract tests against recombyn-protocol."""

from __future__ import annotations

from recombyn_protocol.intelligence import (
    INTELLIGENCE_METHODS,
    INTELLIGENCE_REQUEST_FIELDS,
    intelligence_wire_methods,
    remote_result_usable,
)

from recombyn_intelligence_service.app import _METHODS
from recombyn_intelligence_service.providers import handle_method


def _minimal_body() -> dict:
    return {
        "prompt": "SaaS landing premium, no purple glow",
        "scene_key": "landing",
        "intent": "design",
        "flags": {},
        "images": ["https://example.invalid/ref.png"],
        "painted": False,
        "memory_notes": [],
        "eval_patterns": [],
        "design_research": {
            "category": "ai_landing",
            "avoid": ["purple gradient"],
            "anti_category_strategy": ["avoid: glow orbs"],
        },
        "design_strategy": {
            "visual_thesis": "editorial product metaphor",
            "positioning": "premium",
        },
        "design_candidates": {"count": 2, "candidates": [{"id": "a"}, {"id": "b"}]},
        "design_tournament": {"winner_id": "a", "summary": "a wins"},
        "design_swarm": {"direction": "editorial"},
        "design_simulation": {"warnings": [], "adjustments": ["raise CTA"]},
        "design_counterfactual": {
            "repair_plan_draft": {"actions": [{"summary": "cut secondary"}]}
        },
        "design_governance": {"status": "pass", "explain": []},
        "observe_facts": {"hero_coverage": 0.7},
        "judge_verdict": {"score": 82, "status": "pass"},
    }


def test_protocol_version_floor():
    import recombyn_protocol

    # Package may expose __version__ via importlib metadata instead.
    from importlib.metadata import version

    ver = version("recombyn-protocol")
    parts = [int(x) for x in ver.split(".")[:3]]
    assert parts >= [0, 1, 3], f"need recombyn-protocol>=0.1.3, got {ver}"
    assert recombyn_protocol is not None


def test_http_surface_matches_protocol_wire_set():
    assert _METHODS == intelligence_wire_methods()
    for name in INTELLIGENCE_METHODS:
        assert name in _METHODS


def test_request_field_contract_documented():
    # Keep the documented request keys stable — Private may ignore extras.
    required = {
        "prompt",
        "scene_key",
        "flags",
        "design_research",
        "design_strategy",
        "memory_notes",
    }
    assert required.issubset(set(INTELLIGENCE_REQUEST_FIELDS))


def test_every_canonical_method_returns_usable_payload():
    body = _minimal_body()
    # Seed candidate/tournament/autonomous chain fields used by later methods.
    body["design_candidates"] = handle_method("propose_candidates", body)
    body["design_tournament"] = handle_method("tournament", body)
    body["design_swarm"] = handle_method("swarm_direction", body)
    body["design_simulation"] = handle_method("simulate", body)
    body["design_counterfactual"] = handle_method("counterfactual", body)
    body["autonomous_art_director"] = handle_method("autonomous_plan", body)

    for method in INTELLIGENCE_METHODS:
        out = handle_method(method, body)
        assert isinstance(out, dict), method
        assert remote_result_usable(method, out), (
            f"{method} returned unusable payload (host would use local fallback): {out!r}"
        )
        # Never paint canvas ops from this service.
        assert "tool_ops" not in out
        assert not out.get("apply_ops")
        # Keep sync prior fresh when plan is re-run in the loop.
        if method == "autonomous_plan" and out.get("active"):
            body["autonomous_art_director"] = out


def test_analyze_reference_skip_without_images_is_empty_ok():
    """No images → {} is intentional; host uses local fallback."""
    out = handle_method(
        "analyze_reference",
        {"prompt": "x", "scene_key": "landing", "intent": "design", "images": []},
    )
    assert out == {}
    assert not remote_result_usable("analyze_reference", out)

