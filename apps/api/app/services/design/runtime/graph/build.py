"""LangGraph compile + run_agent_graph entry."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, RetryPolicy, TimeoutPolicy

from recombyn_agent_sdk import KERNEL_CANVAS_REQUIRED

from app.services.design.readpath.canvas_scene import resolve_agent_scene, scene_key as _scene_key
from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.host import assemble_stage_system
from app.services.design.runtime.graph.llm_io import (
    _flag_on,
    _int_rule,
    _prompt_text,
    _resolve_agent_persona,
)
from app.services.design.runtime.graph.scene_log import (
    _persist_task_meta,
    _resolve_wh,
)
from app.services.design.runtime.graph.nodes import (
    _node_action,
    _node_animation_decide,
    _node_animation_paint,
    _node_apply_confirm,
    _node_bootstrap,
    _node_design_agent,
    _node_intent_classify,
    _node_memory,
    _node_observe,
    _node_paint_ops,
    _node_propose,
    _node_review_agent,
    _node_settle,
)
from app.services.design.runtime.graph.state import (
    AgentGraphRunInput,
    AgentRunState,
    AgentRuntime,
    GraphState,
    _DEFAULT_MAX_REFLECT,
    _DEFAULT_MAX_ROUNDS,
)
from app.services.design.runtime.agent_profile import resolve_tool_host
from app.services.design.runtime.pipeline_support import (
    _normalize_ref_images,
    _run_error_code,
    _user_facing_run_error,
)
from app.services.design.prompts.rules_text import _as_text
from app.services.design.prompts.skill_store import format_skills_catalog
from app.services.design.admin.task_store import (

    STATUS_CANCELLED,
    STATUS_ERROR,
    STATUS_PAUSED,
    STATUS_RUNNING,
    STATUS_SUCCESS,
    STATUS_WAITING_CLIENT,
    _update_task,
    build_run_lifecycle,
    claim_run_lease,
    design_worker_id,
    expire_stale_design_task,
    get_design_task,
    get_run_lifecycle,
    heartbeat_run_lease,
    list_stale_resumable_task_ids,
    merge_task_meta,
    new_resume_token,
    parse_task_meta,
    peek_run_intent,
    release_run_lease,
    set_run_intent,
    task_is_resumable,
)

_log = logging.getLogger(__name__)


@dataclass
class _GraphCompileCache:
    """Compiled LangGraph templates (not per-run state)."""

    templates: dict[str, Any] = field(default_factory=dict)
    lc_design: Any = None
    checkpoint_sweep_started: bool = False


@dataclass
class _RunControl:
    """In-process pause/cancel + wallet hold bindings for active tasks."""

    intent: dict[str, str] = field(default_factory=dict)
    tasks: dict[str, asyncio.Task[Any]] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)
    hold_fns: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    hold_lock: threading.Lock = field(default_factory=threading.Lock)


_CACHE = _GraphCompileCache()
_RUN = _RunControl()
_LC_DESIGN_GRAPH = None

_INTENT_PAUSE = "pause"
_INTENT_CANCEL = "cancel"

TEMPLATE_CANVAS_OPS_V1 = "canvas_ops_v1"

# Explicit ownership prevents node-like helper modules from being mistaken for
# LangGraph stages. Optional intelligence modules are invoked by design_agent,
# not independently registered into the topology.
_CANVAS_OPS_V1_NODE_MODULES = {
    "bootstrap": "bootstrap",
    "apply_confirm": "apply",
    "memory": "memory",
    "intent_classify": "intent",
    "design_agent": "decide",
    "animation_decide": "animation_decide",
    "animation_paint": "animation_paint",
    "paint_ops": "paint",
    "action": "apply",
    "observe": "observe",
    "review": "review",
    "propose": "apply",
    "__settle__": "settle",
}


def audit_canvas_ops_v1_topology() -> dict[str, list[str] | dict[str, str]]:
    """Static topology inventory for CI and maintenance tooling."""
    nodes_dir = Path(__file__).with_name("nodes")
    available = sorted(
        path.stem for path in nodes_dir.glob("*.py") if path.stem != "__init__"
    )
    registered = dict(_CANVAS_OPS_V1_NODE_MODULES)
    registered_modules = set(registered.values())
    return {
        "registered_nodes": registered,
        "registered_modules": sorted(registered_modules),
        "unregistered_modules": sorted(set(available) - registered_modules),
    }

# Logical stage ids used in AgentProfile.topology.stages_enabled (not node names).
_CANVAS_OPS_V1_SUPPORTED = frozenset(
    {
        "bootstrap",
        "apply_confirm",
        "memory",
        "intent",
        "decide",
        "paint",
        "action",
        "observe",
        "propose",
        "review",
        "settle",
    }
)
_CANVAS_OPS_V1_REQUIRED = frozenset(KERNEL_CANVAS_REQUIRED)


class _SceneInterruptPark(Exception):
    """Park run on non-scene interrupt; keep checkpoint without error settle."""
    pass


def _bind_design_hold_fns(task_id: str, settle: Any, refund: Any) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    with _RUN.hold_lock:
        _RUN.hold_fns[tid] = (settle, refund)


def _unbind_design_hold_fns(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    with _RUN.hold_lock:
        _RUN.hold_fns.pop(tid, None)


def _design_settle_hold_fn(rt: AgentRuntime) -> Any:
    """Return a settle callable that always yields a non-null int (DB NOT NULL contract)."""
    tid = str(rt.run.task_id or "").strip()
    with _RUN.hold_lock:
        pair = _RUN.hold_fns.get(tid)
    raw: Any = None
    if pair and callable(pair[0]):
        raw = pair[0]
    else:
        raw = getattr(rt, "settle_hold_fn", None)
    if not callable(raw):
        raise RuntimeError("design settle_hold_fn not bound")

    def _as_int_credits(*args: Any, **kwargs: Any) -> int:
        out = raw(*args, **kwargs)
        try:
            return int(out if out is not None else 0)
        except (TypeError, ValueError):
            return 0

    return _as_int_credits


def _design_refund_hold_fn(rt: AgentRuntime) -> Any:
    tid = str(rt.run.task_id or "").strip()
    with _RUN.hold_lock:
        pair = _RUN.hold_fns.get(tid)
    if pair and callable(pair[1]):
        return pair[1]
    fn = getattr(rt, "refund_hold_fn", None)
    if callable(fn):
        return fn
    raise RuntimeError("design refund_hold_fn not bound")


def _register_active_run(task_id: str, task: asyncio.Task[Any] | None = None) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    cur = task or asyncio.current_task()
    with _RUN.lock:
        if cur is not None:
            _RUN.tasks[tid] = cur
        _RUN.intent.pop(tid, None)


def _unregister_active_run(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    with _RUN.lock:
        _RUN.tasks.pop(tid, None)
        _RUN.intent.pop(tid, None)


def _get_run_intent(task_id: str) -> str | None:
    tid = str(task_id or "").strip()
    with _RUN.lock:
        local = _RUN.intent.get(tid)
    if local in (_INTENT_PAUSE, _INTENT_CANCEL):
        return local
    try:
        return peek_run_intent(tid)
    except Exception:
        return None


def _request_run_intent(task_id: str, intent: str) -> bool:
    """Set pause/cancel intent (memory + durable) and cancel in-flight task if local."""
    tid = str(task_id or "").strip()
    if not tid or intent not in (_INTENT_PAUSE, _INTENT_CANCEL):
        return False
    with _RUN.lock:
        _RUN.intent[tid] = intent
        running = _RUN.tasks.get(tid)
    try:
        set_run_intent(tid, intent)
    except Exception:
        _log.debug("durable run_intent write failed task=%s", tid, exc_info=True)
    if running is not None and not running.done():
        running.cancel()
        return True
    return False


def _try_claim_run_lease(task_id: str) -> dict[str, Any]:
    return claim_run_lease(task_id, owner_id=design_worker_id())


def _heartbeat_run_lease_safe(task_id: str) -> None:
    try:
        heartbeat_run_lease(task_id, owner_id=design_worker_id())
    except Exception:
        _log.debug("run lease heartbeat failed task=%s", task_id, exc_info=True)


def _release_run_lease_safe(task_id: str) -> None:
    try:
        release_run_lease(task_id, owner_id=design_worker_id())
    except Exception:
        _log.debug("run lease release failed task=%s", task_id, exc_info=True)


def _interrupt_payloads(raw: Any) -> list[Any]:
    """Normalize ``__interrupt__`` tuple / list / Interrupt → value list."""
    out: list[Any] = []
    if raw is None:
        return out
    items = raw if isinstance(raw, (list, tuple)) else (raw,)
    for it in items:
        if it is None:
            continue
        val = getattr(it, "value", it)
        out.append(val)
    return out


def _scene_interrupt_from_state(state: Any) -> dict[str, Any] | None:
    """Return pending scene_feedback interrupt value, if any."""
    if state is None:
        return None
    for task in getattr(state, "tasks", None) or ():
        for val in _interrupt_payloads(getattr(task, "interrupts", None)):
            if isinstance(val, dict) and val.get("kind") == "scene_feedback":
                return dict(val)
    for val in _interrupt_payloads(getattr(state, "interrupts", None)):
        if isinstance(val, dict) and val.get("kind") == "scene_feedback":
            return dict(val)
    return None


async def _resolve_scene_resume_value(task_id: str, *, timeout_sec: float) -> Any:
    """Wait for FE scene (or timeout / pause marker) to resume an observe interrupt."""
    from app.services.design.runtime.scene_feedback import wait_for_scene

    snap = await wait_for_scene(task_id, timeout_sec=timeout_sec)
    intent = _get_run_intent(task_id)
    if intent == _INTENT_CANCEL:
        return {"cancelled": True}
    if intent == _INTENT_PAUSE:
        return {"paused": True}
    if snap is None:
        return {"timeout": True}
    return snap


def request_design_pause(task_id: str) -> dict[str, Any]:
    """Ask a running design graph to pause at the next cancel boundary (keep checkpoint)."""
    tid = str(task_id or "").strip()
    row = get_design_task(tid)
    if not row:
        return {"ok": False, "error": "not_found"}
    status = str(row.get("status") or "")
    if status == STATUS_PAUSED:
        return {"ok": True, "status": STATUS_PAUSED, "already": True}
    if status == STATUS_WAITING_CLIENT:
        # Already stopped at client wait — treat as resumable pause.
        merge_task_meta(
            tid,
            {
                "run_lifecycle": build_run_lifecycle(
                    thread_id=_design_thread_id(tid),
                    resumable=True,
                    interrupt_kind="waiting_client",
                    resume_token=get_run_lifecycle(parse_task_meta(row.get("meta_json"))).get(
                        "resume_token"
                    )
                    or new_resume_token(),
                )
            },
        )
        _update_task(tid, status=STATUS_PAUSED, error_message="paused")
        return {"ok": True, "status": STATUS_PAUSED}
    if status != STATUS_RUNNING:
        return {"ok": False, "error": "not_running", "status": status}
    cancelled = _request_run_intent(tid, _INTENT_PAUSE)
    return {"ok": True, "status": STATUS_RUNNING, "cancel_signaled": cancelled}


def request_design_cancel(task_id: str, *, refund_hold_fn: Any | None = None) -> dict[str, Any]:
    """Abandon a run: refund hold, mark cancelled (checkpoint cleaned by caller/async)."""
    tid = str(task_id or "").strip()
    row = get_design_task(tid)
    if not row:
        return {"ok": False, "error": "not_found"}
    status = str(row.get("status") or "")
    if status in (STATUS_SUCCESS, STATUS_CANCELLED):
        return {"ok": True, "status": status, "already": True}

    cancelled = _request_run_intent(tid, _INTENT_CANCEL)
    hold = int(row.get("hold_credits") or 0)
    charged = int(row.get("charged_credits") or 0)
    user_id = str(row.get("user_id") or "")
    if refund_hold_fn and hold > 0 and charged <= 0 and user_id:
        try:
            refund_hold_fn(user_id, hold, task_id=tid)
        except Exception:
            _log.exception("cancel refund failed task=%s", tid)

    thread_id = _design_thread_id(tid)
    merge_task_meta(
        tid,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=thread_id,
                resumable=False,
                interrupt_kind="cancelled",
                settled=charged > 0,
            )
        },
    )
    _update_task(tid, status=STATUS_CANCELLED, error_message="cancelled")
    _unbind_design_hold_fns(tid)
    return {
        "ok": True,
        "status": STATUS_CANCELLED,
        "cancel_signaled": cancelled,
        "thread_id": thread_id,
        "cleanup_checkpoint": True,
    }


async def cleanup_design_checkpoint(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    await _cleanup_design_thread(_lc_design_graph(), _design_thread_id(tid))


def get_design_run_status(task_id: str) -> dict[str, Any] | None:
    row = get_design_task(task_id)
    if not row:
        return None
    meta = parse_task_meta(row.get("meta_json"))
    lc = get_run_lifecycle(meta)
    status = str(row.get("status") or "")
    resumable = task_is_resumable(row)
    return {
        "task_id": row["id"],
        "user_id": row.get("user_id"),
        "status": status,
        "resumable": resumable,
        "hold_credits": int(row.get("hold_credits") or 0),
        "charged_credits": int(row.get("charged_credits") or 0),
        "error_message": row.get("error_message"),
        "thread_id": lc.get("thread_id") or _design_thread_id(str(row["id"])),
        "interrupt_kind": lc.get("interrupt_kind"),
        "checkpoint_at": lc.get("checkpoint_at"),
        "resume_token": lc.get("resume_token") if resumable else None,
        "updated_at": row.get("updated_at"),
        "lease_owner": (meta.get("run_lease") or {}).get("owner_id")
        if isinstance(meta.get("run_lease"), dict)
        else None,
        "run_intent": meta.get("run_intent"),
    }


def mark_design_waiting_client(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    merge_task_meta(
        tid,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=_design_thread_id(tid),
                resumable=True,
                interrupt_kind="waiting_client",
            )
        },
    )
    _update_task(tid, status=STATUS_WAITING_CLIENT, error_message=None)


def mark_design_running(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    _update_task(tid, status=STATUS_RUNNING, error_message=None)


def _resume_token_for(task_id: str) -> str | None:
    row = get_design_task(task_id)
    lc = get_run_lifecycle(parse_task_meta((row or {}).get("meta_json")))
    tok = lc.get("resume_token")
    return str(tok) if tok else None


def _persist_lifecycle(
    task_id: str,
    *,
    status: str,
    resumable: bool,
    interrupt_kind: str | None,
    error_message: str | None = None,
    settled: bool = False,
) -> None:
    token = new_resume_token() if resumable else None
    merge_task_meta(
        task_id,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=_design_thread_id(task_id),
                resumable=resumable,
                interrupt_kind=interrupt_kind,
                resume_token=token,
                settled=settled,
            )
        },
    )
    fields: dict[str, Any] = {"status": status}
    if error_message is not None:
        fields["error_message"] = error_message
    _update_task(task_id, **fields)


def invalidate_agent_graph_cache(flow_id: str | None = None) -> None:
    del flow_id
    global _LC_DESIGN_GRAPH
    _CACHE.templates.clear()
    _CACHE.lc_design = None
    _LC_DESIGN_GRAPH = None


def _design_thread_id(task_id: str) -> str:
    return f"design:{str(task_id or '').strip()}"


def _design_graph_retry_policy() -> RetryPolicy:
    from app.core.config import settings

    attempts = max(1, int(getattr(settings, "design_graph_retry_attempts", 3) or 3))
    return RetryPolicy(
        max_attempts=attempts,
        initial_interval=0.5,
        backoff_factor=2.0,
        max_interval=8.0,
    )


def _design_graph_node_timeout() -> TimeoutPolicy | None:
    from app.core.config import settings

    sec = float(getattr(settings, "design_graph_node_timeout_sec", 180.0) or 0.0)
    if sec <= 0:
        return None
    return TimeoutPolicy(run_timeout=sec)


def _design_graph_paint_timeout() -> TimeoutPolicy | None:
    """paint_ops may run several in-node attempts; allow a longer wall clock."""
    from app.core.config import settings

    sec = float(getattr(settings, "design_graph_paint_timeout_sec", 0.0) or 0.0)
    if sec <= 0:
        sec = float(getattr(settings, "design_graph_node_timeout_sec", 180.0) or 0.0)
    if sec <= 0:
        return None
    return TimeoutPolicy(run_timeout=sec)


def _get_design_graph_checkpointer() -> Any:
    """Shared durable checkpointer (MySQL 8+ → memory).

    Wallet settle/refund stay on ``_bind_design_hold_fns``, not in graph state.
    When ``design_graph_require_durable_checkpoint`` is set, memory backend is refused
    so pause/resume cannot silently lose checkpoints.
    """
    from app.core.config import settings
    from app.services.llm.agent import checkpointer_backend, get_agent_checkpointer

    cp = get_agent_checkpointer()
    backend = checkpointer_backend()
    _log.debug("design graph checkpointer backend=%s", backend)
    require_durable = bool(
        getattr(settings, "design_graph_require_durable_checkpoint", True)
    )
    if require_durable and backend == "memory":
        raise RuntimeError(
            "design graph requires a durable checkpointer (mysql); "
            "got memory. Configure DATABASE_URL / MySQL checkpointer, or set "
            "DESIGN_GRAPH_REQUIRE_DURABLE_CHECKPOINT=false for ephemeral tests."
        )
    return cp


async def sweep_stale_design_checkpoints(*, limit: int = 50) -> dict[str, Any]:
    """Delete checkpoints and expire DB rows for orphaned resumable runs past TTL."""
    from app.core.config import settings

    ttl = float(getattr(settings, "design_run_checkpoint_ttl_hours", 0) or 0)
    if ttl <= 0:
        return {"swept": 0, "candidates": 0, "skipped": True}
    ids = await asyncio.to_thread(
        list_stale_resumable_task_ids,
        ttl_hours=ttl,
        limit=limit,
    )
    swept = 0
    for tid in ids:
        try:
            await cleanup_design_checkpoint(tid)
            ok = await asyncio.to_thread(
                expire_stale_design_task,
                tid,
                reason="checkpoint_ttl_expired",
            )
            if ok:
                swept += 1
        except Exception:
            _log.exception("checkpoint TTL sweep failed task_id=%s", tid)
    return {"swept": swept, "candidates": len(ids), "skipped": False}


def start_design_checkpoint_ttl_scheduler() -> None:
    """Background thread: expire orphaned paused/waiting checkpoints."""
    if _CACHE.checkpoint_sweep_started:
        return
    from app.core.config import settings

    ttl = float(getattr(settings, "design_run_checkpoint_ttl_hours", 0) or 0)
    if ttl <= 0:
        return
    interval_h = float(
        getattr(settings, "design_run_checkpoint_sweep_interval_hours", 6.0) or 6.0
    )
    if interval_h <= 0:
        return
    interval_s = max(300.0, interval_h * 3600.0)

    def _loop() -> None:
        time.sleep(min(90.0, interval_s / 12))
        while True:
            try:
                result = asyncio.run(sweep_stale_design_checkpoints(limit=80))
                if not result.get("skipped") and int(result.get("swept") or 0) > 0:
                    _log.info("design checkpoint TTL sweep: %s", result)
            except Exception:
                _log.exception("design checkpoint TTL sweep failed")
            time.sleep(interval_s)

    threading.Thread(
        target=_loop, name="design-checkpoint-ttl", daemon=True
    ).start()
    _CACHE.checkpoint_sweep_started = True
    _log.info(
        "design checkpoint TTL scheduler started ttl_h=%.2f interval_h=%.2f",
        ttl,
        interval_h,
    )


async def _cleanup_design_thread(graph: Any, thread_id: str) -> None:
    tid = str(thread_id or "").strip()
    if not tid:
        return
    cp = getattr(graph, "checkpointer", None)
    if cp is None:
        return
    try:
        await cp.adelete_thread(tid)
    except Exception:
        _log.debug("design graph thread cleanup failed tid=%s", tid, exc_info=True)


def _build_lc_design_graph():
    """canvas_ops_v1 — … → paint → action → observe → [review] → settle.

    Review is optional (Profile ``review_mode`` / settings); may loop paint on must_fix.
    Design quality check (P41 lanes) runs at the end of Review, not a separate hop.
    """
    from app.core.config import settings

    g = StateGraph(GraphState)
    dest = (
        "bootstrap",
        "apply_confirm",
        "memory",
        "intent_classify",
        "design_agent",
        "animation_decide",
        "animation_paint",
        "paint_ops",
        "action",
        "observe",
        "review",
        "propose",
        "__settle__",
        END,
    )
    retry = _design_graph_retry_policy()
    node_timeout = _design_graph_node_timeout()
    paint_timeout = _design_graph_paint_timeout()
    # paint_ops already retries empty/invalid ops in-node — do NOT also retry the
    # whole node on timeout (that alone made "add a rect" take ~7 minutes).
    io_kw: dict[str, Any] = {"destinations": dest, "retry_policy": retry}
    if node_timeout is not None:
        io_kw["timeout"] = node_timeout
    paint_kw: dict[str, Any] = {
        "destinations": dest,
        "retry_policy": RetryPolicy(
            max_attempts=1,
            initial_interval=0.5,
            backoff_factor=2.0,
            max_interval=8.0,
        ),
    }
    if paint_timeout is not None:
        paint_kw["timeout"] = paint_timeout
    # observe / review: no whole-node graph retry (LLM has in-node fail-open).
    once_kw: dict[str, Any] = {
        "destinations": dest,
        "retry_policy": RetryPolicy(
            max_attempts=1,
            initial_interval=0.5,
            backoff_factor=2.0,
            max_interval=8.0,
        ),
    }
    if node_timeout is not None:
        once_kw["timeout"] = node_timeout
    g.add_node("bootstrap", _node_bootstrap, destinations=dest)
    g.add_node("apply_confirm", _node_apply_confirm, destinations=dest)
    g.add_node("memory", _node_memory, **io_kw)
    g.add_node("intent_classify", _node_intent_classify, **io_kw)
    g.add_node("design_agent", _node_design_agent, **io_kw)
    g.add_node("animation_decide", _node_animation_decide, **io_kw)
    g.add_node("animation_paint", _node_animation_paint, **paint_kw)
    g.add_node("paint_ops", _node_paint_ops, **paint_kw)
    # action: hydrate can hang on image providers — apply same once timeout as review.
    g.add_node("action", _node_action, **once_kw)
    g.add_node("observe", _node_observe, **once_kw)
    g.add_node("review", _node_review_agent, **once_kw)
    g.add_node("propose", _node_propose, destinations=dest)
    g.add_node("__settle__", _node_settle, destinations=(END,))
    g.add_edge(START, "bootstrap")
    if bool(getattr(settings, "design_graph_checkpoint", True)):
        return g.compile(checkpointer=_get_design_graph_checkpointer())
    return g.compile()


def build_canvas_ops_v1_graph():
    """Topology template builder for ``canvas_ops_v1``."""
    return _build_lc_design_graph()


def _topology_registry() -> dict[str, dict[str, Any]]:
    """Live template registry — Admin flow JSON is not listed here."""
    return {
        TEMPLATE_CANVAS_OPS_V1: {
            "builder": build_canvas_ops_v1_graph,
            "supported_stages": _CANVAS_OPS_V1_SUPPORTED,
            "required_stages": _CANVAS_OPS_V1_REQUIRED,
        },
    }


def list_topology_templates() -> list[str]:
    return sorted(_topology_registry().keys())


def validate_profile_topology(profile: Any) -> None:
    """Fail-fast if Profile template/stages are unknown or incomplete."""
    tid = str(getattr(profile, "topology_template", "") or "").strip()
    meta = _topology_registry().get(tid)
    if meta is None:
        known = ", ".join(list_topology_templates()) or "(none)"
        raise ValueError(
            f"unknown topology template {tid!r} for profile "
            f"{getattr(profile, 'id', '?')!r}; known: {known}"
        )
    supported: frozenset[str] = meta["supported_stages"]
    required: frozenset[str] = meta["required_stages"]
    enabled = {
        str(x).strip().lower()
        for x in (getattr(profile, "stages_enabled", ()) or ())
        if str(x).strip()
    }
    unknown = sorted(enabled - supported)
    if unknown:
        raise ValueError(
            f"profile {getattr(profile, 'id', '?')!r} stages_enabled not in "
            f"template {tid!r}: {unknown}"
        )
    missing = sorted(required - enabled)
    if missing:
        raise ValueError(
            f"profile {getattr(profile, 'id', '?')!r} missing required stages "
            f"for {tid!r}: {missing}"
        )


def resolve_topology_graph(profile: Any | None = None) -> Any:
    """Compile (cached) LangGraph for the active / given AgentProfile template."""
    global _LC_DESIGN_GRAPH
    from app.services.design.runtime.agent_profile import (
        get_active_agent_profile,
        validate_profile_surface,
    )

    prof = profile or get_active_agent_profile()
    validate_profile_topology(prof)
    validate_profile_surface(prof)
    tid = str(prof.topology_template).strip()
    cached = _CACHE.templates.get(tid)
    if cached is not None:
        return cached
    builder = _topology_registry()[tid]["builder"]
    graph = builder()
    _CACHE.templates[tid] = graph
    if tid == TEMPLATE_CANVAS_OPS_V1:
        _CACHE.lc_design = graph
        _LC_DESIGN_GRAPH = graph
    return graph


def _lc_design_graph():
    """Resolve live graph from active AgentProfile.topology.template."""
    return resolve_topology_graph()


def _bind_topology_run_meta(rt: AgentRuntime) -> str:
    """Stamp runtime with live topology template id; return template id."""
    from app.services.design.runtime.agent_profile import get_active_agent_profile

    tid = str(
        get_active_agent_profile().topology_template or TEMPLATE_CANVAS_OPS_V1
    ).strip()
    rt.decision.route = f"langgraph:{tid}"
    rt.flow_id = tid
    rt.flow_version = 1
    rt.run.flow_id = tid
    rt.run.flow_version = 1
    return tid


def _bind_pending_ask_proposal(
    rt: AgentRuntime,
    *,
    proposal_id: str | None,
    proposal_task_id: str | None,
    apply_list: list[dict[str, Any]],
) -> None:
    """Load Ask held ops for typed confirm (intent proposal_action). Chip path skips this."""
    if apply_list:
        return
    pid = _as_text(proposal_id).strip()
    tid = _as_text(proposal_task_id).strip()
    if not pid or not tid:
        return
    from app.services.design.admin.task_store import resolve_ask_proposal_ops
    from app.services.design.ops.tool_ops_contract import tool_ops_batch_detail

    ops = resolve_ask_proposal_ops(tid, pid)
    if not ops:
        return
    rt.flags["pending_proposal"] = {
        "id": pid,
        "task_id": tid,
        "ops": ops,
        "detail": (tool_ops_batch_detail(ops) or "")[:400],
    }


def _review_loop_max_from_profile() -> int | None:
    try:
        from app.services.design.runtime.agent_profile import get_active_agent_profile

        for frm, when, to, mx in get_active_agent_profile().topology_loops or ():
            if (
                str(frm).lower() == "review"
                and str(when).lower() == "must_fix"
                and str(to).lower() in ("paint", "paint_ops")
            ):
                return max(1, int(mx))
    except Exception:
        return None
    return None


def _normalize_design_intensity(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if s in ("light", "medium", "high", "extreme"):
        return s
    return "medium"


def _review_mode_for_intensity(intensity: str) -> str:
    if intensity == "light":
        return "off"
    if intensity in ("high", "extreme"):
        return "always"
    return "auto"


async def run_agent_graph(inp: AgentGraphRunInput) -> AsyncIterator[dict[str, Any]]:
    """Internal graph runner (public entry: ``design_stream``)."""
    user_id = inp.user_id
    mode = inp.mode
    prompt = inp.prompt
    rules = inp.rules
    user_selected_model = inp.user_selected_model
    canvas_id = inp.canvas_id
    canvas_size = inp.canvas_size
    scene = inp.scene
    scene_nodes = inp.scene_nodes
    scene_frames = inp.scene_frames
    spatial_summary = inp.spatial_summary
    focus_frame_id = inp.focus_frame_id
    images = inp.images
    memory_in = inp.memory_in
    session_id = inp.session_id
    project_id = inp.project_id
    hold = inp.hold
    free_daily = inp.free_daily
    t0 = inp.t0
    settle_hold_fn = inp.settle_hold_fn
    refund_hold_fn = inp.refund_hold_fn
    apply_ops = inp.apply_ops
    proposal_id = inp.proposal_id
    proposal_task_id = inp.proposal_task_id
    interaction_mode = inp.interaction_mode
    skill_refs = inp.skill_refs
    locale_in = inp.locale
    intensity_in = getattr(inp, "design_intensity", None)

    task_id = str(inp.task_id or uuid.uuid4())
    trace_id = str(uuid.uuid4())
    try:
        from app.services.llm.usage_log import bind_usage_context

        bind_usage_context(user_id=user_id, task_id=task_id, source="design")
    except Exception:
        pass

    ui_mode = _as_text(interaction_mode or "agent").strip().lower()
    if ui_mode not in ("agent", "ask"):
        ui_mode = "agent"

    sid = _as_text(session_id).strip()
    pid = _as_text(project_id).strip() or "__none__"
    max_rounds = _int_rule(rules, "agent.react.max_rounds", _DEFAULT_MAX_ROUNDS) or _DEFAULT_MAX_ROUNDS
    max_reflect = _int_rule(rules, "agent.react.max_reflect", _DEFAULT_MAX_REFLECT)
    review_loop_max = _review_loop_max_from_profile()

    scene_key, _ = resolve_agent_scene(scene, prompt, canvas_size, rules=rules)
    scene_key = scene_key or _scene_key(scene) or ""
    nodes = [n for n in (scene_nodes or []) if isinstance(n, dict) and n.get("id")][:120]
    frames = [f for f in (scene_frames or []) if isinstance(f, dict) and f.get("id")][:32]
    focus_id = _as_text(focus_frame_id).strip()
    w, h = _resolve_wh(
        canvas_size=canvas_size,
        scene_key=scene_key,
        rules=rules,
        scene_frames=frames,
        focus_id=focus_id,
    )
    ref_images = _normalize_ref_images(images, rules=rules)
    apply_list = [o for o in (apply_ops or []) if isinstance(o, dict)]

    run = AgentRunState(
        trace_id=trace_id,
        task_id=task_id,
        goal=prompt,
        reflect_left=max_reflect,
        t0=float(t0 or 0.0) or time.perf_counter(),
    )
    decision = DesignRunDecision(
        trace_id=trace_id,
        session_id=sid or None,
        focus_frame_id=focus_id or None,
        probe_len=len(prompt),
        has_ref_images=bool(ref_images),
        has_scene_nodes=bool(nodes),
        route="agent_graph",
        task_id=task_id,
        scene=scene_key or None,
    )

    tools_host = resolve_tool_host()
    # Defer path only needs the short catalog — skip building full tool bodies.
    defer_tools = _flag_on(rules, "agent.react.defer_tools", "1")
    tools_catalog = tools_host.format_catalog(rules)
    tools_block = "" if defer_tools else tools_host.format_full(rules)
    scene_for_cat = scene_key or ""
    from app.services.design.runtime.agent_profile import get_active_agent_profile
    from app.services.design.runtime.host.prompts import resolve_output_locale
    from app.services.design.runtime.subagent import format_subagents_catalog

    skill_namespaces = tuple(get_active_agent_profile().skills_namespaces or ())
    # Decide: skills catalog only — fonts belong on Paint; skip parallel font fetch.
    skills_catalog = await asyncio.to_thread(
        format_skills_catalog,
        scene=scene_for_cat,
        user_id=user_id,
        namespaces=skill_namespaces or None,
    )
    persona = _resolve_agent_persona(rules, user_selected_model)
    size_auto_hint = _prompt_text(rules, "agent.prompt.size_auto")
    subagents_catalog = format_subagents_catalog(get_active_agent_profile())
    # Decide-stage packs + catalogs (full tool/skill bodies arrive via need_*).
    decide_catalogs = [
        tools_catalog if defer_tools else tools_block,
        skills_catalog,
    ]
    if str(subagents_catalog or "").strip():
        decide_catalogs.append(subagents_catalog)
    out_locale = resolve_output_locale(
        profile_locale=get_active_agent_profile().locale,
        prompt=prompt,
    )
    system = assemble_stage_system(
        rules,
        stage="decide",
        ask_mode=(ui_mode == "ask"),
        persona=persona,
        catalog_blocks=decide_catalogs,
        locale=out_locale,
    )


    rt = AgentRuntime(
        user_id=user_id,
        mode=mode,
        prompt=prompt,
        rules=rules,
        user_selected_model=user_selected_model,
        canvas_id=canvas_id,
        canvas_size=canvas_size,
        scene_key=scene_key,
        scene_nodes=nodes,
        scene_frames=frames,
        focus_id=focus_id,
        images=ref_images,
        memory_in=memory_in,
        session_id=sid,
        project_id=pid,
        hold=hold,
        free_daily=free_daily,
        t0=t0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=apply_list,
        w=w,
        h=h,
        run=run,
        decision=decision,
        system=system,
        size_auto_hint=size_auto_hint,
        persona=persona,
        defer_tools=defer_tools,
        max_rounds=max_rounds,
        spatial_summary=spatial_summary if isinstance(spatial_summary, dict) else None,
    )
    rt.flags["mode"] = ui_mode
    rt.flags["output_locale"] = out_locale
    intensity = _normalize_design_intensity(intensity_in)
    rt.flags["design_intensity"] = intensity
    # User depth overrides profile/settings review sparsity.
    rt.flags["review_mode"] = _review_mode_for_intensity(intensity)
    base_review_left = int(
        review_loop_max if review_loop_max is not None else max_reflect or 1
    )
    if intensity == "extreme":
        base_review_left = max(base_review_left, 3)
    elif intensity == "high":
        base_review_left = max(base_review_left, 2)
    rt.flags["review_left"] = base_review_left
    _bind_pending_ask_proposal(
        rt,
        proposal_id=proposal_id,
        proposal_task_id=proposal_task_id,
        apply_list=apply_list,
    )
    pinned_refs = [
        str(x).strip() for x in (skill_refs or []) if str(x).strip()
    ][:8]
    if pinned_refs:
        rt.flags["skill_refs"] = pinned_refs
    lease = _try_claim_run_lease(task_id)
    if not lease.get("ok"):
        yield {
            "type": "error",
            "message": str(lease.get("error") or "lease_held"),
            "task_id": task_id,
            "owner_id": lease.get("owner_id"),
        }
        return
    _bind_design_hold_fns(task_id, settle_hold_fn, refund_hold_fn)
    _register_active_run(task_id)

    graph = await asyncio.to_thread(_lc_design_graph)
    topo_id = _bind_topology_run_meta(rt)
    thread_id = _design_thread_id(task_id)
    merge_task_meta(
        task_id,
        {
            "flow_id": topo_id,
            "flow_version": 1,
            "run_lifecycle": build_run_lifecycle(
                thread_id=thread_id,
                resumable=True,
                interrupt_kind=None,
            ),
        },
    )

    async for ev in _drive_design_graph(
        graph=graph,
        graph_input={"rt": rt, "tick": 0},
        task_id=task_id,
        trace_id=trace_id,
        user_id=user_id,
        thread_id=thread_id,
        hold=hold,
        rules=rules,
        locale=out_locale,
        run=run,
        decision=decision,
        refund_hold_fn=refund_hold_fn,
        scene_key=scene_key or "",
        ui_mode=ui_mode,
        run_name=f"{topo_id}:{task_id[:8]}",
    ):
        yield ev


async def resume_agent_graph(
    *,
    task_id: str,
    user_id: str,
    settle_hold_fn: Any,
    refund_hold_fn: Any,
    resume_token: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Continue a paused / waiting_client / resumable-error design run from checkpoint."""
    tid = str(task_id or "").strip()
    row = get_design_task(tid)
    if not row:
        yield {"type": "error", "message": "task_not_found", "task_id": tid}
        return
    if str(row.get("user_id") or "") != str(user_id or ""):
        yield {"type": "error", "message": "forbidden", "task_id": tid}
        return
    if not task_is_resumable(row):
        yield {
            "type": "error",
            "message": "not_resumable",
            "task_id": tid,
            "status": row.get("status"),
        }
        return

    meta = parse_task_meta(row.get("meta_json"))
    lc = get_run_lifecycle(meta)
    expected = str(lc.get("resume_token") or "")
    if not resume_token or not expected or expected != str(resume_token).strip():
        yield {"type": "error", "message": "resume_token_mismatch", "task_id": tid}
        return

    lease = _try_claim_run_lease(tid)
    if not lease.get("ok"):
        yield {
            "type": "error",
            "message": str(lease.get("error") or "lease_held"),
            "task_id": tid,
            "owner_id": lease.get("owner_id"),
            "expires_at": lease.get("expires_at"),
        }
        return

    thread_id = str(lc.get("thread_id") or _design_thread_id(tid))
    graph = await asyncio.to_thread(_lc_design_graph)
    config = {"configurable": {"thread_id": thread_id}}
    try:
        snap = await graph.aget_state(config)
    except Exception as err:  # noqa: BLE001
        # Stale MySQL checkpointer conn → rebuild once and retry.
        from app.services.llm.agent import (
            is_mysql_connection_error,
            reset_agent_checkpointer,
        )

        if is_mysql_connection_error(err):
            _log.warning(
                "resume aget_state MySQL conn dead; reset checkpointer task_id=%s",
                tid,
            )
            reset_agent_checkpointer()
            invalidate_agent_graph_cache()
            try:
                graph = await asyncio.to_thread(_lc_design_graph)
                snap = await graph.aget_state(config)
            except Exception as err2:  # noqa: BLE001
                yield {
                    "type": "error",
                    "message": "checkpoint_unavailable",
                    "detail": str(err2)[:200],
                    "task_id": tid,
                }
                return
        else:
            yield {
                "type": "error",
                "message": "checkpoint_unavailable",
                "detail": str(err)[:200],
                "task_id": tid,
            }
            return
    values = getattr(snap, "values", None) or {}
    if not values:
        yield {"type": "error", "message": "checkpoint_empty", "task_id": tid}
        return

    rt = values.get("rt")
    if not isinstance(rt, AgentRuntime):
        yield {"type": "error", "message": "checkpoint_corrupt", "task_id": tid}
        return

    run = rt.run
    decision = rt.decision
    trace_id = str(run.trace_id or "")
    hold = int(rt.hold or row.get("hold_credits") or 0)
    rules = rt.rules if isinstance(rt.rules, dict) else {}

    try:
        from app.services.llm.usage_log import bind_usage_context

        bind_usage_context(user_id=user_id, task_id=tid, source="design")
    except Exception:
        pass

    _bind_design_hold_fns(tid, settle_hold_fn, refund_hold_fn)
    _register_active_run(tid)
    mark_design_running(tid)

    # If checkpoint is parked on observe interrupt, resume with FE scene (or timeout).
    pending_scene = _scene_interrupt_from_state(snap)
    graph_input: Any = None
    if pending_scene is not None:
        from app.services.design.runtime.graph.state import _SCENE_WAIT_SEC
        from app.services.design.runtime.scene_feedback import wait_for_scene

        # Use durable scene if posted; else short wait for mid-post FE.
        posted = await wait_for_scene(tid, timeout_sec=min(2.0, float(_SCENE_WAIT_SEC)))
        if posted is not None:
            graph_input = Command(resume=posted)
        else:
            graph_input = Command(resume={"timeout": True})

    merge_task_meta(
        tid,
        {
            "run_lifecycle": build_run_lifecycle(
                thread_id=thread_id,
                resumable=True,
                interrupt_kind=None,
                resume_token=new_resume_token(),
            )
        },
    )
    yield {
        "type": "status",
        "task_id": tid,
        "trace_id": trace_id,
        "resumed": True,
        "status": STATUS_RUNNING,
        **({"scene_interrupt": True} if pending_scene is not None else {}),
    }

    async for ev in _drive_design_graph(
        graph=graph,
        graph_input=graph_input,
        task_id=tid,
        trace_id=trace_id,
        user_id=user_id,
        thread_id=thread_id,
        hold=hold,
        rules=rules,
        locale=str((rt.flags or {}).get("output_locale") or "") or None,
        run=run,
        decision=decision,
        refund_hold_fn=refund_hold_fn,
        scene_key=str(rt.scene_key or ""),
        ui_mode=str((rt.flags or {}).get("mode") or rt.mode or "agent"),
        run_name=f"lc_design_resume:{tid[:8]}",
    ):
        yield ev


async def _drive_design_graph(
    *,
    graph: Any,
    graph_input: Any,
    task_id: str,
    trace_id: str,
    user_id: str,
    thread_id: str,
    hold: int,
    rules: dict[str, str],
    locale: str | None = None,
    run: AgentRunState,
    decision: DesignRunDecision,
    refund_hold_fn: Any,
    scene_key: str,
    ui_mode: str,
    run_name: str,
) -> AsyncIterator[dict[str, Any]]:
    """Shared start/resume driver: stream, pause/cancel, timeout, cleanup."""
    from app.core.config import settings as _settings
    from app.services.llm.agent import langfuse_callback_handler, merge_tracing_config

    run_timeout = float(getattr(_settings, "design_graph_run_timeout_sec", 600.0) or 0.0)
    timeout_resumable = bool(getattr(_settings, "design_run_timeout_resumable", True))
    keep_checkpoint = False
    lf_handler = None
    try:
        lf_handler = langfuse_callback_handler()
        graph_cfg = merge_tracing_config(
            {"configurable": {"thread_id": thread_id}},
            run_name=run_name,
            metadata={
                "task_id": task_id,
                "trace_id": trace_id,
                "user_id": user_id,
                "scene": scene_key or "",
                "mode": ui_mode,
                "langgraph_thread_id": thread_id,
            },
            tags=["design", "lc_design"],
            callbacks=[lf_handler] if lf_handler is not None else None,
        )

        async def _emit_stream() -> AsyncIterator[dict[str, Any]]:
            """Drive graph; bridge scene_feedback interrupts in-process (same SSE)."""
            from app.services.design.runtime.graph.state import _SCENE_WAIT_SEC

            inp: Any = graph_input
            last_hb = 0.0
            while True:
                saw_interrupt: Any = None
                async for item in graph.astream(
                    inp,
                    config=graph_cfg,
                    stream_mode=["custom", "updates"],
                ):
                    now = time.time()
                    if now - last_hb >= 20.0:
                        await asyncio.to_thread(_heartbeat_run_lease_safe, task_id)
                        last_hb = now
                    intent = _get_run_intent(task_id)
                    if intent in (_INTENT_PAUSE, _INTENT_CANCEL):
                        raise asyncio.CancelledError()

                    mode = "custom"
                    data: Any = item
                    if isinstance(item, tuple) and len(item) == 2:
                        mode, data = item[0], item[1]

                    if mode == "updates" and isinstance(data, dict):
                        if "__interrupt__" in data:
                            saw_interrupt = data.get("__interrupt__")
                        continue

                    if mode == "custom" and isinstance(data, dict) and data.get("type"):
                        yield data

                if saw_interrupt is None:
                    try:
                        st_now = await graph.aget_state(graph_cfg)
                        scene_iv = _scene_interrupt_from_state(st_now)
                        if scene_iv is not None:
                            saw_interrupt = (scene_iv,)
                    except Exception:
                        pass

                if saw_interrupt is None:
                    break

                payloads = _interrupt_payloads(saw_interrupt)
                scene_iv = next(
                    (
                        p
                        for p in payloads
                        if isinstance(p, dict) and p.get("kind") == "scene_feedback"
                    ),
                    None,
                )
                if scene_iv is None:
                    # Unknown interrupt — park for external resume.
                    await asyncio.to_thread(
                        _persist_lifecycle,
                        task_id,
                        status=STATUS_WAITING_CLIENT,
                        resumable=True,
                        interrupt_kind="interrupt",
                    )
                    yield {
                        "type": "paused",
                        "task_id": task_id,
                        "trace_id": trace_id,
                        "resumable": True,
                        "interrupt_kind": "interrupt",
                        "resume_token": _resume_token_for(task_id),
                    }
                    raise _SceneInterruptPark()

                timeout_sec = float(_SCENE_WAIT_SEC)
                raw_ms = scene_iv.get("timeout_ms")
                if raw_ms is not None:
                    try:
                        timeout_sec = max(0.5, float(raw_ms) / 1000.0)
                    except Exception:
                        pass

                resume_val = await _resolve_scene_resume_value(
                    task_id, timeout_sec=timeout_sec
                )
                if isinstance(resume_val, dict) and (
                    resume_val.get("paused") or resume_val.get("cancelled")
                ):
                    raise asyncio.CancelledError()

                inp = Command(resume=resume_val)

        try:
            if run_timeout > 0:
                async with asyncio.timeout(run_timeout):
                    async for chunk in _emit_stream():
                        yield chunk
            else:
                async for chunk in _emit_stream():
                    yield chunk
            if lf_handler is not None:
                lf_tid = getattr(lf_handler, "last_trace_id", None)
                if lf_tid:
                    try:
                        run.langfuse_trace_id = str(lf_tid)
                    except Exception:
                        pass
                    try:
                        from langfuse import get_client

                        get_client().flush()
                    except Exception:
                        pass
            keep_checkpoint = False
        except _SceneInterruptPark:
            keep_checkpoint = True
            return
    except TimeoutError:
        err = TimeoutError(f"design graph run timed out after {run_timeout:.0f}s")
        run.note_error(str(err)[:240])
        run.push_log(phase="error", error=str(err)[:240])
        decision.apply(route="error", intent=run.intent)
        await asyncio.to_thread(_persist_task_meta, task_id, decision=decision, state=run)
        if timeout_resumable:
            keep_checkpoint = True
            await asyncio.to_thread(
                _persist_lifecycle,
                task_id,
                status=STATUS_PAUSED,
                resumable=True,
                interrupt_kind="timeout",
                error_message=str(err)[:800],
            )
            yield {"type": "execution_log", **run.to_execution_log()}
            yield {
                "type": "paused",
                "message": _user_facing_run_error(err, rules=rules, locale=locale),
                "task_id": task_id,
                "trace_id": trace_id,
                "resumable": True,
                "interrupt_kind": "timeout",
                "resume_token": _resume_token_for(task_id),
            }
        else:
            try:
                await asyncio.to_thread(refund_hold_fn, user_id, hold, task_id=task_id)
            except Exception:
                pass
            await asyncio.to_thread(
                _persist_lifecycle,
                task_id,
                status=STATUS_ERROR,
                resumable=False,
                interrupt_kind="timeout",
                error_message=str(err)[:800],
            )
            yield {"type": "execution_log", **run.to_execution_log()}
            yield {
                "type": "error",
                "code": _run_error_code(err),
                "message": _user_facing_run_error(err, rules=rules, locale=locale),
                "task_id": task_id,
                "trace_id": trace_id,
                "refunded_credits": hold,
            }
    except asyncio.CancelledError:
        intent = _get_run_intent(task_id) or _INTENT_PAUSE
        if intent == _INTENT_CANCEL:
            keep_checkpoint = False
            run.note_error("cancelled")
            run.push_log(phase="error", error="cancelled")
            try:
                await asyncio.to_thread(refund_hold_fn, user_id, hold, task_id=task_id)
            except Exception:
                pass
            await asyncio.to_thread(
                _persist_lifecycle,
                task_id,
                status=STATUS_CANCELLED,
                resumable=False,
                interrupt_kind="cancelled",
                error_message="cancelled",
            )
            yield {
                "type": "cancelled",
                "task_id": task_id,
                "trace_id": trace_id,
                "refunded_credits": hold,
            }
            raise
        # Default / explicit pause: keep durable checkpoint for resume.
        keep_checkpoint = True
        run.note_error("paused")
        run.push_log(phase="error", error="paused")
        await asyncio.to_thread(
            _persist_lifecycle,
            task_id,
            status=STATUS_PAUSED,
            resumable=True,
            interrupt_kind="paused",
            error_message="paused",
        )
        yield {
            "type": "paused",
            "task_id": task_id,
            "trace_id": trace_id,
            "resumable": True,
            "interrupt_kind": "paused",
            "resume_token": _resume_token_for(task_id),
        }
        raise
    except Exception as err:  # noqa: BLE001
        run.fatal = str(err) if hasattr(run, "fatal") else None
        try:
            # Keep checkpoint on error when ``design_run_error_resumable``.
            from app.core.config import settings as _s

            keep_on_error = bool(getattr(_s, "design_run_error_resumable", True))
        except Exception:
            keep_on_error = True
        if keep_on_error:
            keep_checkpoint = True
            run.note_error(str(err)[:240])
            run.push_log(phase="error", error=str(err)[:240])
            decision.apply(route="error", intent=run.intent)
            await asyncio.to_thread(_persist_task_meta, task_id, decision=decision, state=run)
            await asyncio.to_thread(
                _persist_lifecycle,
                task_id,
                status=STATUS_ERROR,
                resumable=True,
                interrupt_kind="error",
                error_message=str(err)[:800],
            )
            yield {"type": "execution_log", **run.to_execution_log()}
            yield {
                "type": "paused",
                "message": _user_facing_run_error(err, rules=rules, locale=locale),
                "task_id": task_id,
                "trace_id": trace_id,
                "resumable": True,
                "interrupt_kind": "error",
                "resume_token": _resume_token_for(task_id),
            }
        else:
            keep_checkpoint = False
            try:
                await asyncio.to_thread(refund_hold_fn, user_id, hold, task_id=task_id)
            except Exception:
                pass
            run.note_error(str(err)[:240])
            run.push_log(phase="error", error=str(err)[:240])
            decision.apply(route="error", intent=run.intent)
            await asyncio.to_thread(_persist_task_meta, task_id, decision=decision, state=run)
            await asyncio.to_thread(
                _persist_lifecycle,
                task_id,
                status=STATUS_ERROR,
                resumable=False,
                interrupt_kind="error",
                error_message=str(err)[:800],
            )
            yield {"type": "execution_log", **run.to_execution_log()}
            yield {
                "type": "error",
                "code": _run_error_code(err),
                "message": _user_facing_run_error(err, rules=rules, locale=locale),
                "task_id": task_id,
                "trace_id": trace_id,
                "refunded_credits": hold,
            }
    finally:
        if not keep_checkpoint:
            await _cleanup_design_thread(graph, thread_id)
        _unbind_design_hold_fns(task_id)
        _unregister_active_run(task_id)
        _release_run_lease_safe(task_id)
        try:
            set_run_intent(task_id, None)
        except Exception:
            pass

