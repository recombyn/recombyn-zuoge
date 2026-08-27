"""Open agent-sdk kernel vocabulary."""

from recombyn_agent_sdk import (
    DEFAULT_CONTRACT_IDS,
    KERNEL_CANVAS_REQUIRED,
    KERNEL_STAGES,
    MODEL_TRACE_EVENT_TYPES,
    PROFILE_KIND,
    SessionEventKind,
    is_kernel_stage,
    is_paint_mutating_stage,
    model_event,
)


def test_kernel_stages_order():
    assert KERNEL_STAGES == (
        "intent",
        "decide",
        "paint",
        "observe",
        "review",
        "settle",
    )


def test_canvas_required_subset():
    assert set(KERNEL_CANVAS_REQUIRED).issubset(set(KERNEL_STAGES))


def test_paint_mutating_rule():
    assert is_paint_mutating_stage("paint")
    assert is_paint_mutating_stage("act")
    assert not is_paint_mutating_stage("review")
    assert not is_paint_mutating_stage("settle")
    assert not is_paint_mutating_stage("observe")


def test_contract_ids_and_profile_kind():
    assert DEFAULT_CONTRACT_IDS["decide"] == "DecideTurn.v1"
    assert PROFILE_KIND == "AgentProfile"
    assert is_kernel_stage("intent")
    assert not is_kernel_stage("unknown")


def test_session_events_vocabulary():
    assert SessionEventKind.LLM_REQUEST.value == "llm/request"
    assert "stage/decision" in MODEL_TRACE_EVENT_TYPES
    ev = model_event(SessionEventKind.TURN_START, trace_id="abc")
    assert ev["type"] == "turn/start"
    assert ev["trace_id"] == "abc"
    assert "missing" not in ev
