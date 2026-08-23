"""Short-term memory from chat_messages or client-provided turns.

Optimal dialogue context = structured facts + rolling summary + recent verbatim
window (not a flat dump of all chat_messages).
"""

from __future__ import annotations

import re
from typing import Any

from app.services.db import init_schema
from app.services.agent_memory.schema import trim_short_turn

_HEX = re.compile(r"#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b")
_SIZE = re.compile(r"\b(\d{2,4})\s*[x×X]\s*(\d{2,4})\b")
_CONSTRAINT = re.compile(r"(不要|别用|禁止|别加|不要用|别放)[^。！？\n]{0,40}")
_GOAL_HINT = re.compile(r"(做成|帮我|我想要|请|需要|改成|做成一个|设计)[^。！？\n]{0,48}")
_DECISION_HINT = re.compile(r"(已|改成了|调整为|用了|设为)[^。！？\n]{0,48}")
_PREF_HINT = re.compile(r"(喜欢|偏好|风格|调性)[^。！？\n]{0,40}")

_FACT_KIND_ORDER = (
    "goal",
    "constraint",
    "decision",
    "preference",
    "color",
    "size",
    "style",
)


def _limits(rules: dict[str, str]) -> tuple[int, int]:
    try:
        max_turns = int(str(rules.get("memory.short.max_turns") or "10").strip())
    except ValueError:
        max_turns = 10
    try:
        max_chars = int(str(rules.get("memory.short.max_chars") or "6000").strip())
    except ValueError:
        max_chars = 6000
    return max(2, min(30, max_turns)), max(500, min(20000, max_chars))


def dialogue_limits(rules: dict[str, str] | None) -> dict[str, int]:
    """Budgets for layered dialogue context (optimal path)."""
    rules = rules or {}

    def _i(key: str, default: int, lo: int, hi: int) -> int:
        try:
            v = int(str(rules.get(key) or default).strip())
        except ValueError:
            v = default
        return max(lo, min(hi, v))

    return {
        "recent_turns": _i("memory.dialogue.recent_turns", 4, 1, 12),
        "recent_chars": _i("memory.dialogue.recent_chars", 1200, 200, 8000),
        "summary_chars": _i("memory.dialogue.summary_chars", 600, 80, 2000),
        "facts_max": _i("memory.dialogue.facts_max", 12, 4, 32),
        "per_turn_chars": _i("memory.dialogue.per_turn_chars", 400, 80, 2000),
    }


def assistant_facing_text(text: str, *, max_chars: int = 800) -> str:
    """Natural user-facing reply only — unwrap agent JSON when present."""
    t = (text or "").strip()
    if not t:
        return ""
    if "{" in t[:2] or '"intent"' in t[:200] or '"reply"' in t[:200]:
        try:
            from app.services.design.ops.validate import extract_json_object

            obj = extract_json_object(t) or {}
            reply = str(obj.get("reply") or "").strip()
            if reply:
                return reply[:max_chars]
        except Exception:
            pass
    return t[:max_chars]


def normalize_turn_for_dialogue(turn: dict[str, Any], *, per_turn_chars: int) -> dict[str, Any] | None:
    role = str(turn.get("role") or "").strip().lower()
    raw = str(turn.get("text") or "").strip()
    if not raw or role not in ("user", "assistant"):
        return None
    text = assistant_facing_text(raw, max_chars=per_turn_chars) if role == "assistant" else raw[:per_turn_chars]
    text = text.strip()
    if not text:
        return None
    if role == "assistant" and len(text) < 2:
        return None
    return {"role": role, "text": text}


def extract_facts_from_text(*, role: str, text: str) -> list[dict[str, str]]:
    """Runtime-side salience slots — no LLM on the hot path."""
    t = (text or "").strip()
    if not t:
        return []
    out: list[dict[str, str]] = []
    for hx in _HEX.findall(t)[:3]:
        out.append({"kind": "color", "text": hx})
    for a, b in _SIZE.findall(t)[:2]:
        out.append({"kind": "size", "text": f"{a}x{b}"})
    if role == "user":
        for m in _CONSTRAINT.finditer(t):
            clause = m.group(0).strip()
            if clause:
                out.append({"kind": "constraint", "text": clause[:80]})
        g = _GOAL_HINT.search(t)
        if g:
            out.append({"kind": "goal", "text": g.group(0).strip()[:80]})
        elif len(t) <= 80 and (out or len(t) >= 4):
            # Short user lines with extracted slots (or any short ask) → goal.
            # No content keyword lists — intent/style judgment is the LLM's job.
            out.append({"kind": "goal", "text": t[:80]})
        p = _PREF_HINT.search(t)
        if p:
            out.append({"kind": "preference", "text": p.group(0).strip()[:80]})
    else:
        d = _DECISION_HINT.search(t)
        if d:
            out.append({"kind": "decision", "text": d.group(0).strip()[:100]})
    return out


def merge_dialogue_facts(
    existing: list[Any] | None,
    incoming: list[dict[str, str]],
    *,
    max_n: int,
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(kind: str, text: str) -> None:
        k = (kind or "").strip().lower() or "note"
        tx = (text or "").strip()
        if not tx:
            return
        key = f"{k}|{tx.lower()}"
        if key in seen:
            return
        seen.add(key)
        merged.append({"kind": k, "text": tx[:120]})

    for raw in existing or []:
        if not isinstance(raw, dict):
            continue
        _add(str(raw.get("kind") or ""), str(raw.get("text") or ""))
    for raw in incoming or []:
        _add(str(raw.get("kind") or ""), str(raw.get("text") or ""))

    # Prefer later facts per kind when over cap: keep order but drop oldest.
    if len(merged) > max_n:
        merged = merged[-max_n:]
    return merged


def facts_to_summary(facts: list[dict[str, str]], *, max_chars: int) -> str:
    """Deterministic summary from structured slots (optimal over raw chat concat)."""
    buckets: dict[str, list[str]] = {k: [] for k in _FACT_KIND_ORDER}
    other: list[str] = []
    for f in facts:
        kind = str(f.get("kind") or "").strip().lower()
        text = str(f.get("text") or "").strip()
        if not text:
            continue
        if kind in buckets:
            if text not in buckets[kind]:
                buckets[kind].append(text)
        else:
            other.append(text)
    parts: list[str] = []
    labels = {
        "goal": "目标",
        "constraint": "约束",
        "decision": "已定",
        "preference": "偏好",
        "color": "色",
        "size": "尺寸",
        "style": "风格",
    }
    for kind in _FACT_KIND_ORDER:
        vals = buckets.get(kind) or []
        if not vals:
            continue
        lab = labels.get(kind, kind)
        parts.append(f"{lab}：{'、'.join(vals[:3])}")
    if other:
        parts.append("其它：" + "、".join(other[:2]))
    summary = "；".join(parts).strip()
    if len(summary) > max_chars:
        summary = summary[: max_chars - 1].rstrip() + "…"
    return summary


def empty_dialogue_state() -> dict[str, Any]:
    return {"summary": "", "facts": [], "updated_at": 0.0}


def normalize_dialogue_state(raw: Any) -> dict[str, Any]:
    base = empty_dialogue_state()
    if not isinstance(raw, dict):
        return base
    facts_in = raw.get("facts") if isinstance(raw.get("facts"), list) else []
    facts = merge_dialogue_facts([], [
        {"kind": str(f.get("kind") or ""), "text": str(f.get("text") or "")}
        for f in facts_in
        if isinstance(f, dict)
    ], max_n=32)
    summary = str(raw.get("summary") or "").strip()
    if not summary and facts:
        summary = facts_to_summary(facts, max_chars=600)
    try:
        updated = float(raw.get("updated_at") or 0)
    except (TypeError, ValueError):
        updated = 0.0
    return {"summary": summary[:2000], "facts": facts, "updated_at": updated}


def dedupe_current_prompt(turns: list[dict[str, Any]], current_prompt: str) -> list[dict[str, Any]]:
    """Drop trailing user turn identical to this round's USER_PROMPT."""
    q = (current_prompt or "").strip()
    if not q or not turns:
        return turns
    out = list(turns)
    last = out[-1]
    if last.get("role") == "user" and str(last.get("text") or "").strip() == q:
        out = out[:-1]
    return out


def split_recent_and_older(
    turns: list[dict[str, Any]],
    *,
    recent_turns: int,
    recent_chars: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep last N turns (char-budgeted) verbatim; rest are fold candidates."""
    if not turns:
        return [], []
    window = max(1, recent_turns)
    candidate = turns[-window:]
    recent = trim_turns_by_chars(candidate, max_chars=recent_chars)
    # Turns not kept in recent (including those dropped by char trim) → fold.
    recent_tail = recent
    n_kept = len(recent_tail)
    if n_kept <= 0:
        return [], list(turns)
    # Align to original order: older = everything before the kept recent window.
    older = turns[: len(turns) - n_kept] if n_kept < len(turns) else []
    # If trim dropped from inside the window, fold those dropped turns too.
    if n_kept < len(candidate):
        dropped = candidate[: len(candidate) - n_kept]
        older = older + dropped
    return recent_tail, older


def trim_turns_by_chars(
    turns: list[dict[str, Any]],
    *,
    max_chars: int,
) -> list[dict[str, Any]]:
    """Trim via LangChain ``trim_messages`` on ``BaseMessage`` list."""
    if not turns or max_chars <= 0:
        return []
    try:
        from langchain_core.messages import (
            AIMessage,
            BaseMessage,
            HumanMessage,
            trim_messages,
        )

        lc_msgs: list[BaseMessage] = []
        for t in turns:
            role = str(t.get("role") or "")
            text = str(t.get("text") or "")
            if role == "user":
                lc_msgs.append(HumanMessage(content=text))
            elif role == "assistant":
                lc_msgs.append(AIMessage(content=text))

        def _chars(messages: list[BaseMessage]) -> int:
            total = 0
            for m in messages:
                c = getattr(m, "content", "") or ""
                total += len(c) if isinstance(c, str) else len(str(c))
            return total

        trimmed = trim_messages(
            lc_msgs,
            max_tokens=max_chars,
            token_counter=_chars,
            strategy="last",
            allow_partial=True,
        )
        out: list[dict[str, Any]] = []
        for m in trimmed:
            role = "user" if m.type == "human" else "assistant"
            content = m.content if isinstance(m.content, str) else str(m.content or "")
            out.append({"role": role, "text": content})
        return out or list(turns[-1:])
    except Exception:
        recent = list(turns)
        while (
            recent
            and sum(len(str(t.get("text") or "")) for t in recent) > max_chars
            and len(recent) > 1
        ):
            recent = recent[1:]
        return recent


def fold_turns_into_dialogue(
    dialogue: dict[str, Any] | None,
    older_turns: list[dict[str, Any]],
    *,
    max_facts: int,
    summary_chars: int,
) -> dict[str, Any]:
    """Merge older verbatim turns into persistent facts + summary."""
    state = normalize_dialogue_state(dialogue)
    if not older_turns:
        if not state["summary"] and state["facts"]:
            state["summary"] = facts_to_summary(state["facts"], max_chars=summary_chars)
        return state
    incoming: list[dict[str, str]] = []
    for t in older_turns:
        role = str(t.get("role") or "")
        text = str(t.get("text") or "")
        incoming.extend(extract_facts_from_text(role=role, text=text))
    state["facts"] = merge_dialogue_facts(state["facts"], incoming, max_n=max_facts)
    state["summary"] = facts_to_summary(state["facts"], max_chars=summary_chars)
    return state


def update_dialogue_after_run(
    dialogue: dict[str, Any] | None,
    *,
    user_prompt: str,
    assistant_reply: str,
    intent: str | None,
    tool_ops_applied: bool,
    short_turns: list[dict[str, Any]] | None,
    rules: dict[str, str] | None,
) -> dict[str, Any]:
    """Persist optimal dialogue memory after a run (facts-first rolling summary)."""
    import time

    lim = dialogue_limits(rules)
    per = lim["per_turn_chars"]
    cleaned: list[dict[str, Any]] = []
    for t in short_turns or []:
        nt = normalize_turn_for_dialogue(t, per_turn_chars=per)
        if nt:
            cleaned.append(nt)
    cleaned = dedupe_current_prompt(cleaned, user_prompt)
    recent, older = split_recent_and_older(
        cleaned,
        recent_turns=lim["recent_turns"],
        recent_chars=lim["recent_chars"],
    )
    # Current turn is not yet in chat_messages sometimes — always fold it.
    incoming: list[dict[str, str]] = []
    up = (user_prompt or "").strip()
    if up:
        incoming.extend(extract_facts_from_text(role="user", text=up[:per]))
    ar = assistant_facing_text(assistant_reply or "", max_chars=per)
    if ar:
        incoming.extend(extract_facts_from_text(role="assistant", text=ar))
    if tool_ops_applied and intent in ("edit", "create", "canvas_op", "design"):
        ops_hint = ""
        if isinstance(tool_ops_applied, list) and tool_ops_applied:
            names: list[str] = []
            for op in tool_ops_applied[:6]:
                if isinstance(op, dict):
                    n = str(op.get("name") or "").strip()
                    if n:
                        names.append(n)
                elif isinstance(op, str) and op.strip():
                    names.append(op.strip())
            if names:
                ops_hint = "：" + ",".join(names[:6])
        incoming.append(
            {
                "kind": "decision",
                "text": f"本轮已落笔（intent={intent}{ops_hint})"[:120],
            }
        )

    state = fold_turns_into_dialogue(
        dialogue,
        older,
        max_facts=lim["facts_max"],
        summary_chars=lim["summary_chars"],
    )
    # Recent stays verbatim next load; still harvest facts from recent for salience.
    for t in recent:
        incoming.extend(
            extract_facts_from_text(role=str(t.get("role") or ""), text=str(t.get("text") or ""))
        )
    state["facts"] = merge_dialogue_facts(state["facts"], incoming, max_n=lim["facts_max"])
    state["summary"] = facts_to_summary(state["facts"], max_chars=lim["summary_chars"])
    state["updated_at"] = time.time()
    return state


def prepare_dialogue_layers(
    *,
    short: list[dict[str, Any]],
    medium: dict[str, Any] | None,
    rules: dict[str, str] | None,
    current_prompt: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    """Split short history → recent verbatim + folded dialogue + cleaned all turns."""
    lim = dialogue_limits(rules)
    per = lim["per_turn_chars"]
    cleaned: list[dict[str, Any]] = []
    for t in short or []:
        nt = normalize_turn_for_dialogue(t, per_turn_chars=per)
        if nt:
            cleaned.append(nt)
    cleaned = dedupe_current_prompt(cleaned, current_prompt)
    recent, older = split_recent_and_older(
        cleaned,
        recent_turns=lim["recent_turns"],
        recent_chars=lim["recent_chars"],
    )
    stored = None
    if isinstance(medium, dict):
        stored = medium.get("dialogue")
    dialogue = fold_turns_into_dialogue(
        stored,
        older,
        max_facts=lim["facts_max"],
        summary_chars=lim["summary_chars"],
    )
    return recent, dialogue, cleaned


def build_short_term_from_messages(messages: list[dict[str, Any]], *, rules: dict[str, str]) -> list[dict[str, Any]]:
    max_turns, max_chars = _limits(rules)
    max_msgs = max_turns * 2
    slice_msgs = messages[-max_msgs:] if len(messages) > max_msgs else messages
    out: list[dict[str, Any]] = []
    total = 0
    for m in slice_msgs:
        role = str(m.get("role") or "").strip().lower()
        content = str(m.get("content") or "").strip()
        if not content or role not in ("user", "assistant"):
            continue
        # Prefer facing text before trim so JSON agent blobs don't waste budget.
        if role == "assistant":
            content = assistant_facing_text(content, max_chars=2800)
        turn = trim_short_turn({"role": role, "text": content})
        if not turn:
            continue
        tlen = len(turn["text"])
        if total + tlen > max_chars:
            remain = max_chars - total
            if remain < 80:
                break
            turn["text"] = turn["text"][:remain]
            out.append(turn)
            break
        out.append(turn)
        total += tlen
    return out


def load_short_term_from_session(session_id: str, *, rules: dict[str, str]) -> list[dict[str, Any]]:
    sid = (session_id or "").strip()
    if not sid:
        return []
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_schema()
    with Session(engine) as session:
        rows = crud.list_chat_message_role_content(session=session, session_id=sid)
        msgs = [{"role": r.role, "content": r.content} for r in rows]
    return build_short_term_from_messages(msgs, rules=rules)
