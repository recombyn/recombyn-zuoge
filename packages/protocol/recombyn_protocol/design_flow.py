"""Open design-flow schemas: Reference → Research → Strategy → … → Counterfactual."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ReferenceCompositionSchema(BaseModel):
    type: str = ""
    balance: str = ""
    axis: str = ""
    focal_position: str = ""

    model_config = {"extra": "allow"}


class ReferenceHierarchySchema(BaseModel):
    primary: str = ""
    secondary: str = ""
    tertiary: str = ""

    model_config = {"extra": "allow"}


class ReferencePaletteSchema(BaseModel):
    dominant: list[str] = Field(default_factory=list)
    secondary: list[str] = Field(default_factory=list)
    accent: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class ReferenceTypographySchema(BaseModel):
    scale: str = ""
    contrast: str = ""
    alignment: str = ""

    model_config = {"extra": "allow"}


class ReferenceImagerySchema(BaseModel):
    style: str = ""
    depth: str = ""
    lighting: str = ""

    model_config = {"extra": "allow"}


class ReferenceIntelligenceTurnSchema(BaseModel):
    """Vision structured read: visual laws + optional DNA axes."""

    composition: ReferenceCompositionSchema | dict[str, Any] = Field(default_factory=dict)
    hierarchy: ReferenceHierarchySchema | dict[str, Any] = Field(default_factory=dict)
    density: float | None = None
    palette: ReferencePaletteSchema | dict[str, Any] = Field(default_factory=dict)
    typography: ReferenceTypographySchema | dict[str, Any] = Field(default_factory=dict)
    imagery: ReferenceImagerySchema | dict[str, Any] = Field(default_factory=dict)
    grid: str = ""
    spacing: str = ""
    lighting: str = ""
    material: str = ""
    depth: str = ""
    contrast: str = ""
    rhythm: str = ""
    visual_dna: dict[str, float] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class ReferenceAnalyzeSchema(BaseModel):
    """Structured read of a reference image — laws, not 'looks premium'."""

    composition: ReferenceCompositionSchema | dict[str, Any] = Field(default_factory=dict)
    hierarchy: ReferenceHierarchySchema | dict[str, Any] = Field(default_factory=dict)
    density: float | None = None
    palette: ReferencePaletteSchema | dict[str, Any] = Field(default_factory=dict)
    typography: ReferenceTypographySchema | dict[str, Any] = Field(default_factory=dict)
    imagery: ReferenceImagerySchema | dict[str, Any] = Field(default_factory=dict)
    grid: str = ""
    spacing: str = ""
    lighting: str = ""
    material: str = ""
    depth: str = ""
    contrast: str = ""
    rhythm: str = ""

    model_config = {"extra": "allow"}


class ReferenceDnaSchema(BaseModel):
    """Why the reference looks this way — axes in [0, 1], not pixels."""

    visual_dna: dict[str, float] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class DesignResearchReportSchema(BaseModel):
    """Research pipeline report — category patterns + ANTI-CATEGORY."""

    category: str = ""
    common_patterns: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)
    adopt: list[str] = Field(default_factory=list)
    anti_category_strategy: list[str] = Field(default_factory=list)
    why_effective: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    summary: str = ""
    audience: str = ""
    industry: str = ""
    visual_directions: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class DesignStrategySchema(BaseModel):
    """Strategy Engine — Research → Strategy → Brief/Plan. Never mutates SceneDocument."""

    positioning: str = ""
    visual_thesis: str = ""
    differentiation: str = ""
    composition_strategy: str = ""
    typography_strategy: str = ""
    imagery_strategy: str = ""
    color_strategy: str = ""
    interaction_strategy: str = ""
    anti_category_strategy: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class DesignCandidateSchema(BaseModel):
    """One Multi-Candidate plan. Strategy variant — never canvas ops."""

    id: str = ""
    label: str = ""
    summary: str = ""
    strategy: DesignStrategySchema | dict[str, Any] = Field(default_factory=dict)
    selected: bool = False

    model_config = {"extra": "allow"}


class DesignCandidateSetSchema(BaseModel):
    """V1–V5 candidate set. Unselected never write user canvas."""

    candidates: list[DesignCandidateSchema] = Field(default_factory=list)
    primary_id: str = ""
    count: int = 0
    source_strategy: dict[str, Any] | None = None

    model_config = {"extra": "allow"}


class TournamentDimScoresSchema(BaseModel):
    """Multi-dim scores. Runtime-owned — not LLM total."""

    composition: float = 0.0
    typography: float = 0.0
    brand: float = 0.0
    originality: float = 0.0
    user_fit: float = 0.0
    technical: float = 0.0

    model_config = {"extra": "allow"}


class TournamentMatchSchema(BaseModel):
    round: int = 1
    a: str = ""
    b: str = ""
    winner: str = ""
    reason: str = ""
    dim_wins: dict[str, str] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class DesignTournamentResultSchema(BaseModel):
    """Bracket result. Winner / Runner-up / Alternative; user may override."""

    winner_id: str = ""
    runner_up_id: str = ""
    alternative_id: str = ""
    scores: dict[str, Any] = Field(default_factory=dict)
    bracket: list[TournamentMatchSchema] = Field(default_factory=list)
    user_pick: str = ""
    source: str = "bracket"  # bracket | user
    summary: str = ""

    model_config = {"extra": "allow"}


class SwarmProposalSchema(BaseModel):
    """One specialist proposal inside Art Director Swarm."""

    agent_id: str = ""
    role: str = ""
    topic: str = ""
    action: str = ""
    rationale: str = ""

    model_config = {"extra": "allow"}


class SwarmConflictSchema(BaseModel):
    """Conflict between specialists; Art Director resolves (never paints)."""

    topic: str = ""
    proposers: list[str] = Field(default_factory=list)
    proposals: list[str] = Field(default_factory=list)
    resolution: str = ""
    resolved_by: str = "art_director"

    model_config = {"extra": "allow"}


class DesignSwarmResultSchema(BaseModel):
    """Art Director Swarm — Goal → Delegate → Conflict → Final Direction."""

    goal: str = ""
    strategy_summary: str = ""
    delegated: list[SwarmProposalSchema] = Field(default_factory=list)
    conflicts: list[SwarmConflictSchema] = Field(default_factory=list)
    final_direction: list[str] = Field(default_factory=list)
    need_subagents: list[str] = Field(default_factory=list)
    summary: str = ""

    model_config = {"extra": "allow"}


class DesignSimulationAttentionSchema(BaseModel):
    """Predicted attention budget (sums ~1.0). Pre-paint only."""

    hero: float = 0.0
    headline: float = 0.0
    cta: float = 0.0
    nav: float = 0.0
    other: float = 0.0

    model_config = {"extra": "allow"}


class DesignSimulationSchema(BaseModel):
    """Design Simulation — predict before paint. Never mutates SceneDocument."""

    attention: DesignSimulationAttentionSchema | dict[str, Any] = Field(
        default_factory=dict
    )
    hierarchy: float = 0.0
    readability: float = 0.0
    density: float = 0.0
    conversion: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    adjustments: list[str] = Field(default_factory=list)
    attention_adjusted: DesignSimulationAttentionSchema | dict[str, Any] | None = None
    summary: str = ""

    model_config = {"extra": "allow"}


CounterfactualKind = Literal[
    "remove", "resize", "recolor", "reposition", "restructure"
]


class CounterfactualHypothesisSchema(BaseModel):
    """One what-if. Applied only to a Virtual Scene."""

    id: str = ""
    kind: CounterfactualKind | str = "resize"
    target: str = ""
    description: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    selected: bool = False

    model_config = {"extra": "allow"}


class CounterfactualTrialSchema(BaseModel):
    """One hypothesis run: before → virtual → predicted deltas / scores."""

    hypothesis_id: str = ""
    before: dict[str, Any] = Field(default_factory=dict)
    virtual: dict[str, Any] = Field(default_factory=dict)
    deltas: dict[str, float] = Field(default_factory=dict)
    scores_before: dict[str, float] = Field(default_factory=dict)
    scores_after: dict[str, float] = Field(default_factory=dict)
    summary: str = ""

    model_config = {"extra": "allow"}


class DesignCounterfactualSchema(BaseModel):
    """Counterfactual Engine. Never pollutes real canvas; select → Repair Plan draft."""

    hypotheses: list[CounterfactualHypothesisSchema] = Field(default_factory=list)
    trials: list[CounterfactualTrialSchema] = Field(default_factory=list)
    selected_id: str = ""
    repair_plan_draft: dict[str, Any] | None = None
    summary: str = ""

    model_config = {"extra": "allow"}
