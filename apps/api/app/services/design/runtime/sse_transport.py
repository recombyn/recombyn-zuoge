"""Durable Worker-to-browser SSE transport for design runs."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from typing import Any


USER_HEARTBEAT_INTERVAL_SECONDS = 2.0


def sse_data(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def worker_run_sse(task_id: str) -> AsyncIterator[str]:
    from app.services.design.admin.task_store import TERMINAL_STATUSES, get_canvas_commands, get_design_task, get_task_events
    from app.services.design.runtime.pipeline_progress import PipelineSseState

    event_seq = 0
    # The command outbox has a durable browser ACK cursor. Start replay after
    # it so a fresh SSE connection never re-sends already applied mutations.
    command_state = await asyncio.to_thread(get_canvas_commands, task_id, after_seq=0)
    command_seq = max(0, int(command_state.get("acked_seq") or 0))
    progress = PipelineSseState(task_id=task_id)
    last_heartbeat = 0.0
    yield ": connected\n\n"
    yield sse_data(
        progress.decorate({"type": "status", "task_id": task_id, "status": "queued"})
    )
    while True:
        page = await asyncio.to_thread(get_task_events, task_id, after_seq=event_seq)
        items = page.get("items") or []
        for item in items:
            event_seq = max(event_seq, int(item.get("seq") or 0))
            if isinstance(event := item.get("event"), dict):
                for frame in progress.observe(event):
                    yield sse_data(progress.decorate(frame))
                yield sse_data(progress.decorate(event))
        if not items:
            # Empty page still reports last scanned id so model-only windows unblock.
            event_seq = max(event_seq, int(page.get("next_seq") or event_seq))
        for item in (await asyncio.to_thread(get_canvas_commands, task_id, after_seq=command_seq)).get("items") or []:
            command_seq = max(command_seq, int(item.get("seq") or 0))
            if isinstance(event := item.get("event"), dict):
                yield sse_data(progress.decorate({**event, "command_seq": command_seq}))
        row = await asyncio.to_thread(get_design_task, task_id)
        if row and str(row.get("status") or "") in (*TERMINAL_STATUSES, "error"):
            if frame := progress.terminal_stage_event():
                yield sse_data(progress.decorate(frame))
            yield "data: [DONE]\n\n"
            return
        now = asyncio.get_running_loop().time()
        if now - last_heartbeat >= USER_HEARTBEAT_INTERVAL_SECONDS:
            last_heartbeat = now
            if frame := progress.heartbeat_stage_event():
                yield sse_data(progress.decorate(frame))
            yield ": ping\n\n"
        await asyncio.sleep(0.25)


async def local_run_sse(
    source: Callable[[], AsyncIterator[dict[str, Any]]],
    *,
    emit: Callable[[dict[str, Any]], list[dict[str, Any]]],
    persist: Callable[[dict[str, Any]], None],
    heartbeat: Callable[[], dict[str, Any] | None],
    terminal: Callable[[], dict[str, Any] | None],
    decorate: Callable[[dict[str, Any]], dict[str, Any]],
    error_code: Callable[[Exception], str],
) -> AsyncIterator[str]:
    """Transport loop shared by local API execution and checkpoint resume."""
    yield ": connected\n\n"
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=256)
    closed = asyncio.Event()

    async def deliver(item: tuple[str, Any]) -> None:
        while not closed.is_set():
            try:
                queue.put_nowait(item)
                return
            except asyncio.QueueFull:
                await asyncio.sleep(0.05)

    async def produce() -> None:
        try:
            async for event in source():
                frames = emit(event)
                decorated_frames = [decorate(frame) for frame in frames]
                decorated_event = decorate(event)
                for frame in [*decorated_frames, decorated_event]:
                    persist(frame)
                for frame in decorated_frames:
                    await deliver(("event", frame))
                await deliver(("event", decorated_event))
        except Exception as error:  # noqa: BLE001
            payload = {"type": "error", "code": error_code(error), "message": str(error)[:800]}
            payload = decorate(payload)
            persist(payload)
            await deliver(("event", payload))
        finally:
            if frame := terminal():
                frame = decorate(frame)
                persist(frame)
                await deliver(("event", frame))
            await deliver(("done", None))

    asyncio.create_task(produce())
    try:
        while True:
            try:
                kind, payload = await asyncio.wait_for(
                    queue.get(), timeout=USER_HEARTBEAT_INTERVAL_SECONDS
                )
            except asyncio.TimeoutError:
                if frame := heartbeat():
                    yield sse_data(decorate(frame))
                yield ": ping\n\n"
                continue
            if kind == "done":
                yield "data: [DONE]\n\n"
                return
            if isinstance(payload, dict):
                yield sse_data(payload)
    finally:
        closed.set()
