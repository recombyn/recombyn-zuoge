"""Design Strategy engine.

Never mutates SceneDocument.
"""
from __future__ import annotations

from typing import Any


def parse_design_strategy(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_strategy")
        if isinstance(data.get("design_strategy"), dict)
        else data
    )
    return dict(inner or {})


# Category → default axis strategies (filled when Research reports that category).
_CATEGORY_STRATEGY: dict[str, dict[str, str]] = {
    "ai_landing": {
        "positioning": "premium technical",
        "differentiation": "avoid standard AI visual language",
        "composition_strategy": "editorial asymmetry",
        "typography_strategy": "large serif + restrained sans",
        "imagery_strategy": "macro material photography",
        "color_strategy": "warm neutral + one electric accent",
        "interaction_strategy": "one decisive CTA, no feature-card wall",
        "visual_thesis": "single product metaphor, editorial not glass/glow",
    },
    "poster": {
        "positioning": "museum-grade editorial poster",
        "differentiation": "hero-first, not postcard collage",
        "composition_strategy": "single focal hero 60–80%",
        "typography_strategy": "clear type hierarchy, one primary title",
        "imagery_strategy": "museum-grade material thesis",
        "color_strategy": "restrained palette + one accent",
        "interaction_strategy": "",
        "visual_thesis": "one thesis, one hero, generous empty space",
    },
    "dashboard": {
        "positioning": "task-first operator console",
        "differentiation": "primary metric over KPI wall",
        "composition_strategy": "task-first hierarchy, quiet secondary panels",
        "typography_strategy": "dense but readable data type",
        "imagery_strategy": "charts only when they decide",
        "color_strategy": "neutral chrome + one status accent",
        "interaction_strategy": "actionable empty states",
        "visual_thesis": "one primary metric owns attention",
    },
    "landing": {
        "positioning": "product-led marketing page",
        "differentiation": "related section family, not three equal cards",
        "composition_strategy": "family of related sections",
        "typography_strategy": "restrained type scale",
        "imagery_strategy": "product-led imagery",
        "color_strategy": "brand-led, avoid rainbow CTA gradient",
        "interaction_strategy": "one decisive CTA",
        "visual_thesis": "product clarity over template marketing",
    },
    "generic": {
        "positioning": "craft-led original",
        "differentiation": "escape category defaults",
        "composition_strategy": "clear hierarchy, one focal",
        "typography_strategy": "purposeful type contrast",
        "imagery_strategy": "specific, not stock",
        "color_strategy": "limited palette",
        "interaction_strategy": "",
        "visual_thesis": "one clear visual idea",
    },
}


def strategy_request(
    *,
    prompt: str = "",
    research: dict[str, Any] | None = None,
    brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Gather inputs for Strategy (Research + Brief + goal)."""
    res = research if isinstance(research, dict) else {}
    br = brief if isinstance(brief, dict) else {}
    category = str(res.get("category") or "").strip() or "generic"
    return {
        "prompt": str(prompt or "").strip()[:800],
        "category": category,
        "research": res,
        "brief": br,
        "has_research": bool(res.get("anti_category_strategy") or res.get("avoid")),
    }


def _adopt_line(text: str) -> str:
    raw = str(text or "").strip()
    if raw.lower().startswith("adopt:"):
        return raw.split(":", 1)[-1].strip()
    return raw


def _pick_adopt(anti: list[str], *, needle: str) -> str:
    low_n = needle.lower()
    for item in anti:
        adopt = _adopt_line(item)
        if low_n in adopt.lower():
            return adopt
    return ""


def position_strategy(request: dict[str, Any]) -> str:
    """Positioning from category seed or existing brief strategy."""
    brief = request.get("brief") if isinstance(request.get("brief"), dict) else {}
    existing = brief.get("design_strategy") if isinstance(brief.get("design_strategy"), dict) else {}
    if str(existing.get("positioning") or "").strip():
        return str(existing.get("positioning")).strip()
    cat = str(request.get("category") or "generic")
    seed = _CATEGORY_STRATEGY.get(cat) or _CATEGORY_STRATEGY["generic"]
    return seed["positioning"]


def differentiate_strategy(request: dict[str, Any]) -> str:
    """Differentiation from Research ANTI-CATEGORY / avoid list."""
    brief = request.get("brief") if isinstance(request.get("brief"), dict) else {}
    existing = brief.get("design_strategy") if isinstance(brief.get("design_strategy"), dict) else {}
    if str(existing.get("differentiation") or "").strip():
        return str(existing.get("differentiation")).strip()
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    avoid = [str(x).strip() for x in list(res.get("avoid") or []) if str(x).strip()]
    if avoid:
        return "avoid " + "; ".join(avoid[:4])
    cat = str(request.get("category") or "generic")
    seed = _CATEGORY_STRATEGY.get(cat) or _CATEGORY_STRATEGY["generic"]
    return seed["differentiation"]


def compose_axis_strategies(request: dict[str, Any]) -> dict[str, str]:
    """Fill composition / type / imagery / color / interaction axes."""
    cat = str(request.get("category") or "generic")
    seed = dict(_CATEGORY_STRATEGY.get(cat) or _CATEGORY_STRATEGY["generic"])
    brief = request.get("brief") if isinstance(request.get("brief"), dict) else {}
    existing = brief.get("design_strategy") if isinstance(brief.get("design_strategy"), dict) else {}
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    anti = [str(x) for x in list(res.get("anti_category_strategy") or []) if str(x).strip()]
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    subject = str(res.get("subject") or request.get("prompt") or "").strip()
    adopt_only = [
        _adopt_line(x) for x in anti if str(x).lower().startswith("adopt:") or ":" not in str(x)
    ]
    # Prefer Research adopt cues when they match an axis.
    editorial = _pick_adopt(anti, needle="editorial") or _pick_adopt(anti, needle="asymmetric")
    if editorial:
        seed["composition_strategy"] = editorial
        if "editorial" in editorial.lower() or "serif" in editorial.lower():
            seed["typography_strategy"] = editorial
    mono = _pick_adopt(anti, needle="monochrome") or _pick_adopt(anti, needle="imagery")
    if mono:
        seed["imagery_strategy"] = mono
    warm = _pick_adopt(anti, needle="warm") or _pick_adopt(anti, needle="accent")
    if warm:
        seed["color_strategy"] = warm
    metaphor = _pick_adopt(anti, needle="metaphor") or _pick_adopt(anti, needle="product")
    if metaphor and not str(seed.get("visual_thesis") or "").strip():
        seed["visual_thesis"] = metaphor
    if adopt_only and not editorial:
        seed["composition_strategy"] = adopt_only[0]

    # Niche overrides (private) — bind thesis to subject when possible.
    if "auth_ui" in niches:
        seed["composition_strategy"] = "single-column auth form, brand header, one CTA"
        seed["interaction_strategy"] = "one primary sign-in CTA; secondary links quiet"
        seed["visual_thesis"] = (
            f"clean login for {subject}" if subject else "clean single-column login"
        )
    if "seasonal_event" in niches:
        seed["composition_strategy"] = "event motif as hero mass; meta band secondary"
        seed["imagery_strategy"] = "one event symbol, print-grain or tactile, not clipart"
        seed["visual_thesis"] = (
            f"{subject} — one motif, bold type, limited ink"
            if subject
            else "one event motif, bold type, limited ink"
        )
    if "type_specimen" in niches:
        seed["composition_strategy"] = "glyph/wordmark as dominant mass"
        seed["typography_strategy"] = "specimen hierarchy: display hero + quiet meta"
        seed["visual_thesis"] = (
            f"type specimen: {subject}" if subject else "type specimen — glyph as hero"
        )
    if "ecommerce" in niches:
        seed["composition_strategy"] = "product focal with adjacent buy cluster"
        seed["interaction_strategy"] = "one buy CTA near product"
        seed["visual_thesis"] = (
            f"product-first merchandising for {subject}"
            if subject
            else "product-first merchandising"
        )
    elif subject and cat in ("poster", "landing", "ai_landing", "generic"):
        # Prompt-bound thesis — BasicLocal stays category-generic.
        base = str(seed.get("visual_thesis") or "one clear visual idea").strip()
        if subject.lower() not in base.lower():
            seed["visual_thesis"] = f"{base} · subject: {subject}"[:160]

    for key in (
        "composition_strategy",
        "typography_strategy",
        "imagery_strategy",
        "color_strategy",
        "interaction_strategy",
        "visual_thesis",
    ):
        prior = str(existing.get(key) or "").strip()
        if prior:
            seed[key] = prior
    brief_thesis = str(brief.get("visual_thesis") or "").strip()
    if brief_thesis and not str(existing.get("visual_thesis") or "").strip():
        seed["visual_thesis"] = brief_thesis
    return {
        "composition_strategy": seed.get("composition_strategy") or "",
        "typography_strategy": seed.get("typography_strategy") or "",
        "imagery_strategy": seed.get("imagery_strategy") or "",
        "color_strategy": seed.get("color_strategy") or "",
        "interaction_strategy": seed.get("interaction_strategy") or "",
        "visual_thesis": seed.get("visual_thesis") or "",
    }


def _axis_weights_for(category: str, niches: list[str]) -> dict[str, float]:
    if "type_specimen" in niches:
        return {
            "composition": 0.22,
            "typography": 0.38,
            "imagery": 0.10,
            "color": 0.18,
            "interaction": 0.12,
        }
    if "auth_ui" in niches:
        return {
            "composition": 0.30,
            "typography": 0.16,
            "imagery": 0.10,
            "color": 0.16,
            "interaction": 0.28,
        }
    if category == "poster" or "seasonal_event" in niches:
        return {
            "composition": 0.34,
            "typography": 0.22,
            "imagery": 0.24,
            "color": 0.14,
            "interaction": 0.06,
        }
    if category == "dashboard":
        return {
            "composition": 0.30,
            "typography": 0.18,
            "imagery": 0.12,
            "color": 0.14,
            "interaction": 0.26,
        }
    return {
        "composition": 0.28,
        "typography": 0.18,
        "imagery": 0.22,
        "color": 0.16,
        "interaction": 0.16,
    }


def _decide_directives(
    *,
    axes: dict[str, str],
    avoid: list[str],
    paint_checks: list[str],
) -> list[str]:
    """Short executable lines Decide can paste into the user message suffix."""
    lines: list[str] = []
    thesis = str(axes.get("visual_thesis") or "").strip()
    if thesis:
        lines.append(f"THESIS: {thesis}")
    comp = str(axes.get("composition_strategy") or "").strip()
    if comp:
        lines.append(f"COMPOSITION: {comp}")
    for item in avoid[:4]:
        text = str(item).strip()
        if text:
            lines.append(f"AVOID: {text}")
    for check in paint_checks[:5]:
        text = str(check).strip()
        if text:
            lines.append(f"CHECK: {text}")
    return lines[:12]


def assemble_design_strategy(request: dict[str, Any]) -> dict[str, Any]:
    """Private DesignStrategy — prompt/niche bound + Decide directives."""
    positioning = position_strategy(request)
    differentiation = differentiate_strategy(request)
    axes = compose_axis_strategies(request)
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    paint_checks = [str(x) for x in list(res.get("paint_checks") or []) if str(x).strip()]
    anti = [
        str(x).strip()
        for x in list(res.get("anti_category_strategy") or [])
        if str(x).strip()
    ]
    avoid_list = [str(x).strip() for x in list(res.get("avoid") or []) if str(x).strip()]
    if not anti:
        for item in avoid_list[:8]:
            anti.append(f"avoid: {item}")
        for item in list(res.get("adopt") or [])[:8]:
            text = str(item).strip()
            if text:
                anti.append(f"adopt: {text}")
    brief = request.get("brief") if isinstance(request.get("brief"), dict) else {}
    existing = brief.get("design_strategy") if isinstance(brief.get("design_strategy"), dict) else {}
    prior_anti = list(existing.get("anti_category_strategy") or [])
    if prior_anti and not anti:
        anti = [str(x) for x in prior_anti if str(x).strip()]
    cat = str(request.get("category") or "generic")
    directives = _decide_directives(
        axes=axes, avoid=avoid_list or [a[7:] for a in anti if a.startswith("avoid:")], paint_checks=paint_checks
    )
    raw = {
        "positioning": positioning,
        "visual_thesis": axes.get("visual_thesis") or "",
        "differentiation": differentiation,
        "composition_strategy": axes.get("composition_strategy") or "",
        "typography_strategy": axes.get("typography_strategy") or "",
        "imagery_strategy": axes.get("imagery_strategy") or "",
        "color_strategy": axes.get("color_strategy") or "",
        "interaction_strategy": axes.get("interaction_strategy") or "",
        "anti_category_strategy": anti[:18],
        "paint_checks": paint_checks[:12],
        "decide_directives": directives,
        "niches": niches,
        "axis_weights": _axis_weights_for(cat, niches),
        "private_signals": {
            "stage": "niche_weighted_axes",
            "provider_tier": "private",
            "research_diff_score": res.get("differentiation_score"),
            "anti_count": len(anti),
            "subject": res.get("subject") or "",
        },
    }
    return parse_design_strategy(raw)


def run_design_strategy_pipeline(
    *,
    prompt: str = "",
    research: dict[str, Any] | None = None,
    brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Full Strategy Engine. Deterministic; never mutates canvas."""
    request = strategy_request(prompt=prompt, research=research, brief=brief)
    return assemble_design_strategy(request)


