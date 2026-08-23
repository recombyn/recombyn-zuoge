"""Deferred skills/tools/subagent fetch helpers."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from langgraph.config import get_stream_writer

from app.services.design.prompts.skill_store import resolve_triggered_skill_keys
from app.services.design.runtime.agent_profile import (
    get_active_agent_profile,
    resolve_tool_host,
)
from app.services.design.runtime.subagent import (
    format_subagent_results,
    harvest_background_jobs,
    parse_need_subagents,
    resolve_auto_need_subagents,
    run_subagents_parallel,
    spawn_subagent_background,
)

_log = logging.getLogger(__name__)


def _emit(ev: dict[str, Any]) -> None:
    try:
        get_stream_writer()(ev)
    except Exception:
        pass


def _inject_skill_details_bundle(
    rt: Any,
    st: Any,
    sb: dict[str, Any],
    fresh_s: list[str],
    *,
    round_i: int,
) -> None:
    skill_errs = list(sb.get("errors") or [])
    if skill_errs:
        st.push_log(phase="skill_validate", errors=skill_errs[:8])
    if not sb.get("details"):
        return
    details_s = str(sb["details"])
    rt.pending_skill_details = "SKILL_DETAILS:\n" + details_s
    for k in fresh_s:
        if k not in st.skills_loaded:
            st.skills_loaded.append(k)
    st.push_log(
        phase="skill_details",
        need_skills=list(fresh_s),
        detail_chars=len(details_s),
        summary="注入 skill：" + "、".join(fresh_s),
    )
    skill_csv = (", ".join(fresh_s))[:200]
    _emit(
        {
            "type": "activity",
            "id": f"skill-details-{round_i}",
            "kind": "explored",
            "status": "done",
            "summary": skill_csv,
            "detail": skill_csv,
            "index": round_i,
        }
    )
    # Telemetry: craft skills are playbooks (not paint_ops). Emit start/done
    # so SSE consumers / stress can see skill_expect keys, not only react.
    for k in fresh_s:
        key = str(k or "").strip()
        if not key:
            continue
        _emit(
            {
                "type": "skill_start",
                "index": round_i,
                "skill_id": None,
                "skill_key": key,
                "skill_name": key,
                "category": "design",
                "trace_id": st.trace_id,
            }
        )
        _emit(
            {
                "type": "skill_done",
                "index": round_i,
                "skill_key": key,
                "skill_name": key,
                "tokens": 0,
            }
        )


def _inject_tool_details_bundle(
    rt: Any,
    st: Any,
    tb: dict[str, Any],
    fresh_tools: list[str],
    *,
    round_i: int,
) -> None:
    if not tb.get("details"):
        return
    details_t = str(tb["details"])
    rt.pending_tool_details = "TOOL_DETAILS:\n" + details_t
    for k in fresh_tools:
        if k not in st.tools_loaded:
            st.tools_loaded.append(k)
    st.push_log(
        phase="tool_details",
        need_tools=list(fresh_tools),
        detail_chars=len(details_t),
        summary="注入工具详情：" + "、".join(fresh_tools),
    )
    _emit(
        {
            "type": "activity",
            "id": f"tool-details-{round_i}",
            "kind": "explored",
            "status": "done",
            "summary": (", ".join(fresh_tools))[:200],
            "index": round_i,
        }
    )


def _canvas_is_empty(rt: Any) -> bool:
    nodes = [n for n in (rt.scene_nodes or []) if isinstance(n, dict) and n.get("id")]
    if nodes:
        return False
    frames = [f for f in (rt.scene_frames or []) if isinstance(f, dict) and f.get("id")]
    if not frames:
        return True
    return all(bool(f.get("is_empty")) for f in frames)


def _fresh_skill_keys(
    need_skills: list[str], *, skills_loaded: list[str]
) -> list[str]:
    if not need_skills:
        return []
    if "*" in need_skills:
        return list(need_skills)
    # Only keys not yet loaded — never re-queue already-injected skills (avoids decide spin).
    return [k for k in need_skills if k not in skills_loaded]


def _fetch_deferred_skills(
    *,
    keys: list[str],
    scene: str,
    version_pins: dict[str, int | str] | None = None,
    input_args: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    from app.services.design.prompts.skill_store import format_skills_details_checked

    details, errs = format_skills_details_checked(
        keys=keys,
        scene=scene,
        version_pins=version_pins,
        input_args=input_args,
        user_id=user_id,
        role="paint",
        stage="plan",
    )
    return {"keys": list(keys), "details": details or "", "errors": errs}


def _fetch_deferred_tools(*, keys: list[str], rules: dict[str, str]) -> dict[str, Any]:
    details = resolve_tool_host().format_details(keys, rules=rules)
    return {"keys": list(keys), "details": details or ""}


async def _gather_deferred_resource_details(
    *,
    fresh_skills: list[str],
    fresh_tools: list[str],
    scene: str,
    rules: dict[str, str],
    skill_version_pins: dict[str, int | str] | None = None,
    skill_input_args: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Fetch skills / tools in parallel."""
    jobs: list[tuple[str, Any]] = []
    if fresh_skills:
        jobs.append(
            (
                "skills",
                asyncio.to_thread(
                    _fetch_deferred_skills,
                    keys=fresh_skills,
                    scene=scene,
                    version_pins=skill_version_pins,
                    input_args=skill_input_args,
                    user_id=user_id,
                ),
            )
        )
    if fresh_tools:
        jobs.append(
            (
                "tools",
                asyncio.to_thread(
                    _fetch_deferred_tools,
                    keys=fresh_tools,
                    rules=rules,
                ),
            )
        )
    out: dict[str, Any] = {}
    if not jobs:
        return out
    results = await asyncio.gather(
        *(coro for _, coro in jobs),
        return_exceptions=True,
    )
    for (kind, _), result in zip(jobs, results):
        if isinstance(result, BaseException):
            _log.exception("deferred %s fetch failed", kind, exc_info=result)
            out[kind] = {"error": str(result)[:240]}
        else:
            out[kind] = result
    return out


def _default_subagent_task(rt: Any, turn: dict[str, Any], job: dict[str, Any]) -> str:
    explicit = str(job.get("task") or "").strip()
    if explicit:
        return explicit
    thought = str(turn.get("thought") or "").strip()
    prompt = str(getattr(rt, "prompt", "") or "").strip()
    parts = [p for p in (prompt, thought) if p]
    return "\n\n".join(parts)[:4000] or "(no task)"


async def _load_deferred_subagents(
    rt: Any,
    turn: dict[str, Any],
    *,
    round_i: int,
) -> None:
    """Spawn Profile catalog subagents (sync await and/or background)."""
    jobs = parse_need_subagents(
        turn.get("need_subagents")
    )
    pending_job_ids = [
        str(x).strip()
        for x in list(rt.flags.get("subagent_jobs") or [])
        if str(x).strip()
    ]
    # Explicit poll via {job_id: "..."} entries.
    for job in jobs:
        jid = str(job.get("job_id") or "").strip()
        if jid and jid not in pending_job_ids:
            pending_job_ids.append(jid)

    harvested = await harvest_background_jobs(pending_job_ids) if pending_job_ids else []
    if harvested:
        still = [
            jid
            for jid in pending_job_ids
            if all(str(r.job_id or "") != jid for r in harvested)
        ]
        rt.flags["subagent_jobs"] = still

    if not jobs and not harvested:
        return

    st = rt.run
    prof = get_active_agent_profile()
    ids = [str(j.get("id") or "") for j in jobs if j.get("id")]
    if ids:
        st.push_log(
            phase="need_subagents",
            need_subagents=list(ids),
            summary="申请子代理：" + "、".join(ids),
        )
        _emit(
            {
                "type": "activity",
                "id": f"need-subagents-{round_i}",
                "kind": "explored",
                "status": "running",
                "summary": (", ".join(ids))[:200],
                "index": round_i,
            }
        )

    sync_jobs: list[dict[str, Any]] = []
    started_notes: list[str] = []
    results = list(harvested)

    for job in jobs:
        aid = str(job.get("id") or "").strip()
        # Poll-only: job_id without spawn id — already harvested above.
        if not aid:
            continue
        task_text = _default_subagent_task(rt, turn, job)
        images = job.get("images")
        if not images:
            images = list(getattr(rt, "images", None) or [])[:4] or None
        payload = {
            "id": aid,
            "task": task_text,
            "images": images,
            "timeout": job.get("timeout") or 90.0,
            "metadata": job.get("metadata"),
        }
        if job.get("background"):
            jid = spawn_subagent_background(
                agent_id=aid,
                task=task_text,
                rules=rt.rules,
                profile=prof,
                images=images,
                metadata=job.get("metadata"),
                timeout=float(job.get("timeout") or 90.0),
            )
            open_jobs = list(rt.flags.get("subagent_jobs") or [])
            open_jobs.append(jid)
            rt.flags["subagent_jobs"] = open_jobs[-16:]
            started_notes.append(f"`{aid}` job={jid} (background)")
            st.push_log(
                phase="subagent_bg",
                need_subagents=[aid],
                job_id=jid,
                summary=f"后台子代理已启动：{aid}",
            )
        else:
            sync_jobs.append(payload)

    if sync_jobs:
        try:
            results.extend(
                await run_subagents_parallel(
                    sync_jobs, rules=rt.rules, profile=prof
                )
            )
        except Exception as err:
            _log.exception("need_subagents sync failed")
            st.push_log(phase="subagent_error", error=str(err)[:240])

    loaded = list(getattr(st, "subagents_loaded", None) or [])
    for res in results:
        aid = str(getattr(res, "agent_id", "") or "").strip()
        if aid and getattr(res, "ok", False) and aid not in loaded:
            loaded.append(aid)
    for job in sync_jobs:
        aid = str(job.get("id") or "").strip()
        if aid and aid not in loaded:
            # Mark attempted sync spawns to avoid auto re-trigger loops on fail too.
            loaded.append(aid)
    st.subagents_loaded = loaded[-24:]

    detail_parts: list[str] = []
    if started_notes:
        detail_parts.append(
            "SUBAGENT_STARTED:\n" + "\n".join(f"- {n}" for n in started_notes)
        )
    formatted = format_subagent_results(results)
    if formatted:
        detail_parts.append(formatted)
    if detail_parts:
        block = "\n\n".join(detail_parts)
        prev = str(getattr(rt, "pending_subagent_details", "") or "").strip()
        rt.pending_subagent_details = (
            (prev + "\n\n" + block).strip() if prev else block
        )
        st.push_log(
            phase="subagent_details",
            need_subagents=list(ids) if ids else None,
            detail_chars=len(block),
            summary="注入子代理结果："
            + ("、".join(ids) if ids else f"{len(results)} job(s)"),
        )
        _emit(
            {
                "type": "activity",
                "id": f"subagent-details-{round_i}",
                "kind": "explored",
                "status": "done",
                "summary": (", ".join(ids) if ids else "subagent results")[:200],
                "index": round_i,
            }
        )


async def load_deferred_resources(
    rt: Any, turn: dict[str, Any], *, round_i: int | None = None
) -> Any:
    st = rt.run
    round_i = st.round if round_i is None else round_i
    need_tools = list(turn.get("need_tools") or [])
    need_skills = list(turn.get("need_skills") or [])
    need_subagents = parse_need_subagents(
        turn.get("need_subagents")
    )
    # Pass-through only — no auto vision_scout / research.
    intent_l = str(turn.get("intent") or st.intent or "").strip() or "create"
    need_subagents = resolve_auto_need_subagents(
        profile=get_active_agent_profile(),
        has_images=bool(rt.images),
        empty_canvas=_canvas_is_empty(rt),
        intent=intent_l,
        prompt_chars=len(str(rt.prompt or "").strip()),
        already=list(getattr(st, "subagents_loaded", None) or []),
        existing=need_subagents,
    )
    turn["need_subagents"] = need_subagents
    # Auto skills are for design/create turns. Explicit pins and need_skills
    # still work for every intent; ordinary edits must stay deterministic.
    auto_skill_intents = {"create", "design"}
    classified = str(getattr(rt, "classified_intent", None) or intent_l).strip().lower()
    brief = getattr(rt, "design_brief", None)
    has_brief = isinstance(brief, dict) and bool(brief)
    if intent_l in auto_skill_intents and classified != "canvas_op":
        for k in resolve_triggered_skill_keys(
            scene=rt.scene_key or "",
            empty_canvas=_canvas_is_empty(rt),
            has_images=bool(rt.images),
            intent=intent_l,
            prompt_chars=len(str(rt.prompt or "").strip()),
            prompt=str(rt.prompt or ""),
            already_loaded=list(st.skills_loaded or []) + list(need_skills),
            stage="plan",
            classified_intent=classified,
            has_design_brief=has_brief,
        ):
            if k not in need_skills:
                need_skills.append(k)

    # Surface → Core via _meta.extends (dedupe + category order inside expand).
    try:
        from app.services.design.prompts.skill_store import expand_skill_extends

        need_skills = expand_skill_extends(need_skills, scene=rt.scene_key or "")
        turn["need_skills"] = list(need_skills)
    except Exception:
        pass

    fresh_s = _fresh_skill_keys(need_skills, skills_loaded=st.skills_loaded)
    load_skills = bool(need_skills) and not (
        set(need_skills) <= set(st.skills_loaded) and "*" not in need_skills
    )
    if not load_skills:
        fresh_s = []
    fresh_tools = (
        [k for k in need_tools if k not in st.tools_loaded] if need_tools else []
    )

    if load_skills:
        st.push_log(
            phase="need_skills",
            need_skills=list(fresh_s),
            intent=st.intent,
            summary="申请 skill：" + "、".join(fresh_s),
        )
        _emit(
            {
                "type": "activity",
                "id": f"need-skills-{round_i}",
                "kind": "explored",
                "status": "done",
                "summary": (", ".join(fresh_s))[:200],
                "index": round_i,
            }
        )
    if need_tools:
        st.push_log(
            phase="need_tools",
            need_tools=list(need_tools),
            summary="申请工具详情：" + "、".join(need_tools),
        )
        _emit(
            {
                "type": "activity",
                "id": f"need-tools-{round_i}",
                "kind": "explored",
                "status": "done",
                "summary": (", ".join(need_tools))[:200],
                "index": round_i,
            }
        )

    if turn.get("skill_parse_errs"):
        st.push_log(phase="skill_input", errors=list(turn.get("skill_parse_errs") or [])[:8])

    bundles = await _gather_deferred_resource_details(
        fresh_skills=fresh_s if load_skills else [],
        fresh_tools=fresh_tools if need_tools else [],
        scene=rt.scene_key or "",
        rules=rt.rules,
        skill_version_pins=turn.get("skill_version_pins") or None,
        skill_input_args=turn.get("skill_input_args") or None,
        user_id=str(getattr(rt, "user_id", "") or "") or None,
    )
    sb = bundles.get("skills") if load_skills else None
    if isinstance(sb, dict):
        _inject_skill_details_bundle(rt, st, sb, fresh_s, round_i=round_i)
    tb = bundles.get("tools") if need_tools else None
    if isinstance(tb, dict):
        _inject_tool_details_bundle(rt, st, tb, fresh_tools, round_i=round_i)

    if need_subagents or rt.flags.get("subagent_jobs"):
        await _load_deferred_subagents(rt, turn, round_i=round_i)

    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "react",
            "tokens": rt.last_used,
        }
    )
    st.round = round_i + 1
    rt.flags["fetched"] = True
    rt.flags["ready"] = True
    rt.flags["next_round"] = True
    rt.flags["need_tools"] = False
    rt.flags["need_skills"] = False
    rt.flags["need_subagents"] = False
    return rt
