"""Art Director Swarm (P36) — BasicLocal floor.

Kernel path: Decide → IntelligenceClient.swarm_direction → BasicLocal → here.

BasicLocal: fixed specialist set + type/composer conflict arbitration.

Never emits canvas tool_ops. Art Director arbitrates conflicts.
"""
from __future__ import annotations

from typing import Any

from app.services.design.runtime.graph.state import (
    AgentRuntime,
    parse_design_swarm,
)
from app.services.design.runtime.graph.emit_sse import _emit

# Catalog ids exposed via need_subagents (align with Profile spawn names when present).
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


def swarm_goal(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    tournament: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Art Director intake: goal + winning strategy summary."""
    strat = strategy if isinstance(strategy, dict) else {}
    tourney = tournament if isinstance(tournament, dict) else {}
    thesis = str(strat.get("visual_thesis") or "").strip()
    positioning = str(strat.get("positioning") or "").strip()
    winner = str(tourney.get("winner_id") or "").strip()
    summary_bits = [b for b in (positioning, thesis) if b]
    if winner:
        summary_bits.append(f"tournament_winner={winner}")
    return {
        "goal": str(prompt or "").strip()[:800],
        "strategy_summary": " · ".join(summary_bits)[:240],
        "strategy": strat,
        "tournament": tourney,
    }


def delegate_specialists(intake: dict[str, Any]) -> list[dict[str, Any]]:
    """Leads + craft specialists propose actions from Strategy (no paint)."""
    strat = intake.get("strategy") if isinstance(intake.get("strategy"), dict) else {}
    comp = str(strat.get("composition_strategy") or "").strip() or "clear hierarchy"
    typo = str(strat.get("typography_strategy") or "").strip() or "purposeful type contrast"
    imagery = str(strat.get("imagery_strategy") or "").strip() or "specific imagery"
    color = str(strat.get("color_strategy") or "").strip() or "limited palette"
    interaction = str(strat.get("interaction_strategy") or "").strip()
    anti = list(strat.get("anti_category_strategy") or [])[:6]

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
            "action": interaction
            or "one primary task path; quiet secondary chrome",
            "rationale": "UX Lead protects scan path and CTA clarity.",
        },
        {
            "agent_id": "brand_lead",
            "role": "Brand Lead",
            "topic": "brand",
            "action": (
                "hold brand voice; avoid category clichés"
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
    return proposals


def detect_conflicts(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Find opposing specialist actions (deterministic topic pairs)."""
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
        type_bigger = "larger" in type_act or "bigger" in type_act or "enlarge" in type_act
        comp_protect = (
            "whitespace" in comp_act
            or "do not enlarge" in comp_act
            or "protect" in comp_act
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
    return conflicts


def art_director_resolve(
    intake: dict[str, Any],
    proposals: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Art Director arbitrates. Example: keep type size, reposition title."""
    resolved: list[dict[str, Any]] = []
    directions: list[str] = []
    strat = intake.get("strategy") if isinstance(intake.get("strategy"), dict) else {}
    thesis = str(strat.get("visual_thesis") or "").strip()
    if thesis:
        directions.append(f"hold visual thesis: {thesis}")

    for conflict in conflicts:
        topic = str(conflict.get("topic") or "")
        item = dict(conflict)
        if topic == "title_scale_vs_whitespace":
            # Spec example: Typography wants bigger; Composition refuses;
            # Art Director keeps size, moves title.
            item["resolution"] = "keep type size; reposition title"
            directions.append("keep title size; change title position (AD resolve)")
        else:
            item["resolution"] = "defer to Visual Lead composition"
            directions.append(f"resolve {topic}: defer to Visual Lead")
        item["resolved_by"] = "art_director"
        resolved.append(item)

    # Non-conflicting specialist actions become final direction lines.
    conflicted_agents = {
        a for c in resolved for a in list(c.get("proposers") or []) if str(a)
    }
    for prop in proposals:
        if not isinstance(prop, dict):
            continue
        aid = str(prop.get("agent_id") or "")
        if aid in conflicted_agents or aid in ("visual_lead", "ux_lead", "brand_lead"):
            # Leads summarized separately; conflicted specialists replaced by AD.
            if aid in ("visual_lead", "ux_lead", "brand_lead"):
                directions.append(
                    f"{prop.get('role')}: {prop.get('action')}"
                )
            continue
        directions.append(f"{prop.get('role')}: {prop.get('action')}")

    # Dedupe while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for line in directions:
        text = str(line).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return resolved, unique[:16]


def assemble_swarm_result(
    intake: dict[str, Any],
    proposals: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    final_direction: list[str],
) -> dict[str, Any]:
    summary = (
        f"delegated={len(proposals)} conflicts={len(conflicts)} "
        f"directions={len(final_direction)}"
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
            "provider": "basic-local",
        }
    )


def run_design_swarm_pipeline(
    *,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    tournament: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """BasicLocal swarm. Deterministic; never paints."""
    intake = swarm_goal(prompt=prompt, strategy=strategy, tournament=tournament)
    proposals = delegate_specialists(intake)
    conflicts = detect_conflicts(proposals)
    resolved, directions = art_director_resolve(intake, proposals, conflicts)
    return assemble_swarm_result(intake, proposals, resolved, directions)


def should_run_design_swarm(rt: AgentRuntime) -> bool:
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    if getattr(rt, "design_strategy", None) or getattr(rt, "design_tournament", None):
        return True
    return False


def apply_swarm_to_runtime(rt: AgentRuntime, result: dict[str, Any]) -> None:
    """Stash swarm; merge AD directions into Brief notes."""
    clean = parse_design_swarm(result)
    rt.design_swarm = clean
    # Surface for Decide brief gate / prompt packing (existing field).
    directions = list(clean.get("final_direction") or [])
    if directions:
        detail = "ART_DIRECTOR_SWARM:\n" + "\n".join(f"- {d}" for d in directions[:10])
        rt.pending_subagent_details = detail[:2000]
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    if isinstance(brief, dict) and directions:
        notes = list(brief.get("swarm_directions") or [])
        for line in directions:
            text = str(line).strip()
            if text and text not in notes:
                notes.append(text)
        brief["swarm_directions"] = notes[:12]
        # If AD resolved title conflict, push avoid enlarge-title into avoid[].
        if any("keep title size" in str(d).lower() for d in directions):
            avoid = list(brief.get("avoid") or [])
            tip = "enlarge title that breaks whitespace"
            if tip not in avoid:
                avoid.append(tip)
            brief["avoid"] = avoid[:12]
        rt.design_brief = brief


def format_swarm_for_decide(result: dict[str, Any] | None) -> str:
    src = result if isinstance(result, dict) else {}
    if not src.get("final_direction") and not src.get("delegated"):
        return ""
    lines = [
        "DESIGN_SWARM (host-owned). Art Director arbitrates; specialists do not paint.",
        f"goal: {str(src.get('goal') or '')[:120]}",
    ]
    if src.get("strategy_summary"):
        lines.append(f"strategy: {src.get('strategy_summary')}")
    for conflict in list(src.get("conflicts") or [])[:4]:
        if not isinstance(conflict, dict):
            continue
        lines.append(
            f"CONFLICT {conflict.get('topic')}: "
            + " vs ".join(str(x) for x in list(conflict.get("proposals") or [])[:2])
        )
        lines.append(f"  AD: {conflict.get('resolution')}")
    dirs = list(src.get("final_direction") or [])[:10]
    if dirs:
        lines.append("FINAL DIRECTION:")
        lines.extend(f"- {d}" for d in dirs)
    subs = list(src.get("need_subagents") or [])[:8]
    if subs:
        lines.append("need_subagents: " + ", ".join(subs))
    return "\n".join(lines)[:1600]


async def run_design_swarm(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute Art Director Swarm. Fail-open."""
    if not should_run_design_swarm(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-swarm",
            "kind": "explored",
            "status": "running",
            "code": "design_swarm_running", "summary": "DESIGN_SWARM: Art Director → leads → craft · resolve conflicts",
        }
    )
    try:
        strategy = getattr(rt, "design_strategy", None)
        tournament = getattr(rt, "design_tournament", None)
        result = run_design_swarm_pipeline(
            prompt=str(getattr(rt, "prompt", "") or ""),
            strategy=strategy if isinstance(strategy, dict) else None,
            tournament=tournament if isinstance(tournament, dict) else None,
        )
        apply_swarm_to_runtime(rt, result)
        st.push_log(
            phase="design_swarm",
            summary=str(result.get("summary") or "")[:160],
            conflicts=len(result.get("conflicts") or []) or None,
            directions=len(result.get("final_direction") or []) or None,
        )
        _emit(
            {
                "type": "activity",
                "id": "design-swarm",
                "kind": "explored",
                "status": "done",
                "summary": (
                    f"DESIGN_SWARM: conflicts={len(result.get('conflicts') or [])} · "
                    f"directions={len(result.get('final_direction') or [])}"
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_swarm",
                "conflicts": list(result.get("conflicts") or [])[:4],
                "final_direction": list(result.get("final_direction") or [])[:10],
                "need_subagents": list(result.get("need_subagents") or [])[:8],
                "summary": str(result.get("summary") or "")[:240],
            }
        )
        block = format_swarm_for_decide(result)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return result
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_swarm_failed: {err}"[:240])
        st.push_log(
            phase="design_swarm",
            error=str(err)[:200],
            summary="design swarm failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-swarm",
                "kind": "explored",
                "status": "done",
                "code": "design_swarm_skipped", "summary": "DESIGN_SWARM: skipped (failed)",
            }
        )
        return None
