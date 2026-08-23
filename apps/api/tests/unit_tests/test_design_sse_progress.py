from app.api.routes.design import _PipelineSseState


def test_pipeline_heartbeat_remains_visible_after_canvas_paint() -> None:
    """Long paint/refine phases must remain visible rather than degrading to SSE comments."""
    state = _PipelineSseState()
    state.arm("ops")
    state.saw_paint = True

    event = state.heartbeat_stage_event()

    assert event is not None
    assert event["type"] == "activity"
    assert event["stage"] == "ops"


def test_shared_pipeline_progress_reaches_one_terminal_stage() -> None:
    from app.services.design.runtime.pipeline_progress import PipelineSseState

    state = PipelineSseState(task_id="task-1")
    state.observe({"type": "activity", "kind": "tool", "stage": "ops"})

    terminal = state.observe({"type": "result", "status": "success"})

    assert [event["stage"] for event in terminal] == ["done"]
    assert state.terminal_stage_event() is None


def test_shared_pipeline_progress_hides_chat_heartbeats() -> None:
    from app.services.design.runtime.pipeline_progress import PipelineSseState

    state = PipelineSseState(task_id="task-1")
    state.arm("ops")
    state.observe({"type": "chat_done"})

    assert state.heartbeat_stage_event() is None


def test_agent_event_envelope_is_stable_and_user_visible() -> None:
    from app.services.design.runtime.pipeline_progress import (
        AGENT_EVENT_PROTOCOL,
        PipelineSseState,
    )

    state = PipelineSseState(task_id="task-1")
    payload = state.decorate({"type": "tool_ops", "ops": [], "stage": "ops"})

    assert payload["type"] == "tool_ops"
    assert payload["agent_event"] == {
        "protocol": AGENT_EVENT_PROTOCOL,
        "event_id": "task-1:1",
        "kind": "tool_call",
        "phase": "ops",
        "elapsed_ms": payload["agent_event"]["elapsed_ms"],
        "can_cancel": True,
        "resumable": False,
    }


def test_user_heartbeat_interval_is_two_seconds() -> None:
    from app.services.design.runtime.sse_transport import USER_HEARTBEAT_INTERVAL_SECONDS

    assert USER_HEARTBEAT_INTERVAL_SECONDS == 2.0


def test_worker_sse_emits_shared_terminal_progress(monkeypatch) -> None:
    import asyncio
    import json

    from app.services.design.runtime.sse_transport import worker_run_sse
    from app.services.design.admin import task_store

    monkeypatch.setattr(
        task_store,
        "get_task_events",
        lambda *_args, **_kwargs: {
            "items": [
                {
                    "seq": 1,
                    "event": {"type": "activity", "kind": "tool", "stage": "ops"},
                }
            ]
        },
    )
    monkeypatch.setattr(task_store, "get_canvas_commands", lambda *_args, **_kwargs: {"items": []})
    monkeypatch.setattr(task_store, "get_design_task", lambda *_args, **_kwargs: {"status": "success"})

    async def frames() -> list[str]:
        stream = worker_run_sse("task-1")
        return [await stream.__anext__() for _ in range(5)]

    frames_out = asyncio.run(frames())
    payloads = [
        json.loads(frame.removeprefix("data: ").strip())
        for frame in frames_out
        if frame.startswith("data: {")
    ]

    assert any(event.get("type") == "activity" and event.get("stage") == "done" for event in payloads)
    assert frames_out[-1] == "data: [DONE]\n\n"


def test_worker_sse_attaches_outbox_sequence_to_canvas_command(monkeypatch) -> None:
    import asyncio
    import json

    from app.api.routes.design import _worker_run_sse
    from app.services.design.admin import task_store

    monkeypatch.setattr(task_store, "get_task_events", lambda *_args, **_kwargs: {"items": []})
    monkeypatch.setattr(
        task_store,
        "get_canvas_commands",
        lambda *_args, **_kwargs: {
            "items": [{"seq": 42, "event": {"type": "tool_ops", "ops": []}}]
        },
    )
    monkeypatch.setattr(task_store, "get_design_task", lambda *_args, **_kwargs: {"status": "success"})

    async def frames():
        stream = _worker_run_sse("task-1")
        return [await stream.__anext__(), await stream.__anext__(), await stream.__anext__()]

    _, _, command = asyncio.run(frames())
    payload = json.loads(command.removeprefix("data: ").strip())
    assert payload["type"] == "tool_ops"
    assert payload["command_seq"] == 42


def test_worker_sse_starts_canvas_replay_after_durable_ack(monkeypatch) -> None:
    import asyncio

    from app.services.design.runtime.sse_transport import worker_run_sse
    from app.services.design.admin import task_store

    requested_after: list[int] = []

    monkeypatch.setattr(task_store, "get_task_events", lambda *_args, **_kwargs: {"items": []})

    def commands(*_args, **kwargs):
        requested_after.append(int(kwargs.get("after_seq") or 0))
        return {"items": [], "acked_seq": 19}

    monkeypatch.setattr(task_store, "get_canvas_commands", commands)
    monkeypatch.setattr(task_store, "get_design_task", lambda *_args, **_kwargs: {"status": "success"})

    async def frames() -> list[str]:
        stream = worker_run_sse("task-1")
        return [await stream.__anext__() for _ in range(3)]

    asyncio.run(frames())
    assert requested_after[:2] == [0, 19]
