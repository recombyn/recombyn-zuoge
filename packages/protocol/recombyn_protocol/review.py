"""Open Observe / Review / Judge / Diff / Preference schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

# Review dimensional caps — Runtime sums; providers must NOT invent total.
REVIEW_SCORE_CAPS: dict[str, int] = {
    "composition": 20,
    "hierarchy": 20,
    "typography": 15,
    "color": 15,
    "consistency": 15,
    "content": 10,
    "originality": 5,
}
REVIEW_SCORE_RAW_MAX = sum(REVIEW_SCORE_CAPS.values())  # 100
REVIEW_SCORE_TOTAL_MAX = 100
REVIEW_PASS_SCORE = 90
REVIEW_REWORK_SCORE = 70
ReviewAction = Literal["rebuild", "repair", "pass"]

REFERENCE_DNA_AXES: tuple[str, ...] = (
    "minimalism",
    "editorial",
    "contrast",
    "density",
    "asymmetry",
    "texture",
    "decoration",
)
MULTI_REVIEW_LANES: tuple[str, ...] = (
    "composition",
    "hierarchy",
    "typography",
    "color",
    "consistency",
    "anti_slop",
    "originality",
)
REVIEW_LANE_CAPS: dict[str, int | None] = {
    lane: REVIEW_SCORE_CAPS.get(lane) for lane in MULTI_REVIEW_LANES
}

OptimizationDecisionKind = Literal["continue", "stop", "rollback"]


class ObserveFactsSchema(BaseModel):
    """Deterministic Observe QA — geometry/type/whitespace facts, never taste."""

    overflow: bool = False
    overlap: bool = False
    alignment_issues: list[str] = Field(default_factory=list)
    spacing_issues: list[str] = Field(default_factory=list)
    bounds_issues: list[str] = Field(default_factory=list)
    typography_hierarchy_ok: bool = True
    h1_size: float | None = None
    h2_size: float | None = None
    h1_h2_ratio: float | None = None
    text_overflow: bool = False
    line_height_tight: bool = False
    whitespace_ratio: float | None = None
    whitespace_fail: bool = False
    edge_crowding: bool = False
    hero_coverage: float | None = None
    issues: list[str] = Field(default_factory=list)
    structure_issues: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class ReviewScoresSchema(BaseModel):
    """Per-dimension craft scores. Runtime computes total = sum(clamped)."""

    composition: int | float = 0
    hierarchy: int | float = 0
    typography: int | float = 0
    color: int | float = 0
    consistency: int | float = 0
    content: int | float = 0
    originality: int | float = 0

    model_config = {"extra": "allow"}


class PreferenceSignalSchema(BaseModel):
    """One user-edit signal. One edit is evidence, never permanent memory."""

    signal: str = ""
    direction: str = ""
    target: str = ""
    strength: float = 0.0
    evidence: int = 0
    frequency: int = 0
    confidence: float = 0.0

    model_config = {"extra": "allow"}


class JudgeIssueSchema(BaseModel):
    priority: int = 1
    issue: str = ""
    evidence: list[str] = Field(default_factory=list)
    fix: str = ""
    lane: str = ""

    model_config = {"extra": "allow"}


class ParetoScoresSchema(BaseModel):
    quality: int | float | None = None
    originality: int | float | None = None
    consistency: int | float | None = None
    simplicity: int | float | None = None
    ops_cost: int | float | None = None

    model_config = {"extra": "allow"}


class JudgeVerdictSchema(BaseModel):
    """Multi-reviewer Judge. Runtime owns overall from REVIEW_SCORE_CAPS."""

    scores: ReviewScoresSchema | dict[str, Any] = Field(default_factory=dict)
    overall: int | float | None = None
    confidence: float = 0.0
    anti_slop_hits: list[str] = Field(default_factory=list)
    top_issues: list[JudgeIssueSchema] = Field(default_factory=list)
    pareto: ParetoScoresSchema | dict[str, Any] | None = None

    model_config = {"extra": "allow"}


class SceneVisualSnapshot(BaseModel):
    """Deterministic scene metrics for Visual Diff (not LLM guess)."""

    node_count: int = 0
    hero_coverage: float | None = None
    title_area: float | None = None
    decoration_area: float | None = None
    whitespace_ratio: float | None = None
    text_area: float | None = None
    color_area: float | None = None
    bbox_coverage: float | None = None
    spacing_mean: float | None = None
    alignment_issue_count: int | None = None

    model_config = {"extra": "allow"}


class VisualChangeSchema(BaseModel):
    layout: float | None = None
    typography: float | None = None
    color: float | None = None
    imagery: float | None = None

    model_config = {"extra": "allow"}


class VisualDiffSchema(BaseModel):
    v1: SceneVisualSnapshot | dict[str, Any] = Field(default_factory=dict)
    v2: SceneVisualSnapshot | dict[str, Any] = Field(default_factory=dict)
    deltas: dict[str, float] = Field(default_factory=dict)
    visual_change: VisualChangeSchema | dict[str, Any] | None = None
    pixel_available: bool = False
    pixel: dict[str, Any] | None = None

    model_config = {"extra": "allow"}


class OptimizationDecisionSchema(BaseModel):
    decision: OptimizationDecisionKind = "continue"
    strategy: str = ""
    reason: str = ""
    targets: list[str] = Field(default_factory=list)
    restore_index: int | None = None
    iteration: int = 0

    model_config = {"extra": "allow"}


class ResearchTurnSchema(BaseModel):
    """Forked research sub-agent — brief/industry notes; never emits canvas ops."""

    summary: str = Field(default="", description="One-line research takeaway")
    audience: str = Field(default="", description="Primary audience / persona")
    industry: str = Field(default="", description="Industry / category")
    tone: list[str] = Field(default_factory=list, description="Tone / voice keywords")
    competitors: list[str] = Field(
        default_factory=list,
        description="Relevant comps / reference brands (names only)",
    )
    messaging: list[str] = Field(
        default_factory=list,
        description="Key messages / copy angles for the design",
    )
    visual_directions: list[str] = Field(
        default_factory=list,
        description="Visual directions Design/Paint should consider",
    )
    risks: list[str] = Field(
        default_factory=list,
        description="Clichés / pitfalls to avoid",
    )

    model_config = {"extra": "allow"}


class ReviewIssueSchema(BaseModel):
    """One Review finding. Repair compiles target/action/patch → tool_ops."""

    severity: Literal["blocker", "major", "minor"] = Field(
        default="major",
        description="blocker=rebuild; major=repair; minor=nit",
    )
    area: str = Field(
        default="layout",
        description="layout|type|contrast|hierarchy|whitespace|content|ops",
    )
    issue: str = Field(default="", description="What is wrong (concrete, observable)")
    fix_hint: str = Field(
        default="",
        description="How Design should fix it (prose). Prefer target+action+patch for Repair.",
    )
    target: str = Field(default="", description="Scene node id to patch (must already exist)")
    action: str = Field(
        default="",
        description="reduce_size|delete|update|move|… — never create_*",
    )
    patch: dict[str, Any] = Field(
        default_factory=dict,
        description="update_node args (fontSize, x, y, w, h, fill, …)",
    )
    lane: str = Field(
        default="",
        description="MULTI_REVIEW_LANES id when this issue came from a lane",
    )

    model_config = {"extra": "allow"}


class ReviewLaneSchema(BaseModel):
    """One of seven Reviewer lanes. Score is this dimension only; Host merges."""

    lane: str = ""
    score: int | float | None = None
    evidence: list[str] = Field(default_factory=list)
    issues: list[ReviewIssueSchema] = Field(default_factory=list)
    anti_slop_hits: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class ReviewTurnSchema(BaseModel):
    """Review Agent — design judgment only. Never emits canvas tool_ops."""

    pass_: bool = Field(
        default=False,
        alias="pass",
        description="True only when craft quality ships (Runtime may override via score)",
    )
    summary: str = Field(
        default="",
        description="One-line verdict for logs / UI",
    )
    strengths: list[str] = Field(
        default_factory=list,
        description="What already looks good (concrete visual praise)",
    )
    weaknesses: list[str] = Field(
        default_factory=list,
        description="What looks weak vs a polished market design",
    )
    market_gap: str = Field(
        default="",
        description=(
            "Gap vs market-quality / top-tier reference for this deliverable "
            "(poster, landing, app UI, …) — what pros would still change"
        ),
    )
    scores: ReviewScoresSchema | dict[str, Any] = Field(
        default_factory=dict,
        description="Dimensional scores only — Runtime computes total",
    )
    total: int | float | None = None
    anti_slop_hits: list[str] = Field(
        default_factory=list,
        description="Matched anti-AI-slop patterns (glass cards, purple gradient, …)",
    )
    subtraction_actions: list[str] = Field(
        default_factory=list,
        description="What to remove/merge on the next polish pass",
    )
    issues: list[ReviewIssueSchema] = Field(default_factory=list)
    must_fix: bool = Field(
        default=False,
        description="True when Design must rebuild or repair (Runtime score gate)",
    )
    review_action: Literal["rebuild", "repair", "pass"] | None = None
    fix_brief: str = Field(
        default="",
        description="Short brief injected into Paint LAST_ERROR on retry",
    )

    model_config = {"extra": "allow", "populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def _alias_pass(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if "pass_" not in d and "pass" in d:
            d["pass_"] = d.get("pass")
        return d
