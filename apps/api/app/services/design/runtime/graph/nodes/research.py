"""Design Research (P32) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.research → BasicLocal → this module.

This is the **Community / BasicLocal** implementation: category catalog +
ANTI-CATEGORY rules. Advanced Research (Taste / KG / private mining) lives
behind Remote → private Intelligence; do not grow proprietary density here.

Never emits canvas tool_ops. Never writes SceneDocument.
"""
from __future__ import annotations

from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    parse_design_research_report,
)
from app.services.design.runtime.graph.emit_sse import _emit

# Open ANTI-CATEGORY floor — keep small; Private may enrich via Remote.
_CATEGORY_PATTERNS: dict[str, dict[str, list[str]]] = {
    "ai_landing": {
        "common": [
            "dark background",
            "purple-blue gradient",
            "giant hero",
            "three-column feature cards",
            "glow",
            "glassmorphism",
        ],
        "avoid": [
            "purple gradient",
            "glass card",
            "generic dashboard mockup",
            "glow orbs",
            "neon HUD chrome",
        ],
        "adopt": [
            "editorial typography",
            "monochrome imagery",
            "asymmetric grid",
            "single product metaphor",
            "warm neutrals + one accent",
        ],
        "why": [
            "Category clichés signal 'AI SaaS' instantly but erase differentiation.",
            "Editorial asymmetry + restrained color reads premium without glass/glow.",
            "A single product metaphor beats a wall of feature cards for memory.",
        ],
    },
    "poster": {
        "common": [
            "centered hero",
            "large title band",
            "particle decoration",
            "equal side ornaments",
            "high-contrast silhouette",
        ],
        "avoid": [
            "particles",
            "equal decorations fighting the hero",
            "HUD chrome",
            "purple postcard gradient",
        ],
        "adopt": [
            "single focal hero 60–80%",
            "museum-grade material thesis",
            "clear type hierarchy",
            "generous empty space",
        ],
        "why": [
            "Hero dominance (60–80%) raises hierarchy scores on poster evals.",
            "Decoration >15% of frame competes with focal attention.",
            "One thesis + one hero outperforms multi-motif postcard layouts.",
        ],
    },
    "dashboard": {
        "common": [
            "KPI card wall",
            "dense tables",
            "left nav chrome",
            "rainbow charts",
            "equal-weight widgets",
        ],
        "avoid": [
            "KPI wall without primary task",
            "equal card grid",
            "decorative charts with no decision",
        ],
        "adopt": [
            "task-first hierarchy",
            "one primary metric",
            "quiet secondary panels",
            "actionable empty states",
        ],
        "why": [
            "Task-first layouts outperform KPI walls on dashboard evals.",
            "One primary metric reduces scanning cost for the operator.",
        ],
    },
    "landing": {
        "common": [
            "hero + three feature cards",
            "logo cloud",
            "testimonial strip",
            "gradient CTA",
        ],
        "avoid": [
            "generic three-card feature row",
            "stock handshake photography",
            "rainbow CTA gradient",
        ],
        "adopt": [
            "family of related sections",
            "product-led imagery",
            "restrained type scale",
            "one decisive CTA",
        ],
        "why": [
            "Related section families feel intentional; three equal cards feel template.",
            "One CTA raises conversion clarity vs competing buttons.",
        ],
    },
}

_CATEGORY_BY_SCENE: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("poster", ("poster",)),
    ("dashboard", ("dashboard",)),
    # Website / mobile / landing scenes use the richer ai_landing floor catalog
    # (still scene-keyed — never prompt keyword guessing).
    ("ai_landing", ("landing", "website", "mobile")),
)


def research_request(prompt: str, *, scene_key: str = "") -> dict[str, Any]:
    """Category from scene_key only — never prompt keyword/length guessing."""
    text = str(prompt or "").strip()
    scene = str(scene_key or "").strip().lower()
    category = "generic"
    for cat, keys in _CATEGORY_BY_SCENE:
        if any(k in scene for k in keys):
            category = cat
            break
    return {
        "prompt": text[:800],
        "category": category,
        "wants_differentiation": category != "generic",
        "scene_key": str(scene_key or ""),
    }


def _visual_cues(
    *,
    reference_dna: dict[str, Any] | None,
    reference_analyze: dict[str, Any] | None,
) -> list[str]:
    dna = reference_dna if isinstance(reference_dna, dict) else {}
    axes = dna.get("visual_dna") if isinstance(dna.get("visual_dna"), dict) else {}
    analyze = reference_analyze if isinstance(reference_analyze, dict) else {}
    cues: list[str] = []
    comp = analyze.get("composition") if isinstance(analyze.get("composition"), dict) else {}
    if comp.get("type"):
        cues.append(f"composition:{comp.get('type')}")
    imagery = analyze.get("imagery") if isinstance(analyze.get("imagery"), dict) else {}
    if imagery.get("style"):
        cues.append(f"imagery:{imagery.get('style')}")
    for axis, val in axes.items():
        try:
            n = float(val)
        except (TypeError, ValueError):
            continue
        if n >= 0.7:
            cues.append(f"dna_high:{axis}")
        elif n <= 0.3:
            cues.append(f"dna_low:{axis}")
    return cues[:16]


def run_design_research_pipeline(
    *,
    prompt: str,
    scene_key: str = "",
    reference_dna: dict[str, Any] | None = None,
    reference_analyze: dict[str, Any] | None = None,
    eval_patterns: list[dict[str, Any]] | None = None,
    memory_notes: list[str] | None = None,
) -> dict[str, Any]:
    """BasicLocal research: catalog → ANTI-CATEGORY. Deterministic; never paints."""
    request = research_request(prompt, scene_key=scene_key)
    cat = str(request.get("category") or "generic")
    catalog = _CATEGORY_PATTERNS.get(cat) or {}

    common = list(catalog.get("common") or [])
    for cue in _visual_cues(
        reference_dna=reference_dna, reference_analyze=reference_analyze
    )[:6]:
        if cue not in common:
            common.append(cue)

    mined: list[str] = []
    for row in list(eval_patterns or []):
        if not isinstance(row, dict):
            continue
        pattern = str(row.get("pattern") or "").strip()
        if pattern:
            mined.append(pattern)
            label = f"eval_fail:{pattern}"
            if label not in common:
                common.append(label)

    sources = [f"category_catalog:{cat}"] if catalog else ["category_catalog:generic"]
    sources.extend(f"eval:{p}" for p in mined[:12])
    for note in list(memory_notes or []):
        text = str(note or "").strip()
        if text:
            sources.append(f"memory:{text[:40]}")

    avoid: list[str] = []
    adopt: list[str] = []
    if request.get("wants_differentiation") or catalog.get("avoid"):
        avoid = list(catalog.get("avoid") or [])[:10]
        adopt = list(catalog.get("adopt") or [])[:10]

    anti = [f"avoid: {x}" for x in avoid if str(x).strip()]
    anti.extend(f"adopt: {x}" for x in adopt if str(x).strip())

    why = [str(x) for x in list(catalog.get("why") or []) if str(x).strip()]
    if avoid:
        why.append(
            "Avoiding category defaults protects originality without lowering craft."
        )
    if adopt:
        why.append(
            "Adopted alternatives keep premium cues while escaping template recognition."
        )

    return parse_design_research_report(
        {
            "category": cat,
            "common_patterns": common[:16],
            "avoid": avoid[:10],
            "adopt": adopt[:10],
            "anti_category_strategy": anti[:16],
            "why_effective": why[:8],
            "sources": sources[:24],
            "summary": (
                f"category={cat}; patterns={len(common)}"
                + (f"; anti_category={len(anti)}" if anti else "")
            )[:240],
            "industry": cat,
            "visual_directions": adopt[:8],
            "provider": "basic-local",
        }
    )


def should_run_design_research(rt: AgentRuntime) -> bool:
    """Skip chat-only / empty prompts. Create/design goals always research."""
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    prompt = str(getattr(rt, "prompt", "") or "").strip()
    if not prompt:
        return False
    if intent in ("create", "edit", "design"):
        return True
    req = research_request(prompt, scene_key=str(getattr(rt, "scene_key", "") or ""))
    return req.get("category") != "generic" or bool(req.get("wants_differentiation"))


def _eval_patterns_from_rt(rt: AgentRuntime) -> list[dict[str, Any]]:
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    raw = flags.get("eval_patterns")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    return []


def apply_research_to_runtime(rt: AgentRuntime, report: dict[str, Any]) -> None:
    """Stash report on Runtime. Merge avoid into Brief when present."""
    clean = parse_design_research_report(report)
    rt.design_research = clean
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    if isinstance(brief, dict):
        avoid = list(brief.get("avoid") or [])
        for item in list(clean.get("avoid") or []):
            text = str(item).strip()
            if text and text not in avoid:
                avoid.append(text)
        brief["avoid"] = avoid[:12]
        if not brief.get("design_strategy"):
            brief["design_strategy"] = {
                "differentiation": "anti_category",
                "anti_category_strategy": list(clean.get("anti_category_strategy") or [])[
                    :12
                ],
                "visual_thesis": "",
                "positioning": "",
            }
        rt.design_brief = brief


def format_research_for_decide(report: dict[str, Any] | None) -> str:
    """Decide-only block — patterns + ANTI-CATEGORY, not paint adjectives."""
    src = report if isinstance(report, dict) else {}
    if not src:
        return ""
    lines = [
        "DESIGN_RESEARCH (host-owned). Ask why category patterns work.",
        f"category: {src.get('category') or ''}",
    ]
    common = list(src.get("common_patterns") or [])[:8]
    if common:
        lines.append("common_patterns:")
        lines.extend(f"- {x}" for x in common)
    anti = list(src.get("anti_category_strategy") or [])[:12]
    if anti:
        lines.append("ANTI-CATEGORY STRATEGY:")
        lines.extend(f"- {x}" for x in anti)
    why = list(src.get("why_effective") or [])[:6]
    if why:
        lines.append("why_effective:")
        lines.extend(f"- {x}" for x in why)
    return "\n".join(lines)[:1600]


async def run_design_research(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute BasicLocal research and stash. Fail-open."""
    if not should_run_design_research(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-research",
            "kind": "explored",
            "status": "running",
            "code": "design_research_running", "summary": "DESIGN_RESEARCH: category patterns → ANTI-CATEGORY",
        }
    )
    try:
        report = run_design_research_pipeline(
            prompt=str(getattr(rt, "prompt", "") or ""),
            scene_key=str(getattr(rt, "scene_key", "") or ""),
            reference_dna=getattr(rt, "reference_dna", None)
            if isinstance(getattr(rt, "reference_dna", None), dict)
            else None,
            reference_analyze=getattr(rt, "reference_analyze", None)
            if isinstance(getattr(rt, "reference_analyze", None), dict)
            else None,
            eval_patterns=_eval_patterns_from_rt(rt),
        )
        apply_research_to_runtime(rt, report)
        st.push_log(
            phase="design_research",
            summary=(report.get("summary") or report.get("category") or "research")[
                :160
            ],
            category=report.get("category"),
            anti=len(report.get("anti_category_strategy") or []) or None,
        )
        _emit(
            {
                "type": "activity",
                "id": "design-research",
                "kind": "explored",
                "status": "done",
                "summary": (
                    "DESIGN_RESEARCH: "
                    + str(report.get("category") or "")
                    + (
                        f" · anti {len(report.get('anti_category_strategy') or [])}"
                        if report.get("anti_category_strategy")
                        else ""
                    )
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_research",
                "category": report.get("category"),
                "common_patterns": list(report.get("common_patterns") or [])[:8],
                "anti_category_strategy": list(
                    report.get("anti_category_strategy") or []
                )[:12],
                "why_effective": list(report.get("why_effective") or [])[:6],
                "summary": str(report.get("summary") or "")[:240],
            }
        )
        block = format_research_for_decide(report)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return report
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_research_failed: {err}"[:240])
        st.push_log(
            phase="design_research",
            error=str(err)[:200],
            summary="design research failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-research",
                "kind": "explored",
                "status": "done",
                "code": "design_research_skipped", "summary": "DESIGN_RESEARCH: skipped (failed)",
            }
        )
        return None
