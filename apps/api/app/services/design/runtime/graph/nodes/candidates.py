"""Multi-Candidate Design (P34) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.propose_candidates → BasicLocal → here.

Community floor: five named lanes (Editorial…Brand-led) over base Strategy.
Advanced candidate mining lives behind Remote → private Intelligence.

Candidates live on Runtime only. Unselected never write user canvas /
SceneDocument / tool_ops.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    parse_design_candidate_set,
    parse_design_strategy,
)
from app.services.design.runtime.graph.emit_sse import _emit

# Spec lanes: Editorial / Minimal Product / Art Direction / Experimental / Brand-led
_CANDIDATE_LANES: tuple[tuple[str, str, dict[str, str]], ...] = (
    (
        "A",
        "Editorial",
        {
            "positioning": "editorial premium",
            "composition_strategy": "editorial asymmetry",
            "typography_strategy": "large serif + restrained sans",
            "imagery_strategy": "editorial photography",
            "color_strategy": "warm neutrals + one ink accent",
            "visual_thesis": "editorial layout, not template grid",
        },
    ),
    (
        "B",
        "Minimal Product",
        {
            "positioning": "minimal product-led",
            "composition_strategy": "single product focal, generous empty space",
            "typography_strategy": "quiet sans, product owns type weight",
            "imagery_strategy": "single product metaphor / macro product",
            "color_strategy": "monochrome + one product accent",
            "visual_thesis": "product is the hero; chrome disappears",
        },
    ),
    (
        "C",
        "Art Direction",
        {
            "positioning": "art-directed statement",
            "composition_strategy": "bold crop, intentional imbalance",
            "typography_strategy": "expressive display + quiet body",
            "imagery_strategy": "art-directed still / metaphor",
            "color_strategy": "directed palette, high contrast accents",
            "visual_thesis": "one art-directed gesture carries the page",
        },
    ),
    (
        "D",
        "Experimental",
        {
            "positioning": "experimental craft",
            "composition_strategy": "unexpected grid break, controlled risk",
            "typography_strategy": "mixed scale, one experimental face",
            "imagery_strategy": "unusual material / abstract product cue",
            "color_strategy": "unexpected accent on restrained base",
            "visual_thesis": "controlled experiment, still readable",
        },
    ),
    (
        "E",
        "Brand-led",
        {
            "positioning": "brand-led system",
            "composition_strategy": "brand system rhythm, related sections",
            "typography_strategy": "brand type stack, consistent scale",
            "imagery_strategy": "brand-world imagery family",
            "color_strategy": "brand tokens + one campaign accent",
            "visual_thesis": "brand system leads; campaign is one chapter",
        },
    ),
)


def candidate_request(
    *,
    strategy: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Inputs for candidate generation."""
    return {
        "strategy": parse_design_strategy(strategy or {}),
        "research": research if isinstance(research, dict) else {},
    }


def _merge_variant(
    base: dict[str, Any],
    overlay: dict[str, str],
    *,
    label: str,
) -> dict[str, Any]:
    """Clone base Strategy and apply lane overlay. Keep ANTI-CATEGORY."""
    out = deepcopy(base) if isinstance(base, dict) else {}
    for key, val in overlay.items():
        text = str(val or "").strip()
        if text:
            out[key] = text
    diff = str(out.get("differentiation") or "").strip()
    if not diff:
        out["differentiation"] = f"{label} lane — escape category defaults"
    elif label.lower() not in diff.lower():
        out["differentiation"] = f"{diff} · {label} variant"
    anti = list(out.get("anti_category_strategy") or [])
    out["anti_category_strategy"] = anti[:16]
    return parse_design_strategy(out)


def generate_candidate_variants(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Strategy → five named plan variants (A–E). No paint."""
    base = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    base = parse_design_strategy(base)
    rows: list[dict[str, Any]] = []
    for cid, label, overlay in _CANDIDATE_LANES:
        strat = _merge_variant(base, overlay, label=label)
        summary = (
            f"{label}: {strat.get('composition_strategy') or strat.get('visual_thesis') or ''}"
        )[:160]
        rows.append(
            {
                "id": cid,
                "label": label,
                "summary": summary,
                "strategy": strat,
                "selected": False,
            }
        )
    return rows


def assemble_candidate_set(
    request: dict[str, Any],
    variants: list[dict[str, Any]],
    *,
    primary_id: str = "A",
) -> dict[str, Any]:
    """Host-owned candidate set. Mark primary selected for Decide continuity."""
    cleaned = []
    primary = str(primary_id or "A").strip() or "A"
    for row in variants:
        item = dict(row)
        item["selected"] = str(item.get("id") or "") == primary
        cleaned.append(item)
    if cleaned and not any(c.get("selected") for c in cleaned):
        cleaned[0]["selected"] = True
        primary = str(cleaned[0].get("id") or "A")
    return parse_design_candidate_set(
        {
            "candidates": cleaned,
            "primary_id": primary,
            "count": len(cleaned),
            "source_strategy": request.get("strategy")
            if isinstance(request.get("strategy"), dict)
            else None,
            "provider": "basic-local",
        }
    )


def run_multi_candidate_pipeline(
    *,
    strategy: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    primary_id: str = "A",
) -> dict[str, Any]:
    """BasicLocal Multi-Candidate. Deterministic; never paints."""
    request = candidate_request(strategy=strategy, research=research)
    variants = generate_candidate_variants(request)
    return assemble_candidate_set(request, variants, primary_id=primary_id)


def should_run_multi_candidate(rt: AgentRuntime) -> bool:
    """Need a Strategy (or Research). Skip chat."""
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    if getattr(rt, "design_strategy", None):
        return True
    if intent in ("create", "edit", "design"):
        return bool(getattr(rt, "design_research", None))
    return False


def primary_candidate(bundle: dict[str, Any] | None) -> dict[str, Any] | None:
    src = bundle if isinstance(bundle, dict) else {}
    pid = str(src.get("primary_id") or "").strip()
    for row in list(src.get("candidates") or []):
        if not isinstance(row, dict):
            continue
        if pid and str(row.get("id") or "") == pid:
            return row
        if row.get("selected"):
            return row
    rows = [r for r in list(src.get("candidates") or []) if isinstance(r, dict)]
    return rows[0] if rows else None


def apply_candidates_to_runtime(rt: AgentRuntime, bundle: dict[str, Any]) -> None:
    """Stash candidates. Sync primary Strategy → Brief; never emit tool_ops."""
    clean = parse_design_candidate_set(bundle)
    rt.design_candidates = clean
    primary = primary_candidate(clean)
    if not primary:
        return
    strat = primary.get("strategy") if isinstance(primary.get("strategy"), dict) else {}
    if not strat:
        return
    rt.design_strategy = parse_design_strategy(strat)
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    if isinstance(brief, dict):
        brief["design_strategy"] = rt.design_strategy
        thesis = str(rt.design_strategy.get("visual_thesis") or "").strip()
        if thesis and not str(brief.get("visual_thesis") or "").strip():
            brief["visual_thesis"] = thesis
        rt.design_brief = brief


def format_candidates_for_decide(bundle: dict[str, Any] | None) -> str:
    """Decide-only block — list V1–V5 plans; remind unselected stay off-canvas."""
    src = bundle if isinstance(bundle, dict) else {}
    rows = [r for r in list(src.get("candidates") or []) if isinstance(r, dict)]
    if not rows:
        return ""
    lines = [
        "DESIGN_CANDIDATES (host-owned). Five strategy variants.",
        "Unselected candidates must NOT write the user canvas.",
        f"primary: {src.get('primary_id') or ''}",
    ]
    for row in rows[:5]:
        mark = "*" if row.get("selected") or str(row.get("id")) == str(src.get("primary_id")) else " "
        label = str(row.get("label") or row.get("id") or "")
        summary = str(row.get("summary") or "")[:100]
        lines.append(f"[{mark}] {row.get('id')}: {label} — {summary}")
    return "\n".join(lines)[:1600]


async def run_multi_candidate(rt: AgentRuntime) -> dict[str, Any] | None:
    """Generate V1–V5 and stash. Fail-open."""
    if not should_run_multi_candidate(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-candidates",
            "kind": "explored",
            "status": "running",
            "code": "design_candidates_running", "summary": "DESIGN_CANDIDATES: Strategy → V1–V5 (off-canvas until selected)",
        }
    )
    try:
        strategy = getattr(rt, "design_strategy", None)
        research = getattr(rt, "design_research", None)
        bundle = run_multi_candidate_pipeline(
            strategy=strategy if isinstance(strategy, dict) else None,
            research=research if isinstance(research, dict) else None,
            primary_id="A",
        )
        apply_candidates_to_runtime(rt, bundle)
        st.push_log(
            phase="design_candidates",
            summary=f"{bundle.get('count') or 0} candidates · primary {bundle.get('primary_id')}",
            count=bundle.get("count"),
            primary=bundle.get("primary_id"),
        )
        _emit(
            {
                "type": "activity",
                "id": "design-candidates",
                "kind": "explored",
                "status": "done",
                "summary": (
                    f"DESIGN_CANDIDATES: {bundle.get('count') or 0} · "
                    f"primary {bundle.get('primary_id') or ''}"
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_candidates",
                "count": bundle.get("count"),
                "primary_id": bundle.get("primary_id"),
                "candidates": [
                    {
                        "id": c.get("id"),
                        "label": c.get("label"),
                        "summary": c.get("summary"),
                        "selected": bool(c.get("selected")),
                    }
                    for c in list(bundle.get("candidates") or [])[:5]
                    if isinstance(c, dict)
                ],
            }
        )
        block = format_candidates_for_decide(bundle)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return bundle
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_candidates_failed: {err}"[:240])
        st.push_log(
            phase="design_candidates",
            error=str(err)[:200],
            summary="design candidates failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-candidates",
                "kind": "explored",
                "status": "done",
                "code": "design_candidates_skipped", "summary": "DESIGN_CANDIDATES: skipped (failed)",
            }
        )
        return None
