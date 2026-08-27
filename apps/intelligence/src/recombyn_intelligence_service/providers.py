"""Dispatch Intelligence methods to engines.

Never emit canvas tool_ops from this service.
"""

from __future__ import annotations

from typing import Any

from recombyn_intelligence_service.engines.advanced import (
    run_advanced_review_pipeline,
    run_optimize_pipeline,
    run_retrieve_memory_pipeline,
    run_write_principle_pipeline,
)
from recombyn_intelligence_service.engines.autonomous import (
    plan_autonomous_pipeline,
    sync_autonomous_pipeline,
)
from recombyn_intelligence_service.engines.candidates import (
    run_multi_candidate_pipeline,
)
from recombyn_intelligence_service.engines.counterfactual import (
    run_design_counterfactual_pipeline,
)
from recombyn_intelligence_service.engines.governance import (
    run_design_governance_pipeline,
)
from recombyn_intelligence_service.engines.reference import (
    run_reference_intelligence_pipeline,
)
from recombyn_intelligence_service.engines.research import (
    run_design_research_pipeline,
)
from recombyn_intelligence_service.engines.simulation import (
    run_design_simulation_pipeline,
)
from recombyn_intelligence_service.engines.strategy import (
    run_design_strategy_pipeline,
)
from recombyn_intelligence_service.engines.swarm import run_design_swarm_pipeline
from recombyn_intelligence_service.engines.tournament import (
    run_design_tournament_pipeline,
)


def _dict(val: Any) -> dict[str, Any] | None:
    return val if isinstance(val, dict) else None


def _list(val: Any) -> list[Any]:
    return list(val) if isinstance(val, list) else []


def _force_autonomous(flags: dict[str, Any]) -> bool | None:
    raw = flags.get("force_autonomous")
    if raw is None:
        return None
    return bool(raw)


def handle_method(method: str, body: dict[str, Any]) -> dict[str, Any]:
    name = str(method or "").strip()
    prompt = str(body.get("prompt") or "").strip()
    scene = str(body.get("scene_key") or "").strip()
    intent = str(body.get("intent") or "").strip()
    flags = _dict(body.get("flags")) or {}

    research = _dict(body.get("design_research")) or {}
    strategy = _dict(body.get("design_strategy")) or {}
    brief = _dict(body.get("design_brief"))
    candidates = _dict(body.get("design_candidates")) or {}
    tournament = _dict(body.get("design_tournament")) or {}
    swarm = _dict(body.get("design_swarm")) or {}
    simulation = _dict(body.get("design_simulation")) or {}
    observe = _dict(body.get("observe_facts"))
    reference_dna = _dict(body.get("reference_dna"))
    reference_analyze = _dict(body.get("reference_analyze"))
    reference_lock = _dict(body.get("reference_lock"))
    governance = _dict(body.get("design_governance"))
    counterfactual = _dict(body.get("design_counterfactual"))
    autonomous_prior = _dict(body.get("autonomous_art_director"))
    images = [
        str(x).strip()
        for x in _list(body.get("images"))
        if str(x).strip()
    ]
    painted = bool(body.get("painted"))
    knowledge_written = bool(body.get("knowledge_written"))

    if name == "research":
        report = run_design_research_pipeline(
            prompt=prompt,
            scene_key=scene,
            reference_dna=reference_dna,
            reference_analyze=reference_analyze,
            eval_patterns=_list(body.get("eval_patterns")),
            memory_notes=[
                str(x)
                for x in _list(body.get("memory_notes"))
            ],
        )
        report["provider"] = "private-research"
        return report

    if name == "strategy":
        out = run_design_strategy_pipeline(
            prompt=prompt,
            research=research,
            brief=brief,
        )
        out["provider"] = "private-strategy"
        return out

    if name == "propose_candidates":
        strat = strategy
        if not strat:
            strat = run_design_strategy_pipeline(
                prompt=prompt, research=research, brief=brief
            )
        out = run_multi_candidate_pipeline(
            strategy=strat,
            research=research or None,
            prompt=prompt,
            primary_id=str(body.get("primary_id") or ""),
        )
        out["provider"] = "private-candidates"
        return out

    if name == "tournament":
        bundle = candidates
        if not bundle.get("candidates"):
            strat = strategy or run_design_strategy_pipeline(
                prompt=prompt, research=research, brief=brief
            )
            bundle = run_multi_candidate_pipeline(
                strategy=strat, research=research or None, prompt=prompt
            )
        out = run_design_tournament_pipeline(
            candidates_bundle=bundle,
            research=research or None,
            strategy=strategy or None,
            prompt=prompt,
            user_pick=str(body.get("user_pick") or ""),
        )
        out["provider"] = "private-tournament"
        return out

    if name == "swarm_direction":
        strat = strategy
        tour = tournament
        if not strat:
            strat = run_design_strategy_pipeline(
                prompt=prompt, research=research, brief=brief
            )
        out = run_design_swarm_pipeline(
            prompt=prompt,
            strategy=strat,
            tournament=tour or None,
            research=research or None,
        )
        out["provider"] = "private-swarm"
        return out

    if name == "simulate":
        strat = strategy
        sw = swarm
        if not strat:
            strat = run_design_strategy_pipeline(
                prompt=prompt, research=research, brief=brief
            )
        out = run_design_simulation_pipeline(
            prompt=prompt,
            strategy=strat,
            swarm=sw or None,
            research=research or None,
            observe_facts=observe,
            scene_key=scene,
        )
        out["provider"] = "private-simulate"
        return out

    if name == "counterfactual":
        out = run_design_counterfactual_pipeline(
            observe_facts=observe,
            visual_snapshot=_dict(body.get("visual_snapshot")),
            simulation=simulation or None,
            research=research or None,
            strategy=strategy or None,
            prompt=prompt,
            selected_id=str(body.get("selected_id") or ""),
            hypotheses=_list(body.get("hypotheses")) or None,
        )
        out["provider"] = "private-counterfactual"
        return out

    if name == "govern":
        result = run_design_governance_pipeline(
            brief=brief,
            observe_facts=observe,
            strategy=strategy or None,
            reference_lock=reference_lock,
            visual_diff=_dict(body.get("visual_diff")),
            prompt=prompt,
            apply_ops=_list(body.get("apply_ops")),
            flags=flags,
        )
        result["provider"] = "private-governance"
        return result

    if name == "analyze_reference":
        compiled = run_reference_intelligence_pipeline(
            images=images,
            prompt=prompt,
            scene_key=scene,
            intent=intent,
            reference_dna=reference_dna,
            reference_analyze=reference_analyze,
            visual_dna=_dict(body.get("visual_dna")),
        )
        if not compiled:
            return {}
        compiled["provider"] = "private-reference"
        return compiled

    if name == "autonomous_plan":
        plan = plan_autonomous_pipeline(
            prompt=prompt,
            intent=intent,
            force_autonomous=_force_autonomous(flags),
        )
        plan["provider"] = "private-autonomous"
        return plan

    if name == "autonomous_sync":
        synced = sync_autonomous_pipeline(
            prior=autonomous_prior,
            prompt=prompt,
            intent=intent,
            design_research=research or None,
            design_strategy=strategy or None,
            design_candidates=candidates or None,
            design_tournament=tournament or None,
            design_swarm=swarm or None,
            design_simulation=simulation or None,
            design_counterfactual=counterfactual,
            design_governance=governance,
            reference_dna=reference_dna,
            reference_analyze=reference_analyze,
            design_brief=brief,
            observe_facts=observe,
            painted=painted,
            knowledge_written=knowledge_written,
            judge_verdict=_dict(body.get("judge_verdict")),
            optimization=body.get("optimization"),
        )
        if not synced:
            return {}
        synced["provider"] = "private-autonomous"
        return synced

    if name == "review":
        out = run_advanced_review_pipeline(
            prompt=prompt,
            strategy=strategy or None,
            simulation=simulation or None,
            observe_facts=observe,
            judge_verdict=_dict(body.get("judge_verdict")),
            flags=flags,
        )
        return out

    if name == "optimize":
        out = run_optimize_pipeline(
            prompt=prompt,
            strategy=strategy or None,
            simulation=simulation or None,
            counterfactual=counterfactual,
            flags=flags,
        )
        return out

    if name == "retrieve_memory":
        out = run_retrieve_memory_pipeline(
            prompt=prompt,
            scene_key=scene,
            memory_notes=[
                str(x)
                for x in _list(body.get("memory_notes"))
            ],
            flags=flags,
            research=research or None,
        )
        return out

    if name == "write_principle":
        out = run_write_principle_pipeline(
            prompt=prompt,
            scene_key=scene,
            strategy=strategy or None,
            research=research or None,
            governance=governance,
            flags=flags,
        )
        return out

    return {}
