"""Format memory blocks for LLM prompts."""

from __future__ import annotations

import json
from typing import Any


def format_design_memory_block(design: dict[str, Any] | None) -> str:
    """Decide-facing summary. No DNA axis numbers (those stay in Brief, not Paint)."""
    src = design if isinstance(design, dict) else {}
    user = src.get("user") if isinstance(src.get("user"), dict) else {}
    project = src.get("project") if isinstance(src.get("project"), dict) else {}
    session = src.get("session") if isinstance(src.get("session"), dict) else {}
    pref_map = user.get("preference") if isinstance(user.get("preference"), dict) else {}
    committed_bits: list[str] = []
    pending_n = 0
    committed_n = 0
    for val in pref_map.values():
        if not isinstance(val, dict):
            continue
        if val.get("committed") or val.get("signal"):
            if val.get("committed"):
                committed_n += 1
                target = str(val.get("target") or "").strip()
                sig = str(val.get("signal") or "").strip()
                direction = str(val.get("direction") or "").strip()
                rng = val.get("preferred_range") if isinstance(val.get("preferred_range"), dict) else None
                bit = " ".join(x for x in (target, sig, direction) if x)
                if rng and rng.get("min") is not None and rng.get("max") is not None:
                    bit = f"{bit} {rng.get('min')}-{rng.get('max')}".strip()
                if bit:
                    committed_bits.append(bit[:80])
            else:
                pending_n += 1
        else:
            pending_n += 1
    pref_n = committed_n
    rejected_n = len(user.get("rejected_patterns") or []) if isinstance(user.get("rejected_patterns"), list) else 0
    accepted_n = len(user.get("accepted_patterns") or []) if isinstance(user.get("accepted_patterns"), list) else 0
    lock = {}
    brief = session.get("brief") if isinstance(session.get("brief"), dict) else {}
    if isinstance(brief.get("reference_lock"), dict):
        lock = brief["reference_lock"]
    elif isinstance(project.get("reference_dna"), dict) and project.get("reference_dna"):
        lock = {"has_dna": True}
    lock_comp = ""
    if isinstance(lock.get("composition"), dict):
        lock_comp = str(lock["composition"].get("type") or "").strip()
    thesis = str(brief.get("visual_thesis") or "").strip()
    review = session.get("review") if isinstance(session.get("review"), dict) else {}
    total = review.get("total")
    action = str(review.get("action") or "").strip()
    try:
        iteration = int(session.get("iteration") or 0)
    except (TypeError, ValueError):
        iteration = 0
    has_brand = bool(project.get("brand_dna"))
    has_system = bool(project.get("design_system"))
    has_dna = bool(project.get("reference_dna"))
    if not (
        pref_n
        or pending_n
        or rejected_n
        or accepted_n
        or has_brand
        or has_system
        or has_dna
        or lock_comp
        or thesis
        or total is not None
        or iteration
    ):
        return ""
    user_line = (
        f"- user: committed={pref_n} learning={pending_n} "
        f"rejected={rejected_n} accepted={accepted_n}"
    )
    if committed_bits:
        user_line += "; " + "; ".join(committed_bits[:4])
    lines = [
        user_line,
        "- project: "
        + ", ".join(
            x
            for x in (
                "reference_dna locked" if has_dna else "",
                f"language={lock_comp}" if lock_comp else "",
                "brand_dna" if has_brand else "",
                "design_system" if has_system else "",
            )
            if x
        )
        or "empty",
        f"- session: iteration={iteration}"
        + (f"; thesis={thesis[:120]}" if thesis else "")
        + (f"; review={total} {action}".rstrip() if total is not None else ""),
    ]
    return "[Design memory]\n" + "\n".join(lines)


def compose_memory_blocks(
    *,
    medium: dict[str, Any],
    short: list[dict[str, Any]],
    long_hits: list[dict[str, Any]],
    rules: dict[str, str],
    episodes: list[dict[str, Any]] | None = None,
    kg_triples: list[dict[str, Any]] | None = None,
    dialogue: dict[str, Any] | None = None,
    include_recent_dialogue: bool = False,
) -> str:
    parts: list[str] = []
    hint = str(rules.get("memory.task_state_hint") or "").strip()
    if hint:
        parts.append(hint)

    canvas = medium.get("canvas") if isinstance(medium.get("canvas"), dict) else {}
    last_run = medium.get("last_run") if isinstance(medium.get("last_run"), dict) else None
    referents = medium.get("referents") if isinstance(medium.get("referents"), dict) else {}
    design = medium.get("design") if isinstance(medium.get("design"), dict) else {}
    dial = dialogue if isinstance(dialogue, dict) else (
        medium.get("dialogue") if isinstance(medium.get("dialogue"), dict) else {}
    )

    task_lines: list[str] = []
    focus = canvas.get("focus_frame_id") or canvas.get("last_agent_frame_id")
    if focus:
        task_lines.append(f"focus_frame_id: {focus}")
    if canvas.get("last_agent_frame_id"):
        task_lines.append(f"last_agent_frame_id: {canvas.get('last_agent_frame_id')}")
    frames = canvas.get("frames") if isinstance(canvas.get("frames"), list) else []
    if frames:
        try:
            slim = [
                {
                    "id": f.get("id"),
                    "name": f.get("name"),
                    "w": f.get("w"),
                    "h": f.get("h"),
                    "is_empty": f.get("is_empty"),
                }
                for f in frames[:24]
                if isinstance(f, dict) and f.get("id")
            ]
            task_lines.append(f"frames: {json.dumps(slim, ensure_ascii=False)}")
        except Exception:
            pass
    if referents:
        try:
            task_lines.append(f"referents: {json.dumps(referents, ensure_ascii=False)[:1200]}")
        except Exception:
            pass
    if last_run:
        lr = {
            k: last_run.get(k)
            for k in (
                "intent",
                "edit_in_place",
                "blank_artboard",
                "summary",
                "scene",
                "canvas_size",
                "critique_notes",
                "await_user",
            )
            if last_run.get(k) is not None
        }
        if lr:
            task_lines.append(f"last_run: {json.dumps(lr, ensure_ascii=False)}")

    if task_lines:
        parts.append("[Task state]\n" + "\n".join(task_lines))

    design_block = format_design_memory_block(design)
    if design and design_block:
        parts.append(design_block)

    if design:
        from app.services.agent_memory.subgoals import format_queue_block, normalize_queue

        sg_block = format_queue_block(normalize_queue(design.get("subgoals")))
        if sg_block:
            parts.append(sg_block)

    # Optimal chat context: recent verbatim first (Ask chip follow-ups), then facts/summary.
    if include_recent_dialogue and short:
        dial_lines: list[str] = []
        for t in short:
            role = "User" if t.get("role") == "user" else "Assistant"
            dial_lines.append(f"{role}: {t.get('text', '')}")
        if dial_lines:
            parts.append("[Recent dialogue]\n" + "\n".join(dial_lines))

    fact_lines: list[str] = []
    facts = dial.get("facts") if isinstance(dial.get("facts"), list) else []
    for f in facts[:16]:
        if not isinstance(f, dict):
            continue
        kind = str(f.get("kind") or "").strip()
        text = str(f.get("text") or "").strip()
        if kind and text:
            fact_lines.append(f"- ({kind}) {text}")
    summary = str(dial.get("summary") or "").strip()
    if fact_lines or summary:
        dial_parts: list[str] = []
        if fact_lines:
            dial_parts.append("[Dialogue facts]\n" + "\n".join(fact_lines))
        if summary:
            dial_parts.append("[Dialogue summary]\n" + summary)
        parts.append("\n\n".join(dial_parts))

    if long_hits:
        long_lines = []
        for h in long_hits:
            via = h.get("retrieve")
            score = h.get("score")
            suffix = ""
            if isinstance(score, (int, float)) and via == "embedding":
                suffix = f" sim={float(score):.2f}"
            elif via:
                suffix = f" via={via}"
            long_lines.append(
                f"- ({h.get('kind', 'note')}) {h.get('text', '')}{suffix}"
            )
        parts.append("[Long-term preferences]\n" + "\n".join(long_lines))

    if episodes:
        from app.services.agent_memory.episodes import format_episode_block

        ep_block = format_episode_block(episodes)
        if ep_block:
            parts.append(ep_block)

    if kg_triples:
        from app.services.agent_memory.kg import format_kg_block

        kg_block = format_kg_block(kg_triples)
        if kg_block:
            parts.append(kg_block)

    empty_hint = str(rules.get("memory.empty_frame_add_shape") or "").strip()
    if empty_hint and _last_frame_empty(medium):
        parts.append(f"[Canvas hint]\n{empty_hint}")

    return "\n\n".join(parts).strip()


def _last_frame_empty(medium: dict[str, Any]) -> bool:
    canvas = medium.get("canvas") if isinstance(medium.get("canvas"), dict) else {}
    fid = canvas.get("last_agent_frame_id") or canvas.get("focus_frame_id")
    frames = canvas.get("frames") if isinstance(canvas.get("frames"), list) else []
    for f in frames:
        if isinstance(f, dict) and f.get("id") == fid:
            return bool(f.get("is_empty"))
    return False
