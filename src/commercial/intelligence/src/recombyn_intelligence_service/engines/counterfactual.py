"""Counterfactual design (private). Virtual scene only.

Diff vs BasicLocal:
- niche / paint_checks / simulation-driven hypotheses
- auto-recommend best trial (hierarchy / niche objective)
- decide_repair_directives + private_signals
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from recombyn_intelligence_service.engines._schemas import (
    compute_visual_diff,
    normalize_visual_snapshot,
    parse_design_counterfactual,
)
from recombyn_intelligence_service.engines.research import _detect_niches


class SceneVisualSnapshot:
    """Minimal stand-in for SceneVisualSnapshot geometry fields."""

    def __init__(self, **kwargs: Any) -> None:
        self._data = normalize_visual_snapshot(kwargs)

    @staticmethod
    def model_validate(raw: Any) -> "SceneVisualSnapshot":
        return SceneVisualSnapshot(**normalize_visual_snapshot(raw))

    def model_dump(self) -> dict[str, Any]:
        return dict(self._data)


def _clamp01(n: float) -> float:
    return float(max(0.0, min(1.0, n)))


def _f(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _collect_niches(
    *,
    prompt: str = "",
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
) -> list[str]:
    res = research if isinstance(research, dict) else {}
    strat = strategy if isinstance(strategy, dict) else {}
    sim = simulation if isinstance(simulation, dict) else {}
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = [str(x) for x in list(strat.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = [str(x) for x in list(sim.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = _detect_niches(prompt)
    return niches[:4]


def baseline_snapshot(
    *,
    observe_facts: dict[str, Any] | None = None,
    visual_snapshot: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build current metrics snapshot (virtualizable)."""
    if isinstance(visual_snapshot, dict) and visual_snapshot:
        return SceneVisualSnapshot.model_validate(visual_snapshot).model_dump()
    facts = observe_facts if isinstance(observe_facts, dict) else {}
    sim = simulation if isinstance(simulation, dict) else {}
    att = sim.get("attention") if isinstance(sim.get("attention"), dict) else {}
    hero = facts.get("hero_coverage")
    if hero is None and att:
        hero = att.get("hero")
    if hero is None:
        hero = 0.72
    white = facts.get("whitespace_ratio")
    if white is None:
        white = 0.31
    deco = facts.get("decoration_area")
    if deco is None:
        deco = 0.12
    return SceneVisualSnapshot(
        node_count=int(facts.get("node_count") or 12),
        hero_coverage=_clamp01(_f(hero, 0.72)),
        title_area=_clamp01(_f(facts.get("title_area"), 0.12)),
        decoration_area=_clamp01(_f(deco, 0.12)),
        whitespace_ratio=_clamp01(_f(white, 0.31)),
        text_area=_clamp01(_f(facts.get("text_area"), 0.18)),
        color_area=_clamp01(_f(facts.get("color_area"), 0.4)),
        bbox_coverage=_clamp01(_f(facts.get("bbox_coverage"), 0.69)),
    ).model_dump()


def default_hypotheses(
    *,
    snapshot: dict[str, Any],
    simulation: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    prompt: str = "",
) -> list[dict[str, Any]]:
    """Niche / paint_check aware what-ifs (still virtual only)."""
    niches = _collect_niches(
        prompt=prompt, research=research, strategy=strategy, simulation=simulation
    )
    res = research if isinstance(research, dict) else {}
    strat = strategy if isinstance(strategy, dict) else {}
    sim = simulation if isinstance(simulation, dict) else {}
    checks = [
        str(x).lower()
        for x in list(res.get("paint_checks") or [])
        + list(strat.get("paint_checks") or [])
        if str(x).strip()
    ]
    hero = _f(snapshot.get("hero_coverage"), 0.0)
    deco = _f(snapshot.get("decoration_area"), 0.0)
    posterish = (
        "seasonal_event" in niches
        or "type_specimen" in niches
        or str(res.get("category") or "") == "poster"
    )

    hyps: list[dict[str, Any]] = []

    # Poster / event: rarely shrink a weak hero — boost or cut ornament instead.
    if posterish and hero < 0.58:
        hyps.append(
            {
                "id": "H_hero_boost",
                "kind": "resize",
                "target": "hero",
                "description": "Raise hero/motif coverage toward ≥55–70%",
                "params": {"scale": 1.15},
                "selected": False,
                "niche": niches[0] if niches else "poster",
            }
        )
    elif hero >= 0.78:
        hyps.append(
            {
                "id": "H1",
                "kind": "resize",
                "target": "hero",
                "description": "Hero 缩小 20%（过满时释放留白）",
                "params": {"scale": 0.8},
                "selected": False,
            }
        )
    elif not posterish:
        hyps.append(
            {
                "id": "H1",
                "kind": "resize",
                "target": "hero",
                "description": "Hero 缩小 20%",
                "params": {"scale": 0.8},
                "selected": False,
            }
        )

    if deco >= 0.08 or any("ornament" in c for c in checks):
        hyps.append(
            {
                "id": "H2",
                "kind": "remove",
                "target": "decoration",
                "description": "删除装饰 / 降低 ornament 面积",
                "params": {"amount": 1.0},
                "selected": False,
            }
        )

    hyps.append(
        {
            "id": "H3",
            "kind": "reposition",
            "target": "title",
            "description": "Reposition title for whitespace (AD swarm cue)",
            "params": {"shift": "toward_margin"},
            "selected": False,
        }
    )
    hyps.append(
        {
            "id": "H4",
            "kind": "restructure",
            "target": "layout",
            "description": "Restructure toward single focal + quieter chrome",
            "params": {},
            "selected": False,
        }
    )
    hyps.append(
        {
            "id": "H5",
            "kind": "recolor",
            "target": "accent",
            "description": "Recolor: restrain palette, one accent",
            "params": {"mode": "restrain"},
            "selected": False,
        }
    )

    if "auth_ui" in niches or "ecommerce" in niches:
        hyps.append(
            {
                "id": "H_cta",
                "kind": "restructure",
                "target": "cta",
                "description": "Raise primary CTA / buy path attention",
                "params": {"cta_min": 0.10},
                "selected": False,
                "niche": "auth_ui" if "auth_ui" in niches else "ecommerce",
            }
        )
    if "type_specimen" in niches:
        hyps.append(
            {
                "id": "H_type",
                "kind": "restructure",
                "target": "title",
                "description": "Boost type specimen hierarchy; mute photo chrome",
                "params": {"mode": "type_first"},
                "selected": False,
                "niche": "type_specimen",
            }
        )

    if any("CTA" in str(w) or "cta" in str(w).lower() for w in list(sim.get("warnings") or [])):
        if not any(h.get("id") == "H_cta" for h in hyps):
            hyps.append(
                {
                    "id": "H6",
                    "kind": "restructure",
                    "target": "cta",
                    "description": "Raise CTA attention budget (≥10%)",
                    "params": {"cta_min": 0.10},
                    "selected": False,
                }
            )
    if any("hero" in str(w).lower() for w in list(sim.get("warnings") or [])):
        if not any(h.get("id") == "H_hero_boost" for h in hyps):
            hyps.append(
                {
                    "id": "H_hero_boost",
                    "kind": "resize",
                    "target": "hero",
                    "description": "Raise hero coverage (simulation gate)",
                    "params": {"scale": 1.12},
                    "selected": False,
                }
            )

    # Deduplicate by id while preserving order.
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for h in hyps:
        hid = str(h.get("id") or "")
        if not hid or hid in seen:
            continue
        seen.add(hid)
        out.append(h)
    return out


def apply_hypothesis_virtual(
    snapshot: dict[str, Any],
    hypothesis: dict[str, Any],
) -> dict[str, Any]:
    """Mutate a *copy* of snapshot metrics. Never touches real scene nodes."""
    virtual = deepcopy(snapshot if isinstance(snapshot, dict) else {})
    kind = str(hypothesis.get("kind") or "").strip().lower()
    target = str(hypothesis.get("target") or "").strip().lower()
    params = hypothesis.get("params") if isinstance(hypothesis.get("params"), dict) else {}

    if kind == "resize" and target == "hero":
        scale = _f(params.get("scale"), 0.8)
        hero = _f(virtual.get("hero_coverage"), 0.72)
        new_hero = _clamp01(hero * scale)
        delta = new_hero - hero
        virtual["hero_coverage"] = new_hero
        if delta < 0:
            freed = -delta
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) + freed * (8.0 / 14.4)
            )
            virtual["bbox_coverage"] = _clamp01(
                _f(virtual.get("bbox_coverage"), 0.69) - freed * 0.5
            )
        else:
            # Grow hero: steal from decoration / whitespace.
            take = delta
            deco = _f(virtual.get("decoration_area"), 0.12)
            cut_deco = min(deco, take * 0.5)
            virtual["decoration_area"] = _clamp01(deco - cut_deco)
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) - (take - cut_deco) * 0.6
            )
            virtual["bbox_coverage"] = _clamp01(
                _f(virtual.get("bbox_coverage"), 0.69) + take * 0.4
            )
    elif kind == "remove" and target in ("decoration", "deco"):
        amount = _clamp01(_f(params.get("amount"), 1.0))
        deco = _f(virtual.get("decoration_area"), 0.12)
        removed = deco * amount
        virtual["decoration_area"] = _clamp01(deco - removed)
        virtual["whitespace_ratio"] = _clamp01(
            _f(virtual.get("whitespace_ratio"), 0.31) + removed
        )
        virtual["node_count"] = max(0, int(virtual.get("node_count") or 0) - 2)
    elif kind == "reposition" and target == "title":
        virtual["whitespace_ratio"] = _clamp01(
            _f(virtual.get("whitespace_ratio"), 0.31) + 0.03
        )
        virtual["title_area"] = _clamp01(_f(virtual.get("title_area"), 0.12))
    elif kind == "recolor":
        virtual["color_area"] = _clamp01(_f(virtual.get("color_area"), 0.4) * 0.85)
    elif kind == "restructure":
        if target == "cta":
            hero = _f(virtual.get("hero_coverage"), 0.68)
            take = min(0.06, max(0.0, hero - 0.55))
            virtual["hero_coverage"] = _clamp01(hero - take)
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) + take * 0.3
            )
        elif target == "title" and str(params.get("mode") or "") == "type_first":
            virtual["title_area"] = _clamp01(
                _f(virtual.get("title_area"), 0.12) + 0.06
            )
            virtual["decoration_area"] = _clamp01(
                _f(virtual.get("decoration_area"), 0.12) * 0.4
            )
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) + 0.04
            )
        else:
            deco = _f(virtual.get("decoration_area"), 0.12)
            virtual["decoration_area"] = _clamp01(deco * 0.5)
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) + deco * 0.25
            )
            hero = _f(virtual.get("hero_coverage"), 0.68)
            if hero > 0.80:
                virtual["hero_coverage"] = _clamp01(hero * 0.9)
            elif hero < 0.55:
                virtual["hero_coverage"] = _clamp01(hero * 1.08)
    return SceneVisualSnapshot.model_validate(virtual).model_dump()


def score_snapshot(snapshot: dict[str, Any]) -> dict[str, float]:
    """Predict hierarchy / whitespace% / hero% style scores from virtual metrics."""
    hero = _f(snapshot.get("hero_coverage"), 0.0)
    white = _f(snapshot.get("whitespace_ratio"), 0.0)
    deco = _f(snapshot.get("decoration_area"), 0.0)
    hierarchy = 56.0 + 71.0 * white + 18.6 * hero - 20.0 * deco
    return {
        "hero_dominance": round(hero * 100.0, 1),
        "whitespace": round(white * 100.0, 1),
        "hierarchy": round(max(0.0, min(100.0, hierarchy)), 1),
        "decoration": round(deco * 100.0, 1),
    }


def run_counterfactual_trial(
    snapshot: dict[str, Any],
    hypothesis: dict[str, Any],
) -> dict[str, Any]:
    """One hypothesis → virtual scene → deltas + scores."""
    before = SceneVisualSnapshot.model_validate(snapshot or {}).model_dump()
    virtual = apply_hypothesis_virtual(before, hypothesis)
    diff = compute_visual_diff(before, virtual)
    deltas = diff.get("deltas") if isinstance(diff.get("deltas"), dict) else {}
    scores_before = score_snapshot(before)
    scores_after = score_snapshot(virtual)
    hid = str(hypothesis.get("id") or "")
    summary = (
        f"{hypothesis.get('description') or hid}: "
        f"hero {scores_before['hero_dominance']:.0f}→{scores_after['hero_dominance']:.0f}, "
        f"white {scores_before['whitespace']:.0f}→{scores_after['whitespace']:.0f}, "
        f"hier {scores_before['hierarchy']:.0f}→{scores_after['hierarchy']:.0f}"
    )
    return {
        "hypothesis_id": hid,
        "before": before,
        "virtual": virtual,
        "deltas": {str(k): float(v) for k, v in deltas.items()},
        "scores_before": scores_before,
        "scores_after": scores_after,
        "delta_hierarchy": round(
            float(scores_after["hierarchy"]) - float(scores_before["hierarchy"]), 2
        ),
        "summary": summary,
    }


def recommend_trial(
    trials: list[dict[str, Any]],
    *,
    niches: list[str],
    snapshot: dict[str, Any],
) -> str:
    """Pick best hypothesis id by niche objective (not always max hierarchy)."""
    if not trials:
        return ""
    hero = _f(snapshot.get("hero_coverage"), 0.0)
    posterish = "seasonal_event" in niches or "type_specimen" in niches

    def _key(trial: dict[str, Any]) -> tuple[float, float]:
        after = trial.get("scores_after") if isinstance(trial.get("scores_after"), dict) else {}
        d_hier = float(trial.get("delta_hierarchy") or 0.0)
        after_hero = _f(after.get("hero_dominance"), 0.0) / 100.0
        after_deco = _f(after.get("decoration"), 0.0) / 100.0
        niche_bonus = 0.0
        hid = str(trial.get("hypothesis_id") or "")
        if posterish:
            if hero < 0.55 and after_hero >= hero:
                niche_bonus += 4.0
            if after_deco < _f(snapshot.get("decoration_area"), 0.12):
                niche_bonus += 2.0
            if hid in ("H_hero_boost", "H2"):
                niche_bonus += 1.5
        if "auth_ui" in niches or "ecommerce" in niches:
            if hid in ("H_cta", "H6"):
                niche_bonus += 3.0
        if "type_specimen" in niches and hid == "H_type":
            niche_bonus += 3.0
        return (d_hier + niche_bonus, d_hier)

    best = max(trials, key=_key)
    return str(best.get("hypothesis_id") or "")


def compile_repair_plan_draft(
    hypothesis: dict[str, Any],
    trial: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Selected what-if → Repair Plan draft. Still NOT canvas tool_ops."""
    kind = str(hypothesis.get("kind") or "")
    target = str(hypothesis.get("target") or "")
    params = hypothesis.get("params") if isinstance(hypothesis.get("params"), dict) else {}
    actions: list[dict[str, Any]] = []
    if kind == "resize" and target == "hero":
        actions.append(
            {
                "action": "resize",
                "target": "hero",
                "scale": _f(params.get("scale"), 0.8),
            }
        )
    elif kind == "remove":
        actions.append({"action": "remove", "target": target or "decoration"})
    elif kind == "reposition":
        actions.append(
            {
                "action": "reposition",
                "target": target or "title",
                "shift": params.get("shift") or "toward_margin",
            }
        )
    elif kind == "recolor":
        actions.append(
            {"action": "recolor", "target": target or "accent", "mode": "restrain"}
        )
    else:
        actions.append({"action": "restructure", "target": target or "layout"})
    return {
        "source": "counterfactual",
        "hypothesis_id": str(hypothesis.get("id") or ""),
        "description": str(hypothesis.get("description") or ""),
        "actions": actions,
        "predicted": (trial or {}).get("scores_after") if isinstance(trial, dict) else {},
        "applied": False,
        "note": "draft only — does not mutate canvas until Repair applies",
    }


def run_design_counterfactual_pipeline(
    *,
    observe_facts: dict[str, Any] | None = None,
    visual_snapshot: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    prompt: str = "",
    selected_id: str = "",
    hypotheses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Full private counterfactual. Deterministic. Never paints."""
    snap = baseline_snapshot(
        observe_facts=observe_facts,
        visual_snapshot=visual_snapshot,
        simulation=simulation,
    )
    niches = _collect_niches(
        prompt=prompt, research=research, strategy=strategy, simulation=simulation
    )
    hyps = (
        list(hypotheses)
        if hypotheses
        else default_hypotheses(
            snapshot=snap,
            simulation=simulation,
            research=research,
            strategy=strategy,
            prompt=prompt,
        )
    )
    trials = [run_counterfactual_trial(snap, h) for h in hyps if isinstance(h, dict)]
    recommended = recommend_trial(trials, niches=niches, snapshot=snap)
    pick = str(selected_id or "").strip() or recommended
    repair = None
    for h in hyps:
        if not isinstance(h, dict):
            continue
        h["selected"] = str(h.get("id") or "") == pick and bool(pick)
        h["recommended"] = str(h.get("id") or "") == recommended
    if pick:
        chosen = next((h for h in hyps if str(h.get("id") or "") == pick), None)
        trial = next((t for t in trials if t.get("hypothesis_id") == pick), None)
        if chosen:
            repair = compile_repair_plan_draft(chosen, trial)
    directives: list[str] = []
    if repair:
        for step in list(repair.get("actions") or [])[:4]:
            if isinstance(step, dict):
                directives.append(
                    f"REPAIR: {step.get('action')} {step.get('target') or ''}".strip()
                )
    if recommended:
        directives.append(f"RECOMMEND: {recommended}")
    summary = (
        f"trials={len(trials)}"
        + (f" · recommend={recommended}" if recommended else "")
        + (f" · selected={pick}" if pick else "")
        + (f" · niches={','.join(niches)}" if niches else "")
    )
    return parse_design_counterfactual(
        {
            "hypotheses": hyps,
            "trials": trials,
            "selected_id": pick,
            "recommended_id": recommended,
            "repair_plan_draft": repair,
            "summary": summary,
            "niches": niches,
            "decide_repair_directives": directives[:8],
            "private_signals": {
                "stage": "niche_counterfactual",
                "provider_tier": "private",
                "niches": niches,
                "recommended_id": recommended,
                "trial_count": len(trials),
            },
        }
    )
