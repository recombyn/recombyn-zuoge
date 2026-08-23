"""Hardcoded design-run stages (every runtime phase).

Emits `explored` parent + nested `item` lines for:
prepare → scene → prompt → model → lookup → validate → ops →
scene_check → critic → refine → done

Labels / event map: apps/api/seeds/progress_stages.json
"""

from __future__ import annotations

import json
from typing import Any


def _load_progress_stages() -> tuple[dict[str, str], dict[str, str]]:
    from app.core.config import resolve_seed_file

    path = resolve_seed_file("progress_stages.json")
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}, {}
    if not isinstance(parsed, dict):
        return {}, {}
    items_raw = parsed.get("stageItems") or {}
    events_raw = parsed.get("eventStage") or {}
    items = (
        {str(k): str(v) for k, v in items_raw.items()}
        if isinstance(items_raw, dict)
        else {}
    )
    events = (
        {str(k): str(v) for k, v in events_raw.items()}
        if isinstance(events_raw, dict)
        else {}
    )
    return items, events


STAGE_ITEMS, _EVENT_STAGE = _load_progress_stages()

_STAGE_ORDER = list(STAGE_ITEMS.keys())
EXPLORE_ID = "explore-pipeline"


def stage_index(key: str) -> int:
    try:
        return _STAGE_ORDER.index(key)
    except ValueError:
        return -1


def stage_for_event(ev: dict[str, Any]) -> str | None:
    et = str(ev.get("type") or "")
    if et == "status":
        st = str(ev.get("status") or "").strip().lower()
        # routing / chat divert — not design pipeline stages
        if st in ("routing", "chat"):
            return None
        return "scene"
    if et in ("critique_start", "critique_done"):
        return "critic"
    if et == "skill_start" and str(ev.get("skill_key") or "") == "review":
        return "critic"
    if et == "activity":
        aid = str(ev.get("id") or "")
        kind = str(ev.get("kind") or "")
        detail = str(ev.get("detail") or "").lower()
        stage = str(ev.get("stage") or "").strip()
        if stage in STAGE_ITEMS:
            return stage
        if aid.startswith("lookup") or "lookup" in detail:
            return "lookup"
        if aid.startswith("critic") or "goal_critic" in detail or "critic" in detail:
            return "critic"
        if aid.startswith("validate") or "validate" in detail:
            return "validate"
        if aid.startswith("scene") or "scene_check" in detail:
            return "scene_check"
        if kind in ("tool", "added", "updated", "deleted"):
            return "ops"
        if kind == "explored" and aid == EXPLORE_ID:
            return None
        return None
    return _EVENT_STAGE.get(et)


def maybe_advance_stage(current: str | None, incoming: str | None) -> str | None:
    if not incoming:
        return current
    if not current:
        return incoming
    if stage_index(incoming) >= stage_index(current):
        return incoming
    return current


def _item_label(
    stage: str,
    *,
    elapsed_s: int | None = None,
    extra: str | None = None,
) -> str:
    base = STAGE_ITEMS.get(stage) or STAGE_ITEMS.get("prepare") or stage
    if extra:
        base = f"{base}（{extra}）"
    if elapsed_s is None or stage in ("ops", "done"):
        return base
    return f"{base}… {max(0, int(elapsed_s))}s"


def explored_stage_event(
    stage: str,
    *,
    elapsed_s: int | None = None,
    status: str = "running",
    item_count: int | None = None,
    extra: str | None = None,
    item_id: str | None = None,
) -> dict[str, Any]:
    """
    Explored row: parent `explore-pipeline` + one nested item.

    FE upserts the parent and merges `item` into `items[]`.
    """
    failed = status == "error"
    done = status == "done"
    if failed:
        key = "failed"
        ui_status = "error"
    elif done:
        key = "done"
        ui_status = "done"
    else:
        key = stage
        ui_status = "running"
    label = _item_label(
        key,
        elapsed_s=None if (done or failed) else elapsed_s,
        extra=None if (done or failed) else extra,
    )
    count = item_count
    if count is None and not done and not failed:
        count = max(1, stage_index(stage) + 1)
    return {
        "type": "activity",
        "id": EXPLORE_ID,
        "kind": "explored",
        "status": ui_status,
        "count": count,
        # Machine stage key only — FE i18n builds the parent label.
        "code": "design_pipeline",
        "stage": key,
        "visibility": "user",
        "item": {
            "id": item_id or f"stage-{key}",
            "name": label,
        },
        "skill_name": "agent",
        "index": 0,
    }


def thought_stage_event(
    stage: str,
    *,
    elapsed_s: int | None = None,
    status: str = "running",
    extra: str | None = None,
) -> dict[str, Any]:
    return explored_stage_event(
        stage, elapsed_s=elapsed_s, status=status, extra=extra
    )
