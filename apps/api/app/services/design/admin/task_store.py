"""design_task / layer-lock persistence for agent runs."""
from __future__ import annotations

import json
import os
import secrets
import socket
import threading
import time
import uuid as _uuid
from typing import Any

# Terminal vs resumable run statuses (LangGraph checkpoint lifecycle).
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_WAITING_CLIENT = "waiting_client"
STATUS_PAUSED = "paused"
STATUS_SUCCESS = "success"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"

RESUMABLE_STATUSES = frozenset(
    {STATUS_PAUSED, STATUS_WAITING_CLIENT, STATUS_ERROR}
)
TERMINAL_STATUSES = frozenset({STATUS_SUCCESS, STATUS_CANCELLED})

# Product-level run events are intentionally separate from raw model output and
# canvas mutations. They are safe to replay after a browser reconnect without
# accidentally applying an operation twice.
_EVENT_LOG_KEY = "event_log"
_EVENT_LOG_MAX_ITEMS = 96
_EVENT_LOG_MAX_BYTES = 12_000
_COMMAND_LOG_KEY = "canvas_command_outbox"
_COMMAND_LOG_MAX_ITEMS = 48
_REPLAYABLE_EVENT_TYPES = frozenset(
    {
        "status",
        "decision",
        "skill_start",
        "skill_done",
        "activity",
        "paused",
        "cancelled",
        "error",
        "result",
        "chat_done",
    }
)
_EVENT_LOG_DROP_KEYS = frozenset(
    {"svg", "ops", "scene_nodes", "scene_frames", "images", "preview_image"}
)
_TRACE_EVENT_TYPES = frozenset(
    {
        "turn/start",
        "turn/end",
        "step/start",
        "stage/decision",
        "llm/request",
        "llm/response",
        "tool/ops_emit",
        "scene/feedback",
    }
)
_TRACE_LOG_MAX_BYTES = 24_000
_TRACE_LOG_MAX_ITEMS = 256
_WORKER_SNAPSHOT_MAX_ITEMS = 120
_WORKER_SNAPSHOT_MAX_FRAMES = 32
_WORKER_SNAPSHOT_MAX_IMAGES = 8
_WORKER_SNAPSHOT_MAX_STRING = 250_000
_WORKER_SNAPSHOT_MAX_SVG = 1_000_000

_WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{_uuid.uuid4().hex[:8]}"


def _update_task(task_id: str, **fields: Any) -> None:
    if not fields:
        return
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        design_tasks.update_design_task(session=session, task_id=task_id, fields=fields)


def _insert_task(row: dict[str, Any]) -> None:
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        design_tasks.create_design_task(session=session, row=row)


def initialize_design_task(row: dict[str, Any]) -> bool:
    """Create a task once, or promote a prepared task to running without losing meta."""
    tid = str(row.get("id") or "").strip()
    if not tid:
        raise ValueError("missing_task_id")
    existing = get_design_task(tid)
    if not existing:
        _insert_task(row)
        return True
    if str(existing.get("status") or "") in TERMINAL_STATUSES:
        raise ValueError("task_already_terminal")

    current_meta = parse_task_meta(existing.get("meta_json"))
    incoming_meta = parse_task_meta(row.get("meta_json"))
    # The API snapshot is the complete request used to launch the job.  Graph
    # bootstrap only knows a reduced runtime view, so it must never downgrade a
    # prepared Worker snapshot when it persists execution metadata.
    prepared_snapshot = current_meta.get("worker_snapshot")
    current_meta.update(incoming_meta)
    if isinstance(prepared_snapshot, dict):
        current_meta["worker_snapshot"] = prepared_snapshot
    fields = {
        key: value
        for key, value in row.items()
        if key not in {"id", "user_id", "created_at", "meta_json"}
    }
    fields["meta_json"] = json.dumps(current_meta, ensure_ascii=False)
    _update_task(tid, **fields)
    return False


def get_design_task(task_id: str) -> dict[str, Any] | None:
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    tid = str(task_id or "").strip()
    if not tid:
        return None
    with Session(engine) as session:
        row = design_tasks.get_design_task(session=session, task_id=tid)
    if not row:
        return None
    return row.model_dump()


def parse_task_meta(meta_json: Any) -> dict[str, Any]:
    if isinstance(meta_json, dict):
        return dict(meta_json)
    raw = str(meta_json or "").strip()
    if not raw:
        return {}
    try:
        got = json.loads(raw)
        return got if isinstance(got, dict) else {}
    except Exception:
        return {}


def build_worker_snapshot(
    *,
    mode: str,
    prompt: str,
    canvas_id: str | None,
    canvas_size: str | None,
    scene: str | None,
    focus_frame_id: str | None,
    scene_nodes: list[dict[str, Any]] | None,
    scene_frames: list[dict[str, Any]] | None,
    images: list[str] | None,
    user_selected_model: str | None = None,
    style_group_id: int | None = None,
    ref_image_sizes: list[str] | None = None,
    target_layer_id: str | None = None,
    layer_ids: list[str] | None = None,
    current_svg: str | None = None,
    spatial_summary: dict[str, Any] | None = None,
    session_id: str | None = None,
    project_id: str | None = None,
    memory: dict[str, Any] | None = None,
    route_overrides: dict[str, Any] | None = None,
    apply_ops: list[dict[str, Any]] | None = None,
    proposal_id: str | None = None,
    proposal_task_id: str | None = None,
    interaction_mode: str | None = None,
    client_country: str | None = None,
    skill_refs: list[str] | None = None,
    paint_mode: str | None = None,
    locale: str | None = None,
    design_intensity: str | None = None,
) -> dict[str, Any]:
    """Build the versioned, bounded request DTO used by Worker execution.

    Worker mode must receive the same behavior-affecting inputs as the local
    request path.  This function only bounds transport size; it does not
    intentionally discard a field based on its meaning.
    """
    def text(value: Any, *, limit: int = _WORKER_SNAPSHOT_MAX_STRING) -> str | None:
        if value is None:
            return None
        return str(value)[:limit]

    def json_value(value: Any) -> Any:
        try:
            # JSON round-trip prevents non-serializable request state entering
            # task metadata while preserving normal dict/list structures.
            return json.loads(json.dumps(value, ensure_ascii=False))
        except (TypeError, ValueError):
            return None

    def objects(items: list[dict[str, Any]] | None, limit: int) -> list[dict[str, Any]]:
        return [item for item in (json_value(items) or [])[:limit] if isinstance(item, dict)]

    def strings(items: list[str] | None, limit: int) -> list[str]:
        return [str(item)[:_WORKER_SNAPSHOT_MAX_STRING] for item in (items or [])[:limit] if isinstance(item, str)]

    return {
        "version": 2,
        "mode": text(mode, limit=32) or "agent",
        "user_selected_model": text(user_selected_model, limit=128) or "auto",
        "prompt": text(prompt, limit=12_000) or "",
        "canvas_id": text(canvas_id, limit=128),
        "canvas_size": text(canvas_size, limit=64),
        "scene": text(scene, limit=128),
        "focus_frame_id": text(focus_frame_id, limit=128),
        "scene_nodes": objects(scene_nodes, _WORKER_SNAPSHOT_MAX_ITEMS),
        "scene_frames": objects(scene_frames, _WORKER_SNAPSHOT_MAX_FRAMES),
        "images": strings(images, _WORKER_SNAPSHOT_MAX_IMAGES),
        "style_group_id": style_group_id,
        "ref_image_sizes": strings(ref_image_sizes, _WORKER_SNAPSHOT_MAX_IMAGES),
        "target_layer_id": text(target_layer_id, limit=128),
        "layer_ids": strings(layer_ids, _WORKER_SNAPSHOT_MAX_ITEMS),
        "current_svg": text(current_svg, limit=_WORKER_SNAPSHOT_MAX_SVG),
        "spatial_summary": json_value(spatial_summary),
        "session_id": text(session_id, limit=64),
        "project_id": text(project_id, limit=128),
        "memory": json_value(memory),
        "route_overrides": json_value(route_overrides),
        "apply_ops": objects(apply_ops, _WORKER_SNAPSHOT_MAX_ITEMS),
        "proposal_id": text(proposal_id, limit=64),
        "proposal_task_id": text(proposal_task_id, limit=64),
        "interaction_mode": text(interaction_mode, limit=16),
        "client_country": text(client_country, limit=8),
        "skill_refs": strings(skill_refs, _WORKER_SNAPSHOT_MAX_ITEMS),
        "paint_mode": text(paint_mode, limit=32),
        "locale": text(locale, limit=16),
        "design_intensity": text(design_intensity, limit=16),
    }


def _safe_lane_event(
    event: dict[str, Any],
    *,
    allowed: frozenset[str],
    max_bytes: int,
    omit_code: str,
) -> dict[str, Any] | None:
    """Strip canvas payloads and bound size for UI or model-lane persistence."""
    event_type = str(event.get("type") or "").strip()
    if event_type not in allowed:
        return None
    safe = {
        str(key): value
        for key, value in event.items()
        if str(key) not in _EVENT_LOG_DROP_KEYS
    }
    safe["type"] = event_type
    try:
        encoded = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return None
    if len(encoded.encode("utf-8")) > max_bytes:
        return {"type": event_type, "code": omit_code}
    return safe


def _safe_replay_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Keep a bounded UI timeline, never canvas payloads or model token streams."""
    return _safe_lane_event(
        event,
        allowed=_REPLAYABLE_EVENT_TYPES,
        max_bytes=_EVENT_LOG_MAX_BYTES,
        omit_code="event_payload_omitted",
    )


def _safe_trace_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Persist model-lane trace events (no canvas payloads)."""
    return _safe_lane_event(
        event,
        allowed=_TRACE_EVENT_TYPES,
        max_bytes=_TRACE_LOG_MAX_BYTES,
        omit_code="trace_payload_omitted",
    )


def _clamp_seq(after_seq: int, *, default: int = 0) -> int:
    try:
        return max(0, int(after_seq))
    except (TypeError, ValueError):
        return default


def _clamp_limit(limit: int, *, max_items: int) -> int:
    try:
        return max(1, min(int(limit), max_items))
    except (TypeError, ValueError):
        return max_items


def _append_task_event_json(task_id: str, safe: dict[str, Any]) -> int | None:
    tid = str(task_id or "").strip()
    if not tid or not safe:
        return None
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        if not design_tasks.get_design_task(session=session, task_id=tid):
            return None
        return design_tasks.append_design_task_event(
            session=session,
            task_id=tid,
            event_json=json.dumps(safe, ensure_ascii=False),
            created_at=time.time(),
        )


def append_trace_event(task_id: str, event: dict[str, Any]) -> int | None:
    """Persist a model-lane session trace event."""
    safe = _safe_trace_event(event)
    if safe is None:
        return None
    return _append_task_event_json(task_id, safe)


def _list_lane_events(
    task_id: str,
    *,
    after_seq: int,
    limit: int,
    max_items: int,
    allowed: frozenset[str],
) -> dict[str, Any]:
    tid = str(task_id or "").strip()
    cursor = _clamp_seq(after_seq)
    lim = _clamp_limit(limit, max_items=max_items)
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        rows = design_tasks.list_design_task_events(
            session=session, task_id=tid, after_id=cursor, limit=lim * 4
        )
    items: list[dict[str, Any]] = []
    last_scanned = cursor
    for row in rows:
        last_scanned = int(row.id or 0)
        event = parse_task_meta(row.event_json)
        if not event or str(event.get("type") or "") not in allowed:
            continue
        items.append({"seq": last_scanned, "at": row.created_at, "event": event})
        if len(items) >= lim:
            break
    # next_seq is the after_seq cursor (exclusive id > after_seq). Advance past
    # scanned other-lane rows so empty UI windows cannot stall SSE/pollers.
    return {"items": items, "next_seq": last_scanned if rows else cursor}


def get_task_trace(
    task_id: str,
    *,
    after_seq: int = 0,
    limit: int = 256,
) -> dict[str, Any]:
    """Read model-lane trace events for eval/debug."""
    return _list_lane_events(
        task_id,
        after_seq=after_seq,
        limit=limit,
        max_items=_TRACE_LOG_MAX_ITEMS,
        allowed=_TRACE_EVENT_TYPES,
    )


def _event_seq(item: dict[str, Any]) -> int:
    try:
        return int(item.get("seq") or 0)
    except (TypeError, ValueError):
        return 0


def append_task_event(task_id: str, event: dict[str, Any]) -> int | None:
    """Persist a compact, monotonically sequenced event for reconnect replay."""
    safe = _safe_replay_event(event)
    if safe is None:
        return None
    return _append_task_event_json(task_id, safe)


def get_task_events(
    task_id: str,
    *,
    after_seq: int = 0,
    limit: int = 96,
) -> dict[str, Any]:
    """Read UI-lane events only (model_request/response stay on /trace)."""
    return _list_lane_events(
        task_id,
        after_seq=after_seq,
        limit=limit,
        max_items=_EVENT_LOG_MAX_ITEMS,
        allowed=_REPLAYABLE_EVENT_TYPES,
    )


def append_canvas_command(task_id: str, event: dict[str, Any]) -> int | None:
    """Append one canvas command without touching competing task metadata."""
    tid = str(task_id or "").strip()
    if not tid or str(event.get("type") or "") not in {"tool_ops", "svg_delta"}:
        return None
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        if not design_tasks.get_design_task(session=session, task_id=tid):
            return None
        return design_tasks.append_design_task_canvas_command(
            session=session,
            task_id=tid,
            command_json=json.dumps(event, ensure_ascii=False),
            created_at=time.time(),
        )


def get_canvas_commands(task_id: str, *, after_seq: int = 0, limit: int = 48) -> dict[str, Any]:
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    tid = str(task_id or "").strip()
    cursor = max(0, int(after_seq or 0))
    lim = max(1, min(int(limit or 48), _COMMAND_LOG_MAX_ITEMS))
    with Session(engine) as session:
        rows = design_tasks.list_design_task_canvas_commands(
            session=session, task_id=tid, after_id=cursor, limit=lim
        )
        last_id, acked_id = design_tasks.get_design_task_canvas_command_cursors(session=session, task_id=tid)
    kept = []
    for row in rows:
        event = parse_task_meta(row.command_json)
        if event:
            kept.append({"seq": int(row.id or 0), "at": row.created_at, "event": event})
    return {
        "items": kept,
        "next_seq": last_id + 1,
        "acked_seq": acked_id,
    }


def acknowledge_canvas_commands(task_id: str, seq: int) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        design_tasks.acknowledge_design_task_canvas_commands(
            session=session,
            task_id=tid,
            through_id=max(0, int(seq or 0)),
            acknowledged_at=time.time(),
        )


def prune_design_run_outboxes(*, retention_days: int) -> dict[str, int]:
    """Prune old replay rows without affecting active/resumable task recovery."""
    from sqlmodel import Session
    from app.repositories import design_tasks
    from app.core.db import engine

    days = max(1, int(retention_days or 7))
    with Session(engine) as session:
        return design_tasks.prune_design_task_outboxes(
            session=session,
            cutoff=time.time() - days * 86400,
            statuses=[STATUS_SUCCESS, STATUS_CANCELLED, STATUS_ERROR],
        )


def get_run_lifecycle(meta: dict[str, Any] | None) -> dict[str, Any]:
    lc = (meta or {}).get("run_lifecycle")
    return dict(lc) if isinstance(lc, dict) else {}


def new_resume_token() -> str:
    return secrets.token_urlsafe(16)


def build_run_lifecycle(
    *,
    thread_id: str,
    resumable: bool,
    interrupt_kind: str | None = None,
    resume_token: str | None = None,
    settled: bool = False,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "thread_id": str(thread_id or "").strip(),
        "resumable": bool(resumable),
        "interrupt_kind": (str(interrupt_kind or "").strip() or None),
        "checkpoint_at": time.time(),
        "resume_token": (resume_token or new_resume_token()) if resumable else None,
        "settled": bool(settled),
    }
    if extra:
        for k, v in extra.items():
            if v is not None:
                out[k] = v
    return out


def merge_task_meta(task_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Atomically merge task metadata under the database row lock.

    Scene feedback, lifecycle updates and lease heartbeats arrive from
    different processes.  Updating a pre-read JSON blob loses fields written
    by another process, so all shared metadata writes pass through this one
    transactional path.
    """
    tid = str(task_id or "").strip()
    if not tid:
        return {}
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        row = design_tasks.get_design_task_for_update(session=session, task_id=tid)
        if not row:
            return {}
        meta = parse_task_meta(row.meta_json)
        for k, v in (patch or {}).items():
            if k == "run_lifecycle" and isinstance(v, dict):
                meta["run_lifecycle"] = {**get_run_lifecycle(meta), **v}
            else:
                meta[k] = v
        row.meta_json = json.dumps(meta, ensure_ascii=False)
        row.updated_at = time.time()
        session.add(row)
        session.commit()
    return meta


def task_is_resumable(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    status = str(row.get("status") or "").strip()
    if status not in RESUMABLE_STATUSES:
        return False
    if status == STATUS_ERROR:
        meta = parse_task_meta(row.get("meta_json"))
        lc = get_run_lifecycle(meta)
        if lc.get("resumable") is False:
            return False
    return True


def list_stale_resumable_task_ids(*, ttl_hours: float, limit: int = 100) -> list[str]:
    """Paused / waiting / resumable-error tasks older than TTL (by updated_at)."""
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    hours = float(ttl_hours or 0.0)
    if hours <= 0:
        return []
    lim = max(1, min(int(limit or 100), 500))
    cutoff = time.time() - hours * 3600.0
    with Session(engine) as session:
        rows = design_tasks.list_stale_design_tasks(
            session=session,
            statuses=[STATUS_PAUSED, STATUS_WAITING_CLIENT, STATUS_ERROR],
            cutoff=cutoff,
            limit=lim,
        )
    out: list[str] = []
    for row in rows:
        d = row.model_dump()
        if not task_is_resumable(d):
            continue
        tid = str(d.get("id") or "").strip()
        if tid:
            out.append(tid)
    return out


def list_stale_queued_task_ids(*, older_than_sec: float = 30.0, limit: int = 100) -> list[str]:
    """Queued tasks that were persisted but never claimed by a Worker."""
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    cutoff = time.time() - max(1.0, float(older_than_sec))
    with Session(engine) as session:
        rows = design_tasks.list_stale_design_tasks(
            session=session, statuses=[STATUS_QUEUED], cutoff=cutoff, limit=limit
        )
    return [str(row.id) for row in rows if str(row.id or "").strip()]


def expire_stale_design_task(
    task_id: str,
    *,
    reason: str = "checkpoint_ttl_expired",
) -> bool:
    """Mark a resumable orphan as cancelled + non-resumable. Caller deletes checkpoint."""
    tid = str(task_id or "").strip()
    if not tid:
        return False
    row = get_design_task(tid)
    if not row or not task_is_resumable(row):
        return False
    merge_task_meta(
        tid,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=str(
                    get_run_lifecycle(parse_task_meta(row.get("meta_json"))).get("thread_id")
                    or f"design:{tid}"
                ),
                resumable=False,
                interrupt_kind="expired",
                resume_token=None,
                settled=True,
                extra={"expire_reason": reason},
            )
        },
    )
    _update_task(tid, status=STATUS_CANCELLED, error_message=reason)
    return True


def recover_expired_running_task(task_id: str) -> bool:
    """Turn a dead Worker lease into an explicit, checkpoint-resumable state."""
    tid = str(task_id or "").strip()
    row = get_design_task(tid)
    if not row or str(row.get("status") or "") != STATUS_RUNNING:
        return False
    meta = parse_task_meta(row.get("meta_json"))
    if lease_is_active(get_run_lease(meta)):
        return False
    merge_task_meta(
        tid,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=str(get_run_lifecycle(meta).get("thread_id") or f"design:{tid}"),
                resumable=True,
                interrupt_kind="worker_lease_expired",
                extra={"recovery_hint": "resume_from_checkpoint"},
            )
        },
    )
    _update_task(tid, status=STATUS_ERROR, error_message="worker_lease_expired")
    return True


def list_stale_running_task_ids(*, older_than_sec: float, limit: int = 100) -> list[str]:
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        rows = design_tasks.list_stale_design_tasks(
            session=session,
            statuses=[STATUS_RUNNING],
            cutoff=time.time() - max(1.0, float(older_than_sec)),
            limit=limit,
        )
    return [str(row.id) for row in rows if str(row.id or "").strip()]


# --- Cross-worker run lease + durable pause/cancel intent --------------------

_LEASE_LOCK = threading.Lock()
_LEASE_REDIS_PREFIX = "design:run_lease:"


def design_worker_id() -> str:
    return _WORKER_ID


def get_run_lease(meta: dict[str, Any] | None) -> dict[str, Any]:
    raw = (meta or {}).get("run_lease")
    return dict(raw) if isinstance(raw, dict) else {}


def lease_is_active(lease: dict[str, Any] | None, *, now: float | None = None) -> bool:
    if not lease:
        return False
    owner = str(lease.get("owner_id") or "").strip()
    if not owner:
        return False
    exp = float(lease.get("expires_at") or 0)
    return exp > float(now if now is not None else time.time())


def _lease_ttl_sec(ttl_sec: float | None) -> float:
    try:
        from app.core.config import settings

        ttl = float(
            ttl_sec
            if ttl_sec is not None
            else getattr(settings, "design_run_lease_ttl_sec", 90.0) or 90.0
        )
    except Exception:
        ttl = float(ttl_sec or 90.0)
    return max(15.0, ttl)


def _lease_redis() -> Any | None:
    try:
        from app.core.config import settings

        url = str(getattr(settings, "redis_url", "") or "").strip()
        if not url:
            return None
        import redis

        return redis.Redis.from_url(
            url, decode_responses=True, socket_connect_timeout=0.4, socket_timeout=0.4
        )
    except Exception:
        return None


def _persist_run_lease_meta(task_id: str, lease: dict[str, Any] | None) -> None:
    merge_task_meta(
        task_id,
        {"run_lease": lease, **({"run_intent": None} if lease else {})},
    )


def _claim_lease_redis(
    tid: str,
    owner: str,
    *,
    ttl: float,
) -> dict[str, Any] | None:
    """Redis SET NX lease. Returns result dict or None if Redis unavailable."""
    r = _lease_redis()
    if r is None:
        return None
    key = f"{_LEASE_REDIS_PREFIX}{tid}"
    try:
        cur = r.get(key)
        if cur == owner:
            r.set(key, owner, ex=int(ttl))
            return {"ok": True, "via": "redis", "owner_id": owner}
        if cur and cur != owner:
            return {
                "ok": False,
                "error": "lease_held",
                "owner_id": cur,
                "via": "redis",
            }
        if r.set(key, owner, nx=True, ex=int(ttl)):
            return {"ok": True, "via": "redis", "owner_id": owner}
        # Lost race — re-read.
        cur2 = r.get(key)
        if cur2 == owner:
            return {"ok": True, "via": "redis", "owner_id": owner}
        return {
            "ok": False,
            "error": "lease_held",
            "owner_id": cur2,
            "via": "redis",
        }
    except Exception:
        return None


def _heartbeat_lease_redis(tid: str, owner: str, *, ttl: float) -> bool | None:
    r = _lease_redis()
    if r is None:
        return None
    key = f"{_LEASE_REDIS_PREFIX}{tid}"
    try:
        cur = r.get(key)
        if cur != owner:
            return False
        r.set(key, owner, ex=int(ttl))
        return True
    except Exception:
        return None


def _release_lease_redis(tid: str, owner: str) -> None:
    r = _lease_redis()
    if r is None:
        return
    key = f"{_LEASE_REDIS_PREFIX}{tid}"
    try:
        cur = r.get(key)
        if cur in (None, owner):
            r.delete(key)
    except Exception:
        pass


def _new_lease(owner: str, ttl: float, *, now: float | None = None) -> dict[str, Any]:
    t = float(now if now is not None else time.time())
    return {
        "owner_id": owner,
        "claimed_at": t,
        "heartbeat_at": t,
        "expires_at": t + ttl,
        "ttl_sec": ttl,
    }


def _claim_conflict(
    prev: dict[str, Any],
    owner: str,
    *,
    now: float,
    steal_if_expired: bool,
    via: str,
) -> dict[str, Any] | None:
    """Return an error payload if claim must fail; None if claim may proceed."""
    if lease_is_active(prev, now=now):
        prev_owner = str(prev.get("owner_id") or "")
        if prev_owner and prev_owner != owner:
            return {
                "ok": False,
                "error": "lease_held",
                "owner_id": prev_owner,
                "expires_at": prev.get("expires_at"),
                "via": via,
            }
        return None
    if prev and not steal_if_expired:
        return {
            "ok": False,
            "error": "lease_expired",
            "owner_id": prev.get("owner_id"),
            "via": via,
        }
    return None


def _claim_lease_meta(
    tid: str,
    owner: str,
    *,
    ttl: float,
    steal_if_expired: bool,
) -> dict[str, Any]:
    """Claim via get+merge (process lock held by caller). Used by tests / DB fallback."""
    now = time.time()
    row = get_design_task(tid)
    if not row:
        # New runs claim before bootstrap inserts the row (Redis NX path already
        # allows this). Treat missing row as an open claim; lease is persisted later.
        return {"ok": True, "lease": _new_lease(owner, ttl, now=now), "via": "pending"}
    meta = parse_task_meta(row.get("meta_json"))
    prev = get_run_lease(meta)
    conflict = _claim_conflict(
        prev, owner, now=now, steal_if_expired=steal_if_expired, via="meta"
    )
    if conflict:
        return conflict
    lease = _new_lease(owner, ttl, now=now)
    _persist_run_lease_meta(tid, lease)
    return {"ok": True, "lease": lease, "via": "meta"}


def _claim_lease_db_cas(
    tid: str,
    owner: str,
    *,
    ttl: float,
    steal_if_expired: bool,
) -> dict[str, Any]:
    """Transactional claim: Session + ``FOR UPDATE``."""
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    now = time.time()
    lease = _new_lease(owner, ttl, now=now)
    try:
        with Session(engine) as session:
            row = design_tasks.get_design_task_for_update(session=session, task_id=tid)
            if not row:
                return {"ok": True, "lease": lease, "via": "pending"}
            meta = parse_task_meta(row.meta_json)
            prev = get_run_lease(meta)
            conflict = _claim_conflict(
                prev, owner, now=now, steal_if_expired=steal_if_expired, via="db"
            )
            if conflict:
                return conflict
            meta["run_lease"] = lease
            meta["run_intent"] = None
            row.meta_json = json.dumps(meta, ensure_ascii=False)
            row.updated_at = time.time()
            session.add(row)
            session.commit()
        return {"ok": True, "lease": lease, "via": "db"}
    except Exception:
        # Unit tests / missing table: fall back to merge under process lock.
        return _claim_lease_meta(
            tid, owner, ttl=ttl, steal_if_expired=steal_if_expired
        )


def claim_run_lease(
    task_id: str,
    *,
    owner_id: str | None = None,
    ttl_sec: float | None = None,
    steal_if_expired: bool = True,
) -> dict[str, Any]:
    """Acquire exclusive ownership of a design run (Redis NX → DB CAS → meta)."""
    tid = str(task_id or "").strip()
    if not tid:
        return {"ok": False, "error": "missing_task_id"}
    owner = str(owner_id or _WORKER_ID).strip()
    ttl = _lease_ttl_sec(ttl_sec)
    with _LEASE_LOCK:
        redis_res = _claim_lease_redis(tid, owner, ttl=ttl)
        if redis_res is not None:
            if not redis_res.get("ok"):
                return redis_res
            lease = _new_lease(owner, ttl)
            try:
                _persist_run_lease_meta(tid, lease)
            except Exception:
                pass
            return {"ok": True, "lease": lease, "via": redis_res.get("via") or "redis"}
        return _claim_lease_db_cas(
            tid, owner, ttl=ttl, steal_if_expired=steal_if_expired
        )


def heartbeat_run_lease(
    task_id: str,
    *,
    owner_id: str | None = None,
    ttl_sec: float | None = None,
) -> bool:
    tid = str(task_id or "").strip()
    if not tid:
        return False
    owner = str(owner_id or _WORKER_ID).strip()
    ttl = _lease_ttl_sec(ttl_sec)
    with _LEASE_LOCK:
        redis_hb = _heartbeat_lease_redis(tid, owner, ttl=ttl)
        if redis_hb is False:
            return False
        row = get_design_task(tid)
        if not row:
            return False
        meta = parse_task_meta(row.get("meta_json"))
        prev = get_run_lease(meta)
        prev_owner = str(prev.get("owner_id") or "")
        if prev_owner and prev_owner != owner:
            return False
        now = time.time()
        lease = {
            **(prev or {}),
            "owner_id": owner,
            "heartbeat_at": now,
            "expires_at": now + ttl,
            "ttl_sec": ttl,
        }
        merge_task_meta(tid, {"run_lease": lease})
        return True


def release_run_lease(task_id: str, *, owner_id: str | None = None) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    owner = str(owner_id or _WORKER_ID).strip()
    with _LEASE_LOCK:
        _release_lease_redis(tid, owner)
        row = get_design_task(tid)
        if not row:
            return
        meta = parse_task_meta(row.get("meta_json"))
        prev = get_run_lease(meta)
        if prev and str(prev.get("owner_id") or "") not in ("", owner):
            return
        merge_task_meta(tid, {"run_lease": None})


def set_run_intent(task_id: str, intent: str | None) -> None:
    """Durable pause/cancel signal visible to every worker."""
    tid = str(task_id or "").strip()
    if not tid:
        return
    val = str(intent or "").strip() or None
    if val not in (None, "pause", "cancel"):
        return
    merge_task_meta(tid, {"run_intent": val})


def peek_run_intent(task_id: str) -> str | None:
    tid = str(task_id or "").strip()
    if not tid:
        return None
    row = get_design_task(tid)
    if not row:
        return None
    raw = parse_task_meta(row.get("meta_json")).get("run_intent")
    val = str(raw or "").strip()
    return val if val in ("pause", "cancel") else None


def resolve_ask_proposal_ops(
    proposal_task_id: str | None,
    proposal_id: str | None,
) -> list[dict[str, Any]] | None:
    """Return server-stored Ask ops when proposal id matches and is unexpired."""
    tid = str(proposal_task_id or "").strip()
    pid = str(proposal_id or "").strip()
    if not tid or not pid:
        return None
    row = get_design_task(tid)
    if not row:
        return None
    meta = parse_task_meta(row.get("meta_json"))
    prop = meta.get("ask_proposal")
    if not isinstance(prop, dict):
        return None
    if str(prop.get("id") or "").strip() != pid:
        return None
    try:
        exp = float(prop.get("expires_at") or 0)
    except (TypeError, ValueError):
        exp = 0.0
    if exp and exp < time.time():
        return None
    ops = prop.get("ops")
    if not isinstance(ops, list) or not ops:
        return None
    return [o for o in ops if isinstance(o, dict)][:48]


def _lock_layers(canvas_id: str, target_layer_id: str, all_layer_ids: list[str]) -> None:
    from sqlmodel import Session

    from app.repositories import design_tasks
    from app.core.db import engine

    with Session(engine) as session:
        design_tasks.insert_design_layer_locks(
            session=session,
            canvas_id=canvas_id,
            target_layer_id=target_layer_id,
            all_layer_ids=all_layer_ids,
        )
