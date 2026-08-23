"""Public intelligence / governance / autonomous contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# Canonical DesignIntelligenceClient / IntelligenceProvider method names.
INTELLIGENCE_METHODS: tuple[str, ...] = (
    "analyze_reference",
    "research",
    "strategy",
    "propose_candidates",
    "tournament",
    "swarm_direction",
    "simulate",
    "counterfactual",
    "review",
    "optimize",
    "govern",
    "autonomous_plan",
    "autonomous_sync",
    "retrieve_memory",
    "write_principle",
)

# JSON body keys for POST /v1/{method} (RemoteIntelligenceProvider).
INTELLIGENCE_REQUEST_FIELDS: tuple[str, ...] = (
    "method",
    "prompt",
    "scene_key",
    "intent",
    "flags",
    "images",
    "painted",
    "knowledge_written",
    "design_brief",
    "design_research",
    "design_strategy",
    "design_candidates",
    "design_tournament",
    "design_swarm",
    "design_simulation",
    "design_counterfactual",
    "design_governance",
    "autonomous_art_director",
    "reference_dna",
    "reference_analyze",
    "reference_lock",
    "observe_facts",
    "visual_diff",
    "judge_verdict",
    "eval_patterns",
    "memory_notes",
    "apply_ops",
)

TOURNAMENT_DIMS: tuple[str, ...] = (
    "composition",
    "typography",
    "brand",
    "originality",
    "user_fit",
    "technical",
)

GOVERNANCE_LANES: tuple[str, ...] = (
    "brand",
    "accessibility",
    "copyright",
    "reference_similarity",
    "design_system",
    "content",
    "tool_permission",
)

AUTONOMOUS_HOPS: tuple[str, ...] = (
    "intent",
    "research",
    "strategy",
    "reference",
    "brief",
    "candidates",
    "tournament",
    "swarm",
    "simulation",
    "execution",
    "observe",
    "review",
    "optimization",
    "counterfactual",
    "governance",
    "knowledge",
    "final",
)


def intelligence_wire_methods() -> frozenset[str]:
    """Canonical HTTP methods."""
    return frozenset(INTELLIGENCE_METHODS)


def remote_result_usable(method: str, data: dict[str, Any] | None) -> bool:
    """True when a remote JSON body should be trusted instead of BasicLocal.

    Empty ``{}`` stubs must fall through so Kernel quality does not regress
    when an optional remote is up but unimplemented.
    """
    if not isinstance(data, dict) or not data:
        return False
    name = str(method or "").strip()
    if name == "govern":
        return bool(str(data.get("status") or "").strip())
    return any(
        str(k) not in ("method",) and v not in (None, "", [], {})
        for k, v in data.items()
    )


class GovernanceLaneResultSchema(BaseModel):
    """One governance lane check."""

    lane: str = ""
    status: Literal["pass", "fail", "warn"] = "pass"
    message: str = ""
    evidence: list[str] = Field(default_factory=list)
    fix: str = ""

    model_config = {"extra": "allow"}


class DesignGovernanceSchema(BaseModel):
    """Settle hard gate. FAIL → Explain → Repair."""

    status: Literal["pass", "fail"] = "pass"
    lanes: list[GovernanceLaneResultSchema] = Field(default_factory=list)
    explain: list[str] = Field(default_factory=list)
    repair_plan: dict[str, Any] | None = None
    summary: str = ""

    model_config = {"extra": "allow"}


class AutonomousHopSchema(BaseModel):
    """One hop in an autonomous orchestration plan."""

    id: str = ""
    status: Literal["pending", "running", "done", "skipped", "deferred"] = "pending"
    note: str = ""

    model_config = {"extra": "allow"}


class AutonomousArtDirectorSchema(BaseModel):
    """Goal-only orchestration plan (never paints)."""

    active: bool = False
    goal: str = ""
    mode: Literal["idle", "goal", "micro_edit"] = "idle"
    hops: list[AutonomousHopSchema] = Field(default_factory=list)
    summary: str = ""

    model_config = {"extra": "allow"}
