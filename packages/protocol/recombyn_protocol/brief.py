"""Open Design Brief schemas (Decide → Paint / Review contract)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

DESIGN_BRIEF_P0_FIELDS: tuple[str, ...] = (
    "purpose",
    "audience",
    "emotion",
    "visual_thesis",
    "visual_hero",
    "composition",
    "avoid",
)
DESIGN_BRIEF_P1_FIELDS: tuple[str, ...] = (
    "visual_focus",
    "palette",
    "typography",
    "tokens",
    "reference_lock",
    "style_dna",
    "reference_dna",
    "design_strategy",
)


class DesignBriefCompositionSchema(BaseModel):
    """Composition plan inside the brief (archetype + hard rules)."""

    archetype: str = Field(
        default="",
        description="center_hero|left_text_right_visual|editorial_split|full_bleed|…",
    )
    rules: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class PaletteBrief(BaseModel):
    roles: dict[str, str] = Field(default_factory=dict)
    hex: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class TypographyBrief(BaseModel):
    h1: float | None = None
    h2: float | None = None
    h3: float | None = None
    body: float | None = None
    caption: float | None = None
    ratios: str | None = None

    model_config = {"extra": "allow"}


class DesignTokens(BaseModel):
    spacing: dict[str, Any] = Field(default_factory=dict)
    radius: dict[str, Any] = Field(default_factory=dict)
    grid: dict[str, Any] = Field(default_factory=dict)
    density: str | None = None
    hierarchy: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class DesignBriefSchema(BaseModel):
    """Decide → Paint/Review execution contract.

    P0 fields must be present for create / complex edit.
    P1 fields are optional unless a surface skill marks them required.
    """

    purpose: str = ""
    audience: str = ""
    emotion: list[str] | str = Field(default_factory=list)
    visual_thesis: str = ""
    visual_hero: str = ""
    composition: DesignBriefCompositionSchema | str | dict[str, Any] = ""
    avoid: list[str] = Field(default_factory=list)
    visual_focus: dict[str, Any] | str | None = None
    palette: PaletteBrief | dict[str, Any] | list[Any] | str | None = None
    typography: TypographyBrief | dict[str, Any] | str | None = None
    tokens: DesignTokens | dict[str, Any] | None = None
    reference_lock: dict[str, Any] | str | None = None
    style_dna: dict[str, Any] | str | None = None
    reference_dna: dict[str, Any] | None = None
    design_strategy: dict[str, Any] | None = None
    subtraction_intent: bool = True

    model_config = {"extra": "allow"}
