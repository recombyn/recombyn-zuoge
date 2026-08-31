"""MemoryService — load bundle, build patches, persist.

Tier map (ADR 0006):
  session  → short-term dialogue + medium task_state (+ LangGraph checkpointer)
  project  → project_id on medium / episodes (scoped fields; not a separate store)
  global   → long-term Store + episodes/KG by user_id
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.services.agent_memory.compose import compose_memory_blocks
from app.services.agent_memory.episodes import list_recent_episodes
from app.services.agent_memory.long_term import list_long_hits, load_user_design_memory
from app.services.agent_memory.medium_term import load_project_design_memory, load_task_state_from_session, persist_medium_term
from app.services.agent_memory.schema import (
    deep_merge,
    empty_task_state,
    merge_user_design_layers,
    normalize_design_memory,
    normalize_task_state,
    overlay_project_design,
)
from app.services.agent_memory.short_term import (
    build_short_term_from_messages,
    load_short_term_from_session,
)

logger = logging.getLogger(__name__)

# Roadmap labels → implementation notes (documentation + tests; not a router).
MEMORY_TIERS: dict[str, str] = {
    "session": "short_term + medium_term(session) + langgraph_checkpointer",
    "project": "project_id on medium_term / episodes",
    "global": "long_term store + episodes/kg by user_id",
}


def _mem_print(msg: str) -> None:
    logger.info(msg)
    try:
        from app.services.design.prompts.rules_text import _exec_trace_verbose, _safe_print

        if _exec_trace_verbose():
            _safe_print(msg)
    except Exception:
        pass


def _rule_on(rules: dict[str, str], key: str, default: str) -> bool:
    val = str(rules.get(key) if rules.get(key) is not None else default).strip().lower()
    return val in ("1", "true", "yes", "on")


def _hydrate_design_memory_layers(
    medium: dict[str, Any],
    *,
    user_id: str,
    session_id: str,
    project_id: str,
) -> dict[str, Any]:
    """Fill User from long-term and Project from the latest sibling session."""
    out = dict(medium or {})
    design = normalize_design_memory(out.get("design"))
    design["user"] = merge_user_design_layers(
        design.get("user"),
        load_user_design_memory(user_id),
    )
    design["project"] = overlay_project_design(
        design.get("project"),
        load_project_design_memory(
            user_id, project_id, exclude_session_id=session_id
        ),
    )
    out["design"] = design
    return out


@dataclass
class MemoryBundle:
    medium: dict[str, Any]
    short: list[dict[str, Any]]
    long_hits: list[dict[str, Any]]
    episodes: list[dict[str, Any]]
    kg_triples: list[dict[str, Any]]
    blocks: str
    # Full short window before recent-split (for dialogue fold on write).
    short_all: list[dict[str, Any]] = field(default_factory=list)


class MemoryService:
    def load(
        self,
        *,
        user_id: str,
        session_id: str,
        project_id: str,
        memory_in: dict[str, Any] | None,
        rules: dict[str, str],
        query: str = "",
        scene: str = "",
    ) -> MemoryBundle:
        t0 = time.time()
        q_preview = (query or "").strip()[:80]

        def _mem(phase: str, **extra: Any) -> None:
            bits = " ".join(f"{k}={v!r}" for k, v in extra.items() if v is not None)
            msg = (
                f"[exec] +{time.time() - t0:6.2f}s mode=memory phase={phase}"
                + (f"  {bits}" if bits else "")
            )
            _mem_print(msg)

        if not _rule_on(rules, "memory.enabled", "1"):
            _mem("disabled", query=q_preview)
            medium = empty_task_state(session_id=session_id, project_id=project_id, user_id=user_id)
            return MemoryBundle(
                medium=medium,
                short=[],
                long_hits=[],
                episodes=[],
                kg_triples=[],
                blocks="",
                short_all=[],
            )

        _mem("BEGIN", query=q_preview, scene=(scene or "")[:40])
        mem = memory_in if isinstance(memory_in, dict) else {}
        client_medium = mem.get("medium") if isinstance(mem.get("medium"), dict) else None
        server_medium = load_task_state_from_session(user_id, session_id, project_id=project_id)
        base = server_medium or empty_task_state(
            session_id=session_id, project_id=project_id, user_id=user_id
        )
        if client_medium:
            medium = normalize_task_state(
                deep_merge(base, client_medium),
                session_id=session_id,
                project_id=project_id,
                user_id=user_id,
            )
        else:
            medium = normalize_task_state(
                base, session_id=session_id, project_id=project_id, user_id=user_id
            )
        medium = _hydrate_design_memory_layers(
            medium,
            user_id=user_id,
            session_id=session_id,
            project_id=project_id,
        )
        _mem("medium_ok", has_client=bool(client_medium), has_server=bool(server_medium))

        short_in = mem.get("short")
        if isinstance(short_in, list) and short_in:
            short = build_short_term_from_messages(
                [{"role": t.get("role"), "content": t.get("text")} for t in short_in if isinstance(t, dict)],
                rules=rules,
            )
        elif session_id:
            short = load_short_term_from_session(session_id, rules=rules)
        else:
            short = []
        _mem("short_ok", n=len(short))

        retrieve = mem.get("retrieve_long")
        if retrieve is False:
            long_hits: list[dict[str, Any]] = []
            _mem("long_skip", reason="retrieve_long=false")
        else:
            t_long = time.time()
            long_hits = list_long_hits(user_id, rules=rules, query=query or "")
            _mem(
                "long_ok",
                n=len(long_hits),
                ms=int((time.time() - t_long) * 1000),
                mode=str(
                    (rules or {}).get("memory.long.retrieve") or "embedding"
                ),
            )

        # P1: episodes (embedding top_k with recency fallback).
        t_ep = time.time()
        episodes = list_recent_episodes(user_id, rules=rules, query=query or "")
        _mem(
            "episodes_ok",
            n=len(episodes),
            ms=int((time.time() - t_ep) * 1000),
            mode=str(
                (rules or {}).get("memory.episode.retrieve") or "embedding"
            ),
        )

        # P3: knowledge-graph triples (scene + query keywords).
        from app.services.agent_memory.kg import retrieve_triples

        sc = (scene or "").strip()
        if not sc:
            last = medium.get("last_run") if isinstance(medium.get("last_run"), dict) else {}
            sc = str(last.get("scene") or "").strip()
        t_kg = time.time()
        kg_triples = retrieve_triples(
            user_id, query=query or "", scene=sc, rules=rules
        )
        _mem("kg_ok", n=len(kg_triples), ms=int((time.time() - t_kg) * 1000), scene=sc[:40])

        from app.services.agent_memory.short_term import prepare_dialogue_layers

        recent, dialogue_view, short_all = prepare_dialogue_layers(
            short=short,
            medium=medium,
            rules=rules,
            current_prompt=query or "",
        )
        # Keep folded dialogue on medium for this run's memory_patch base.
        medium = dict(medium)
        medium["dialogue"] = dialogue_view

        blocks = compose_memory_blocks(
            medium=medium,
            short=recent,
            long_hits=long_hits,
            episodes=episodes,
            kg_triples=kg_triples,
            rules=rules,
            dialogue=dialogue_view,
            # Ask follow-ups are short chips ("随意一段示例"); need verbatim recent turns.
            include_recent_dialogue=True,
        )
        _mem(
            "DONE",
            blocks_chars=len(blocks or ""),
            short=len(recent),
            short_raw=len(short_all),
            long=len(long_hits),
            episodes=len(episodes),
            kg=len(kg_triples),
            dialogue_facts=len(dialogue_view.get("facts") or []),
            dialogue_summary_chars=len(str(dialogue_view.get("summary") or "")),
            total_ms=int((time.time() - t0) * 1000),
        )
        return MemoryBundle(
            medium=medium,
            short=recent,
            long_hits=long_hits,
            episodes=episodes,
            kg_triples=kg_triples,
            blocks=blocks,
            short_all=short_all,
        )

    def build_run_patch(
        self,
        medium: dict[str, Any],
        *,
        task_id: str,
        intent: str | None,
        edit_in_place: bool,
        blank_artboard: bool,
        summary: str,
        tool_ops_applied: bool,
        critique_notes: str | None,
        scene_key: str | None,
        canvas_size: str | None,
        design_patch: dict[str, Any] | None = None,
        subgoals: list[str] | None = None,
        completed_skill_keys: list[str] | None = None,
        user_prompt: str = "",
        assistant_reply: str = "",
        short_turns: list[dict[str, Any]] | None = None,
        rules: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        last_run = {
            "at": time.time(),
            "task_id": task_id,
            "intent": intent,
            "edit_in_place": edit_in_place,
            "blank_artboard": blank_artboard,
            "summary": str(summary or "")[:900],
            "tool_ops_applied": tool_ops_applied,
            "scene": scene_key,
            "canvas_size": canvas_size,
        }
        if critique_notes:
            last_run["critique_notes"] = str(critique_notes)[:600]
        if subgoals:
            last_run["subgoals"] = subgoals[:6]
        if completed_skill_keys:
            last_run["completed_skills"] = completed_skill_keys[:24]
        if isinstance(design_patch, dict) and "await_user" in design_patch:
            last_run["await_user"] = bool(design_patch.get("await_user"))
            design_patch = {k: v for k, v in design_patch.items() if k != "await_user"}
            if not design_patch:
                design_patch = None
        patch: dict[str, Any] = {"last_run": last_run}
        if design_patch:
            patch["design"] = design_patch

        from app.services.agent_memory.short_term import update_dialogue_after_run

        # Prefer full short history for folding when caller passes it; else medium-only.
        patch["dialogue"] = update_dialogue_after_run(
            medium.get("dialogue") if isinstance(medium, dict) else None,
            user_prompt=user_prompt or str(summary or ""),
            assistant_reply=assistant_reply or str(summary or ""),
            intent=intent,
            tool_ops_applied=tool_ops_applied,
            short_turns=short_turns,
            rules=rules,
        )
        merged = deep_merge(medium, patch)
        return {"medium": merged}

    def persist_after_run(
        self,
        user_id: str,
        session_id: str,
        project_id: str,
        merged_medium: dict[str, Any],
    ) -> None:
        if not session_id:
            return
        persist_medium_term(user_id, session_id, project_id, merged_medium)


memory_service = MemoryService()
