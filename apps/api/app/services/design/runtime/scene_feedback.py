"""FE→BE scene snapshots between agent rounds (cross-worker safe).

SSE is one-way; the frontend POSTs the real canvas inventory after applying
tool_ops so the next LLM round sees truth, not a simulated apply.

Transport (same API):
1. Process-local Event — fast path when wait + publish share a worker
2. Redis key ``design:scene_wait:{task_id}`` when Redis is up
3. ``design_task.meta_json.scene_wait`` — durable fallback for any worker
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

_log = logging.getLogger(__name__)

_lock = asyncio.Lock()
# task_id -> { event, nodes, frames, round, updated_at, ... }
_pending: dict[str, dict[str, Any]] = {}
_TTL_SEC = 600.0
_REDIS_PREFIX = "design:scene_wait:"


def _poll_interval_sec() -> float:
    try:
        from app.core.config import settings

        ms = float(getattr(settings, "design_scene_wait_poll_ms", 150.0) or 150.0)
    except Exception:
        ms = 150.0
    return max(0.05, ms / 1000.0)


def _clean_op_results(op_results: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in op_results or []:
        if not isinstance(r, dict):
            continue
        def node_ids(key: str) -> list[str]:
            raw = r.get(key)
            if not isinstance(raw, list):
                return []
            return list(dict.fromkeys(str(value).strip() for value in raw if str(value).strip()))[:32]

        operation = str(r.get("operation") or "").strip().lower()
        out.append(
            {
                "op_id": str(r.get("op_id") or "")[:160],
                "name": str(r.get("name") or "")[:120],
                "ok": bool(r.get("ok", True)),
                "error": str(r.get("error") or "")[:200],
                **({"operation": operation} if operation in {"create", "update", "delete", "other"} else {}),
                "expected_node_ids": node_ids("expected_node_ids"),
                "actual_node_ids": node_ids("actual_node_ids"),
            }
        )
    return out[:64]


def _sanitize_preview_image(raw: Any) -> str | None:
    s = str(raw or "").strip()
    if not s:
        return None
    # Cap ~1.5MB text so Redis/DB stay healthy.
    if len(s) > 1_500_000:
        return None
    if s.startswith("data:image/") or s.startswith("https://") or s.startswith("http://"):
        return s
    return None


def _pack_payload(
    *,
    nodes: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    spatial: dict[str, Any] | None,
    op_results: list[dict[str, Any]],
    round_n: int,
    preview_image: str | None = None,
    transaction_id: str | None = None,
    transaction_status: str | None = None,
    base_revision: int | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "nodes": nodes,
        "frames": frames,
        "spatial": spatial,
        "op_results": op_results,
        "round": int(round_n or 0),
    }
    prev = _sanitize_preview_image(preview_image)
    if prev:
        out["preview_image"] = prev
    tid = str(transaction_id or "").strip()
    if tid:
        out["transaction_id"] = tid
    status = str(transaction_status or "").strip().lower()
    if status in ("ack", "rollback", "commit"):
        out["transaction_status"] = status
    if base_revision is not None:
        try:
            out["base_revision"] = int(base_revision)
        except (TypeError, ValueError):
            pass
    return out


def _unpack_payload(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    nodes = raw.get("nodes")
    frames = raw.get("frames")
    spatial = raw.get("spatial")
    op_results = raw.get("op_results")
    out_nodes = (
        [n for n in nodes if isinstance(n, dict) and n.get("id")]
        if isinstance(nodes, list)
        else []
    )
    out_frames = (
        [f for f in frames if isinstance(f, dict) and f.get("id")]
        if isinstance(frames, list)
        else []
    )
    preview = _sanitize_preview_image(raw.get("preview_image"))
    tid = str(raw.get("transaction_id") or "").strip()
    status = str(raw.get("transaction_status") or "").strip().lower()
    has_tx = bool(tid) or status in ("ack", "rollback", "commit")
    if not (
        out_nodes
        or out_frames
        or isinstance(spatial, dict)
        or op_results
        or preview
        or has_tx
    ):
        if raw.get("ready") is False:
            return None
    out: dict[str, Any] = {
        "nodes": out_nodes,
        "frames": out_frames,
        "spatial": spatial if isinstance(spatial, dict) else None,
        "op_results": op_results if isinstance(op_results, list) else [],
    }
    try:
        rnd = int(raw.get("round") or 0)
        if rnd:
            out["round"] = rnd
    except (TypeError, ValueError):
        pass
    if preview:
        out["preview_image"] = preview
    if tid:
        out["transaction_id"] = tid
    if status in ("ack", "rollback", "commit"):
        out["transaction_status"] = status
    if raw.get("base_revision") is not None:
        try:
            out["base_revision"] = int(raw.get("base_revision"))
        except (TypeError, ValueError):
            pass
    return out


def _redis_client() -> Any | None:
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


def _redis_key(task_id: str) -> str:
    return f"{_REDIS_PREFIX}{task_id}"


def _durable_write(task_id: str, slot: dict[str, Any]) -> None:
    """Write wait/ready slot to Redis (preferred) and DB meta fallback."""
    tid = str(task_id or "").strip()
    if not tid:
        return
    body = dict(slot)
    body["updated_at"] = time.time()
    r = _redis_client()
    if r is not None:
        try:
            r.set(
                _redis_key(tid),
                json.dumps(body, ensure_ascii=False, default=str),
                ex=int(_TTL_SEC),
            )
        except Exception:
            _log.debug("scene_wait redis write failed task=%s", tid, exc_info=True)
    try:
        from app.services.design.admin.task_store import merge_task_meta

        # Keep DB payload lighter: drop bulky preview_image (Redis keeps full).
        payload = body.get("payload") if body.get("ready") else None
        if isinstance(payload, dict):
            payload = {k: v for k, v in payload.items() if k != "preview_image"}
        db_slot = {
            "waiting": bool(body.get("waiting")),
            "ready": bool(body.get("ready")),
            "round": int(body.get("round") or 0),
            "updated_at": body.get("updated_at"),
            "payload": payload,
            "has_preview": bool(
                isinstance(body.get("payload"), dict)
                and body["payload"].get("preview_image")
            ),
        }
        merge_task_meta(tid, {"scene_wait": db_slot})
    except Exception:
        _log.debug("scene_wait db write failed task=%s", tid, exc_info=True)


def _durable_read(task_id: str) -> dict[str, Any] | None:
    tid = str(task_id or "").strip()
    if not tid:
        return None
    r = _redis_client()
    if r is not None:
        try:
            raw = r.get(_redis_key(tid))
            if raw:
                got = json.loads(raw)
                if isinstance(got, dict):
                    return got
        except Exception:
            _log.debug("scene_wait redis read failed task=%s", tid, exc_info=True)
    try:
        from app.services.design.admin.task_store import get_design_task, parse_task_meta

        row = get_design_task(tid)
        sw = parse_task_meta((row or {}).get("meta_json")).get("scene_wait")
        if isinstance(sw, dict):
            return dict(sw)
    except Exception:
        _log.debug("scene_wait db read failed task=%s", tid, exc_info=True)
    return None


def _unpack_slot_payload(slot: dict[str, Any]) -> dict[str, Any] | None:
    if not slot or not slot.get("ready"):
        return None
    payload = slot.get("payload")
    if not isinstance(payload, dict):
        # Older shape: nodes at top level
        payload = {
            "nodes": slot.get("nodes"),
            "frames": slot.get("frames"),
            "spatial": slot.get("spatial"),
            "op_results": slot.get("op_results"),
            "round": slot.get("round"),
        }
    return _unpack_payload(payload)


def _clear_scene_wait_meta(tid: str, *, round_n: int = 0) -> None:
    try:
        from app.services.design.admin.task_store import merge_task_meta

        merge_task_meta(
            tid,
            {
                "scene_wait": {
                    "waiting": False,
                    "ready": False,
                    "round": int(round_n or 0),
                    "payload": None,
                    "updated_at": time.time(),
                }
            },
        )
    except Exception:
        pass


def _redis_raw_as_str(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, (bytes, bytearray)):
        return val.decode("utf-8")
    return str(val)


def _redis_take_ready(task_id: str) -> dict[str, Any] | None:
    """Atomically take a ready Redis latch (GETDEL when available)."""
    tid = str(task_id or "").strip()
    if not tid:
        return None
    r = _redis_client()
    if r is None:
        return None
    key = _redis_key(tid)
    raw: str | None = None
    try:
        # Redis 6.2+: GETDEL is a true atomic take.
        raw = _redis_raw_as_str(r.execute_command("GETDEL", key))
    except Exception:
        try:
            val = r.get(key)
            if val is None:
                return None
            r.delete(key)
            raw = _redis_raw_as_str(val)
        except Exception:
            _log.debug("scene_wait redis take failed task=%s", tid, exc_info=True)
            return None
    if not raw:
        return None
    try:
        slot = json.loads(raw)
    except Exception:
        return None
    if not isinstance(slot, dict):
        return None
    out = _unpack_slot_payload(slot)
    if out is not None:
        return out
    # Not ready (e.g. waiting latch) — put it back so waiters keep polling.
    try:
        r.set(key, raw, ex=int(_TTL_SEC))
    except Exception:
        _log.debug("scene_wait redis restore failed task=%s", tid, exc_info=True)
    return None


def _durable_take(task_id: str) -> dict[str, Any] | None:
    """Consume a ready durable payload (Redis GETDEL first, then DB)."""
    tid = str(task_id or "").strip()
    if not tid:
        return None
    taken = _redis_take_ready(tid)
    if taken is not None:
        _clear_scene_wait_meta(tid, round_n=int(taken.get("round") or 0))
        return taken

    slot = _durable_read(tid)
    out = _unpack_slot_payload(slot) if isinstance(slot, dict) else None
    if out is None:
        return None
    # Drop Redis key if a concurrent writer left one (best-effort).
    r = _redis_client()
    if r is not None:
        try:
            r.delete(_redis_key(tid))
        except Exception:
            pass
    _clear_scene_wait_meta(
        tid, round_n=int((slot or {}).get("round") or out.get("round") or 0)
    )
    return out


def _memory_take(slot: dict[str, Any]) -> dict[str, Any] | None:
    nodes = slot.get("nodes")
    frames = slot.get("frames")
    spatial = slot.get("spatial")
    op_results = slot.get("op_results")
    preview = _sanitize_preview_image(slot.get("preview_image"))
    ev = slot.get("event")
    if isinstance(ev, asyncio.Event):
        ev.clear()
    slot["nodes"] = None
    slot["frames"] = None
    slot["spatial"] = None
    slot["op_results"] = None
    slot["preview_image"] = None
    out_nodes: list[dict[str, Any]] = []
    out_frames: list[dict[str, Any]] = []
    if isinstance(nodes, list):
        out_nodes = [n for n in nodes if isinstance(n, dict) and n.get("id")]
    if isinstance(frames, list):
        out_frames = [f for f in frames if isinstance(f, dict) and f.get("id")]
    if out_nodes or out_frames or isinstance(spatial, dict) or (
        isinstance(op_results, list) and op_results
    ) or preview:
        out: dict[str, Any] = {
            "nodes": out_nodes,
            "frames": out_frames,
            "spatial": spatial if isinstance(spatial, dict) else None,
            "op_results": op_results if isinstance(op_results, list) else [],
        }
        if preview:
            out["preview_image"] = preview
        return out
    # Explicit empty post (ready latch via event only).
    if slot.get("_posted"):
        slot["_posted"] = False
        out = {
            "nodes": [],
            "frames": [],
            "spatial": spatial if isinstance(spatial, dict) else None,
            "op_results": op_results if isinstance(op_results, list) else [],
        }
        if preview:
            out["preview_image"] = preview
        return out
    return None


async def begin_wait(task_id: str, *, round_n: int) -> None:
    """Reset latch so the next POST satisfies this round."""
    tid = str(task_id or "").strip()
    if not tid:
        return
    async with _lock:
        _pending[tid] = {
            "event": asyncio.Event(),
            "nodes": None,
            "frames": None,
            "spatial": None,
            "op_results": None,
            "preview_image": None,
            "round": int(round_n),
            "updated_at": time.time(),
            "_posted": False,
        }
    await asyncio.to_thread(
        _durable_write,
        tid,
        {
            "waiting": True,
            "ready": False,
            "round": int(round_n),
            "payload": None,
        },
    )


async def publish_scene(
    task_id: str,
    nodes: list[dict[str, Any]] | None,
    *,
    frames: list[dict[str, Any]] | None = None,
    spatial: dict[str, Any] | None = None,
    op_results: list[dict[str, Any]] | None = None,
    preview_image: str | None = None,
    round_n: int | None = None,
    transaction_id: str | None = None,
    transaction_status: str | None = None,
    base_revision: int | None = None,
) -> bool:
    tid = str(task_id or "").strip()
    if not tid:
        return False
    clean = [n for n in (nodes or []) if isinstance(n, dict) and n.get("id")]
    clean_frames = [f for f in (frames or []) if isinstance(f, dict) and f.get("id")]
    spatial_clean = spatial if isinstance(spatial, dict) else None
    results_clean = _clean_op_results(op_results)
    preview_clean = _sanitize_preview_image(preview_image)
    rn = int(round_n or 0)
    async with _lock:
        slot = _pending.get(tid)
        # Drop stale FE posts that belong to a previous wait (late after timeout).
        if (
            slot is not None
            and round_n is not None
            and slot.get("_posted") is not True
            and int(slot.get("round") or 0) > 0
            and rn > 0
            and rn != int(slot.get("round") or 0)
        ):
            _log.warning(
                "scene_feedback stale round ignored task=%s got=%s expected=%s",
                tid,
                rn,
                slot.get("round"),
            )
            return False
        if slot is None:
            slot = {
                "event": asyncio.Event(),
                "nodes": clean,
                "frames": clean_frames,
                "spatial": spatial_clean,
                "op_results": results_clean,
                "preview_image": preview_clean,
                "round": rn,
                "updated_at": time.time(),
                "_posted": True,
            }
            _pending[tid] = slot
        else:
            slot["nodes"] = clean
            slot["frames"] = clean_frames
            slot["spatial"] = spatial_clean
            slot["op_results"] = results_clean
            slot["preview_image"] = preview_clean
            if round_n is not None:
                slot["round"] = int(round_n)
                rn = int(round_n)
            else:
                rn = int(slot.get("round") or 0)
            slot["updated_at"] = time.time()
            slot["_posted"] = True
        slot["event"].set()
    payload = _pack_payload(
        nodes=clean,
        frames=clean_frames,
        spatial=spatial_clean,
        op_results=results_clean,
        round_n=rn,
        preview_image=preview_clean,
        transaction_id=transaction_id,
        transaction_status=transaction_status,
        base_revision=base_revision,
    )
    await asyncio.to_thread(
        _durable_write,
        tid,
        {
            "waiting": True,
            "ready": True,
            "round": rn,
            "payload": payload,
        },
    )
    return True


async def wait_for_scene(
    task_id: str,
    *,
    timeout_sec: float = 8.0,
) -> dict[str, Any] | None:
    """Block until FE posts a snapshot, or timeout → None (caller keeps simulated)."""
    tid = str(task_id or "").strip()
    if not tid:
        return None
    deadline = time.time() + max(0.5, float(timeout_sec))
    poll = _poll_interval_sec()

    async with _lock:
        slot = _pending.get(tid)
        if slot is None:
            # Remote wait: another worker may have begun; still poll durable.
            pass
        elif slot.get("event") and slot["event"].is_set() and (
            isinstance(slot.get("nodes"), list) or slot.get("_posted")
        ):
            got = _memory_take(slot)
            if got is not None:
                await asyncio.to_thread(_durable_take, tid)
                return got
        ev: asyncio.Event | None = slot["event"] if slot else None

    while time.time() < deadline:
        # Abort if another worker recorded pause/cancel.
        try:
            from app.services.design.admin.task_store import (
                heartbeat_run_lease,
                peek_run_intent,
            )

            intent = await asyncio.to_thread(peek_run_intent, tid)
            if intent in ("pause", "cancel"):
                return None
            # Keep run lease alive while blocked on FE (cross-worker resume safety).
            await asyncio.to_thread(heartbeat_run_lease, tid)
        except Exception:
            pass

        durable = await asyncio.to_thread(_durable_take, tid)
        if durable is not None:
            return durable

        async with _lock:
            slot = _pending.get(tid)
            if slot is not None:
                ev = slot.get("event")
                if isinstance(ev, asyncio.Event) and ev.is_set():
                    got = _memory_take(slot)
                    if got is not None:
                        return got

        remaining = deadline - time.time()
        if remaining <= 0:
            break
        if ev is not None:
            try:
                await asyncio.wait_for(ev.wait(), timeout=min(poll, remaining))
            except asyncio.TimeoutError:
                pass
        else:
            await asyncio.sleep(min(poll, remaining))

    # Final durable check (FE posted just as we timed out).
    return await asyncio.to_thread(_durable_take, tid)


async def clear_task(task_id: str) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    async with _lock:
        _pending.pop(tid, None)
        now = time.time()
        dead = [
            k
            for k, v in _pending.items()
            if now - float(v.get("updated_at") or 0) > _TTL_SEC
        ]
        for k in dead:
            _pending.pop(k, None)
    r = _redis_client()
    if r is not None:
        try:
            r.delete(_redis_key(tid))
        except Exception:
            pass
    try:
        from app.services.design.admin.task_store import merge_task_meta

        merge_task_meta(
            tid,
            {
                "scene_wait": {
                    "waiting": False,
                    "ready": False,
                    "payload": None,
                    "updated_at": time.time(),
                }
            },
        )
    except Exception:
        pass
