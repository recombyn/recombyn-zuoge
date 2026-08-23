"""Lightweight subgoals queue (P2) — todo / doing / done in task_state.design.subgoals."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

logger = logging.getLogger(__name__)

_STATUSES = frozenset({"todo", "doing", "done", "skipped"})


def _rule_on(rules: dict[str, str] | None, key: str, default: str) -> bool:
    raw = default
    if isinstance(rules, dict) and rules.get(key) is not None:
        raw = str(rules.get(key) or default)
    return raw.strip().lower() in ("1", "true", "yes", "on")


def max_subgoals(rules: dict[str, str] | None) -> int:
    try:
        raw = "6"
        if isinstance(rules, dict) and rules.get("memory.subgoals.max") is not None:
            raw = str(rules.get("memory.subgoals.max") or "6")
        return max(1, min(8, int(raw.strip() or "6")))
    except ValueError:
        return 6


def enabled(rules: dict[str, str] | None) -> bool:
    return _rule_on(rules, "memory.subgoals.enabled", "1")


def normalize_item(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        return {
            "id": f"sg_{uuid.uuid4().hex[:8]}",
            "text": text[:200],
            "status": "todo",
        }
    if not isinstance(raw, dict):
        return None
    text = str(raw.get("text") or "").strip()
    if not text:
        return None
    status = str(raw.get("status") or "todo").strip().lower()
    if status not in _STATUSES:
        status = "todo"
    sid = str(raw.get("id") or "").strip() or f"sg_{uuid.uuid4().hex[:8]}"
    return {"id": sid[:32], "text": text[:200], "status": status}


def normalize_queue(raw: Any, *, rules: dict[str, str] | None = None) -> list[dict[str, Any]]:
    limit = max_subgoals(rules)
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        norm = normalize_item(item)
        if not norm:
            continue
        if norm["id"] in seen:
            norm["id"] = f"sg_{uuid.uuid4().hex[:8]}"
        seen.add(norm["id"])
        out.append(norm)
        if len(out) >= limit:
            break
    return ensure_one_doing(out)


def ensure_one_doing(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """At most one doing; if none and todos remain, promote first todo."""
    items = [dict(x) for x in queue]
    doing_idxs = [i for i, x in enumerate(items) if x.get("status") == "doing"]
    if len(doing_idxs) > 1:
        for i in doing_idxs[1:]:
            items[i]["status"] = "todo"
        doing_idxs = doing_idxs[:1]
    if not doing_idxs:
        for item in items:
            if item.get("status") == "todo":
                item["status"] = "doing"
                break
    return items


def seed_from_texts(
    texts: list[str],
    *,
    rules: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    cleaned = [str(t).strip() for t in texts if str(t).strip()]
    if not cleaned:
        return []
    limit = max_subgoals(rules)
    items: list[dict[str, Any]] = []
    for i, text in enumerate(cleaned[:limit]):
        items.append(
            {
                "id": f"sg_{i + 1}_{uuid.uuid4().hex[:6]}",
                "text": text[:200],
                "status": "doing" if i == 0 else "todo",
            }
        )
    return items


def seed_from_goal(goal: str, *, rules: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Single-item queue from user prompt when model did not emit subgoals."""
    g = (goal or "").strip()
    if not g:
        return []
    # Skip tiny prompts (structural). Greeting vs task is the intent LLM's job.
    if len(g) < 4:
        return []
    return seed_from_texts([g[:160]], rules=rules)


def parse_subgoals_payload(raw: Any) -> list[str]:
    """Extract string list from model JSON subgoals field."""
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[\n;；|]+", raw)
        return [p.strip() for p in parts if p.strip()][:8]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:200])
        elif isinstance(item, dict):
            t = str(item.get("text") or "").strip()
            if t:
                out.append(t[:200])
        if len(out) >= 8:
            break
    return out


def get_queue_from_medium(medium: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(medium, dict):
        return []
    design = medium.get("design") if isinstance(medium.get("design"), dict) else {}
    return normalize_queue(design.get("subgoals"))


def active_focus(queue: list[dict[str, Any]]) -> dict[str, Any] | None:
    for item in queue:
        if item.get("status") == "doing":
            return item
    for item in queue:
        if item.get("status") == "todo":
            return item
    return None


def pending_count(queue: list[dict[str, Any]]) -> int:
    return sum(1 for x in queue if x.get("status") in ("todo", "doing"))


def advance_after_ops(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    After canvas ops land: mark current doing done, promote next todo → doing.
    """
    items = ensure_one_doing([dict(x) for x in queue])
    advanced = False
    for item in items:
        if item.get("status") == "doing":
            item["status"] = "done"
            advanced = True
            break
    if not advanced:
        return items
    return ensure_one_doing(items)


def format_queue_block(queue: list[dict[str, Any]]) -> str:
    if not queue:
        return ""
    lines = [
        "[Subgoals queue]",
        "Focus on status=doing first; then todo. Do not reopen done unless USER asks.",
    ]
    for i, item in enumerate(queue, start=1):
        st = item.get("status") or "todo"
        lines.append(f"{i}. [{st}] {item.get('text') or ''}")
    focus = active_focus(queue)
    if focus:
        lines.append(f"CURRENT_FOCUS: {focus.get('text')}")
    return "\n".join(lines)


def texts_for_sse(queue: list[dict[str, Any]]) -> list[str]:
    """FE expects string goals; prefix status for clarity."""
    out: list[str] = []
    for item in queue:
        st = item.get("status") or "todo"
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        out.append(f"[{st}] {text}")
    return out[:8]


def design_patch_with_queue(queue: list[dict[str, Any]]) -> dict[str, Any]:
    return {"subgoals": normalize_queue(queue)}
