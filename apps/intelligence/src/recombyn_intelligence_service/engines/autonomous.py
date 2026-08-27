"""Autonomous Art Director.

Goal-only hop plan + sync. Never emits canvas tool_ops. Never paints.
"""

from __future__ import annotations

import re
from typing import Any

from recombyn_intelligence_service.engines._schemas import (
    AUTONOMOUS_HOPS,
    parse_autonomous_art_director,
)

_MICRO_EDIT_RX = re.compile(
    r"(调整标题|改一下标题|帮我调|挪一下|改成|字号|换色|改色|"
    r"resize\s+(the\s+)?title|move\s+(the\s+)?title|change\s+the\s+(title|color|font)|"
    r"make\s+(it|the\s+title)\s+(bigger|smaller)|nudge\b)",
    re.I,
)
_GOAL_RX = re.compile(
    r"(我要一个|做一个|官网|landing\s*page|显得更|更贵|更专业|科技感|"
    r"premium|professional|tech(?:nical|nology)?\s*feel|brand\s*site|"
    r"campaign|视觉方向|设计策略|art\s*direction)",
    re.I,
)

_HOP_SLOT: dict[str, str] = {
    "research": "design_research",
    "strategy": "design_strategy",
    "reference": "reference_dna",
    "candidates": "design_candidates",
    "tournament": "design_tournament",
    "swarm": "design_swarm",
    "simulation": "design_simulation",
    "counterfactual": "design_counterfactual",
    "governance": "design_governance",
    "optimization": "optimization",
    "review": "judge_verdict",
}


def classify_autonomous_mode(prompt: str) -> str:
    """Return goal | micro_edit | idle from user text."""
    text = str(prompt or "").strip()
    if not text:
        return "idle"
    if _MICRO_EDIT_RX.search(text) and not _GOAL_RX.search(text):
        return "micro_edit"
    if _GOAL_RX.search(text):
        return "goal"
    if len(text) >= 40 and not _MICRO_EDIT_RX.search(text):
        return "goal"
    return "idle"


def is_goal_only_prompt(prompt: str) -> bool:
    return classify_autonomous_mode(prompt) == "goal"


def _hop_row(hop_id: str, status: str = "pending", note: str = "") -> dict[str, Any]:
    return {"id": hop_id, "status": status, "note": note}


def build_autonomous_plan(
    *,
    prompt: str = "",
    intent: str = "",
    force: bool | None = None,
) -> dict[str, Any]:
    """Build host-owned hop plan. Never includes tool_ops."""
    mode = classify_autonomous_mode(prompt)
    if force is True:
        mode = "goal"
    elif force is False:
        mode = "micro_edit" if mode == "goal" else mode
    active = mode == "goal"
    goal = str(prompt or "").strip()[:800]
    hops: list[dict[str, Any]] = []
    for hid in AUTONOMOUS_HOPS:
        if not active:
            hops.append(_hop_row(hid, "skipped", "not autonomous"))
            continue
        if hid == "intent":
            note = f"intent={intent or 'design'}" if intent else "goal intake"
            hops.append(_hop_row(hid, "done" if intent else "pending", note))
        elif hid in (
            "execution",
            "observe",
            "review",
            "optimization",
            "governance",
            "knowledge",
        ):
            hops.append(_hop_row(hid, "deferred", "kernel or later stage"))
        else:
            hops.append(_hop_row(hid, "pending", ""))
    summary = (
        "Autonomous Art Director: goal → Research → Strategy → Tournament → Governance → Final"
        if active
        else (
            "micro-edit path (no full OS orchestration)"
            if mode == "micro_edit"
            else "autonomous idle"
        )
    )
    return parse_autonomous_art_director(
        {
            "active": active,
            "goal": goal,
            "mode": mode,
            "hops": hops,
            "summary": summary,
        }
    )


def sync_autonomous_hops(
    plan: dict[str, Any] | None,
    *,
    slots: dict[str, Any] | None = None,
    painted: bool = False,
    observe: dict[str, Any] | None = None,
    governance: dict[str, Any] | None = None,
    knowledge_written: bool = False,
    reference_analyze: Any = None,
) -> dict[str, Any]:
    """Refresh hop statuses from provided slot map. Never mutates canvas."""
    base = parse_autonomous_art_director(plan or {})
    if not base.get("active"):
        return base
    slot_map: dict[str, Any] = dict(slots or {})
    if observe:
        slot_map["observe"] = observe
    if governance:
        slot_map["governance"] = governance
    if painted:
        slot_map["execution"] = True

    hops_out: list[dict[str, Any]] = []
    for row in list(base.get("hops") or []):
        if not isinstance(row, dict):
            continue
        hid = str(row.get("id") or "")
        status = str(row.get("status") or "pending")
        note = str(row.get("note") or "")
        if hid == "intent" and slot_map.get("intent"):
            status, note = "done", f"intent={slot_map['intent']}"
        elif hid == "brief" and slot_map.get("brief"):
            status, note = "done", "brief locked"
        elif hid == "reference" and (slot_map.get("reference") or reference_analyze):
            status, note = "done", "reference DNA"
        elif hid == "execution" and slot_map.get("execution"):
            status, note = "done", "paint applied (kernel)"
        elif hid == "observe" and slot_map.get("observe"):
            status, note = "done", "observe facts"
        elif hid == "governance" and isinstance(slot_map.get("governance"), dict):
            gstat = str(slot_map["governance"].get("status") or "")
            status = "done"
            note = f"governance={gstat or 'checked'}"
        elif hid in _HOP_SLOT and slot_map.get(hid):
            status, note = "done", f"{hid} ready"
        elif hid == "final":
            ready = all(
                slot_map.get(k)
                for k in ("research", "strategy", "candidates", "tournament")
            )
            if ready:
                status, note = "done", "pre-paint OS chain complete"
            else:
                status, note = "pending", "awaiting intelligence chain"
        elif hid == "knowledge":
            if knowledge_written:
                status, note = "done", "KG / memory writeback"
            else:
                status = "deferred"
        hops_out.append(_hop_row(hid, status, note))

    base["hops"] = hops_out
    done_n = sum(1 for h in hops_out if h.get("status") == "done")
    base["summary"] = (
        f"Autonomous Art Director: {done_n}/{len(hops_out)} hops done · "
        f"goal={str(base.get('goal') or '')[:80]}"
    )[:240]
    return parse_autonomous_art_director(base)


def plan_autonomous_pipeline(
    *,
    prompt: str = "",
    intent: str = "",
    force_autonomous: bool | None = None,
) -> dict[str, Any]:
    """Decide-start plan phase. Chat/ask stay idle unless forced."""
    force_b = force_autonomous
    if intent in ("chat", "ask") and force_b is not True:
        plan = build_autonomous_plan(prompt=prompt, intent=intent, force=False)
        plan["active"] = False
        plan["mode"] = "idle"
        for hop in list(plan.get("hops") or []):
            if isinstance(hop, dict):
                hop["status"] = "skipped"
                hop["note"] = "chat/ask"
        return parse_autonomous_art_director(plan)
    return build_autonomous_plan(prompt=prompt, intent=intent, force=force_b)


def sync_autonomous_pipeline(
    *,
    prior: dict[str, Any] | None = None,
    prompt: str = "",
    intent: str = "",
    design_research: Any = None,
    design_strategy: Any = None,
    design_candidates: Any = None,
    design_tournament: Any = None,
    design_swarm: Any = None,
    design_simulation: Any = None,
    design_counterfactual: Any = None,
    design_governance: Any = None,
    reference_dna: Any = None,
    reference_analyze: Any = None,
    design_brief: Any = None,
    observe_facts: Any = None,
    painted: bool = False,
    knowledge_written: bool = False,
    judge_verdict: Any = None,
    optimization: Any = None,
) -> dict[str, Any] | None:
    """After intelligence hops: refresh statuses. Returns None if inactive."""
    plan = prior if isinstance(prior, dict) else None
    if not plan or not plan.get("active"):
        return plan if isinstance(plan, dict) else None

    brief_ok = isinstance(design_brief, dict) and bool(design_brief)

    slots: dict[str, Any] = {
        "research": design_research if isinstance(design_research, dict) and design_research else None,
        "strategy": design_strategy if isinstance(design_strategy, dict) and design_strategy else None,
        "reference": reference_dna if isinstance(reference_dna, dict) and reference_dna else None,
        "candidates": design_candidates if isinstance(design_candidates, dict) and design_candidates else None,
        "tournament": design_tournament if isinstance(design_tournament, dict) and design_tournament else None,
        "swarm": design_swarm if isinstance(design_swarm, dict) and design_swarm else None,
        "simulation": design_simulation if isinstance(design_simulation, dict) and design_simulation else None,
        "counterfactual": design_counterfactual
        if isinstance(design_counterfactual, dict) and design_counterfactual
        else None,
        "governance": design_governance if isinstance(design_governance, dict) and design_governance else None,
        "optimization": optimization,
        "review": judge_verdict,
        "brief": brief_ok or None,
        "intent": str(intent or "").strip() or None,
    }
    return sync_autonomous_hops(
        plan,
        slots=slots,
        painted=painted,
        observe=observe_facts if isinstance(observe_facts, dict) else None,
        governance=design_governance if isinstance(design_governance, dict) else None,
        knowledge_written=knowledge_written,
        reference_analyze=reference_analyze,
    )
