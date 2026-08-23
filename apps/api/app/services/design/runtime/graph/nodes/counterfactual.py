"""Counterfactual Design (P38) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.counterfactual → BasicLocal → here.

Community floor: H1–H5(+H6) virtual-scene trials + repair draft (not applied).
Metric deltas are frozen test contracts. Advanced CF lives behind Remote.

Never mutates real canvas / SceneDocument / tool_ops.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    SceneVisualSnapshot,
    compute_visual_diff,
    parse_design_counterfactual,
)
from app.services.design.runtime.graph.emit_sse import _emit


def _clamp01(n: float) -> float:
    return float(max(0.0, min(1.0, n)))


def _f(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def baseline_snapshot(
    *,
    observe_facts: dict[str, Any] | None = None,
    visual_snapshot: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build current metrics snapshot (virtualizable). Spec example defaults OK."""
    if isinstance(visual_snapshot, dict) and visual_snapshot:
        return SceneVisualSnapshot.model_validate(visual_snapshot).model_dump()
    facts = observe_facts if isinstance(observe_facts, dict) else {}
    sim = simulation if isinstance(simulation, dict) else {}
    att = sim.get("attention") if isinstance(sim.get("attention"), dict) else {}
    hero = facts.get("hero_coverage")
    if hero is None and att:
        hero = att.get("hero")
    if hero is None:
        hero = 0.72  # spec example "Hero dominance: 72"
    white = facts.get("whitespace_ratio")
    if white is None:
        white = 0.31  # spec example whitespace 31
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
) -> list[dict[str, Any]]:
    """Standard what-ifs: Hero shrink 20%, remove decoration, …"""
    hyps = [
        {
            "id": "H1",
            "kind": "resize",
            "target": "hero",
            "description": "Hero 缩小 20%",
            "params": {"scale": 0.8},
            "selected": False,
        },
        {
            "id": "H2",
            "kind": "remove",
            "target": "decoration",
            "description": "删除右侧装饰",
            "params": {"amount": 1.0},
            "selected": False,
        },
        {
            "id": "H3",
            "kind": "reposition",
            "target": "title",
            "description": "Reposition title for whitespace (AD swarm cue)",
            "params": {"shift": "toward_margin"},
            "selected": False,
        },
        {
            "id": "H4",
            "kind": "restructure",
            "target": "layout",
            "description": "Restructure toward single focal + quieter chrome",
            "params": {},
            "selected": False,
        },
        {
            "id": "H5",
            "kind": "recolor",
            "target": "accent",
            "description": "Recolor: restrain palette, one accent",
            "params": {"mode": "restrain"},
            "selected": False,
        },
    ]
    sim = simulation if isinstance(simulation, dict) else {}
    # If CTA gate fired, add a CTA-focused restructure.
    if any("CTA" in str(w) for w in list(sim.get("warnings") or [])):
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
    # Keep H1 when hero is large (spec path).
    hero = _f(snapshot.get("hero_coverage"), 0.0)
    if hero < 0.45:
        hyps = [h for h in hyps if h["id"] != "H1"]
    return hyps


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
        freed = max(0.0, hero - new_hero)
        virtual["hero_coverage"] = new_hero
        # Spec: Hero 72→58 frees ~14pts; whitespace 31→39 (+8) — not 1:1.
        virtual["whitespace_ratio"] = _clamp01(
            _f(virtual.get("whitespace_ratio"), 0.31) + freed * (8.0 / 14.4)
        )
        virtual["bbox_coverage"] = _clamp01(
            _f(virtual.get("bbox_coverage"), 0.69) - freed * 0.5
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
            # Steal a bit from hero for CTA path (metrics only).
            hero = _f(virtual.get("hero_coverage"), 0.68)
            take = min(0.06, max(0.0, hero - 0.55))
            virtual["hero_coverage"] = _clamp01(hero - take)
            virtual["whitespace_ratio"] = _clamp01(
                _f(virtual.get("whitespace_ratio"), 0.31) + take * 0.3
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
    return SceneVisualSnapshot.model_validate(virtual).model_dump()


def score_snapshot(snapshot: dict[str, Any]) -> dict[str, float]:
    """Predict hierarchy / whitespace% / hero% style scores from virtual metrics."""
    hero = _f(snapshot.get("hero_coverage"), 0.0)
    white = _f(snapshot.get("whitespace_ratio"), 0.0)
    deco = _f(snapshot.get("decoration_area"), 0.0)
    # Fits spec example: (hero72, white31)→89; after Hero−20% (58,39)→92.
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
    """One hypothesis → virtual scene → deltas (via Visual Diff) + scores."""
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
        "summary": summary,
    }


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
        actions.append({"action": "recolor", "target": target or "accent", "mode": "restrain"})
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
    selected_id: str = "",
    hypotheses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Full counterfactual. Deterministic. Never paints."""
    snap = baseline_snapshot(
        observe_facts=observe_facts,
        visual_snapshot=visual_snapshot,
        simulation=simulation,
    )
    hyps = list(hypotheses) if hypotheses else default_hypotheses(
        snapshot=snap, simulation=simulation
    )
    trials = [run_counterfactual_trial(snap, h) for h in hyps if isinstance(h, dict)]
    pick = str(selected_id or "").strip()
    repair = None
    for h in hyps:
        if not isinstance(h, dict):
            continue
        h["selected"] = str(h.get("id") or "") == pick and bool(pick)
    if pick:
        chosen = next((h for h in hyps if str(h.get("id") or "") == pick), None)
        trial = next((t for t in trials if t.get("hypothesis_id") == pick), None)
        if chosen:
            repair = compile_repair_plan_draft(chosen, trial)
    summary = f"trials={len(trials)}" + (f" · selected={pick}" if pick else "")
    return parse_design_counterfactual(
        {
            "hypotheses": hyps,
            "trials": trials,
            "selected_id": pick,
            "repair_plan_draft": repair,
            "summary": summary,
            "provider": "basic-local",
        }
    )


def should_run_design_counterfactual(rt: AgentRuntime) -> bool:
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    if getattr(rt, "design_simulation", None) or getattr(rt, "observe_facts", None):
        return True
    if getattr(rt, "visual_snapshot", None) or getattr(rt, "design_strategy", None):
        return True
    return False


def apply_counterfactual_to_runtime(rt: AgentRuntime, result: dict[str, Any]) -> None:
    """Stash counterfactual + optional repair draft. Never writes scene / ops."""
    clean = parse_design_counterfactual(result)
    # Harden: never allow accidental ops on this path.
    if "tool_ops" in clean:
        clean.pop("tool_ops", None)
    rt.design_counterfactual = clean


def format_counterfactual_for_decide(result: dict[str, Any] | None) -> str:
    src = result if isinstance(result, dict) else {}
    trials = [t for t in list(src.get("trials") or []) if isinstance(t, dict)]
    if not trials and not src.get("hypotheses"):
        return ""
    lines = [
        "DESIGN_COUNTERFACTUAL (host-owned). Virtual Scene only — never mutates canvas.",
    ]
    for trial in trials[:6]:
        lines.append(f"- {trial.get('summary') or trial.get('hypothesis_id')}")
    if src.get("selected_id"):
        lines.append(f"selected: {src.get('selected_id')} → Repair Plan draft (not applied)")
    if src.get("repair_plan_draft"):
        draft = src["repair_plan_draft"]
        lines.append(
            f"repair_draft: {draft.get('description')} applied={draft.get('applied')}"
        )
    return "\n".join(lines)[:1600]


async def run_design_counterfactual(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute counterfactual engine. Fail-open."""
    if not should_run_design_counterfactual(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-counterfactual",
            "kind": "explored",
            "status": "running",
            "summary": "DESIGN_COUNTERFACTUAL: virtual what-if (no canvas writes)",
        }
    )
    try:
        flags = rt.flags if isinstance(rt.flags, dict) else {}
        simulation = getattr(rt, "design_simulation", None)
        observe = getattr(rt, "observe_facts", None)
        if not isinstance(observe, dict):
            observe = None
        snap = getattr(rt, "visual_snapshot", None)
        if not isinstance(snap, dict):
            snap = None
        selected = str(flags.get("selected_id") or "").strip()
        result = run_design_counterfactual_pipeline(
            observe_facts=observe if isinstance(observe, dict) else None,
            visual_snapshot=snap,
            simulation=simulation if isinstance(simulation, dict) else None,
            selected_id=selected,
        )
        apply_counterfactual_to_runtime(rt, result)
        st.push_log(
            phase="design_counterfactual",
            summary=str(result.get("summary") or "")[:160],
            trials=len(result.get("trials") or []) or None,
            selected=result.get("selected_id") or None,
        )
        _emit(
            {
                "type": "activity",
                "id": "design-counterfactual",
                "kind": "explored",
                "status": "done",
                "summary": (
                    f"DESIGN_COUNTERFACTUAL: {result.get('summary') or ''}"
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_counterfactual",
                "hypotheses": [
                    {
                        "id": h.get("id"),
                        "kind": h.get("kind"),
                        "description": h.get("description"),
                        "selected": bool(h.get("selected")),
                    }
                    for h in list(result.get("hypotheses") or [])[:8]
                    if isinstance(h, dict)
                ],
                "trials": [
                    {"hypothesis_id": t.get("hypothesis_id"), "summary": t.get("summary")}
                    for t in list(result.get("trials") or [])[:6]
                    if isinstance(t, dict)
                ],
                "selected_id": result.get("selected_id"),
                "summary": str(result.get("summary") or "")[:240],
            }
        )
        block = format_counterfactual_for_decide(result)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return result
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_counterfactual_failed: {err}"[:240])
        st.push_log(
            phase="design_counterfactual",
            error=str(err)[:200],
            summary="design counterfactual failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-counterfactual",
                "kind": "explored",
                "status": "done",
                "summary": "DESIGN_COUNTERFACTUAL: skipped (failed)",
            }
        )
        return None
