"""Art Director swarm (private). Never paints.

Diff vs BasicLocal:
- niche-aware specialist proposals + extra conflict topics
- research paint_checks / decide_directives folded into final_direction
- tournament rubric hint in AD summary
- private_signals on result
"""
from __future__ import annotations

from typing import Any

from recombyn_intelligence_service.engines._schemas import parse_design_swarm
from recombyn_intelligence_service.engines.research import _detect_niches

_SWARM_SUBAGENT_IDS: tuple[str, ...] = (
    "art_director",
    "visual_lead",
    "ux_lead",
    "brand_lead",
    "composer",
    "imagery",
    "type",
    "color",
)

_NICHE_SPECIALIST_OVERRIDES: dict[str, dict[str, dict[str, str]]] = {
    "seasonal_event": {
        "composer": {
            "action": "hero motif ≥55% frame; ornaments <15%; protect empty margins",
            "rationale": "Event posters die when ornaments compete with the motif.",
        },
        "type": {
            "action": "one primary title block; date/venue as secondary band only",
            "rationale": "Title must read at poster distance without eating the hero.",
        },
        "color": {
            "action": "2–3 ink palette; one accent for date or CTA sticker max",
            "rationale": "Limited ink reads premium vs rainbow event kitsch.",
        },
        "imagery": {
            "action": "one tactile event motif owns the frame — no clipart collage",
            "rationale": "Single motif memory > stock spooky/christmas collage.",
        },
    },
    "auth_ui": {
        "ux_lead": {
            "action": "form-first hierarchy; one primary submit; quiet chrome",
            "rationale": "Auth success = scan path to credentials, not hero photo.",
        },
        "composer": {
            "action": "keep form column stable; do not enlarge brand mark into form area",
            "rationale": "Brand mark must not steal focus from inputs.",
        },
        "type": {
            "action": "input labels readable; headline restrained vs form",
            "rationale": "Display type must not overpower the form.",
        },
        "imagery": {
            "action": "no split-screen stock photo wall; soft brand field only",
            "rationale": "Auth clichés start with decorative photo panels.",
        },
    },
    "type_specimen": {
        "type": {
            "action": "display contrast is the hero; specimen sizes own hierarchy",
            "rationale": "Type specimen lives or dies on contrast, not decoration.",
        },
        "composer": {
            "action": "grid for specimens; protect tracking/leading air",
            "rationale": "Whitespace is part of the type system.",
        },
        "imagery": {
            "action": "no photo hero unless letterforms are the image",
            "rationale": "Imagery must not compete with type as subject.",
        },
    },
    "ecommerce": {
        "ux_lead": {
            "action": "one buy path; price+CTA cluster; mute badge noise",
            "rationale": "Commerce conversion needs a single decisive action.",
        },
        "imagery": {
            "action": "product is hero; lifestyle only if it clarifies material",
            "rationale": "Product clarity over lifestyle wallpaper.",
        },
        "color": {
            "action": "brand + one urgency accent max; no rainbow promo stack",
            "rationale": "Promo rainbow destroys trust and scan path.",
        },
    },
}


def _niches_from(
    *,
    prompt: str,
    strategy: dict[str, Any],
    research: dict[str, Any],
) -> list[str]:
    niches = [str(x) for x in list(research.get("niches") or []) if str(x).strip()]
    if niches:
        return niches[:4]
    from_strat = [str(x) for x in list(strategy.get("niches") or []) if str(x).strip()]
    if from_strat:
        return from_strat[:4]
    return _detect_niches(prompt)[:4]


def swarm_goal(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    tournament: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Art Director intake: goal + winning strategy + niche context."""
    strat = strategy if isinstance(strategy, dict) else {}
    tourney = tournament if isinstance(tournament, dict) else {}
    res = research if isinstance(research, dict) else {}
    thesis = str(strat.get("visual_thesis") or "").strip()
    positioning = str(strat.get("positioning") or "").strip()
    winner = str(tourney.get("winner_id") or "").strip()
    rubric = str(tourney.get("rubric_id") or "").strip()
    niches = _niches_from(prompt=prompt, strategy=strat, research=res)
    summary_bits = [b for b in (positioning, thesis) if b]
    if winner:
        summary_bits.append(f"tournament_winner={winner}")
    if rubric:
        summary_bits.append(f"rubric={rubric}")
    if niches:
        summary_bits.append(f"niches={','.join(niches)}")
    return {
        "goal": str(prompt or "").strip()[:800],
        "strategy_summary": " · ".join(summary_bits)[:280],
        "strategy": strat,
        "tournament": tourney,
        "research": res,
        "niches": niches,
    }


def delegate_specialists(intake: dict[str, Any]) -> list[dict[str, Any]]:
    """Leads + craft specialists; niche overlays rewrite key actions."""
    strat = intake.get("strategy") if isinstance(intake.get("strategy"), dict) else {}
    niches = [str(x) for x in list(intake.get("niches") or []) if str(x).strip()]
    comp = str(strat.get("composition_strategy") or "").strip() or "clear hierarchy"
    typo = str(strat.get("typography_strategy") or "").strip() or "purposeful type contrast"
    imagery = str(strat.get("imagery_strategy") or "").strip() or "specific imagery"
    color = str(strat.get("color_strategy") or "").strip() or "limited palette"
    interaction = str(strat.get("interaction_strategy") or "").strip()
    anti = list(strat.get("anti_category_strategy") or [])[:6]
    paint_checks = [
        str(x)
        for x in list((intake.get("research") or {}).get("paint_checks") or [])
        + list(strat.get("paint_checks") or [])
        if str(x).strip()
    ][:6]

    proposals: list[dict[str, Any]] = [
        {
            "agent_id": "visual_lead",
            "role": "Visual Lead",
            "topic": "composition",
            "action": f"own the visual system around: {comp}",
            "rationale": "Visual Lead holds composition + imagery coherence.",
        },
        {
            "agent_id": "ux_lead",
            "role": "UX Lead",
            "topic": "ux",
            "action": interaction or "one primary task path; quiet secondary chrome",
            "rationale": "UX Lead protects scan path and CTA clarity.",
        },
        {
            "agent_id": "brand_lead",
            "role": "Brand Lead",
            "topic": "brand",
            "action": (
                "hold brand voice; enforce anti-category avoid list"
                if anti
                else "hold brand voice and token rhythm"
            ),
            "rationale": "Brand Lead guards differentiation.",
        },
        {
            "agent_id": "composer",
            "role": "Composer",
            "topic": "composition",
            "action": "protect whitespace; do not enlarge title if it breaks empty space",
            "rationale": "Composer owns layout balance and breathing room.",
        },
        {
            "agent_id": "imagery",
            "role": "Imagery",
            "topic": "imagery",
            "action": f"commit imagery to: {imagery}",
            "rationale": "Imagery owns material / photo metaphor.",
        },
        {
            "agent_id": "type",
            "role": "Type",
            "topic": "typography",
            "action": "title should be larger for hierarchy punch",
            "rationale": f"Type wants stronger display presence ({typo}).",
        },
        {
            "agent_id": "color",
            "role": "Color",
            "topic": "color",
            "action": f"lock palette to: {color}",
            "rationale": "Color owns accent budget.",
        },
    ]

    # Apply first matching niche overlay (deterministic order).
    for niche in niches:
        overrides = _NICHE_SPECIALIST_OVERRIDES.get(niche) or {}
        if not overrides:
            continue
        by_id = {str(p.get("agent_id") or ""): p for p in proposals}
        for agent_id, patch in overrides.items():
            row = by_id.get(agent_id)
            if not row:
                continue
            if patch.get("action"):
                row["action"] = patch["action"]
            if patch.get("rationale"):
                row["rationale"] = patch["rationale"]
            row["niche"] = niche
        break

    if paint_checks:
        proposals.append(
            {
                "agent_id": "art_director",
                "role": "Art Director",
                "topic": "gates",
                "action": "enforce paint_checks: " + ", ".join(paint_checks[:5]),
                "rationale": "Private research gates must survive into Decide.",
            }
        )
    return proposals


def detect_conflicts(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Opposing specialist actions — BasicLocal title conflict + niche extras."""
    by_id = {
        str(p.get("agent_id") or ""): p
        for p in proposals
        if isinstance(p, dict) and p.get("agent_id")
    }
    conflicts: list[dict[str, Any]] = []
    type_p = by_id.get("type")
    composer_p = by_id.get("composer")
    if type_p and composer_p:
        type_act = str(type_p.get("action") or "").lower()
        comp_act = str(composer_p.get("action") or "").lower()
        type_bigger = (
            "larger" in type_act
            or "bigger" in type_act
            or "enlarge" in type_act
            or "display contrast is the hero" in type_act
        )
        comp_protect = (
            "whitespace" in comp_act
            or "do not enlarge" in comp_act
            or "protect" in comp_act
            or "hero motif" in comp_act
            or "air" in comp_act
        )
        if type_bigger and comp_protect:
            conflicts.append(
                {
                    "topic": "title_scale_vs_whitespace",
                    "proposers": ["type", "composer"],
                    "proposals": [
                        str(type_p.get("action") or ""),
                        str(composer_p.get("action") or ""),
                    ],
                    "resolution": "",
                    "resolved_by": "art_director",
                }
            )

    imagery_p = by_id.get("imagery")
    if imagery_p and composer_p:
        img_act = str(imagery_p.get("action") or "").lower()
        comp_act = str(composer_p.get("action") or "").lower()
        if (
            ("collage" in img_act or "lifestyle" in img_act)
            and ("hero" in comp_act or "protect" in comp_act or "motif" in comp_act)
        ):
            conflicts.append(
                {
                    "topic": "imagery_vs_hero_budget",
                    "proposers": ["imagery", "composer"],
                    "proposals": [
                        str(imagery_p.get("action") or ""),
                        str(composer_p.get("action") or ""),
                    ],
                    "resolution": "",
                    "resolved_by": "art_director",
                }
            )

    color_p = by_id.get("color")
    brand_p = by_id.get("brand_lead")
    if color_p and brand_p:
        color_act = str(color_p.get("action") or "").lower()
        brand_act = str(brand_p.get("action") or "").lower()
        if ("accent" in color_act or "urgency" in color_act) and (
            "anti-category" in brand_act or "avoid" in brand_act
        ):
            conflicts.append(
                {
                    "topic": "accent_vs_anti_category",
                    "proposers": ["color", "brand_lead"],
                    "proposals": [
                        str(color_p.get("action") or ""),
                        str(brand_p.get("action") or ""),
                    ],
                    "resolution": "",
                    "resolved_by": "art_director",
                }
            )
    return conflicts


def art_director_resolve(
    intake: dict[str, Any],
    proposals: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Art Director arbitrates with niche-aware resolutions."""
    resolved: list[dict[str, Any]] = []
    directions: list[str] = []
    strat = intake.get("strategy") if isinstance(intake.get("strategy"), dict) else {}
    niches = [str(x) for x in list(intake.get("niches") or []) if str(x).strip()]
    thesis = str(strat.get("visual_thesis") or "").strip()
    if thesis:
        directions.append(f"hold visual thesis: {thesis}")
    if niches:
        directions.append(f"niche lock: {', '.join(niches)}")

    for conflict in conflicts:
        topic = str(conflict.get("topic") or "")
        item = dict(conflict)
        if topic == "title_scale_vs_whitespace":
            if "type_specimen" in niches:
                item["resolution"] = "keep display contrast; shrink secondary chrome"
                directions.append(
                    "keep display type contrast; shrink chrome (AD niche resolve)"
                )
            elif "seasonal_event" in niches or "poster" in str(
                (intake.get("research") or {}).get("category") or ""
            ):
                item["resolution"] = "keep hero coverage; title as one secondary band"
                directions.append(
                    "keep hero ≥55%; title one block, not enlarged into hero (AD)"
                )
            else:
                item["resolution"] = "keep type size; reposition title"
                directions.append("keep title size; change title position (AD resolve)")
        elif topic == "imagery_vs_hero_budget":
            item["resolution"] = "single motif/product owns frame; kill collage extras"
            directions.append("single hero image budget; no collage fight (AD)")
        elif topic == "accent_vs_anti_category":
            item["resolution"] = "one accent max; never rainbow / purple SaaS cliché"
            directions.append("one accent only; anti-category color hold (AD)")
        else:
            item["resolution"] = "defer to Visual Lead composition"
            directions.append(f"resolve {topic}: defer to Visual Lead")
        item["resolved_by"] = "art_director"
        resolved.append(item)

    conflicted_agents = {
        a for c in resolved for a in list(c.get("proposers") or []) if str(a)
    }
    for prop in proposals:
        if not isinstance(prop, dict):
            continue
        aid = str(prop.get("agent_id") or "")
        if aid == "art_director":
            directions.append(f"AD gate: {prop.get('action')}")
            continue
        if aid in conflicted_agents or aid in ("visual_lead", "ux_lead", "brand_lead"):
            if aid in ("visual_lead", "ux_lead", "brand_lead"):
                directions.append(f"{prop.get('role')}: {prop.get('action')}")
            continue
        directions.append(f"{prop.get('role')}: {prop.get('action')}")

    for line in list(strat.get("decide_directives") or [])[:4]:
        text = str(line).strip()
        if text:
            directions.append(f"directive: {text}")

    seen: set[str] = set()
    unique: list[str] = []
    for line in directions:
        text = str(line).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return resolved, unique[:18]


def assemble_swarm_result(
    intake: dict[str, Any],
    proposals: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    final_direction: list[str],
) -> dict[str, Any]:
    niches = [str(x) for x in list(intake.get("niches") or []) if str(x).strip()]
    summary = (
        f"delegated={len(proposals)} conflicts={len(conflicts)} "
        f"directions={len(final_direction)}"
        + (f" niches={','.join(niches)}" if niches else "")
    )
    return parse_design_swarm(
        {
            "goal": intake.get("goal") or "",
            "strategy_summary": intake.get("strategy_summary") or "",
            "delegated": proposals,
            "conflicts": conflicts,
            "final_direction": final_direction,
            "need_subagents": list(_SWARM_SUBAGENT_IDS),
            "summary": summary,
            "niches": niches,
            "private_signals": {
                "stage": "niche_swarm",
                "provider_tier": "private",
                "niches": niches,
                "conflict_topics": [
                    str(c.get("topic") or "")
                    for c in conflicts
                    if isinstance(c, dict) and c.get("topic")
                ][:8],
            },
        }
    )


def run_design_swarm_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    tournament: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Full private swarm. Deterministic; never paints."""
    intake = swarm_goal(
        prompt=prompt,
        strategy=strategy,
        tournament=tournament,
        research=research,
    )
    proposals = delegate_specialists(intake)
    conflicts = detect_conflicts(proposals)
    resolved, directions = art_director_resolve(intake, proposals, conflicts)
    return assemble_swarm_result(intake, proposals, resolved, directions)
