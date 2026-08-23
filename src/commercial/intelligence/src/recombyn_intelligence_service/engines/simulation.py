"""Design simulation (private). Never paints.

Diff vs BasicLocal:
- niche / paint_checks driven attention priors + gates
- swarm final_direction nudges
- poster/seasonal skip blind CTA≥10% gate; use hero coverage gates
- decide_prepaint_directives + private_signals
"""
from __future__ import annotations

import re
from typing import Any

from recombyn_intelligence_service.engines._schemas import parse_design_simulation
from recombyn_intelligence_service.engines.research import _detect_niches

_ATTENTION_KEYS = ("hero", "headline", "cta", "nav", "other")
_CTA_MIN = 0.10
_HERO_MIN_POSTER = 0.55


def _clamp01(n: float) -> float:
    return float(max(0.0, min(1.0, n)))


def _normalize_attention(raw: dict[str, float]) -> dict[str, float]:
    vals = {k: _clamp01(float(raw.get(k) or 0.0)) for k in _ATTENTION_KEYS}
    total = sum(vals.values()) or 1.0
    return {k: round(v / total, 4) for k, v in vals.items()}


def _collect_niches(request: dict[str, Any]) -> list[str]:
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = [str(x) for x in list(strat.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = _detect_niches(str(request.get("prompt") or ""))
    return niches[:4]


def _paint_checks(request: dict[str, Any]) -> list[str]:
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    return [
        str(x)
        for x in list(res.get("paint_checks") or []) + list(strat.get("paint_checks") or [])
        if str(x).strip()
    ][:12]


def simulation_request(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    swarm: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    scene_key: str = "",
) -> dict[str, Any]:
    """Gather inputs for pre-paint simulation."""
    return {
        "prompt": str(prompt or "").strip()[:800],
        "strategy": strategy if isinstance(strategy, dict) else {},
        "swarm": swarm if isinstance(swarm, dict) else {},
        "research": research if isinstance(research, dict) else {},
        "observe_facts": observe_facts if isinstance(observe_facts, dict) else {},
        "scene_key": str(scene_key or "").strip().lower(),
    }


def predict_attention(request: dict[str, Any]) -> dict[str, float]:
    """Predict attention with niche / paint_check / swarm nudges."""
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    facts = (
        request.get("observe_facts")
        if isinstance(request.get("observe_facts"), dict)
        else {}
    )
    swarm = request.get("swarm") if isinstance(request.get("swarm"), dict) else {}
    scene = str(request.get("scene_key") or "")
    prompt = str(request.get("prompt") or "").lower()
    niches = _collect_niches(request)
    checks = [c.lower() for c in _paint_checks(request)]
    cat = str(
        (request.get("research") or {}).get("category")
        or strat.get("category")
        or ""
    ).lower()
    comp = str(strat.get("composition_strategy") or "").lower()
    thesis = str(strat.get("visual_thesis") or "").lower()
    interaction = str(strat.get("interaction_strategy") or "").lower()

    base = {"hero": 0.68, "headline": 0.19, "cta": 0.08, "nav": 0.05, "other": 0.0}
    is_landing = (
        "landing" in scene
        or "website" in scene
        or "landing" in prompt
        or "官网" in prompt
        or "saas" in prompt
        or cat in ("ai_landing", "landing")
        or "ecommerce" in niches
    )
    is_poster = (
        "poster" in scene
        or "海报" in prompt
        or cat == "poster"
        or "seasonal_event" in niches
    )
    is_auth = "auth_ui" in niches or "login" in prompt or "登录" in prompt
    is_type = "type_specimen" in niches
    is_dash = "dashboard" in scene or cat == "dashboard"

    if is_poster:
        base = {"hero": 0.74, "headline": 0.18, "cta": 0.02, "nav": 0.0, "other": 0.06}
    elif is_auth:
        base = {"hero": 0.22, "headline": 0.18, "cta": 0.38, "nav": 0.08, "other": 0.14}
    elif is_type:
        base = {"hero": 0.30, "headline": 0.48, "cta": 0.05, "nav": 0.02, "other": 0.15}
    elif is_dash:
        base = {"hero": 0.35, "headline": 0.15, "cta": 0.25, "nav": 0.15, "other": 0.10}
    elif is_landing:
        base = {"hero": 0.66, "headline": 0.18, "cta": 0.10, "nav": 0.04, "other": 0.02}

    if re.search(
        r"single (product )?focal|hero 60|60[-–]80|product is the hero|museum-grade",
        f"{comp} {thesis}",
    ):
        base["hero"] += 0.04
        base["cta"] -= 0.02
    if "editorial" in comp or "asymmetric" in comp:
        base["headline"] += 0.03
        base["nav"] -= 0.01
    if "cta" in interaction or "decisive" in interaction:
        base["cta"] += 0.03
        base["hero"] -= 0.02

    if any("hero_coverage" in c for c in checks):
        base["hero"] = max(base["hero"], 0.60)
        base["other"] = max(0.0, base["other"] - 0.03)
    if any("ornament" in c for c in checks):
        base["other"] = max(0.0, base["other"] - 0.04)
        base["hero"] += 0.02
    if any("one_primary_cta" in c for c in checks):
        base["cta"] = max(base["cta"], 0.11)
    if any("primary_title" in c for c in checks):
        base["headline"] = max(base["headline"], 0.16)
    if any("form_first" in c for c in checks):
        base["cta"] = max(base["cta"], 0.32)
        base["hero"] = min(base["hero"], 0.28)

    # Swarm final_direction soft nudges.
    for line in list(swarm.get("final_direction") or [])[:10]:
        low = str(line).lower()
        if "hero" in low and ("55" in low or "coverage" in low or "motif" in low):
            base["hero"] += 0.03
            base["other"] -= 0.02
        if "one accent" in low or "anti-category color" in low:
            base["other"] = max(0.0, base["other"] - 0.02)
        if "cta" in low and ("decisive" in low or "buy" in low or "submit" in low):
            base["cta"] += 0.02

    hero_cov = facts.get("hero_coverage")
    if hero_cov is not None:
        try:
            h = _clamp01(float(hero_cov))
            base["hero"] = 0.55 * base["hero"] + 0.45 * h
        except (TypeError, ValueError):
            pass
    white = facts.get("whitespace_ratio")
    if white is not None:
        try:
            w = _clamp01(float(white))
            base["other"] = max(0.0, base["other"] - 0.05 * w)
        except (TypeError, ValueError):
            pass

    return _normalize_attention(base)


def predict_quality_scores(
    request: dict[str, Any],
    attention: dict[str, float],
) -> dict[str, float]:
    """Hierarchy / readability / density / conversion — niche-aware."""
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    facts = (
        request.get("observe_facts")
        if isinstance(request.get("observe_facts"), dict)
        else {}
    )
    niches = _collect_niches(request)
    hero = float(attention.get("hero") or 0.0)
    cta = float(attention.get("cta") or 0.0)
    headline = float(attention.get("headline") or 0.0)

    hierarchy = 55.0 + 30.0 * hero + 10.0 * headline
    if 0.55 <= hero <= 0.80:
        hierarchy += 8.0
    if "type_specimen" in niches:
        hierarchy = 50.0 + 40.0 * headline + 15.0 * hero
    readability = 70.0 + 15.0 * headline - 20.0 * max(0.0, hero - 0.75)
    if facts.get("typography_hierarchy_ok") is False:
        readability -= 12.0
    if "type_specimen" in niches:
        readability += 8.0 * headline
    density = 40.0 + 50.0 * (1.0 - float(facts.get("whitespace_ratio") or 0.35))
    if "empty" in str(strat.get("composition_strategy") or "").lower():
        density -= 8.0
    if "seasonal_event" in niches:
        density -= 4.0  # private bias toward quieter event frames
    conversion = 40.0 + 120.0 * cta + 10.0 * headline
    if "seasonal_event" in niches or str(request.get("scene_key") or "") == "poster":
        # Poster conversion ≠ CTA share; treat hierarchy as proxy.
        conversion = 45.0 + 40.0 * hero + 20.0 * headline
    elif cta < _CTA_MIN:
        conversion -= 15.0
    if "ecommerce" in niches and cta >= 0.10:
        conversion += 6.0

    return {
        "hierarchy": round(max(0.0, min(100.0, hierarchy)), 1),
        "readability": round(max(0.0, min(100.0, readability)), 1),
        "density": round(max(0.0, min(100.0, density)), 1),
        "conversion": round(max(0.0, min(100.0, conversion)), 1),
    }


def evaluate_simulation_gates(
    attention: dict[str, float],
    scores: dict[str, float],
    *,
    request: dict[str, Any] | None = None,
) -> tuple[list[str], list[str], dict[str, float] | None, list[str]]:
    """Gates → warnings + adjustments + decide_prepaint_directives."""
    req = request if isinstance(request, dict) else {}
    niches = _collect_niches(req)
    checks = [c.lower() for c in _paint_checks(req)]
    warnings: list[str] = []
    adjustments: list[str] = []
    directives: list[str] = []
    adjusted: dict[str, float] | None = None
    cta = float(attention.get("cta") or 0.0)
    hero = float(attention.get("hero") or 0.0)
    is_posterish = (
        "seasonal_event" in niches
        or "poster" in str(req.get("scene_key") or "")
        or "type_specimen" in niches
    )

    if is_posterish:
        if hero < _HERO_MIN_POSTER:
            warnings.append(
                f"hero coverage < 55% (predicted {round(hero * 100)}%)"
            )
            adjustments.append("raise hero/motif coverage to ≥55% before paint")
            directives.append("CHECK: hero_coverage>=0.55")
            adj = dict(attention)
            need = _HERO_MIN_POSTER - hero
            take = min(need, float(adj.get("other") or 0.0) + float(adj.get("nav") or 0.0))
            adj["other"] = max(0.0, float(adj.get("other") or 0.0) - take * 0.6)
            adj["nav"] = max(0.0, float(adj.get("nav") or 0.0) - take * 0.4)
            adj["hero"] = float(adj.get("hero") or 0.0) + need
            adjusted = _normalize_attention(adj)
    elif cta < _CTA_MIN:
        warnings.append(f"CTA < 10% (predicted {round(cta * 100)}%)")
        adjustments.append("boost CTA attention to ≥10% before paint")
        directives.append("CHECK: one_primary_cta")
        adj = dict(attention)
        deficit = _CTA_MIN - cta
        take_hero = min(deficit, max(0.0, float(adj.get("hero") or 0.0) - 0.55))
        adj["hero"] = float(adj.get("hero") or 0.0) - take_hero
        remain = deficit - take_hero
        if remain > 0:
            adj["nav"] = max(0.0, float(adj.get("nav") or 0.0) - remain)
        adj["cta"] = float(adj.get("cta") or 0.0) + deficit
        adjusted = _normalize_attention(adj)

    if any("ornament" in c for c in checks) and float(attention.get("other") or 0) > 0.12:
        warnings.append("ornament/other attention high vs paint_checks")
        adjustments.append("cut ornament budget; keep other attention <12%")
        directives.append("CHECK: ornament_area<0.15")

    if float(scores.get("hierarchy") or 0.0) < 70:
        warnings.append("hierarchy prediction < 70")
        adjustments.append("strengthen single focal / headline hierarchy")
        directives.append("COMPOSITION: single focal hierarchy")
    if float(scores.get("density") or 0.0) > 75:
        warnings.append("density prediction high")
        adjustments.append("increase whitespace before paint")
        directives.append("CHECK: whitespace_up")

    # Deduplicate directives.
    seen: set[str] = set()
    uniq_dir: list[str] = []
    for line in directives:
        if line not in seen:
            seen.add(line)
            uniq_dir.append(line)
    return warnings, adjustments, adjusted, uniq_dir[:10]


def run_design_simulation_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    swarm: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    scene_key: str = "",
) -> dict[str, Any]:
    """Full private pre-paint simulation. Never mutates canvas."""
    request = simulation_request(
        prompt=prompt,
        strategy=strategy,
        swarm=swarm,
        research=research,
        observe_facts=observe_facts,
        scene_key=scene_key,
    )
    niches = _collect_niches(request)
    attention = predict_attention(request)
    scores = predict_quality_scores(request, attention)
    warnings, adjustments, attention_adjusted, directives = evaluate_simulation_gates(
        attention, scores, request=request
    )
    summary = (
        f"attention hero={round(attention['hero']*100)}% "
        f"cta={round(attention['cta']*100)}%"
        + (f" · niches={','.join(niches)}" if niches else "")
        + (f" · warnings={len(warnings)}" if warnings else "")
    )
    return parse_design_simulation(
        {
            "attention": attention,
            "hierarchy": scores["hierarchy"],
            "readability": scores["readability"],
            "density": scores["density"],
            "conversion": scores["conversion"],
            "warnings": warnings,
            "adjustments": adjustments,
            "attention_adjusted": attention_adjusted,
            "summary": summary,
            "niches": niches,
            "decide_prepaint_directives": directives,
            "private_signals": {
                "stage": "niche_simulate",
                "provider_tier": "private",
                "niches": niches,
                "paint_checks": _paint_checks(request)[:8],
                "gate_count": len(warnings),
            },
        }
    )
