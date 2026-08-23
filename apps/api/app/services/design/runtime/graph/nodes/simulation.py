"""Design Simulation (P37) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.simulate → BasicLocal → here.

Community floor: deterministic attention / quality prediction + CTA gate.
Numeric contracts are frozen (tests lock hero/cta shares). Do not “simplify”
formulas here — richer simulation lives behind Remote → private Intelligence.

Read-only. Never mutates SceneDocument / tool_ops.
"""
from __future__ import annotations

import re
from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    parse_design_simulation,
)
from app.services.design.runtime.graph.emit_sse import _emit

_ATTENTION_KEYS = ("hero", "headline", "cta", "nav", "other")
_CTA_MIN = 0.10


def _clamp01(n: float) -> float:
    return float(max(0.0, min(1.0, n)))


def _normalize_attention(raw: dict[str, float]) -> dict[str, float]:
    vals = {k: _clamp01(float(raw.get(k) or 0.0)) for k in _ATTENTION_KEYS}
    total = sum(vals.values()) or 1.0
    return {k: round(v / total, 4) for k, v in vals.items()}


def simulation_request(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    swarm: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    scene_key: str = "",
) -> dict[str, Any]:
    """Gather inputs for pre-paint simulation."""
    return {
        "prompt": str(prompt or "").strip()[:800],
        "strategy": strategy if isinstance(strategy, dict) else {},
        "swarm": swarm if isinstance(swarm, dict) else {},
        "observe_facts": observe_facts if isinstance(observe_facts, dict) else {},
        "scene_key": str(scene_key or "").strip().lower(),
    }


def predict_attention(request: dict[str, Any]) -> dict[str, float]:
    """Predict attention budget from Strategy / Observe (landing-style default)."""
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    facts = (
        request.get("observe_facts")
        if isinstance(request.get("observe_facts"), dict)
        else {}
    )
    scene = str(request.get("scene_key") or "")
    prompt = str(request.get("prompt") or "").lower()
    del prompt  # attention priors use scene/strategy — never prompt keywords
    comp = str(strat.get("composition_strategy") or "").lower()
    thesis = str(strat.get("visual_thesis") or "").lower()
    interaction = str(strat.get("interaction_strategy") or "").lower()

    # Spec landing example baseline: Hero 68 / Headline 19 / CTA 8 / Nav 5.
    base = {"hero": 0.68, "headline": 0.19, "cta": 0.08, "nav": 0.05, "other": 0.0}
    is_landing = "landing" in scene or "website" in scene or "mobile" in scene
    is_poster = "poster" in scene
    if is_poster:
        base = {"hero": 0.72, "headline": 0.18, "cta": 0.02, "nav": 0.0, "other": 0.08}
    elif not is_landing and "dashboard" in scene:
        base = {"hero": 0.35, "headline": 0.15, "cta": 0.25, "nav": 0.15, "other": 0.10}

    # Strong focal cues only — avoid nudging the landing baseline on any "hero" mention.
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

    # Blend Observe facts when canvas already exists (still prediction layer).
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
            # More whitespace → slightly less "other" clutter attention.
            base["other"] = max(0.0, base["other"] - 0.05 * w)
        except (TypeError, ValueError):
            pass

    return _normalize_attention(base)


def predict_quality_scores(
    request: dict[str, Any],
    attention: dict[str, float],
) -> dict[str, float]:
    """Hierarchy / readability / density / conversion — 0–100, Runtime-owned."""
    strat = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    facts = (
        request.get("observe_facts")
        if isinstance(request.get("observe_facts"), dict)
        else {}
    )
    hero = float(attention.get("hero") or 0.0)
    cta = float(attention.get("cta") or 0.0)
    headline = float(attention.get("headline") or 0.0)

    hierarchy = 55.0 + 30.0 * hero + 10.0 * headline
    if 0.55 <= hero <= 0.80:
        hierarchy += 8.0
    readability = 70.0 + 15.0 * headline - 20.0 * max(0.0, hero - 0.75)
    if facts.get("typography_hierarchy_ok") is False:
        readability -= 12.0
    density = 40.0 + 50.0 * (1.0 - float(facts.get("whitespace_ratio") or 0.35))
    if "empty" in str(strat.get("composition_strategy") or "").lower():
        density -= 8.0
    conversion = 40.0 + 120.0 * cta + 10.0 * headline
    if cta < _CTA_MIN:
        conversion -= 15.0

    return {
        "hierarchy": round(max(0.0, min(100.0, hierarchy)), 1),
        "readability": round(max(0.0, min(100.0, readability)), 1),
        "density": round(max(0.0, min(100.0, density)), 1),
        "conversion": round(max(0.0, min(100.0, conversion)), 1),
    }


def evaluate_simulation_gates(
    attention: dict[str, float],
    scores: dict[str, float],
) -> tuple[list[str], list[str], dict[str, float] | None]:
    """CTA < 10% etc. → warnings + pre-paint adjustments (not canvas ops)."""
    warnings: list[str] = []
    adjustments: list[str] = []
    adjusted: dict[str, float] | None = None
    cta = float(attention.get("cta") or 0.0)
    if cta < _CTA_MIN:
        warnings.append(f"CTA < 10% (predicted {round(cta * 100)}%)")
        adjustments.append("boost CTA attention to ≥10% before paint")
        adj = dict(attention)
        deficit = _CTA_MIN - cta
        take_hero = min(deficit, max(0.0, float(adj.get("hero") or 0.0) - 0.55))
        adj["hero"] = float(adj.get("hero") or 0.0) - take_hero
        remain = deficit - take_hero
        if remain > 0:
            adj["nav"] = max(0.0, float(adj.get("nav") or 0.0) - remain)
        adj["cta"] = float(adj.get("cta") or 0.0) + deficit
        adjusted = _normalize_attention(adj)
    if float(scores.get("hierarchy") or 0.0) < 70:
        warnings.append("hierarchy prediction < 70")
        adjustments.append("strengthen single focal / headline hierarchy")
    if float(scores.get("density") or 0.0) > 75:
        warnings.append("density prediction high")
        adjustments.append("increase whitespace before paint")
    return warnings, adjustments, adjusted


def run_design_simulation_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    swarm: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    scene_key: str = "",
) -> dict[str, Any]:
    """Full pre-paint simulation. Never mutates canvas."""
    request = simulation_request(
        prompt=prompt,
        strategy=strategy,
        swarm=swarm,
        observe_facts=observe_facts,
        scene_key=scene_key,
    )
    attention = predict_attention(request)
    scores = predict_quality_scores(request, attention)
    warnings, adjustments, attention_adjusted = evaluate_simulation_gates(
        attention, scores
    )
    summary = (
        f"attention hero={round(attention['hero']*100)}% "
        f"cta={round(attention['cta']*100)}%"
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
            "provider": "basic-local",
        }
    )


def should_run_design_simulation(rt: AgentRuntime) -> bool:
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    if getattr(rt, "design_strategy", None) or getattr(rt, "design_swarm", None):
        return True
    return False


def apply_simulation_to_runtime(rt: AgentRuntime, result: dict[str, Any]) -> None:
    """Stash simulation; push adjustments into Brief — never tool_ops."""
    clean = parse_design_simulation(result)
    rt.design_simulation = clean
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    if not isinstance(brief, dict):
        return
    adjustments = list(clean.get("adjustments") or [])
    if adjustments:
        notes = list(brief.get("simulation_adjustments") or [])
        for line in adjustments:
            text = str(line).strip()
            if text and text not in notes:
                notes.append(text)
        brief["simulation_adjustments"] = notes[:8]
    # CTA gate → interaction_strategy hint on nested design_strategy if present.
    if any("CTA" in str(w) for w in list(clean.get("warnings") or [])):
        ds = brief.get("design_strategy")
        if isinstance(ds, dict) and not str(ds.get("interaction_strategy") or "").strip():
            ds["interaction_strategy"] = "one decisive CTA with ≥10% attention budget"
            brief["design_strategy"] = ds
        avoid = list(brief.get("avoid") or [])
        tip = "CTA attention below 10%"
        if tip not in avoid:
            avoid.append(tip)
        brief["avoid"] = avoid[:12]
    rt.design_brief = brief


def format_simulation_for_decide(result: dict[str, Any] | None) -> str:
    src = result if isinstance(result, dict) else {}
    att = src.get("attention") if isinstance(src.get("attention"), dict) else {}
    if not att and not src.get("summary"):
        return ""
    lines = [
        "DESIGN_SIMULATION (host-owned, pre-paint). Read-only — does not mutate canvas.",
        "Predicted Attention:",
    ]
    for key in _ATTENTION_KEYS:
        if key == "other" and float(att.get(key) or 0) <= 0:
            continue
        lines.append(f"- {key}: {round(float(att.get(key) or 0) * 100)}%")
    lines.append(
        f"Hierarchy={src.get('hierarchy')} Readability={src.get('readability')} "
        f"Density={src.get('density')} Conversion={src.get('conversion')}"
    )
    for w in list(src.get("warnings") or [])[:6]:
        lines.append(f"WARNING: {w}")
    for a in list(src.get("adjustments") or [])[:6]:
        lines.append(f"ADJUST: {a}")
    adj = src.get("attention_adjusted")
    if isinstance(adj, dict) and adj:
        lines.append(
            "Attention after adjust: "
            + ", ".join(
                f"{k}={round(float(adj.get(k) or 0)*100)}%"
                for k in _ATTENTION_KEYS
                if k != "other" or float(adj.get(k) or 0) > 0
            )
        )
    return "\n".join(lines)[:1600]


async def run_design_simulation(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute pre-paint simulation. Fail-open."""
    if not should_run_design_simulation(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-simulation",
            "kind": "explored",
            "status": "running",
            "summary": "DESIGN_SIMULATION: predict attention / hierarchy before paint",
        }
    )
    try:
        strategy = getattr(rt, "design_strategy", None)
        swarm = getattr(rt, "design_swarm", None)
        observe = getattr(rt, "observe_facts", None)
        if not isinstance(observe, dict):
            observe = None
        result = run_design_simulation_pipeline(
            prompt=str(getattr(rt, "prompt", "") or ""),
            strategy=strategy if isinstance(strategy, dict) else None,
            swarm=swarm if isinstance(swarm, dict) else None,
            observe_facts=observe,
            scene_key=str(getattr(rt, "scene_key", "") or ""),
        )
        apply_simulation_to_runtime(rt, result)
        st.push_log(
            phase="design_simulation",
            summary=str(result.get("summary") or "")[:160],
            warnings=len(result.get("warnings") or []) or None,
            cta=round(float((result.get("attention") or {}).get("cta") or 0) * 100),
        )
        _emit(
            {
                "type": "activity",
                "id": "design-simulation",
                "kind": "explored",
                "status": "done",
                "summary": (
                    "DESIGN_SIMULATION: "
                    + str(result.get("summary") or "")
                    + (
                        f" · adj {len(result.get('adjustments') or [])}"
                        if result.get("adjustments")
                        else ""
                    )
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_simulation",
                "attention": result.get("attention"),
                "hierarchy": result.get("hierarchy"),
                "readability": result.get("readability"),
                "density": result.get("density"),
                "conversion": result.get("conversion"),
                "warnings": list(result.get("warnings") or [])[:6],
                "adjustments": list(result.get("adjustments") or [])[:6],
                "summary": str(result.get("summary") or "")[:240],
            }
        )
        block = format_simulation_for_decide(result)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return result
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_simulation_failed: {err}"[:240])
        st.push_log(
            phase="design_simulation",
            error=str(err)[:200],
            summary="design simulation failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-simulation",
                "kind": "explored",
                "status": "done",
                "summary": "DESIGN_SIMULATION: skipped (failed)",
            }
        )
        return None
