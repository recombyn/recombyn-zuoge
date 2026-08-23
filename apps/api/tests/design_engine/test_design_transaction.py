"""PR5 — DesignTransaction emit / chunk / rollback / pack ACK."""
from __future__ import annotations

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes import apply as apply_mod
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    new_design_transaction,
    resolve_transaction_phase,
)
from app.services.design.runtime.scene_feedback import _pack_payload, _unpack_payload


def _rt(*, flags: dict | None = None) -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_tx", goal="poster")
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="800x600",
        scene_key="website",
        scene_nodes=[],
        scene_frames=[],
        focus_id=None,
        images=[],
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=800,
        h=600,
        run=run,
        decision=DesignRunDecision(),
        flags=flags or {},
    )


def test_new_design_transaction_id_prefix():
    tx = new_design_transaction(task_id="task_1", turn_id="3", phase="paint", ops_count=4)
    assert tx.transaction_id.startswith("tx_")
    assert tx.design_id == "task_1"
    assert tx.ops_count == 4
    assert tx.phase == "paint"


def test_resolve_transaction_phase_correction_and_polish():
    rt = _rt(flags={"review_failed": True})
    assert resolve_transaction_phase(rt) == "correction"
    rt.flags["polish"] = True
    assert resolve_transaction_phase(rt) == "polish"
    rt.flags = {}
    assert resolve_transaction_phase(rt) == "paint"


def test_resolve_transaction_phase_rebuild_vs_repair():
    rt = _rt(flags={"review_failed": True, "review_action": "rebuild"})
    assert resolve_transaction_phase(rt) == "paint"
    rt.flags["review_action"] = "repair"
    assert resolve_transaction_phase(rt) == "correction"


def test_chunk_ops_splits_and_keeps_small():
    ops = [{"name": f"op_{i}"} for i in range(25)]
    chunks = apply_mod._chunk_ops(ops, chunk_size=12)
    assert len(chunks) == 3
    assert len(chunks[0]) == 12
    assert len(chunks[1]) == 12
    assert len(chunks[2]) == 1
    assert apply_mod._chunk_ops(ops[:5], chunk_size=12) == [ops[:5]]


def test_emit_design_transaction_begin_chunk_commit(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(apply_mod, "_emit", lambda ev: emitted.append(ev))
    monkeypatch.setattr(apply_mod, "_tool_ops_activity_events", lambda **_k: [])

    rt = _rt()
    ops = [
        {"name": "create_text", "args": {"id": f"t{i}", "text": str(i)}}
        for i in range(14)
    ]
    tid = apply_mod._emit_design_transaction(
        rt, paint_ops=ops, round_i=1, skill_key="react", skill_name="Design Agent"
    )
    st = rt.run
    assert tid.startswith("tx_")
    assert st.active_transaction_id == tid
    types = [e.get("type") for e in emitted]
    assert types[0] == "transaction.begin"
    assert "transaction.chunk" in types
    assert types[-1] == "transaction.commit"
    assert emitted[-1].get("await_ack") is True
    assert types.count("transaction.chunk") == 2
    for ev in emitted:
        if ev.get("type") == "transaction.chunk":
            assert ev.get("transaction_id") == tid
            assert "ops" in ev


def test_emit_transaction_rollback_clears_active(monkeypatch):
    emitted: list[dict] = []
    monkeypatch.setattr(apply_mod, "_emit", lambda ev: emitted.append(ev))
    rt = _rt()
    st = rt.run
    st.active_transaction_id = "tx_abc"
    st.active_transaction_phase = "paint"
    st.active_transaction_base_revision = 3
    apply_mod._emit_transaction_rollback(rt, reason="client_abort", round_i=2)
    assert st.active_transaction_id == ""
    assert emitted[0]["type"] == "transaction.rollback"
    assert emitted[0]["transaction_id"] == "tx_abc"
    assert "client_abort" in emitted[0]["reason"]


def test_pack_unpack_transaction_ack_fields():
    packed = _pack_payload(
        nodes=[{"id": "n1"}],
        frames=[{"id": "f1"}],
        spatial=None,
        op_results=[{"op_id": "1", "name": "create_text", "ok": True}],
        round_n=2,
        transaction_id="tx_ack1",
        transaction_status="ack",
        base_revision=7,
    )
    assert packed["transaction_id"] == "tx_ack1"
    assert packed["transaction_status"] == "ack"
    assert packed["base_revision"] == 7
    unpacked = _unpack_payload(packed)
    assert unpacked is not None
    assert unpacked["transaction_id"] == "tx_ack1"
    assert unpacked["transaction_status"] == "ack"
    assert unpacked["base_revision"] == 7
