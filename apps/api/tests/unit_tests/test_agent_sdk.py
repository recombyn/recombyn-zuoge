"""Open agent-sdk kernel vocabulary."""

from recombyn_agent_sdk import (
    DEFAULT_CONTRACT_IDS,
    KERNEL_CANVAS_REQUIRED,
    KERNEL_STAGES,
    PROFILE_KIND,
    is_kernel_stage,
    is_paint_mutating_stage,
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
