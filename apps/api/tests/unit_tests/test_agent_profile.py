"""AgentProfile — load YAML, Voice pack keys, P1 policy overlay."""

from __future__ import annotations

import pytest

from app.services.design.runtime.agent_profile import (
    apply_profile_rules,
    clear_agent_profile_cache,
    get_active_agent_profile,
    load_agent_profile,
    resolve_profile_id,
)
from app.services.design.runtime.host.prompts import (
    assemble_stage_system,
)
from app.services.design.runtime.models_route import (
    parse_fallback_chain,
    parse_model_lanes,
    resolve_review_model,
    router_model_id,
)


@pytest.fixture(autouse=True)
def _clear_profile_cache():
    clear_agent_profile_cache()
    yield
    clear_agent_profile_cache()


def test_load_design_canvas_profile():
    prof = load_agent_profile("design.canvas")
    assert prof.id == "design.canvas"
    assert prof.version == 1
    assert prof.persona_auto == "agent.persona.auto"
    assert prof.persona_locked == "agent.persona.locked"
    assert prof.overlay_ask == "agent.prompt.ask_system"
    assert prof.overlay_agent == "agent.prompt.agent_system"
    assert prof.stage_protocol("decide") == "agent.prompt.need_tools_overlay"
    assert prof.stage_protocol("paint") == "agent.prompt.paint_system"
    assert prof.stage_protocol("review") == "agent.prompt.review_system"
    assert prof.stage_uses_mode_overlay("decide") is True
    assert prof.stage_uses_mode_overlay("paint") is True
    assert prof.stage_uses_mode_overlay("review") is False
    assert prof.intent_prompt == "agent.prompt.intent_classify"
    assert prof.runtime_flags.get("defer_tools") is True
    assert prof.runtime_flags.get("critique_enabled") is True
    assert "precheck.model_threshold" in prof.policy_patches
    assert "agent.react.defer_tools" in prof.policy_patches
    assert prof.primary_role() is not None
    assert prof.primary_role().id == "design"
    assert "decide" in prof.primary_role().stages
    rev = prof.role_for_stage("review")
    assert rev is not None
    assert rev.kind == "specialist"
    assert rev.isolation == "forked_context"
    assert rev.subagent_id == "review"
    assert prof.get_subagent("review") is not None
    assert prof.skills_namespaces == ("core", "ext", "user")


def test_resolve_default_profile_id():
    assert resolve_profile_id() == "design.canvas"
    assert resolve_profile_id(explicit="design.canvas") == "design.canvas"


def test_active_profile_cached():
    a = get_active_agent_profile()
    b = get_active_agent_profile()
    assert a is b
    assert a.id == "design.canvas"


def test_assemble_stage_uses_profile_keys(monkeypatch):
    seen: list[str] = []

    def fake_require(rules, key, **variables):
        seen.append(key)
        return f"BODY:{key}"

    monkeypatch.setattr(
        "app.services.design.runtime.host.prompts.require_prompt_pack",
        fake_require,
    )
    out = assemble_stage_system({}, stage="decide", ask_mode=False, persona="")
    assert "BODY:agent.prompt.need_tools_overlay" in out
    assert "BODY:agent.prompt.agent_system" in out
    assert seen[0] == "agent.prompt.need_tools_overlay"

    seen.clear()
    out_ask = assemble_stage_system({}, stage="paint", ask_mode=True, persona="")
    assert "BODY:agent.prompt.paint_system" in out_ask
    assert "BODY:agent.prompt.ask_system" in out_ask

    seen.clear()
    out_rev = assemble_stage_system({}, stage="review", ask_mode=False, persona="")
    assert "BODY:agent.prompt.review_system" in out_rev
    assert "agent.prompt.agent_system" not in out_rev
    assert "agent.prompt.ask_system" not in out_rev


def test_unknown_stage_raises():
    with pytest.raises(ValueError, match="unknown"):
        assemble_stage_system({}, stage="nope", ask_mode=False)


def test_mode_overlay_keys():
    prof = load_agent_profile("design.canvas")
    assert prof.mode_overlay_key(ask_mode=True) == "agent.prompt.ask_system"
    assert prof.mode_overlay_key(ask_mode=False) == "agent.prompt.agent_system"


def test_apply_profile_rules_kv_passthrough():
    base = {
        "precheck.model_threshold": "fast->a;standard->b;reasoning->c",
        "precheck.router_model": "router-x",
        "agent.review.model": "review-y",
        "precheck.fallback_chain": "c,b,a",
        "precheck.vision_model": "vision-z",
        "assets.image_default_model": "image-w",
        "memory.dialogue.recent_turns": "4",
        "agent.attach.max_images": "4",
        "agent.react.defer_tools": "0",
    }
    out = apply_profile_rules(base)
    assert out["precheck.model_threshold"] == base["precheck.model_threshold"]
    assert out["precheck.router_model"] == "router-x"
    assert out["agent.review.model"] == "review-y"
    # Declared flags in profile force values (design.canvas defer_tools: true).
    assert out["agent.react.defer_tools"] == "1"
    assert out["design.critique.enabled"] == "1"
    assert parse_model_lanes(out)["fast"] == "a"
    assert router_model_id(out) == "router-x"
    assert resolve_review_model(out)[0] == "review-y"
    assert parse_fallback_chain(out) == ["c", "b", "a"]


def test_apply_profile_rules_literal_lanes_override():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "literal.route",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "routing": {
            "lanes": {
                "fast": "model-fast",
                "standard": "model-std",
                "reasoning": "model-reason",
            },
            "router_model": "model-router",
            "stage_pins": {"review": "model-review"},
            "fallback": ["model-reason", "model-std"],
        },
        "runtime": {"flags": {"defer_tools": False, "critique_enabled": False}},
    }
    prof = ap._profile_from_dict(raw, source="test")
    base = {"precheck.model_threshold": "fast->old;standard->old"}
    out = apply_profile_rules(base, profile=prof)
    lanes = parse_model_lanes(out)
    assert lanes["fast"] == "model-fast"
    assert lanes["standard"] == "model-std"
    assert out["precheck.router_model"] == "model-router"
    assert out["agent.review.model"] == "model-review"
    assert out["agent.react.defer_tools"] == "0"
    assert out["design.critique.enabled"] == "0"
    assert prof.critique_enabled() is False


def test_topology_from_design_canvas():
    prof = load_agent_profile("design.canvas")
    assert prof.topology_template == "canvas_ops_v1"
    assert "intent" in prof.stages_enabled
    assert "decide" in prof.stages_enabled
    assert "paint" in prof.stages_enabled
    assert "observe" in prof.stages_enabled
    assert any(loop[0] == "review" for loop in prof.topology_loops)


def test_validate_and_resolve_canvas_ops_template():
    from app.services.design.runtime.graph.build import (
        invalidate_agent_graph_cache,
        list_topology_templates,
        resolve_topology_graph,
        validate_profile_topology,
    )

    invalidate_agent_graph_cache()
    prof = load_agent_profile("design.canvas")
    validate_profile_topology(prof)
    assert "canvas_ops_v1" in list_topology_templates()
    g1 = resolve_topology_graph(prof)
    g2 = resolve_topology_graph(prof)
    assert g1 is g2
    nodes = set(getattr(g1, "nodes", {}) or {})
    assert "review" in nodes
    assert "observe" in nodes
    assert "paint_ops" in nodes
    invalidate_agent_graph_cache()


def test_should_route_to_review_follows_profile(monkeypatch):
    from app.services.design.runtime.graph.nodes import observe as obs

    class _P:
        stages_enabled = ("intent", "decide", "paint", "observe", "review")
        runtime_flags = {"review_mode": "always"}

    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.get_active_agent_profile",
        lambda: _P(),
    )
    monkeypatch.setattr(
        "app.core.config.settings.design_review_agent_enabled",
        True,
        raising=False,
    )
    # always + review stage → route (clean design prompt, non-lean length)
    rt = type(
        "RT",
        (),
        {
            "classified_intent": "design",
            "prompt": (
                "Design a complete multi-section marketing landing page with nav, hero, "
                "three feature blocks, testimonials, pricing table, FAQ, and footer."
            ),
            "images": None,
            "flags": {},
            "run": None,
            "paint_ops": [],
            "rules": {"design.review.mode": "always"},
        },
    )()
    assert obs._should_route_to_review(rt) is True

    class _NoReview:
        stages_enabled = ("intent", "decide", "paint", "observe")
        runtime_flags = {"review_mode": "always"}

    monkeypatch.setattr(
        "app.services.design.runtime.agent_profile.get_active_agent_profile",
        lambda: _NoReview(),
    )
    assert obs._should_route_to_review(rt) is False


def test_profile_review_mode_string_flag():
    from app.services.design.runtime.agent_profile import _policy_from_runtime

    patches, flags = _policy_from_runtime({"flags": {"review_mode": "auto", "critique_enabled": True}})
    assert flags.get("review_mode") == "auto"
    assert patches.get("design.review.mode") == "auto"
    assert flags.get("critique_enabled") is True
    assert patches.get("design.critique.enabled") == "1"


def test_unknown_topology_template_fails():
    from app.services.design.runtime import agent_profile as ap
    from app.services.design.runtime.graph.build import validate_profile_topology

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.topo",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "topology": {
            "template": "not_a_real_template",
            "stages_enabled": ["intent", "decide", "paint", "observe"],
        },
    }
    prof = ap._profile_from_dict(raw, source="test")
    with pytest.raises(ValueError, match="unknown topology template"):
        validate_profile_topology(prof)


def test_missing_required_stage_fails():
    from app.services.design.runtime import agent_profile as ap
    from app.services.design.runtime.graph.build import validate_profile_topology

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.stages",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "topology": {
            "template": "canvas_ops_v1",
            "stages_enabled": ["intent", "decide"],
        },
    }
    prof = ap._profile_from_dict(raw, source="test")
    with pytest.raises(ValueError, match="missing required stages"):
        validate_profile_topology(prof)


def test_contracts_and_tool_host_from_design_canvas():
    from app.services.design.runtime.agent_profile import (
        resolve_contract_schema,
        resolve_tool_host,
        validate_profile_surface,
    )
    from app.services.design.runtime.graph.state import (
        DecideTurnSchema,
        PaintOpsSchema,
        ReviewTurnSchema,
    )
    from app.services.design.runtime.models_route import IntentClassifyDecision

    prof = load_agent_profile("design.canvas")
    assert prof.contracts["decide"] == "DecideTurn.v1"
    assert prof.contracts["act"] == "ToolOpsBatch.v1"
    assert prof.tools_host == "canvas_fe"
    assert prof.tools_catalog == "canvas_actions"
    validate_profile_surface(prof)
    assert resolve_contract_schema("intent", profile=prof) is IntentClassifyDecision
    assert resolve_contract_schema("decide", profile=prof) is DecideTurnSchema
    assert resolve_contract_schema("act", profile=prof) is PaintOpsSchema
    assert resolve_contract_schema("review", profile=prof) is ReviewTurnSchema
    host = resolve_tool_host(profile=prof)
    assert host.id == "canvas_fe"
    assert callable(host.format_catalog)
    assert callable(host.validate_ops)


def test_unknown_contract_schema_fails():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.contract",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "contracts": {"decide": {"schema": "NoSuchSchema.v9"}},
    }
    prof = ap._profile_from_dict(raw, source="test")
    with pytest.raises(ValueError, match="unknown contract schema"):
        ap.validate_profile_surface(prof)


def test_unknown_tool_host_fails():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.host",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "capabilities": {"tools": {"host": "crm_api", "catalog": "crm_tools"}},
    }
    prof = ap._profile_from_dict(raw, source="test")
    with pytest.raises(ValueError, match="unknown tools.host"):
        ap.resolve_tool_host(profile=prof)


def test_roles_reject_unlive_isolation():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.iso",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                }
            }
        },
        "topology": {
            "template": "canvas_ops_v1",
            "stages_enabled": ["decide", "paint"],
        },
        "roles": {
            "primary": {
                "id": "design",
                "stages": ["decide", "paint"],
                "isolation": "os_subprocess",
            }
        },
    }
    with pytest.raises(ValueError, match="isolation"):
        ap._profile_from_dict(raw, source="test")


def test_forked_role_requires_subagent_catalog():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "bad.fork",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                    "review": {"protocol": "z", "mode_overlay": False},
                }
            }
        },
        "topology": {
            "template": "canvas_ops_v1",
            "stages_enabled": ["decide", "paint", "review"],
        },
        "roles": {
            "primary": {"id": "design", "stages": ["decide", "paint"]},
            "specialists": [
                {
                    "id": "review",
                    "stages": ["review"],
                    "isolation": "forked_context",
                    "subagent": "review",
                }
            ],
        },
    }
    with pytest.raises(ValueError, match="subagents.review"):
        ap._profile_from_dict(raw, source="test")


def test_design_canvas_review_is_forked_subagent():
    prof = load_agent_profile("design.canvas")
    role = prof.role_for_stage("review")
    assert role is not None
    assert role.isolation == "forked_context"
    assert role.subagent_id == "review"
    sa = prof.get_subagent("review")
    assert sa is not None
    assert sa.isolation == "forked_context"
    assert sa.stage == "review"
    assert sa.model_ref.startswith("$kv:")
    assert prof.subagent_for_stage("review") is sa


def test_design_canvas_subagent_catalog_is_review_only():
    from app.services.design.runtime.agent_profile import (
        ensure_contract_registry,
        validate_profile_surface,
    )
    from app.services.design.runtime.subagent import format_subagents_catalog

    prof = load_agent_profile("design.canvas")
    assert prof.get_subagent("vision_scout") is None
    assert prof.get_subagent("research") is None
    review = prof.get_subagent("review")
    assert review is not None
    assert review.isolation == "forked_context"
    assert review.contract == "ReviewTurn.v1"
    reg = ensure_contract_registry()
    assert "ReviewTurn.v1" in reg
    assert prof.contracts.get("review") == "ReviewTurn.v1"
    assert prof.stage_protocol("review") == "agent.prompt.review_system"
    validate_profile_surface(prof)
    cat = format_subagents_catalog(prof)
    assert "review" in cat
    assert "vision_scout" not in cat
    assert "research" not in cat
    assert "need_subagents" in cat


def test_resolve_subagent_model_kv():
    from app.services.design.runtime.subagent import resolve_subagent_model

    rules = {"agent.review.model": "review-model-x"}
    assert resolve_subagent_model("$kv:agent.review.model", rules) == "review-model-x"
    assert resolve_subagent_model("literal-m", rules) == "literal-m"


def test_roles_inferred_when_omitted():
    from app.services.design.runtime import agent_profile as ap

    raw = {
        "apiVersion": "recombyn.agent/v1",
        "kind": "AgentProfile",
        "id": "infer.roles",
        "identity": {
            "prompts": {
                "stages": {
                    "decide": {"protocol": "x"},
                    "paint": {"protocol": "y"},
                    "review": {"protocol": "z", "mode_overlay": False},
                }
            }
        },
        "topology": {
            "template": "canvas_ops_v1",
            "stages_enabled": ["decide", "paint", "review"],
        },
    }
    prof = ap._profile_from_dict(raw, source="test")
    assert prof.primary_role() is not None
    assert "review" not in prof.primary_role().stages
    assert prof.role_for_stage("review") is not None
