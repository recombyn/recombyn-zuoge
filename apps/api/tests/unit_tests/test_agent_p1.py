"""P1: RunState + failure episode gate."""

from __future__ import annotations

from app.services.design.runtime.graph.state import AgentRunState


def test_run_state_execution_log():
    st = AgentRunState(trace_id="t1", task_id="task1", goal="加标题")
    st.note_error("too_many_ops")
    st.push_log(phase="validate_fail", error="too_many_ops")
    st.painted = False
    log = st.to_execution_log()
    assert log["trace_id"] == "t1"
    assert log["errors"] == ["too_many_ops"]
    assert log["steps"][0]["phase"] == "validate_fail"


def test_failure_episode_gate():
    from app.services.agent_memory.episodes import should_write_episode

    assert (
        should_write_episode(
            chat_only=False,
            tool_ops_applied=False,
            outcome="failed",
            has_reflexion_errors=True,
        )
        is True
    )
    assert (
        should_write_episode(
            chat_only=True,
            tool_ops_applied=False,
            outcome="success",
            has_reflexion_errors=False,
        )
        is False
    )
