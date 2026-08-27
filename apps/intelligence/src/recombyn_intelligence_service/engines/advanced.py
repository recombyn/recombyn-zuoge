"""Advanced Intelligence hooks (review / optimize / memory / principle).

Kernel Review & Opt remain authoritative; these payloads enrich Remote when usable.
Never emit canvas tool_ops.
"""
from __future__ import annotations

from typing import Any


def _as_dict(val: Any) -> dict[str, Any]:
    return val if isinstance(val, dict) else {}


def _as_list(val: Any) -> list[Any]:
    return list(val) if isinstance(val, list) else []


def run_advanced_review_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    judge_verdict: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Production-style judge hints for Remote. Deterministic; never paints."""
    strat = _as_dict(strategy)
    sim = _as_dict(simulation)
    obs = _as_dict(observe_facts)
    prior = _as_dict(judge_verdict)
    flag = _as_dict(flags)

    issues: list[dict[str, Any]] = []
    warnings = _as_list(sim.get("warnings"))
    for w in warnings[:8]:
        text = str(w).strip()
        if text:
            issues.append({"lane": "simulation", "severity": "warn", "message": text})

    anti = _as_list(strat.get("anti_category_strategy") or flag.get("anti_category_strategy"))
    avoid_hits = [str(x) for x in anti if str(x).lower().startswith("avoid:")]
    if len(avoid_hits) >= 3:
        issues.append(
            {
                "lane": "anti_slop",
                "severity": "info",
                "message": f"{len(avoid_hits)} ANTI-CATEGORY avoids active",
            }
        )

    hero = obs.get("hero_coverage")
    try:
        hero_n = float(hero) if hero is not None else None
    except (TypeError, ValueError):
        hero_n = None
    if hero_n is not None and hero_n < 0.45:
        issues.append(
            {
                "lane": "hierarchy",
                "severity": "warn",
                "message": f"hero_coverage={hero_n:.2f} below premium floor",
            }
        )

    score = 88
    if any(i.get("severity") == "warn" for i in issues):
        score -= 8 * sum(1 for i in issues if i.get("severity") == "warn")
    if prior.get("score") is not None:
        try:
            score = int(round((score + float(prior["score"])) / 2))
        except (TypeError, ValueError):
            pass
    score = max(40, min(98, score))
    status = "pass" if score >= 70 else "revise"

    return {
        "status": status,
        "score": score,
        "issues": issues[:12],
        "summary": (
            f"private review {status} score={score} issues={len(issues)}"
            + (f" · {prompt[:40]}" if prompt else "")
        )[:240],
        "provider": "private-review",
    }


def run_optimize_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    simulation: dict[str, Any] | None = None,
    counterfactual: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Suggest Opt priorities (not applied ops)."""
    _ = flags
    strat = _as_dict(strategy)
    sim = _as_dict(simulation)
    cf = _as_dict(counterfactual)
    actions: list[str] = []

    for adj in _as_list(sim.get("adjustments"))[:6]:
        text = str(adj).strip()
        if text:
            actions.append(text)

    draft = _as_dict(cf.get("repair_plan_draft"))
    for step in _as_list(draft.get("actions"))[:6]:
        if isinstance(step, dict):
            text = str(step.get("summary") or step.get("op") or "").strip()
        else:
            text = str(step).strip()
        if text and text not in actions:
            actions.append(text)

    thesis = str(strat.get("visual_thesis") or "").strip()
    if thesis:
        actions.append(f"protect visual thesis: {thesis[:80]}")

    if not actions:
        actions = [
            "raise primary focal contrast",
            "cut one competing secondary motif",
            "verify CTA attention ≥ 10%",
        ]

    return {
        "actions": actions[:10],
        "priority": "repair" if _as_list(sim.get("warnings")) else "polish",
        "summary": f"optimize {len(actions)} actions" + (f" · {prompt[:40]}" if prompt else ""),
        "applied": False,
        "provider": "private-optimize",
    }


def run_retrieve_memory_pipeline(
    *,
    prompt: str = "",
    scene_key: str = "",
    memory_notes: list[str] | None = None,
    flags: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Taste / preference retrieval from private Taste KG (seed + runtime)."""
    from recombyn_intelligence_service.engines.taste_kg import (
        detect_category,
        search_taste,
    )

    flag = _as_dict(flags)
    res = _as_dict(research)
    category = str(res.get("category") or flag.get("taste_category") or "").strip()
    if not category:
        category = detect_category(prompt, scene_key)
    niches = [str(x) for x in _as_list(res.get("niches")) if str(x).strip()][:4]
    if not niches:
        niches = [str(x) for x in _as_list(flag.get("niches")) if str(x).strip()][:4]

    hit = search_taste(
        prompt=prompt,
        scene_key=scene_key,
        category=category,
        niches=niches,
        limit=8,
    )
    notes = [str(x).strip() for x in _as_list(hit.get("notes")) if str(x).strip()]

    for item in _as_list(memory_notes):
        text = str(item).strip()
        if text and text not in notes:
            notes.append(text)
    for key in ("memory_notes", "taste_notes", "user_preferences"):
        extra = flag.get(key)
        if isinstance(extra, list):
            for item in extra:
                text = str(item).strip()
                if text and text not in notes:
                    notes.append(text)
        elif isinstance(extra, dict):
            for k, v in extra.items():
                text = f"{k}:{v}".strip()
                if text and text not in notes:
                    notes.append(text)

    low = str(prompt or "").lower()
    if any(x in low for x in ("高级", "premium", "贵", "专业")):
        tip = "preference:premium_restraint"
        if tip not in notes:
            notes.append(tip)
    if any(x in low for x in ("极简", "minimal", "留白")):
        tip = "preference:high_whitespace"
        if tip not in notes:
            notes.append(tip)

    prefs = _as_dict(hit.get("preferences"))
    prefs["premium"] = bool(prefs.get("premium")) or any(
        "premium" in n for n in notes
    )
    prefs["anti_glow"] = bool(prefs.get("anti_glow")) or any(
        "glow" in n or "editorial_not_glow" in n for n in notes
    )
    prefs["whitespace"] = bool(prefs.get("whitespace")) or any(
        "whitespace" in n or "留白" in n for n in notes
    )

    return {
        "notes": notes[:16],
        "principles": list(hit.get("principles") or [])[:12],
        "preferences": prefs,
        "category": hit.get("category") or category,
        "niches": list(hit.get("niches") or niches)[:4],
        "ids": list(hit.get("ids") or [])[:12],
        "scores": list(hit.get("scores") or [])[:12],
        "hits": list(hit.get("hits") or [])[:12],
        "related_triples": list(hit.get("related_triples") or [])[:8],
        "retrieval": hit.get("retrieval") or "hashed-ngram-v1",
        "embed_dim": hit.get("embed_dim"),
        "embed_backend": hit.get("embed_backend"),
        "embed_model": hit.get("embed_model"),
        "summary": hit.get("summary") or f"memory notes={len(notes)}",
        "store": "private-taste-kg",
        "private_signals": hit.get("private_signals")
        or {"provider_tier": "private", "niches": niches},
        "provider": "private-memory",
    }


def run_write_principle_pipeline(
    *,
    prompt: str = "",
    scene_key: str = "",
    strategy: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    governance: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist principles into private Taste KG (runtime JSON + SPO triples)."""
    from recombyn_intelligence_service.engines.taste_kg import (
        detect_category,
        write_principles,
    )

    flag = _as_dict(flags)
    strat = _as_dict(strategy)
    res = _as_dict(research)
    gov = _as_dict(governance)
    principles: list[str] = []

    thesis = str(strat.get("visual_thesis") or "").strip()
    if thesis:
        principles.append(f"thesis:{thesis[:120]}")
    for line in _as_list(res.get("anti_category_strategy"))[:6]:
        text = str(line).strip()
        if text:
            principles.append(f"research:{text[:100]}")
    for check in _as_list(res.get("paint_checks"))[:4]:
        text = str(check).strip()
        if text:
            principles.append(f"paint_check:{text[:80]}")
    for niche in _as_list(res.get("niches"))[:3]:
        text = str(niche).strip()
        if text:
            principles.append(f"niche:{text}")
    status = str(gov.get("status") or "").strip()
    if status == "pass":
        principles.append("governance:last_pass")
    elif status == "fail":
        # Still learn the failure as a principle, but tag repair.
        principles.append("governance:last_fail_repair")
        for expl in _as_list(gov.get("explain"))[:3]:
            text = str(expl).strip()
            if text:
                principles.append(f"governance_explain:{text[:100]}")

    if not principles and prompt:
        principles.append(f"goal_echo:{prompt[:100]}")

    category = str(res.get("category") or flag.get("taste_category") or "").strip()
    niches = [str(x) for x in _as_list(res.get("niches")) if str(x).strip()]
    if niches and not category:
        category = niches[0]
    if not category:
        category = detect_category(prompt, scene_key)

    stored = write_principles(
        principles,
        category=category,
        prompt=prompt,
        source="run",
    )
    return {
        "principles": list(stored.get("principles") or principles)[:12],
        "written": bool(stored.get("written")),
        "ids": list(stored.get("ids") or []),
        "added": stored.get("added"),
        "category": category,
        "niches": niches[:4],
        "store": stored.get("store") or "private-taste-kg",
        "summary": stored.get("summary") or f"wrote {len(principles)} principles",
        "private_signals": {
            "provider_tier": "private",
            "category": category,
            "niches": niches[:4],
        },
        "provider": "private-principle",
    }
