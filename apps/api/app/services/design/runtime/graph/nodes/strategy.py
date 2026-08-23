"""Design Strategy (P33) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.strategy → BasicLocal → this module.

Community floor: category axis catalog + Research ANTI-CATEGORY merge into Brief.
Advanced Strategy (Taste / private theses) lives behind Remote → private Intelligence.

Never emits canvas tool_ops. Never writes SceneDocument.
"""
from __future__ import annotations

from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    parse_design_strategy,
)
from app.services.design.runtime.graph.emit_sse import _emit

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
        # First adopt becomes composition cue when nothing matched.
        seed["composition_strategy"] = adopt_only[0]
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
    # Brief P0 thesis wins over category seed when Strategy thesis was not preset.
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


def assemble_design_strategy(request: dict[str, Any]) -> dict[str, Any]:
    """Host-owned DesignStrategy.v1 — never paints."""
    positioning = position_strategy(request)
    differentiation = differentiate_strategy(request)
    axes = compose_axis_strategies(request)
    res = request.get("research") if isinstance(request.get("research"), dict) else {}
    anti = [
        str(x).strip()
        for x in list(res.get("anti_category_strategy") or [])
        if str(x).strip()
    ]
    if not anti:
        # Rebuild avoid:/adopt: lines from Research lists.
        for item in list(res.get("avoid") or [])[:8]:
            text = str(item).strip()
            if text:
                anti.append(f"avoid: {text}")
        for item in list(res.get("adopt") or [])[:8]:
            text = str(item).strip()
            if text:
                anti.append(f"adopt: {text}")
    brief = request.get("brief") if isinstance(request.get("brief"), dict) else {}
    existing = brief.get("design_strategy") if isinstance(brief.get("design_strategy"), dict) else {}
    prior_anti = list(existing.get("anti_category_strategy") or [])
    if prior_anti and not anti:
        anti = [str(x) for x in prior_anti if str(x).strip()]
    raw = {
        "positioning": positioning,
        "visual_thesis": axes.get("visual_thesis") or "",
        "differentiation": differentiation,
        "composition_strategy": axes.get("composition_strategy") or "",
        "typography_strategy": axes.get("typography_strategy") or "",
        "imagery_strategy": axes.get("imagery_strategy") or "",
        "color_strategy": axes.get("color_strategy") or "",
        "interaction_strategy": axes.get("interaction_strategy") or "",
        "anti_category_strategy": anti[:16],
        "provider": "basic-local",
    }
    return parse_design_strategy(raw)


def run_design_strategy_pipeline(
    *,
    prompt: str = "",
    research: dict[str, Any] | None = None,
    brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """BasicLocal Strategy. Deterministic; never mutates canvas."""
    request = strategy_request(prompt=prompt, research=research, brief=brief)
    return assemble_design_strategy(request)


def should_run_design_strategy(rt: AgentRuntime) -> bool:
    """Run after Research (or when Brief needs a strategy). Skip chat."""
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    if intent in ("create", "edit", "design"):
        return True
    if getattr(rt, "design_research", None):
        return True
    return False


def apply_strategy_to_runtime(rt: AgentRuntime, strategy: dict[str, Any]) -> None:
    """Stash Strategy on Runtime + merge into Brief (thesis / design_strategy)."""
    clean = parse_design_strategy(strategy)
    rt.design_strategy = clean
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    if not isinstance(brief, dict):
        brief = {}
    brief["design_strategy"] = clean
    thesis = str(clean.get("visual_thesis") or "").strip()
    if thesis and not str(brief.get("visual_thesis") or "").strip():
        brief["visual_thesis"] = thesis
    # Prefer Strategy avoid lines into Brief.avoid when missing.
    avoid = list(brief.get("avoid") or [])
    for item in list(clean.get("anti_category_strategy") or []):
        text = str(item).strip()
        if text.lower().startswith("avoid:"):
            text = text.split(":", 1)[-1].strip()
        if text and text not in avoid and not text.lower().startswith("adopt"):
            avoid.append(text)
    brief["avoid"] = avoid[:12]
    rt.design_brief = brief


def format_strategy_for_decide(strategy: dict[str, Any] | None) -> str:
    """Decide-only block — positioning / axes / ANTI-CATEGORY."""
    src = strategy if isinstance(strategy, dict) else {}
    if not src:
        return ""
    lines = ["DESIGN_STRATEGY (host-owned). Plan from this; do not paint yet."]
    for key, label in (
        ("positioning", "Positioning"),
        ("visual_thesis", "Visual thesis"),
        ("differentiation", "Differentiation"),
        ("composition_strategy", "Composition"),
        ("typography_strategy", "Typography"),
        ("imagery_strategy", "Imagery"),
        ("color_strategy", "Color"),
        ("interaction_strategy", "Interaction"),
    ):
        val = str(src.get(key) or "").strip()
        if val:
            lines.append(f"{label}: {val}")
    anti = list(src.get("anti_category_strategy") or [])[:12]
    if anti:
        lines.append("ANTI-CATEGORY STRATEGY:")
        lines.extend(f"- {x}" for x in anti)
    return "\n".join(lines)[:1600]


async def run_design_strategy(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute Strategy Engine and stash. Fail-open: never blocks Decide."""
    if not should_run_design_strategy(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-strategy",
            "kind": "explored",
            "status": "running",
            "summary": "DESIGN_STRATEGY: Research → Strategy → Brief",
        }
    )
    try:
        research = getattr(rt, "design_research", None)
        if not isinstance(research, dict):
            research = {}
        brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
        strategy = run_design_strategy_pipeline(
            prompt=str(getattr(rt, "prompt", "") or ""),
            research=research if isinstance(research, dict) else None,
            brief=brief,
        )
        apply_strategy_to_runtime(rt, strategy)
        st.push_log(
            phase="design_strategy",
            summary=(strategy.get("positioning") or strategy.get("visual_thesis") or "strategy")[
                :160
            ],
            positioning=strategy.get("positioning"),
            anti=len(strategy.get("anti_category_strategy") or []) or None,
        )
        _emit(
            {
                "type": "activity",
                "id": "design-strategy",
                "kind": "explored",
                "status": "done",
                "summary": (
                    "DESIGN_STRATEGY: "
                    + str(strategy.get("positioning") or strategy.get("visual_thesis") or "")
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_strategy",
                "positioning": strategy.get("positioning"),
                "visual_thesis": strategy.get("visual_thesis"),
                "differentiation": strategy.get("differentiation"),
                "composition_strategy": strategy.get("composition_strategy"),
                "typography_strategy": strategy.get("typography_strategy"),
                "imagery_strategy": strategy.get("imagery_strategy"),
                "color_strategy": strategy.get("color_strategy"),
                "anti_category_strategy": list(
                    strategy.get("anti_category_strategy") or []
                )[:12],
            }
        )
        block = format_strategy_for_decide(strategy)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return strategy
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_strategy_failed: {err}"[:240])
        st.push_log(
            phase="design_strategy",
            error=str(err)[:200],
            summary="design strategy failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-strategy",
                "kind": "explored",
                "status": "done",
                "summary": "DESIGN_STRATEGY: skipped (failed)",
            }
        )
        return None
