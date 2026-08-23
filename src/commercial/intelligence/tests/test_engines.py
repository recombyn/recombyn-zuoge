"""Engine smoke tests."""

from __future__ import annotations

from recombyn_intelligence_service.providers import handle_method


def test_research_pipeline_via_provider():
    out = handle_method(
        "research",
        {
            "prompt": "做一个高级科技感 SaaS 官网 landing，不要廉价 AI 味",
            "scene_key": "landing",
            "intent": "design",
            "flags": {},
        },
    )
    assert out.get("provider") == "private-research"
    assert out.get("category")
    assert isinstance(out.get("avoid"), list)


def test_strategy_pipeline_via_provider():
    research = handle_method(
        "research",
        {"prompt": "节日海报，差异化", "scene_key": "poster", "flags": {}},
    )
    out = handle_method(
        "strategy",
        {
            "prompt": "节日海报，差异化",
            "design_research": research,
            "flags": {},
        },
    )
    assert out.get("provider") == "private-strategy"
    assert out.get("visual_thesis") or out.get("positioning")


def test_candidates_tournament_swarm_chain():
    research = handle_method(
        "research",
        {"prompt": "SaaS landing premium", "scene_key": "landing", "flags": {}},
    )
    strategy = handle_method(
        "strategy",
        {"prompt": "SaaS landing premium", "design_research": research, "flags": {}},
    )
    candidates = handle_method(
        "propose_candidates",
        {
            "prompt": "SaaS landing premium",
            "design_research": research,
            "design_strategy": strategy,
            "flags": {},
        },
    )
    assert candidates.get("provider") == "private-candidates"
    assert int(candidates.get("count") or 0) >= 2

    tournament = handle_method(
        "tournament",
        {
            "prompt": "SaaS landing premium",
            "design_research": research,
            "design_candidates": candidates,
            "flags": {},
        },
    )
    assert tournament.get("provider") == "private-tournament"
    assert tournament.get("winner_id")

    swarm = handle_method(
        "swarm_direction",
        {
            "prompt": "SaaS landing premium",
            "design_strategy": strategy,
            "design_tournament": tournament,
            "flags": {},
        },
    )
    assert swarm.get("provider") == "private-swarm"
    assert swarm.get("final_direction") or swarm.get("delegated")


def test_simulate_and_counterfactual():
    strategy = handle_method(
        "strategy",
        {"prompt": "clean product page", "scene_key": "landing", "flags": {}},
    )
    sim = handle_method(
        "simulate",
        {
            "prompt": "clean product page",
            "design_strategy": strategy,
            "scene_key": "landing",
            "flags": {},
        },
    )
    assert sim.get("provider") == "private-simulate"
    assert isinstance(sim.get("attention"), dict)

    cf = handle_method(
        "counterfactual",
        {
            "prompt": "clean product page",
            "design_simulation": sim,
            "flags": {},
        },
    )
    assert cf.get("provider") == "private-counterfactual"
    assert isinstance(cf.get("trials"), list)
    assert cf.get("trials")


def test_governance_pipeline_via_provider():
    out = handle_method(
        "govern",
        {
            "prompt": "clean product page",
            "flags": {},
            "apply_ops": [],
        },
    )
    assert out.get("provider") == "private-governance"
    assert out.get("status") in ("pass", "fail")
    assert isinstance(out.get("lanes"), list)

def test_analyze_reference_pipeline_via_provider():
    out = handle_method(
        "analyze_reference",
        {
            "prompt": "make an editorial SaaS landing from this reference",
            "scene_key": "landing",
            "intent": "design",
            "images": ["https://example.com/ref.png"],
            "flags": {},
        },
    )
    assert out.get("provider") == "private-reference"
    assert isinstance(out.get("analyze"), dict)
    assert isinstance(out.get("dna"), dict)
    assert isinstance((out.get("dna") or {}).get("visual_dna"), dict)
    assert isinstance(out.get("lock"), dict)
    skipped = handle_method(
        "analyze_reference",
        {"prompt": "hi", "intent": "chat", "images": [], "flags": {}},
    )
    assert skipped == {}


def test_plan_and_sync_autonomous():
    plan = handle_method(
        "autonomous_plan",
        {
            "prompt": "I want a premium professional tech-feel brand site landing page.",
            "intent": "design",
            "flags": {},
        },
    )
    assert plan.get("provider") == "private-autonomous"
    assert plan.get("active") is True
    assert plan.get("mode") == "goal"
    hops = plan.get("hops") or []
    assert len(hops) >= 10

    micro = handle_method(
        "autonomous_plan",
        {"prompt": "resize the title and change the color", "intent": "design", "flags": {}},
    )
    assert micro.get("active") is False
    assert micro.get("mode") == "micro_edit"

    synced = handle_method(
        "autonomous_sync",
        {
            "prompt": plan.get("goal") or "",
            "intent": "design",
            "autonomous_art_director": plan,
            "design_research": {"category": "ai_landing", "avoid": ["glow"]},
            "design_strategy": {"visual_thesis": "editorial product"},
            "design_candidates": {"candidates": [{"id": "A"}], "count": 1},
            "design_tournament": {"winner_id": "A"},
            "flags": {},
        },
    )
    assert synced.get("provider") == "private-autonomous"
    assert synced.get("active") is True
    by_id = {h.get("id"): h for h in (synced.get("hops") or []) if isinstance(h, dict)}
    assert by_id.get("research", {}).get("status") == "done"
    assert by_id.get("strategy", {}).get("status") == "done"
    assert by_id.get("final", {}).get("status") == "done"


def test_advanced_hooks_via_provider():
    review = handle_method(
        "review",
        {
            "prompt": "premium SaaS",
            "design_strategy": {
                "anti_category_strategy": ["avoid: glow", "avoid: glass", "avoid: purple"]
            },
            "design_simulation": {
                "warnings": ["CTA < 10%"],
                "adjustments": ["raise CTA"],
            },
            "flags": {},
        },
    )
    assert review.get("provider") == "private-review"
    assert review.get("status") in ("pass", "revise")
    assert isinstance(review.get("score"), int)

    opt = handle_method(
        "optimize",
        {
            "prompt": "premium SaaS",
            "design_simulation": {
                "warnings": ["CTA < 10%"],
                "adjustments": ["raise CTA"],
            },
            "flags": {},
        },
    )
    assert opt.get("provider") == "private-optimize"
    assert opt.get("applied") is False
    assert opt.get("actions")

    mem = handle_method(
        "retrieve_memory",
        {"prompt": "做一个高级科技感官网，要留白", "flags": {}},
    )
    assert mem.get("provider") == "private-memory"
    assert mem.get("notes")
    assert mem.get("store") == "private-taste-kg"

    written = handle_method(
        "write_principle",
        {
            "prompt": "goal",
            "design_strategy": {"visual_thesis": "editorial product"},
            "design_research": {"anti_category_strategy": ["avoid: glow"]},
            "flags": {},
        },
    )
    assert written.get("provider") == "private-principle"
    assert written.get("written") is True
    assert written.get("principles")
    assert written.get("store") == "private-taste-kg"


def test_private_research_richer_than_floor():
    out = handle_method(
        "research",
        {"prompt": "AI landing 不能千篇一律", "scene_key": "website", "flags": {}},
    )
    assert out.get("differentiation_score") is not None
    assert (out.get("private_signals") or {}).get("stage") == "niche_pipeline"

