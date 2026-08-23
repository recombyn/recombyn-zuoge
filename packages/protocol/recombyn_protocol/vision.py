"""Vision scout turn schema (read-only; never emits canvas ops)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class VisionScoutTurnSchema(BaseModel):
    """Forked vision_scout sub-agent — read refs/brief; never emits canvas ops."""

    summary: str = Field(default="", description="One-line scout verdict")
    subjects: list[str] = Field(default_factory=list, description="Main subjects / motifs")
    palette: list[str] = Field(
        default_factory=list,
        description="Suggested colors (hex or short names)",
    )
    layout_notes: str = Field(default="", description="Composition / hierarchy notes")
    style_keywords: list[str] = Field(default_factory=list)
    lettering: str = Field(default="", description="Text / typography observations")
    recommendations: list[str] = Field(
        default_factory=list,
        description="Concrete next steps for Design/Paint",
    )

    model_config = {"extra": "allow"}
