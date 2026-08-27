# -*- coding: utf-8 -*-
"""Design run pause / resume / cancel lifecycle."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.services.design.admin import task_store as ts
from app.services.design.admin.task_store import task_is_resumable
from app.services.design.runtime.graph.build import (
    _design_thread_id,
    _get_run_intent,
    _INTENT_CANCEL,
    _INTENT_PAUSE,
    _request_run_intent,
    get_design_run_status,
    request_design_cancel,
    request_design_pause,
)


def test_design_thread_id_stable():
    assert _design_thread_id("t1") == "design:t1"


def test_task_is_resumable_matrix():
    assert not task_is_resumable(None)
    assert not task_is_resumable({"status": "running", "meta_json": "{}"})
    assert task_is_resumable({"status": "paused", "meta_json": "{}"})
    assert task_is_resumable({"status": "waiting_client", "meta_json": "{}"})
    assert task_is_resumable(
        {
            "status": "error",
            "meta_json": json.dumps({"run_lifecycle": {"resumable": True}}),
        }
    )
    assert not task_is_resumable(
        {
            "status": "error",
            "meta_json": json.dumps({"run_lifecycle": {"resumable": False}}),
        }
    )
    assert not task_is_resumable({"status": "success", "meta_json": "{}"})
    assert not task_is_resumable({"status": "cancelled", "meta_json": "{}"})


def test_task_event_replay_is_bounded_and_never_keeps_canvas_payload(monkeypatch):
    from app.repositories import design_tasks

    events: list[dict] = []
    monkeypatch.setattr(design_tasks, "get_design_task", lambda **_kwargs: object())

    def append(*, event_json, **_kwargs):
        events.append({"id": len(events) + 1, "event_json": event_json, "created_at": 1.0})
        return len(events)

    def list_events(*, after_id, limit, **_kwargs):
        return [type("Event", (), item)() for item in events if item["id"] > after_id][:limit]

    monkeypatch.setattr(design_tasks, "append_design_task_event", append)
    monkeypatch.setattr(design_tasks, "list_design_task_events", list_events)
    assert ts.append_task_event(
        "E1",
        {
            "type": "activity",
            "stage": "ops",
            "svg": "<svg>must-not-persist</svg>",
            "ops": [{"name": "create_shape"}],
        },
    ) == 1
    assert ts.append_task_event("E1", {"type": "analysis_delta", "text": "secret"}) is None
    assert ts.append_task_event("E1", {"type": "result", "status": "success"}) == 2

    replay = ts.get_task_events("E1", after_seq=1)
    assert replay["next_seq"] == 2
    assert [item["seq"] for item in replay["items"]] == [2]
    first_event = json.loads(events[0]["event_json"])
    assert "svg" not in first_event
    assert "ops" not in first_event


def test_canvas_command_ack_prevents_reconnect_replay() -> None:
    """Outbox ACK is durable: a fresh subscriber only sees unacknowledged rows."""
    from sqlmodel import SQLModel, Session, create_engine

    from app.repositories import design_tasks

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        first = design_tasks.append_design_task_canvas_command(
            session=session, task_id="cmd-1", command_json='{"type":"tool_ops"}', created_at=1.0
        )
        second = design_tasks.append_design_task_canvas_command(
            session=session, task_id="cmd-1", command_json='{"type":"svg_delta"}', created_at=2.0
        )
        design_tasks.acknowledge_design_task_canvas_commands(
            session=session, task_id="cmd-1", through_id=first, acknowledged_at=3.0
        )
        assert [row.id for row in design_tasks.list_design_task_canvas_commands(
            session=session, task_id="cmd-1", after_id=0, limit=48
        )] == [second]
        assert design_tasks.get_design_task_canvas_command_cursors(session=session, task_id="cmd-1") == (second, first)


def test_outbox_prune_keeps_active_task_rows() -> None:
    from sqlmodel import SQLModel, Session, create_engine

    from app.repositories import design_tasks
    from app.models import DesignTask

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        for task_id, status in (("done", "success"), ("active", "paused")):
            session.add(DesignTask(
                id=task_id, user_id="u", task_type="agent", status=status,
                created_at=1.0, updated_at=1.0,
            ))
        session.commit()
        for task_id in ("done", "active"):
            design_tasks.append_design_task_event(session=session, task_id=task_id, event_json="{}", created_at=1.0)
            design_tasks.append_design_task_canvas_command(session=session, task_id=task_id, command_json="{}", created_at=1.0)
        pruned = design_tasks.prune_design_task_outboxes(session=session, cutoff=2.0, statuses=["success", "error", "cancelled"])
        assert pruned == {"events": 1, "commands": 1}
        assert len(design_tasks.list_design_task_events(session=session, task_id="done", after_id=0, limit=10)) == 0
        assert len(design_tasks.list_design_task_events(session=session, task_id="active", after_id=0, limit=10)) == 1


def test_snapshot_runner_forwards_behavioral_context(monkeypatch) -> None:
    import asyncio

    from app.services.design.runtime import orchestrator

    captured: dict = {}

    async def fake_run_design_job(**kwargs):
        captured.update(kwargs)
        yield {"type": "result", "status": "success"}

    monkeypatch.setattr(orchestrator, "run_design_job", fake_run_design_job)
    snapshot = ts.build_worker_snapshot(
        mode="agent", prompt="draw", canvas_id="canvas", canvas_size="800x600", scene="web",
        focus_frame_id="frame", scene_nodes=[{"id": "n"}], scene_frames=[{"id": "frame"}], images=["https://image"],
        user_selected_model="model-a", target_layer_id="n", layer_ids=["n"], current_svg="<svg/>",
        spatial_summary={"focus": "n"}, session_id="s", project_id="p", memory={"medium": {}},
        route_overrides={"fast": "model-a"}, apply_ops=[{"name": "update_shape"}], proposal_id="proposal",
        proposal_task_id="previous", interaction_mode="ask", client_country="CN", skill_refs=["skill"],
        paint_mode="ops", locale="zh-CN", design_intensity="high",
    )

    async def collect():
        return [event async for event in orchestrator.run_design_job_from_snapshot(user_id="u", snapshot=snapshot, task_id="task")]

    assert asyncio.run(collect()) == [{"type": "result", "status": "success"}]
    assert captured["task_id"] == "task"
    assert captured["user_selected_model"] == "model-a"
    assert captured["current_svg"] == "<svg/>"
    assert captured["spatial_summary"] == {"focus": "n"}
    assert captured["memory"] == {"medium": {}}
    assert captured["route_overrides"] == {"fast": "model-a"}
    assert captured["proposal_task_id"] == "previous"
    assert captured["interaction_mode"] == "ask"
    assert captured["client_country"] == "CN"
    assert captured["locale"] == "zh-CN"


def test_worker_failure_marks_task_resumable_and_releases_lease(monkeypatch) -> None:
    from worker import tasks as worker_tasks

    updates: list[dict] = []
    events: list[dict] = []
    metas: list[dict] = []
    released: list[str] = []
    monkeypatch.setattr(
        ts,
        "get_design_task",
        lambda _tid: {"id": "worker-1", "user_id": "u1", "meta_json": json.dumps({"worker_snapshot": {"version": 2}})},
    )
    def fail_run(awaitable):
        awaitable.close()
        raise RuntimeError("boom")

    monkeypatch.setattr(worker_tasks.asyncio, "run", fail_run)
    monkeypatch.setattr(ts, "append_task_event", lambda _tid, event: events.append(event))
    monkeypatch.setattr(ts, "merge_task_meta", lambda _tid, patch: metas.append(patch) or patch)
    monkeypatch.setattr(ts, "_update_task", lambda _tid, **fields: updates.append(fields))
    monkeypatch.setattr(ts, "release_run_lease", lambda tid: released.append(tid))

    out = worker_tasks.run_design_agent_job.run("worker-1")

    assert out["status"] == "error"
    assert events == [{"type": "error", "code": "worker_failed", "message": "boom"}]
    assert updates == [{"status": "error", "error_message": "boom"}]
    assert metas[0]["run_lifecycle"]["resumable"] is True
    assert released == ["worker-1"]


def test_worker_resume_rejects_non_owner_before_enqueue(monkeypatch) -> None:
    import asyncio
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.api.routes.design import DesignResumeIn, design_run_resume
    from app.core.config import settings

    monkeypatch.setattr(
        ts,
        "get_design_task",
        lambda _tid: {"id": "resume-1", "user_id": "owner", "status": "paused", "meta_json": "{}"},
    )
    monkeypatch.setattr(settings, "design_agent_worker_enabled", True)

    with pytest.raises(HTTPException) as raised:
        asyncio.run(
            design_run_resume(
                SimpleNamespace(id="intruder"), "resume-1", None, DesignResumeIn(resume_token="token")
            )
        )
    assert raised.value.status_code == 403
    assert raised.value.detail == "forbidden"


def test_worker_resume_enqueues_only_after_valid_owner_and_token(monkeypatch) -> None:
    import asyncio
    from types import SimpleNamespace

    from app.api.routes.design import DesignResumeIn, design_run_resume
    from app.core.config import settings
    from worker.tasks import run_design_agent_job

    queued: list[tuple] = []
    monkeypatch.setattr(
        ts,
        "get_design_task",
        lambda _tid: {
            "id": "resume-2",
            "user_id": "owner",
            "status": "paused",
            "meta_json": json.dumps({"run_lifecycle": {"resume_token": "valid-token"}}),
        },
    )
    monkeypatch.setattr(settings, "design_agent_worker_enabled", True)
    monkeypatch.setattr(run_design_agent_job, "delay", lambda *args: queued.append(args))

    response = asyncio.run(
        design_run_resume(
            SimpleNamespace(id="owner"), "resume-2", None, DesignResumeIn(resume_token="valid-token")
        )
    )
    assert response.media_type == "text/event-stream"
    assert queued == [("resume-2", True, "valid-token")]


def test_canvas_command_ack_rejects_non_owner(monkeypatch) -> None:
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.api.routes.design import CanvasCommandAckIn, design_run_commands_ack

    monkeypatch.setattr(
        ts,
        "get_design_task",
        lambda _tid: {"id": "command-1", "user_id": "owner"},
    )
    with pytest.raises(HTTPException) as raised:
        design_run_commands_ack(SimpleNamespace(id="intruder"), "command-1", CanvasCommandAckIn(seq=42))
    assert raised.value.status_code == 404
    assert raised.value.detail == "task_not_found"


def test_worker_snapshot_preserves_behavior_affecting_request_fields():
    snapshot = ts.build_worker_snapshot(
        mode="agent",
        prompt="x" * 20_000,
        canvas_id="c1",
        canvas_size="800x600",
        scene="website",
        focus_frame_id="f1",
        scene_nodes=[{"id": "n1", "type": "shape", "x": 1, "secret": "drop"}],
        scene_frames=[{"id": "f1", "name": "Board", "w": 800, "ignored": True}],
        images=["data:image/png;base64,x", "https://cdn.example.com/a.png"],
        style_group_id=7,
        ref_image_sizes=["10x20"],
        target_layer_id="layer-1",
        layer_ids=["layer-1", "layer-2"],
        current_svg="<svg><rect /></svg>",
        spatial_summary={"focused": "n1"},
        session_id="session-1",
        project_id="project-1",
        memory={"medium": {"canvas": {}}},
        route_overrides={"fast": "model-x"},
        apply_ops=[{"name": "update_shape", "args": {"id": "n1"}}],
        proposal_id="proposal-1",
        proposal_task_id="task-0",
        interaction_mode="ask",
        client_country="CN",
        skill_refs=["skill-1"],
        paint_mode="ops",
        locale="zh-CN",
        design_intensity="high",
    )
    assert snapshot["version"] == 2
    assert len(snapshot["prompt"]) == 12_000
    assert snapshot["scene_nodes"] == [{"id": "n1", "type": "shape", "x": 1, "secret": "drop"}]
    assert snapshot["images"] == ["data:image/png;base64,x", "https://cdn.example.com/a.png"]
    assert snapshot["style_group_id"] == 7
    assert snapshot["ref_image_sizes"] == ["10x20"]
    assert snapshot["target_layer_id"] == "layer-1"
    assert snapshot["layer_ids"] == ["layer-1", "layer-2"]
    assert snapshot["current_svg"] == "<svg><rect /></svg>"
    assert snapshot["spatial_summary"] == {"focused": "n1"}
    assert snapshot["session_id"] == "session-1"
    assert snapshot["project_id"] == "project-1"
    assert snapshot["memory"] == {"medium": {"canvas": {}}}
    assert snapshot["route_overrides"] == {"fast": "model-x"}
    assert snapshot["apply_ops"] == [{"name": "update_shape", "args": {"id": "n1"}}]
    assert snapshot["proposal_id"] == "proposal-1"
    assert snapshot["proposal_task_id"] == "task-0"
    assert snapshot["interaction_mode"] == "ask"
    assert snapshot["client_country"] == "CN"
    assert snapshot["skill_refs"] == ["skill-1"]
    assert snapshot["paint_mode"] == "ops"
    assert snapshot["locale"] == "zh-CN"
    assert snapshot["design_intensity"] == "high"


def test_initialize_design_task_promotes_prepared_row_without_losing_snapshot(monkeypatch):
    store = {
        "Q1": {
            "id": "Q1",
            "user_id": "u1",
            "status": "queued",
            "meta_json": json.dumps({"worker_snapshot": {"version": 2, "prompt": "original"}}),
        }
    }
    monkeypatch.setattr(ts, "get_design_task", lambda tid: store.get(tid))
    monkeypatch.setattr(ts, "_insert_task", lambda row: store.setdefault(row["id"], row))

    def update(tid, **fields):
        store[tid].update(fields)

    monkeypatch.setattr(ts, "_update_task", update)
    created = ts.initialize_design_task(
        {"id": "Q1", "user_id": "u1", "status": "running", "meta_json": json.dumps({"trace_id": "t1"})}
    )
    assert created is False
    assert store["Q1"]["status"] == "running"
    meta = ts.parse_task_meta(store["Q1"]["meta_json"])
    assert meta["worker_snapshot"] == {"version": 2, "prompt": "original"}
    assert meta["trace_id"] == "t1"


def test_run_intent_pause_cancel(monkeypatch):
    tid = "intent-unit-1"
    _request_run_intent(tid, _INTENT_PAUSE)
    assert _get_run_intent(tid) == _INTENT_PAUSE
    _request_run_intent(tid, _INTENT_CANCEL)
    assert _get_run_intent(tid) == _INTENT_CANCEL


def test_request_pause_not_found(monkeypatch):
    from app.services.design.runtime.graph import build as build_mod

    monkeypatch.setattr(build_mod, "get_design_task", lambda _tid: None)
    out = request_design_pause("missing")
    assert out["ok"] is False
    assert out["error"] == "not_found"


def test_request_pause_already_paused(monkeypatch):
    from app.services.design.runtime.graph import build as build_mod

    monkeypatch.setattr(
        build_mod,
        "get_design_task",
        lambda _tid: {"id": "t", "status": "paused", "meta_json": "{}"},
    )
    out = request_design_pause("t")
    assert out["ok"] is True
    assert out.get("already") is True


def test_request_cancel_refunds_unssettled(monkeypatch):
    from app.services.design.runtime.graph import build as build_mod

    refunded: list[tuple] = []

    def refund(uid, hold, *, task_id):
        refunded.append((uid, hold, task_id))

    monkeypatch.setattr(
        build_mod,
        "get_design_task",
        lambda _tid: {
            "id": "c1",
            "user_id": "u1",
            "status": "paused",
            "hold_credits": 12,
            "charged_credits": 0,
            "meta_json": "{}",
        },
    )
    monkeypatch.setattr(build_mod, "merge_task_meta", lambda *a, **k: {})
    monkeypatch.setattr(build_mod, "_update_task", lambda *a, **k: None)
    monkeypatch.setattr(build_mod, "_unbind_design_hold_fns", lambda *_a, **_k: None)

    out = request_design_cancel("c1", refund_hold_fn=refund)
    assert out["ok"] is True
    assert out["status"] == "cancelled"
    assert refunded == [("u1", 12, "c1")]
    assert out.get("cleanup_checkpoint") is True


def test_get_design_run_status_shape(monkeypatch):
    from app.services.design.runtime.graph import build as build_mod

    monkeypatch.setattr(
        build_mod,
        "get_design_task",
        lambda _tid: {
            "id": "s1",
            "user_id": "u",
            "status": "paused",
            "hold_credits": 3,
            "charged_credits": 0,
            "error_message": "paused",
            "meta_json": json.dumps(
                {
                    "run_lifecycle": {
                        "thread_id": "design:s1",
                        "resumable": True,
                        "interrupt_kind": "paused",
                        "resume_token": "tok",
                        "checkpoint_at": 1.0,
                    }
                }
            ),
            "updated_at": 2.0,
        },
    )
    st = get_design_run_status("s1")
    assert st is not None
    assert st["resumable"] is True
    assert st["resume_token"] == "tok"
    assert st["interrupt_kind"] == "paused"
    assert st["thread_id"] == "design:s1"


def test_build_run_lifecycle_fields():
    lc = ts.build_run_lifecycle(
        thread_id="design:x",
        resumable=True,
        interrupt_kind="paused",
    )
    assert lc["thread_id"] == "design:x"
    assert lc["resumable"] is True
    assert lc["interrupt_kind"] == "paused"
    assert lc["resume_token"]
    expired = ts.build_run_lifecycle(
        thread_id="design:x",
        resumable=False,
        interrupt_kind="expired",
        settled=True,
    )
    assert expired["resume_token"] is None
    assert expired["resumable"] is False


def test_filter_unemitted_ops_idempotent():
    from app.services.design.runtime.graph.nodes.apply import (
        _filter_unemitted_ops,
        _mark_ops_emitted,
        _op_id_of,
    )
    from app.services.design.runtime.graph.state import AgentRunState

    st = AgentRunState(task_id="t", trace_id="tr", goal="")
    ops = [
        {"name": "create_rect", "op_id": "a1", "args": {}},
        {"name": "create_text", "op_id": "a2", "args": {}},
        {"name": "noop", "args": {}},
    ]
    assert _op_id_of(ops[0]) == "a1"
    assert _op_id_of(ops[1]) == "a2"
    assert _op_id_of(ops[2]).startswith("fp:")
    first = _filter_unemitted_ops(st, ops)
    assert len(first) == 3
    _mark_ops_emitted(st, first[:2])
    assert st.emitted_op_ids == ["a1", "a2"]
    second = _filter_unemitted_ops(st, ops)
    assert len(second) == 1
    assert second[0]["name"] == "noop"
    _mark_ops_emitted(st, second)
    assert _filter_unemitted_ops(st, ops) == []


def test_list_stale_resumable_respects_ttl(monkeypatch):
    import time

    now = time.time()
    rows = [
        {
            "id": "old-paused",
            "status": "paused",
            "meta_json": "{}",
            "updated_at": now - 100_000,
        },
        {
            "id": "fresh",
            "status": "paused",
            "meta_json": "{}",
            "updated_at": now - 10,
        },
        {
            "id": "err-non",
            "status": "error",
            "meta_json": json.dumps({"run_lifecycle": {"resumable": False}}),
            "updated_at": now - 100_000,
        },
    ]

    class _FakeRow:
        def __init__(self, d):
            self._d = d

        def model_dump(self):
            return self._d

    def fake_list(*, session, statuses, cutoff, limit):
        _ = session, statuses, limit
        return [_FakeRow(r) for r in rows if float(r["updated_at"]) < cutoff]

    monkeypatch.setattr("app.repositories.design_tasks.list_stale_design_tasks", fake_list)
    ids = ts.list_stale_resumable_task_ids(ttl_hours=1.0, limit=50)
    assert ids == ["old-paused"]
    assert ts.list_stale_resumable_task_ids(ttl_hours=0) == []


def test_expire_stale_design_task(monkeypatch):
    updated: dict = {}
    metas: list = []

    monkeypatch.setattr(
        ts,
        "get_design_task",
        lambda tid: {
            "id": tid,
            "status": "paused",
            "meta_json": json.dumps(
                {"run_lifecycle": {"thread_id": f"design:{tid}", "resumable": True}}
            ),
        },
    )

    def merge(tid, patch):
        metas.append((tid, patch))
        return patch

    monkeypatch.setattr(ts, "merge_task_meta", merge)
    monkeypatch.setattr(
        ts,
        "_update_task",
        lambda tid, **fields: updated.update({"id": tid, **fields}),
    )
    assert ts.expire_stale_design_task("e1") is True
    assert updated["status"] == "cancelled"
    assert updated["error_message"] == "checkpoint_ttl_expired"
    lc = metas[0][1]["run_lifecycle"]
    assert lc["resumable"] is False
    assert lc["interrupt_kind"] == "expired"


def test_sweep_stale_skips_when_ttl_zero(monkeypatch):
    import asyncio

    from app.core.config import settings as settings_mod
    from app.services.design.runtime.graph import build as build_mod

    monkeypatch.setattr(settings_mod, "design_run_checkpoint_ttl_hours", 0)
    out = asyncio.run(build_mod.sweep_stale_design_checkpoints())
    assert out["skipped"] is True
    assert out["swept"] == 0


def test_require_durable_checkpointer_refuses_memory(monkeypatch):
    from app.core.config import settings as settings_mod
    from app.services.design.runtime.graph import build as build_mod

    monkeypatch.setattr(
        settings_mod, "design_graph_require_durable_checkpoint", True
    )
    monkeypatch.setattr(
        "app.services.llm.agent.get_agent_checkpointer", lambda: object()
    )
    monkeypatch.setattr("app.services.llm.agent.checkpointer_backend", lambda: "memory")
    with pytest.raises(RuntimeError, match="durable checkpointer"):
        build_mod._get_design_graph_checkpointer()
    monkeypatch.setattr(
        settings_mod, "design_graph_require_durable_checkpoint", False
    )
    assert build_mod._get_design_graph_checkpointer() is not None


def _patch_lease_store(monkeypatch, store: dict[str, dict]):
    """In-memory lease store; force meta path (no Redis / no live DB)."""
    monkeypatch.setattr(ts, "_lease_redis", lambda: None)

    def force_meta(tid, owner, *, ttl, steal_if_expired=True):
        return ts._claim_lease_meta(
            tid, owner, ttl=ttl, steal_if_expired=steal_if_expired
        )

    monkeypatch.setattr(ts, "_claim_lease_db_cas", force_meta)

    def get_task(tid):
        return store.get(tid)

    def merge(tid, patch):
        row = store.setdefault(tid, {"id": tid, "meta_json": "{}"})
        meta = ts.parse_task_meta(row.get("meta_json"))
        for k, v in patch.items():
            meta[k] = v
        row["meta_json"] = json.dumps(meta)
        return meta

    monkeypatch.setattr(ts, "get_design_task", get_task)
    monkeypatch.setattr(ts, "merge_task_meta", merge)


def test_claim_run_lease_exclusive(monkeypatch):
    store: dict[str, dict] = {
        "L1": {"id": "L1", "status": "running", "meta_json": "{}"},
    }
    _patch_lease_store(monkeypatch, store)

    a = ts.claim_run_lease("L1", owner_id="worker-a", ttl_sec=60)
    assert a["ok"] is True
    assert a.get("via") in ("meta", "db")
    b = ts.claim_run_lease("L1", owner_id="worker-b", ttl_sec=60)
    assert b["ok"] is False
    assert b["error"] == "lease_held"
    assert ts.heartbeat_run_lease("L1", owner_id="worker-a") is True
    assert ts.heartbeat_run_lease("L1", owner_id="worker-b") is False
    ts.release_run_lease("L1", owner_id="worker-a")
    c = ts.claim_run_lease("L1", owner_id="worker-b", ttl_sec=60)
    assert c["ok"] is True


def test_claim_run_lease_steals_expired(monkeypatch):
    import time as _t

    past = _t.time() - 10
    store = {
        "L2": {
            "id": "L2",
            "status": "paused",
            "meta_json": json.dumps(
                {
                    "run_lease": {
                        "owner_id": "dead",
                        "expires_at": past,
                        "ttl_sec": 30,
                    }
                }
            ),
        }
    }
    _patch_lease_store(monkeypatch, store)
    out = ts.claim_run_lease("L2", owner_id="alive", ttl_sec=30)
    assert out["ok"] is True
    assert out["lease"]["owner_id"] == "alive"


def test_claim_run_lease_redis_nx(monkeypatch):
    """Redis SET NX wins before DB; second owner is rejected."""
    store: dict[str, dict] = {
        "LR": {"id": "LR", "status": "running", "meta_json": "{}"},
    }
    keys: dict[str, str] = {}

    class _FakeRedis:
        def get(self, key):
            return keys.get(key)

        def set(self, key, value, nx=False, ex=None):
            if nx and key in keys:
                return False
            keys[key] = value
            return True

        def delete(self, key):
            keys.pop(key, None)

    monkeypatch.setattr(ts, "_lease_redis", lambda: _FakeRedis())

    def merge(tid, patch):
        row = store.setdefault(tid, {"id": tid, "meta_json": "{}"})
        meta = ts.parse_task_meta(row.get("meta_json"))
        for k, v in patch.items():
            meta[k] = v
        row["meta_json"] = json.dumps(meta)
        return meta

    monkeypatch.setattr(ts, "get_design_task", lambda tid: store.get(tid))
    monkeypatch.setattr(ts, "merge_task_meta", merge)

    a = ts.claim_run_lease("LR", owner_id="redis-a", ttl_sec=60)
    assert a["ok"] is True
    assert a.get("via") == "redis"
    b = ts.claim_run_lease("LR", owner_id="redis-b", ttl_sec=60)
    assert b["ok"] is False
    assert b["error"] == "lease_held"
    ts.release_run_lease("LR", owner_id="redis-a")
    c = ts.claim_run_lease("LR", owner_id="redis-b", ttl_sec=60)
    assert c["ok"] is True
    assert c.get("via") == "redis"


def test_durable_run_intent(monkeypatch):
    store = {"I1": {"id": "I1", "meta_json": "{}"}}

    monkeypatch.setattr(ts, "get_design_task", lambda tid: store.get(tid))

    def merge(tid, patch):
        row = store[tid]
        meta = ts.parse_task_meta(row.get("meta_json"))
        for k, v in patch.items():
            meta[k] = v
        row["meta_json"] = json.dumps(meta)
        return meta

    monkeypatch.setattr(ts, "merge_task_meta", merge)
    ts.set_run_intent("I1", "pause")
    assert ts.peek_run_intent("I1") == "pause"
    ts.set_run_intent("I1", None)
    assert ts.peek_run_intent("I1") is None


def test_scene_wait_durable_cross_worker(monkeypatch):
    import asyncio

    from app.services.design.runtime import scene_feedback as sf

    durable: dict[str, dict] = {}

    monkeypatch.setattr(sf, "_redis_client", lambda: None)

    def write(tid, slot):
        durable[tid] = dict(slot)
        durable[tid]["updated_at"] = 1.0

    def read(tid):
        return dict(durable[tid]) if tid in durable else None

    def take(tid):
        slot = durable.get(tid)
        if not slot or not slot.get("ready"):
            return None
        payload = slot.get("payload")
        durable[tid] = {
            "waiting": False,
            "ready": False,
            "round": slot.get("round") or 0,
            "payload": None,
        }
        return sf._unpack_payload(payload)

    monkeypatch.setattr(sf, "_durable_write", write)
    monkeypatch.setattr(sf, "_durable_read", read)
    monkeypatch.setattr(sf, "_durable_take", take)
    monkeypatch.setattr(ts, "peek_run_intent", lambda _tid: None)

    async def _run():
        await sf.publish_scene(
            "SW1",
            [{"id": "n1"}],
            frames=[{"id": "f1"}],
            op_results=[{"op_id": "o1", "ok": True}],
            round_n=2,
        )
        async with sf._lock:
            sf._pending.pop("SW1", None)
        snap = await sf.wait_for_scene("SW1", timeout_sec=2.0)
        assert snap is not None
        assert snap["nodes"][0]["id"] == "n1"
        assert snap["frames"][0]["id"] == "f1"

    asyncio.run(_run())


def test_redis_take_ready_getdel_once(monkeypatch):
    """Only one consumer wins a ready Redis latch."""
    from app.services.design.runtime import scene_feedback as sf

    payload = {
        "waiting": False,
        "ready": True,
        "round": 3,
        "payload": {
            "nodes": [{"id": "n9"}],
            "frames": [],
            "spatial": None,
            "op_results": [],
            "round": 3,
        },
    }
    raw = json.dumps(payload)
    store: dict[str, str] = {"design:scene_wait:RT1": raw}
    deleted: list[str] = []

    class _FakeRedis:
        def execute_command(self, cmd, key):
            if str(cmd).upper() != "GETDEL":
                raise RuntimeError("unsupported")
            deleted.append(key)
            return store.pop(key, None)

        def get(self, key):
            return store.get(key)

        def delete(self, key):
            store.pop(key, None)

        def set(self, key, value, ex=None):
            store[key] = value

    monkeypatch.setattr(sf, "_redis_client", lambda: _FakeRedis())
    first = sf._redis_take_ready("RT1")
    second = sf._redis_take_ready("RT1")
    assert first is not None
    assert first["nodes"][0]["id"] == "n9"
    assert second is None
    assert "design:scene_wait:RT1" not in store
    assert deleted[0] == "design:scene_wait:RT1"


def test_redis_take_ready_restores_waiting_latch(monkeypatch):
    from app.services.design.runtime import scene_feedback as sf

    waiting = {"waiting": True, "ready": False, "round": 1, "payload": None}
    raw = json.dumps(waiting)
    store: dict[str, str] = {"design:scene_wait:W1": raw}

    class _FakeRedis:
        def execute_command(self, cmd, key):
            if str(cmd).upper() != "GETDEL":
                raise RuntimeError("unsupported")
            return store.pop(key, None)

        def set(self, key, value, ex=None):
            store[key] = value

    monkeypatch.setattr(sf, "_redis_client", lambda: _FakeRedis())
    assert sf._redis_take_ready("W1") is None
    assert "design:scene_wait:W1" in store


def test_request_run_intent_persists(monkeypatch):
    from app.services.design.runtime.graph import build as build_mod

    intents: list = []

    monkeypatch.setattr(
        build_mod, "set_run_intent", lambda tid, intent: intents.append((tid, intent))
    )
    monkeypatch.setattr(build_mod, "peek_run_intent", lambda tid: None)
    ok = build_mod._request_run_intent("t-intent", build_mod._INTENT_PAUSE)
    assert ok is False  # no local asyncio task
    assert intents == [("t-intent", "pause")]
    assert build_mod._get_run_intent("t-intent") == "pause"


def test_normalize_resume_snap():
    from app.services.design.runtime.graph.nodes.observe import _normalize_resume_snap

    assert _normalize_resume_snap(None) is None
    assert _normalize_resume_snap({"timeout": True}) is None
    assert _normalize_resume_snap({"paused": True}) is None
    snap = _normalize_resume_snap(
        {
            "nodes": [{"id": "n1"}],
            "frames": [{"id": "f1"}],
            "op_results": [{"ok": False, "name": "x"}],
            "spatial": {"empty_rects": []},
        }
    )
    assert snap is not None
    assert snap["nodes"][0]["id"] == "n1"
    assert snap["spatial"]["empty_rects"] == []


def test_interrupt_payloads_and_scene_from_state():
    from types import SimpleNamespace

    from app.services.design.runtime.graph import build as build_mod

    assert build_mod._interrupt_payloads(None) == []
    iv = SimpleNamespace(value={"kind": "scene_feedback", "task_id": "t"})
    assert build_mod._interrupt_payloads((iv,)) == [
        {"kind": "scene_feedback", "task_id": "t"}
    ]
    st = SimpleNamespace(
        tasks=(SimpleNamespace(interrupts=(iv,)),),
        interrupts=None,
    )
    got = build_mod._scene_interrupt_from_state(st)
    assert got == {"kind": "scene_feedback", "task_id": "t"}


def test_scene_interrupt_bridge_resume():
    """Minimal graph: interrupt ? Command(resume=) completes observe."""
    import asyncio
    from typing import TypedDict

    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt

    from app.services.design.runtime.graph.build import _interrupt_payloads

    class S(TypedDict):
        n: int
        snap: object

    async def observe(state: S):
        val = interrupt({"kind": "scene_feedback", "round": state["n"]})
        return {"snap": val}

    g = StateGraph(S)
    g.add_node("observe", observe)
    g.add_edge(START, "observe")
    g.add_edge("observe", END)
    app = g.compile(checkpointer=InMemorySaver())
    cfg = {"configurable": {"thread_id": "bridge-1"}}

    async def _run():
        saw = None
        async for item in app.astream(
            {"n": 1, "snap": None}, cfg, stream_mode=["custom", "updates"]
        ):
            mode, data = item
            if mode == "updates" and isinstance(data, dict) and "__interrupt__" in data:
                saw = data["__interrupt__"]
        assert saw is not None
        payloads = _interrupt_payloads(saw)
        assert payloads[0]["kind"] == "scene_feedback"
        async for _ in app.astream(
            Command(resume={"nodes": [{"id": "a"}], "frames": []}),
            cfg,
            stream_mode="updates",
        ):
            pass
        st = await app.aget_state(cfg)
        assert st.values["snap"]["nodes"][0]["id"] == "a"
        assert st.next == ()

    asyncio.run(_run())
