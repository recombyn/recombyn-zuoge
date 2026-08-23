"""Multi-candidate design (private). Never paints.

Diff vs BasicLocal:
- niche-aware lane overlays (event / auth / type / ecommerce)
- primary_id picked from niche (not always A)
- private_signals on the candidate set
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from recombyn_intelligence_service.engines._schemas import (
    parse_design_candidate_set,
    parse_design_strategy,
)
from recombyn_intelligence_service.engines.research import _detect_niches

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

# Niche → extra overlay patches per lane id (merged on top of base lane).
_NICHE_LANE_PATCHES: dict[str, dict[str, dict[str, str]]] = {
    "seasonal_event": {
        "A": {
            "composition_strategy": "editorial event motif as hero mass",
            "imagery_strategy": "one tactile event symbol, print grain",
            "visual_thesis": "editorial event — one motif, limited ink",
        },
        "C": {
            "composition_strategy": "hero motif ≥60%; meta band secondary",
            "color_strategy": "2–3 ink palette, one accent sticker max",
            "visual_thesis": "art-directed event motif owns the frame",
        },
        "D": {
            "imagery_strategy": "unexpected material on event symbol — still one motif",
            "visual_thesis": "experimental event craft without collage kitsch",
        },
    },
    "auth_ui": {
        "B": {
            "composition_strategy": "form-first column, quiet brand field",
            "interaction_strategy": "one primary sign-in CTA",
            "visual_thesis": "minimal auth — form is the product",
        },
        "E": {
            "composition_strategy": "brand header + stable form stack",
            "imagery_strategy": "no stock photo wall",
            "visual_thesis": "brand-led login without decorative chrome",
        },
    },
    "type_specimen": {
        "A": {
            "typography_strategy": "display serif specimen + quiet meta",
            "imagery_strategy": "letterforms are the image",
            "visual_thesis": "editorial type specimen",
        },
        "D": {
            "typography_strategy": "extreme display contrast; tracking air protected",
            "composition_strategy": "glyph as dominant mass",
            "visual_thesis": "experimental specimen — type is the hero",
        },
    },
    "ecommerce": {
        "B": {
            "composition_strategy": "product focal + adjacent buy cluster",
            "interaction_strategy": "one buy CTA near product",
            "visual_thesis": "product-first merchandising",
        },
        "E": {
            "composition_strategy": "brand merchandising rhythm; mute badge noise",
            "color_strategy": "brand + one urgency accent max",
            "visual_thesis": "brand commerce — one buy path",
        },
    },
}

_NICHE_PRIMARY: dict[str, str] = {
    "seasonal_event": "C",
    "auth_ui": "B",
    "type_specimen": "D",
    "ecommerce": "B",
    "ai_landing": "A",
}


def candidate_request(
    *,
    strategy: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    prompt: str = "",
) -> dict[str, Any]:
    """Inputs for candidate generation."""
    res = research if isinstance(research, dict) else {}
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    if not niches and prompt:
        niches = _detect_niches(prompt)
    return {
        "strategy": parse_design_strategy(strategy or {}),
        "research": res,
        "niches": niches[:4],
        "prompt": str(prompt or "").strip()[:800],
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
    paint = list(out.get("paint_checks") or [])
    # Carry research paint_checks onto each variant.
    out["anti_category_strategy"] = anti[:16]
    out["paint_checks"] = paint[:12]
    return parse_design_strategy(out)


def _lane_overlay_for(cid: str, base_overlay: dict[str, str], niches: list[str]) -> dict[str, str]:
    overlay = dict(base_overlay)
    for niche in niches:
        patch = (_NICHE_LANE_PATCHES.get(niche) or {}).get(cid)
        if patch:
            overlay.update(patch)
            break
    return overlay


def pick_primary_id(
    *,
    niches: list[str],
    research: dict[str, Any],
    requested: str = "",
) -> str:
    req = str(requested or "").strip().upper()
    if req in {row[0] for row in _CANDIDATE_LANES}:
        return req
    for niche in niches:
        if niche in _NICHE_PRIMARY:
            return _NICHE_PRIMARY[niche]
    cat = str(research.get("category") or "").strip().lower()
    if cat in _NICHE_PRIMARY:
        return _NICHE_PRIMARY[cat]
    if cat == "poster":
        return "C"
    if cat == "dashboard":
        return "B"
    return "A"


def generate_candidate_variants(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Strategy → five named plan variants (A–E) with niche patches."""
    base = request.get("strategy") if isinstance(request.get("strategy"), dict) else {}
    base = parse_design_strategy(base)
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    niches = [str(x) for x in list(request.get("niches") or []) if str(x).strip()]
    # Ensure paint_checks survive onto base before lane merge.
    if res.get("paint_checks") and not base.get("paint_checks"):
        base = dict(base)
        base["paint_checks"] = list(res.get("paint_checks") or [])[:12]
    rows: list[dict[str, Any]] = []
    for cid, label, overlay in _CANDIDATE_LANES:
        patched = _lane_overlay_for(cid, overlay, niches)
        strat = _merge_variant(base, patched, label=label)
        niche_tag = niches[0] if niches else ""
        summary = (
            f"{label}"
            + (f"/{niche_tag}" if niche_tag else "")
            + f": {strat.get('composition_strategy') or strat.get('visual_thesis') or ''}"
        )[:160]
        rows.append(
            {
                "id": cid,
                "label": label,
                "summary": summary,
                "strategy": strat,
                "selected": False,
                "niche": niche_tag,
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
    niches = [str(x) for x in list(request.get("niches") or []) if str(x).strip()]
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
            "niches": niches,
            "primary_reason": (
                f"niche:{niches[0]}" if niches else f"default:{primary}"
            ),
            "private_signals": {
                "stage": "niche_candidates",
                "provider_tier": "private",
                "niches": niches,
                "primary_id": primary,
            },
        }
    )


def run_multi_candidate_pipeline(
    *,
    strategy: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    prompt: str = "",
    primary_id: str = "",
) -> dict[str, Any]:
    """Full private Multi-Candidate generator. Deterministic; never paints."""
    request = candidate_request(strategy=strategy, research=research, prompt=prompt)
    primary = pick_primary_id(
        niches=list(request.get("niches") or []),
        research=request.get("research") if isinstance(request.get("research"), dict) else {},
        requested=primary_id,
    )
    variants = generate_candidate_variants(request)
    return assemble_candidate_set(request, variants, primary_id=primary)
