# -*- coding: utf-8 -*-
"""Smoke: fixed LC design graph + edge-condition helpers."""
from __future__ import annotations

from unittest.mock import MagicMock

from langgraph.types import Command

from app.services.design.runtime.graph.build import (
    _bind_design_hold_fns,
    _build_lc_design_graph,
    _design_refund_hold_fn,
    _design_settle_hold_fn,
    _design_thread_id,
    _get_design_graph_checkpointer,
    _unbind_design_hold_fns,
    invalidate_agent_graph_cache,
)
from app.services.design.runtime.graph.state import AgentRunState, AgentRuntime
from app.services.design.runtime.graph.scene_log import _bump, _commit
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.flow_runtime import choose_outgoing_edges, eval_edge_condition


def test_and_edge_condition():
    assert eval_edge_condition("mode=ask&op_failed", {"mode": "ask", "op_failed": True})
    assert not eval_edge_condition("mode=ask&op_failed", {"mode": "ask", "ok": True})


def test_build_lc_design_graph_nodes():
    from app.core.config import settings as settings_mod

    settings_mod.design_graph_require_durable_checkpoint = False
    invalidate_agent_graph_cache()
    compiled = _build_lc_design_graph()
    nodes = set(compiled.nodes)
    assert {
        "bootstrap",
        "memory",
        "intent_classify",
        "design_agent",
        "paint_ops",
        "action",
        "propose",
        "__settle__",
    } <= nodes
    assert "thought" not in nodes
    # Durable checkpointer (MySQL/Sqlite/memory) enables thread_id resume / get_state.
    assert compiled.checkpointer is not None


def test_design_thread_id():
    assert _design_thread_id("abc") == "design:abc"


def test_design_graph_uses_shared_durable_checkpointer():
    from app.core.config import settings as settings_mod

    settings_mod.design_graph_require_durable_checkpoint = False
    invalidate_agent_graph_cache()
    from app.services.llm.agent import checkpointer_backend, get_agent_checkpointer

    cp = _get_design_graph_checkpointer()
    assert cp is get_agent_checkpointer()
    assert checkpointer_backend() in ("mysql", "sqlite", "memory")
    compiled = _build_lc_design_graph()
    assert compiled.checkpointer is cp


def test_design_hold_fns_bound_outside_checkpoint_state():
    tid = "hold-unit-1"
    settled: list[str] = []
    refunded: list[str] = []

    def settle(*_a, **_k):
        settled.append("ok")
        return {"spent": 0}

    def refund(*_a, **_k):
        refunded.append("ok")
        return None

    _bind_design_hold_fns(tid, settle, refund)
    try:
        run = AgentRunState(trace_id="t", task_id=tid, goal="g")
        rt = AgentRuntime(
            user_id="u",
            mode="agent",
            prompt="hi",
            rules={},
            user_selected_model=None,
            canvas_id=None,
            canvas_size=None,
            scene_key="website",
            scene_nodes=[],
            scene_frames=[],
            focus_id="",
            images=[],
            memory_in=None,
            session_id="s",
            project_id="p",
            hold=0,
            free_daily=False,
            t0=0.0,
            settle_hold_fn=settle,
            refund_hold_fn=refund,
            apply_ops=[],
            w=0,
            h=0,
            run=run,
            decision=DesignRunDecision(trace_id="t", task_id=tid),
        )
        assert callable(_design_settle_hold_fn(rt))
        assert callable(_design_refund_hold_fn(rt))
        upd = _bump(rt)
        assert upd["rt"].settle_hold_fn is None
        assert upd["rt"].refund_hold_fn is None
        # Still resolvable from registry after scrubbing graph state.
        _design_settle_hold_fn(rt)()
        _design_refund_hold_fn(rt)()
        assert settled == ["ok"]
        assert refunded == ["ok"]

        from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

        serde = JsonPlusSerializer(
            pickle_fallback=False,
            allowed_msgpack_modules=[
                ("app.services.design.runtime.graph.state", "AgentRuntime"),
                ("app.services.design.runtime.graph.state", "AgentRunState"),
                ("app.services.design.runtime.decision_log", "DesignRunDecision"),
            ],
        )
        blob = serde.dumps_typed({"rt": rt, "tick": 1})
        back = serde.loads_typed(blob)
        assert back["rt"].run.task_id == tid
        assert back["rt"].settle_hold_fn is None
    finally:
        _unbind_design_hold_fns(tid)


def test_commit_has_no_goto():
    rt = MagicMock()
    rt.run.round = 0
    rt.run.log = []
    cmd = _commit(rt)
    assert isinstance(cmd, Command)
    goto = getattr(cmd, "goto", None)
    assert goto in (None, (), [])


def test_label_is_not_edge_condition():
    from app.services.design.runtime.flow_runtime import _edge_condition

    edge = {
        "id": "e_mode_agent",
        "source": "mode_fork",
        "target": "model_route",
        "label": "Agent 主线",
        "condition": "",
        "priority": 20,
        "isDefault": True,
    }
    assert _edge_condition(edge) == ""
    outs, detail = choose_outgoing_edges(
        node={"id": "mode_fork"},
        edges=[
            {
                "id": "e_mode_ask",
                "source": "mode_fork",
                "target": "ask_thought",
                "label": "Ask 模式",
                "condition": "",
                "priority": 5,
                "isDefault": False,
            },
            edge,
        ],
        ctx={"mode": "agent"},
    )
    assert outs and outs[0]["target"] == "model_route"
    assert detail["via"] == "default"
