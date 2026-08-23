"""Open protocol package — public contracts only."""
from __future__ import annotations

from recombyn_protocol import (
    AUTONOMOUS_HOPS,
    DESIGN_BRIEF_P0_FIELDS,
    GOVERNANCE_LANES,
    INTELLIGENCE_METHODS,
    MULTI_REVIEW_LANES,
    REVIEW_SCORE_CAPS,
    TOURNAMENT_DIMS,
    DesignBriefSchema,
    DesignCandidateSetSchema,
    DesignCounterfactualSchema,
    DesignGovernanceSchema,
    DesignResearchReportSchema,
    DesignStrategySchema,
    DesignTournamentResultSchema,
    ObserveFactsSchema,
    ReferenceDnaSchema,
    ReviewScoresSchema,
    ReviewTurnSchema,
)

from app.services.design.runtime.graph.state import (
    AUTONOMOUS_HOPS as STATE_HOPS,
    DesignBriefSchema as StateBrief,
    DesignResearchReportSchema as StateResearch,
    DesignStrategySchema as StateStrategy,
    DesignTournamentResultSchema as StateTournament,
    ObserveFactsSchema as StateObserve,
    ReviewTurnSchema as StateReview,
    REVIEW_SCORE_CAPS as STATE_CAPS,
)


def test_protocol_methods_cover_client_surface():
    for name in (
        "analyze_reference",
        "research",
        "strategy",
        "propose_candidates",
        "swarm_direction",
        "govern",
        "autonomous_plan",
        "review",
        "optimize",
        "retrieve_memory",
        "write_principle",
    ):
        assert name in INTELLIGENCE_METHODS


def test_state_reexports_protocol_types():
    assert STATE_HOPS is AUTONOMOUS_HOPS
    assert StateResearch is DesignResearchReportSchema
    assert StateStrategy is DesignStrategySchema
    assert StateTournament is DesignTournamentResultSchema
    assert StateBrief is DesignBriefSchema
    assert StateObserve is ObserveFactsSchema
    assert StateReview is ReviewTurnSchema
    assert STATE_CAPS is REVIEW_SCORE_CAPS


def test_flow_and_review_schemas_roundtrip():
    brief = DesignBriefSchema(
        purpose="landing",
        audience="builders",
        emotion=["premium"],
        visual_thesis="editorial tech",
        visual_hero="product macro",
        composition={"archetype": "editorial_split"},
        avoid=["purple gradient"],
    )
    research = DesignResearchReportSchema(category="ai_landing", avoid=["purple gradient"])
    strategy = DesignStrategySchema(positioning="premium technical")
    candidates = DesignCandidateSetSchema(
        candidates=[{"id": "A", "label": "Editorial", "selected": True}],
        primary_id="A",
        count=1,
    )
    tournament = DesignTournamentResultSchema(winner_id="A")
    observe = ObserveFactsSchema(overflow=False, whitespace_ratio=0.4)
    scores = ReviewScoresSchema(composition=18, hierarchy=18)
    review = ReviewTurnSchema(pass_=True, scores=scores, summary="ok")
    assert set(DESIGN_BRIEF_P0_FIELDS).issubset(brief.model_dump().keys())
    assert research.model_dump()["category"] == "ai_landing"
    assert strategy.model_dump()["positioning"] == "premium technical"
    assert candidates.model_dump()["primary_id"] == "A"
    assert tournament.model_dump()["winner_id"] == "A"
    assert observe.model_dump()["whitespace_ratio"] == 0.4
    assert review.model_dump(by_alias=True)["pass"] is True
    assert sum(REVIEW_SCORE_CAPS.values()) == 100
    assert "anti_slop" in MULTI_REVIEW_LANES
    assert "brand" in GOVERNANCE_LANES
    assert "composition" in TOURNAMENT_DIMS
    assert DesignGovernanceSchema(status="pass").model_dump()["status"] == "pass"
    assert DesignCounterfactualSchema(selected_id="H1").model_dump()["selected_id"] == "H1"
    assert ReferenceDnaSchema(visual_dna={"contrast": 0.8}).model_dump()["visual_dna"][
        "contrast"
    ] == 0.8


def test_paint_tool_op_uses_name_and_args():
    from recombyn_protocol import DecideTurnSchema, PaintOpsSchema, PaintToolOp

    op = PaintToolOp.model_validate(
        {"name": "create_text", "args": {"text": "Hi", "x": 1}}
    )
    assert op.name == "create_text"
    assert op.args["text"] == "Hi"
    batch = PaintOpsSchema.model_validate(
        {"tool_ops": [{"name": "create_shape", "args": {"shapeType": "rect"}}]}
    )
    assert batch.tool_ops[0].name == "create_shape"
    decide = DecideTurnSchema(intent="create", design_brief={"purpose": "poster"})
    assert decide.intent == "create"
