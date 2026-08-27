"""Design Research pipeline.

Never emits canvas tool_ops. Never writes SceneDocument.
"""
from __future__ import annotations

import re
from typing import Any


def parse_design_research_report(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_research")
        if isinstance(data.get("design_research"), dict)
        else data
    )
    return dict(inner or {})

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

_CATEGORY_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "ai_landing",
        (
            "ai product",
            "ai 官网",
            "ai landing",
            "saas",
            "llm",
            "gpt",
            "大模型",
            "人工智能官网",
            "ai 产品",
        ),
    ),
    (
        "poster",
        ("海报", "poster", "易拉宝", "roll-up", "kv", "演唱会"),
    ),
    (
        "dashboard",
        ("dashboard", "后台", "控制台", "kpi", "数据看板"),
    ),
    (
        "landing",
        ("landing", "官网", "官网首页", "营销页", "落地页"),
    ),
)

_DIFF_HINTS = (
    "不能千篇一律",
    "不要千篇一律",
    "别千篇一律",
    "不落俗套",
    "差异化",
    "高级但不能",
    "premium but not",
    "not generic",
    "not cliché",
    "not cliche",
    "avoid generic",
    "differentiate",
)

# Private niches — BasicLocal has no prompt-aware overlays.
_NICHE_OVERLAYS: tuple[tuple[str, tuple[str, ...], dict[str, list[str]]], ...] = (
    (
        "seasonal_event",
        ("halloween", "万圣节", "圣诞", "christmas", "春节", "concert", "演唱会", "音乐节"),
        {
            "avoid": [
                "clipart icons as hero",
                "rainbow gradient sky",
                "equal ornament frame",
                "stock spooky silhouette collage",
            ],
            "adopt": [
                "one event motif owns 60%+",
                "date/venue type as secondary band",
                "tactile material or print grain",
                "limited ink palette (2–3 colors)",
            ],
            "paint_checks": [
                "hero_coverage>=0.55",
                "ornament_area<0.15",
                "primary_title_one_block",
            ],
        },
    ),
    (
        "auth_ui",
        ("登录", "login", "sign in", "signup", "注册页", "auth"),
        {
            "avoid": [
                "split-screen stock photo wall",
                "blurred glass form card",
                "purple-on-white SaaS chrome",
                "too many social login buttons fighting CTA",
            ],
            "adopt": [
                "single-column form with clear primary CTA",
                "brand mark + short value line above fields",
                "generous field spacing, one accent color",
                "error/empty states designed, not default",
            ],
            "paint_checks": [
                "one_primary_cta",
                "form_column_centered_or_offset_not_both",
                "no_feature_card_wall",
            ],
        },
    ),
    (
        "type_specimen",
        ("字体", "type specimen", "字样", "typography poster", "字体展示"),
        {
            "avoid": [
                "busy photo background under glyphs",
                "more than two display faces competing",
                "centered postcard with equal margins only",
            ],
            "adopt": [
                "glyph or wordmark as hero mass",
                "meta (family/weight) in quiet secondary type",
                "strong contrast black/ink on paper field",
            ],
            "paint_checks": [
                "type_is_hero",
                "secondary_meta_smaller",
                "empty_space>=0.25",
            ],
        },
    ),
    (
        "ecommerce",
        ("电商", "ecommerce", "商品详情", "pdp", "加购", "shop"),
        {
            "avoid": [
                "rainbow sale badges everywhere",
                "equal product card grid as hero",
                "stock lifestyle collage with no product focus",
            ],
            "adopt": [
                "product as single focal",
                "price/CTA cluster near product",
                "restrained merchandising chrome",
            ],
            "paint_checks": [
                "product_focal",
                "one_buy_cta",
                "badge_noise_low",
            ],
        },
    ),
)


def _detect_niches(prompt: str) -> list[str]:
    text = str(prompt or "")
    low = text.lower()
    hits: list[str] = []
    for niche_id, hints, _overlay in _NICHE_OVERLAYS:
        if any(h.lower() in low or h in text for h in hints):
            hits.append(niche_id)
    return hits[:4]


def _niche_overlay(niche_ids: list[str]) -> dict[str, list[str]]:
    avoid: list[str] = []
    adopt: list[str] = []
    paint_checks: list[str] = []
    by_id = {row[0]: row[2] for row in _NICHE_OVERLAYS}
    for nid in niche_ids:
        overlay = by_id.get(nid) or {}
        for item in overlay.get("avoid") or []:
            if item not in avoid:
                avoid.append(item)
        for item in overlay.get("adopt") or []:
            if item not in adopt:
                adopt.append(item)
        for item in overlay.get("paint_checks") or []:
            if item not in paint_checks:
                paint_checks.append(item)
    return {"avoid": avoid, "adopt": adopt, "paint_checks": paint_checks}


def _subject_hint(prompt: str) -> str:
    """Lightweight subject cue for thesis binding (not full NLP)."""
    text = str(prompt or "").strip()
    if not text:
        return ""
    # Prefer quoted phrase
    m = re.search(r"[「\"']([^」\"']{2,40})[」\"']", text)
    if m:
        return m.group(1).strip()
    # Strip leading ask verbs / articles only (word-bounded — never eat letters inside words).
    cleaned = re.sub(
        r"(设计|做一个|做一张|帮我|\bplease\b|\bdesign\b|\bmake\b|\bcreate\b|\ba\b|\ban\b|\bthe\b)\s*",
        " ",
        text,
        flags=re.I,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.-")
    if len(cleaned) <= 48:
        return cleaned
    return cleaned[:48].rsplit(" ", 1)[0] or cleaned[:48]


def research_request(prompt: str, *, scene_key: str = "") -> dict[str, Any]:
    """Detect category + niches + differentiation ask from the user goal."""
    text = str(prompt or "").strip()
    low = text.lower()
    category = ""
    for cat, hints in _CATEGORY_HINTS:
        if any(h.lower() in low or h in text for h in hints):
            category = cat
            break
    if not category:
        scene = str(scene_key or "").strip().lower()
        if "poster" in scene:
            category = "poster"
        elif "dashboard" in scene:
            category = "dashboard"
        elif "landing" in scene or "website" in scene or "mobile" in scene:
            # Prefer ai_landing floor for product sites; plain landing for marketing.
            category = "ai_landing" if any(
                k in low for k in ("ai", "saas", "llm", "gpt", "大模型")
            ) else "landing"
    niches = _detect_niches(text)
    wants_diff = any(h.lower() in low or h in text for h in _DIFF_HINTS)
    return {
        "prompt": text[:800],
        "category": category or "generic",
        "niches": niches,
        "subject": _subject_hint(text),
        "wants_differentiation": wants_diff or bool(category) or bool(niches),
        "scene_key": str(scene_key or ""),
    }


def source_collect(
    request: dict[str, Any],
    *,
    eval_patterns: list[dict[str, Any]] | None = None,
    memory_notes: list[str] | None = None,
) -> dict[str, Any]:
    """Collect textual sources: category catalog + eval failure patterns + memory."""
    cat = str(request.get("category") or "generic")
    catalog = _CATEGORY_PATTERNS.get(cat) or {}
    sources = [f"category_catalog:{cat}"] if catalog else ["category_catalog:generic"]
    mined: list[str] = []
    for row in list(eval_patterns or []):
        if not isinstance(row, dict):
            continue
        pattern = str(row.get("pattern") or "").strip()
        if pattern:
            mined.append(pattern)
            sources.append(f"eval:{pattern}")
    for note in list(memory_notes or []):
        text = str(note or "").strip()
        if text:
            sources.append(f"memory:{text[:40]}")
    return {
        "category": cat,
        "catalog": catalog,
        "eval_patterns": mined[:12],
        "sources": sources[:24],
    }


def visual_collect(
    *,
    reference_dna: dict[str, Any] | None = None,
    reference_analyze: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pull visual laws from Reference Intelligence when present."""
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
    return {"visual_cues": cues[:16], "has_reference": bool(cues)}


def pattern_extract(sources: dict[str, Any], visual: dict[str, Any]) -> dict[str, Any]:
    """Extract common category patterns (+ reference cues as soft signals)."""
    catalog = sources.get("catalog") if isinstance(sources.get("catalog"), dict) else {}
    common = list(catalog.get("common") or [])
    for cue in list((visual or {}).get("visual_cues") or [])[:6]:
        if cue not in common:
            common.append(cue)
    for pat in list(sources.get("eval_patterns") or [])[:6]:
        label = f"eval_fail:{pat}"
        if label not in common:
            common.append(label)
    return {
        "category": sources.get("category") or "generic",
        "common_patterns": common[:16],
        "catalog": catalog,
    }


def cluster_patterns(extracted: dict[str, Any]) -> dict[str, Any]:
    """Cluster into cliché / structure / material buckets (deterministic)."""
    buckets: dict[str, list[str]] = {
        "cliche": [],
        "structure": [],
        "material": [],
        "other": [],
    }
    cliche_rx = re.compile(
        r"gradient|glass|glow|particle|hud|neon|purple|三列|three-column|kpi wall",
        re.I,
    )
    structure_rx = re.compile(
        r"hero|grid|card|nav|asymmetric|hierarchy|cta|column|band",
        re.I,
    )
    material_rx = re.compile(
        r"imagery|typography|monochrome|material|editorial|serif|photo",
        re.I,
    )
    for item in list(extracted.get("common_patterns") or []):
        text = str(item)
        if cliche_rx.search(text):
            buckets["cliche"].append(text)
        elif structure_rx.search(text):
            buckets["structure"].append(text)
        elif material_rx.search(text):
            buckets["material"].append(text)
        else:
            buckets["other"].append(text)
    return {"category": extracted.get("category"), "clusters": buckets}


def compare_category(
    request: dict[str, Any],
    extracted: dict[str, Any],
) -> dict[str, Any]:
    """Compare category clichés + private niches → avoid / adopt / paint_checks."""
    catalog = extracted.get("catalog") if isinstance(extracted.get("catalog"), dict) else {}
    avoid = list(catalog.get("avoid") or [])
    adopt = list(catalog.get("adopt") or [])
    niche = _niche_overlay(list(request.get("niches") or []))
    for item in niche.get("avoid") or []:
        if item not in avoid:
            avoid.append(item)
    for item in niche.get("adopt") or []:
        if item not in adopt:
            adopt.append(item)
    paint_checks = list(niche.get("paint_checks") or [])
    # Category-level executable floors (private — BasicLocal omits these).
    cat = str(request.get("category") or "generic")
    if cat == "poster" and "hero_coverage>=0.55" not in paint_checks:
        paint_checks.extend(
            ["hero_coverage>=0.55", "ornament_area<0.15", "one_visual_thesis"]
        )
    if cat in ("ai_landing", "landing") and "one_primary_cta" not in paint_checks:
        paint_checks.extend(
            ["one_primary_cta", "no_three_equal_feature_cards", "no_purple_glow_default"]
        )
    if cat == "dashboard" and "one_primary_metric" not in paint_checks:
        paint_checks.extend(["one_primary_metric", "no_equal_kpi_wall"])
    if not request.get("wants_differentiation") and not avoid and not niche:
        return {"avoid": [], "adopt": [], "paint_checks": [], "tension": "none"}
    return {
        "avoid": avoid[:14],
        "adopt": adopt[:14],
        "paint_checks": paint_checks[:12],
        "tension": "differentiate" if request.get("wants_differentiation") else "baseline",
    }


def form_hypotheses(
    extracted: dict[str, Any],
    comparison: dict[str, Any],
) -> list[str]:
    """Why patterns work / fail — not competitor name lists."""
    catalog = extracted.get("catalog") if isinstance(extracted.get("catalog"), dict) else {}
    why = [str(x) for x in list(catalog.get("why") or []) if str(x).strip()]
    if comparison.get("avoid"):
        why.append(
            "Avoiding category defaults protects originality without lowering craft."
        )
    if comparison.get("adopt"):
        why.append(
            "Adopted alternatives keep premium cues while escaping template recognition."
        )
    return why[:8]


def build_anti_category_strategy(
    comparison: dict[str, Any],
) -> list[str]:
    """ANTI-CATEGORY STRATEGY lines: avoid X / adopt Y."""
    lines: list[str] = []
    for item in list(comparison.get("avoid") or [])[:8]:
        text = str(item).strip()
        if text:
            lines.append(f"avoid: {text}")
    for item in list(comparison.get("adopt") or [])[:8]:
        text = str(item).strip()
        if text:
            lines.append(f"adopt: {text}")
    return lines


def research_report(
    *,
    request: dict[str, Any],
    sources: dict[str, Any],
    extracted: dict[str, Any],
    clusters: dict[str, Any],
    comparison: dict[str, Any],
    hypotheses: list[str],
) -> dict[str, Any]:
    """Assemble DesignResearch report. Private fields beyond BasicLocal floor."""
    _ = clusters
    cat = str(request.get("category") or extracted.get("category") or "generic")
    niches = [str(x) for x in list(request.get("niches") or []) if str(x).strip()]
    subject = str(request.get("subject") or "").strip()
    anti = build_anti_category_strategy(comparison)
    avoid = list(comparison.get("avoid") or [])
    adopt = list(comparison.get("adopt") or [])
    paint_checks = list(comparison.get("paint_checks") or [])
    summary_bits = [
        f"category={cat}",
        f"patterns={len(extracted.get('common_patterns') or [])}",
    ]
    if niches:
        summary_bits.append(f"niches={','.join(niches)}")
    if anti:
        summary_bits.append(f"anti_category={len(anti)}")
    if paint_checks:
        summary_bits.append(f"paint_checks={len(paint_checks)}")
    # Stronger private score: niches + checks beyond BasicLocal 0.35 floor.
    diff = 0.42 + 0.06 * len(anti) + 0.08 * len(niches) + 0.05 * min(4, len(paint_checks))
    if avoid:
        diff += 0.12
    return parse_design_research_report(
        {
            "category": cat,
            "niches": niches,
            "subject": subject,
            "common_patterns": list(extracted.get("common_patterns") or [])[:16],
            "avoid": avoid[:14],
            "adopt": adopt[:14],
            "anti_category_strategy": anti[:18],
            "paint_checks": paint_checks[:12],
            "why_effective": list(hypotheses or [])[:8],
            "sources": list(sources.get("sources") or [])[:24]
            + [f"niche:{n}" for n in niches],
            "summary": "; ".join(summary_bits)[:240],
            "industry": cat,
            "visual_directions": adopt[:8],
            "clusters": (clusters or {}).get("clusters")
            if isinstance(clusters, dict)
            else {},
            "differentiation_score": round(min(1.0, diff), 3),
            "private_signals": {
                "stage": "niche_pipeline",
                "provider_tier": "private",
                "cluster_keys": list(
                    ((clusters or {}).get("clusters") or {}).keys()
                )
                if isinstance(clusters, dict)
                else [],
                "subject": subject,
            },
        }
    )


def run_design_research_pipeline(
    *,
    prompt: str,
    scene_key: str = "",
    reference_dna: dict[str, Any] | None = None,
    reference_analyze: dict[str, Any] | None = None,
    eval_patterns: list[dict[str, Any]] | None = None,
    memory_notes: list[str] | None = None,
) -> dict[str, Any]:
    """Full pipeline. Deterministic; LLM optional later. Never paints."""
    request = research_request(prompt, scene_key=scene_key)
    sources = source_collect(
        request, eval_patterns=eval_patterns, memory_notes=memory_notes
    )
    visual = visual_collect(
        reference_dna=reference_dna, reference_analyze=reference_analyze
    )
    extracted = pattern_extract(sources, visual)
    clusters = cluster_patterns(extracted)
    comparison = compare_category(request, extracted)
    hypotheses = form_hypotheses(extracted, comparison)
    return research_report(
        request=request,
        sources=sources,
        extracted=extracted,
        clusters=clusters,
        comparison=comparison,
        hypotheses=hypotheses,
    )


