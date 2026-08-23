"""Forked sub-agents — isolated LLM runs owned by AgentProfile.

Parent (primary Design Agent) may spawn catalog entries from
``AgentProfile.subagents`` via ``need_subagents`` (decide) or graph roles
(e.g. review). Each child gets a **fresh message list** (system + task only)
— never the parent chat transcript.

This is in-process async isolation (API worker), not an OS subprocess:
narrow context, typed return, optional parallel gather, optional
background fire-and-forget.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

_log = logging.getLogger(__name__)

# Process-local background jobs (fire-and-forget spawn).
_BG_LOCK = asyncio.Lock()
_BG_TASKS: dict[str, asyncio.Task[Any]] = {}
_BG_RESULTS: dict[str, "SubAgentResult"] = {}
_BG_REDIS_PREFIX = "design:subagent_job:"
_BG_REDIS_TTL_SEC = 3600


@dataclass(frozen=True)
class SubAgentDef:
    """Spawnable child declared under Profile ``subagents:``."""

    id: str
    description: str
    isolation: str  # forked_context (live) | shared_state (reject for spawn)
    model_ref: str  # literal model id or ``$kv:ruleKey``
    system_key: str
    stage: str
    contract: str
    tools: tuple[str, ...] = ()
    max_turns: int = 1
    parallel_ok: bool = True


@dataclass
class SubAgentResult:
    agent_id: str
    ok: bool
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    model: str = ""
    duration_ms: int = 0
    error: str | None = None
    isolation: str = "forked_context"
    job_id: str | None = None


def resolve_subagent_model(
    model_ref: str,
    rules: dict[str, str] | None,
    *,
    fallback: str = "",
) -> str:
    raw = str(model_ref or "").strip()
    if raw.startswith("$kv:"):
        key = raw[4:].strip()
        got = str((rules or {}).get(key) or "").strip()
        return got or str(fallback or "").strip()
    return raw or str(fallback or "").strip()


def format_subagents_catalog(profile: Any | None = None) -> str:
    """Short catalog for decide system — ids + descriptions only."""
    from app.services.design.runtime.agent_profile import get_active_agent_profile

    prof = profile or get_active_agent_profile()
    items = list(prof.subagents or ())
    if not items:
        return ""
    lines = [
        "SUBAGENTS_CATALOG (forked context — declare via need_subagents):",
        "Use need_subagents: [\"id\"] or "
        '[{"id":"review","task":"...","background":false}].',
        "Look-at-image / brief synthesis is Decide + design_brief — not a catalog scout.",
        "Child runs with fresh system+task only (no parent chat). tool_ops stay [].",
    ]
    for sa in items:
        desc = str(sa.description or "").strip() or "(no description)"
        parallel = "parallel_ok" if sa.parallel_ok else "serial_only"
        lines.append(f"- `{sa.id}` [{parallel}]: {desc}")
    return "\n".join(lines)


def parse_need_subagents(raw: Any) -> list[dict[str, Any]]:
    """Normalize decide ``need_subagents`` → list of spawn job dicts."""
    if raw is None:
        return []
    items: list[Any]
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        items = [text]
    elif isinstance(raw, list):
        items = list(raw)
    else:
        items = [raw]

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        job: dict[str, Any] = {}
        if isinstance(item, str):
            aid = item.strip()
            if not aid:
                continue
            job = {"id": aid, "task": "", "background": False}
        elif isinstance(item, dict):
            aid = str(item.get("id") or "").strip()
            job_id = str(item.get("job_id") or "").strip() or None
            # Poll-only: {"job_id": "..."} without a new spawn id.
            if not aid and not job_id:
                continue
            job = {
                "id": aid,
                "task": str(item.get("task") or "").strip(),
                "background": bool(item.get("background")),
                "images": item.get("images"),
                "timeout": item.get("timeout"),
                "job_id": job_id,
                "metadata": item.get("metadata")
                if isinstance(item.get("metadata"), dict)
                else None,
            }
        else:
            continue
        # Dedup by id+background+task+job fingerprint for this turn.
        finger = (
            f"{job.get('id') or ''}|{job.get('job_id') or ''}|"
            f"{int(bool(job.get('background')))}|{job.get('task') or ''}"
        )
        if finger in seen:
            continue
        seen.add(finger)
        out.append(job)
        if len(out) >= 8:
            break
    return out


def format_subagent_results(results: list[SubAgentResult]) -> str:
    """Serialize spawn results for pending reinject into the next decide turn."""
    if not results:
        return ""
    blocks: list[str] = ["SUBAGENT_RESULTS:"]
    for res in results:
        status = "ok" if res.ok else "error"
        head = f"- `{res.agent_id}` [{status}]"
        if res.job_id:
            head += f" job={res.job_id}"
        if res.duration_ms:
            head += f" {res.duration_ms}ms"
        blocks.append(head)
        if res.error:
            blocks.append(f"  error: {res.error[:240]}")
        if res.summary:
            blocks.append(f"  summary: {res.summary}")
        payload = res.payload if isinstance(res.payload, dict) else {}
        if payload:
            for key in (
                "subjects",
                "palette",
                "layout_notes",
                "style_keywords",
                "lettering",
                "recommendations",
                "audience",
                "industry",
                "tone",
                "competitors",
                "messaging",
                "visual_directions",
                "risks",
                "fix_brief",
                "must_fix",
                "pass",
                "pass_",
                "market_gap",
            ):
                if key not in payload:
                    continue
                val = payload.get(key)
                if val in (None, "", [], {}):
                    continue
                blocks.append(f"  {key}: {val!s}"[:500])
    return "\n".join(blocks)


def resolve_auto_need_subagents(
    *,
    profile: Any,
    has_images: bool,
    empty_canvas: bool,
    intent: str,
    prompt_chars: int,
    already: list[str] | None = None,
    existing: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Pass-through for declared need_subagents (no auto scout/research).

    Ref look + design_brief synthesis belong to Decide. Review is a graph fork,
    not an auto Decide spawn. ``profile`` / canvas flags remain pass-through.
    """
    _ = (profile, has_images, empty_canvas, intent, prompt_chars, already)
    return list(existing or [])


def _resolve_subagent_schema(spec: SubAgentDef, *, profile: Any) -> Any | None:
    from app.services.design.runtime.agent_profile import (
        ensure_contract_registry,
        resolve_contract_schema,
    )

    if spec.contract:
        reg = ensure_contract_registry()
        schema = reg.get(str(spec.contract).strip())
        if schema is not None:
            return schema
    stage = spec.stage or spec.id
    try:
        return resolve_contract_schema(stage, profile=profile)
    except Exception:
        return None


def _assemble_subagent_system(
    *,
    spec: SubAgentDef,
    rules: dict[str, str] | None,
    profile: Any,
    ask_mode: bool,
    persona: str,
    catalog_blocks: list[str] | None,
) -> str:
    from app.services.design.runtime.host import assemble_stage_system
    from app.services.design.runtime.host.prompts import require_prompt_pack

    stage = (spec.stage or spec.id or "").strip().lower()
    if stage and stage in (profile.stages or {}):
        return assemble_stage_system(
            rules or {},
            stage=stage,
            ask_mode=ask_mode,
            persona=persona,
            catalog_blocks=list(catalog_blocks or []),
            profile=profile,
            locale=str(getattr(profile, "locale", "") or "") or None,
        )
    # Catalog-only subagent (not a graph stage): pack body + optional catalogs.
    key = str(spec.system_key or "").strip()
    if not key:
        raise RuntimeError(f"subagent {spec.id!r}: missing system_key and stage pack")
    parts = [require_prompt_pack(rules, key)]
    for block in catalog_blocks or []:
        b = str(block or "").strip()
        if b:
            parts.append(b)
    return "\n\n".join(parts)


async def run_subagent(
    *,
    agent_id: str,
    task: str,
    rules: dict[str, str] | None = None,
    profile: Any | None = None,
    images: list[str] | None = None,
    catalog_blocks: list[str] | None = None,
    schema: Any | None = None,
    model: str | None = None,
    metadata: dict[str, Any] | None = None,
    timeout: float = 90.0,
) -> SubAgentResult:
    """Run one forked sub-agent: fresh system+user only (no parent history)."""
    from app.services.design.runtime.agent_profile import get_active_agent_profile
    from app.services.llm import build_user_message_content
    from app.services.llm.agent import ainvoke_structured

    prof = profile or get_active_agent_profile()
    spec = prof.get_subagent(agent_id)
    if spec is None:
        return SubAgentResult(
            agent_id=str(agent_id),
            ok=False,
            error=f"unknown subagent {agent_id!r}",
        )
    if spec.isolation != "forked_context":
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error=f"subagent {spec.id!r} isolation {spec.isolation!r} is not forked",
            isolation=spec.isolation,
        )

    task_text = str(task or "").strip()
    if not task_text:
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error="empty task",
            isolation=spec.isolation,
        )

    stage = spec.stage or spec.id
    ask_mode = False
    if metadata and str(metadata.get("mode") or "") == "ask":
        ask_mode = True
    persona = str((metadata or {}).get("persona") or "")
    try:
        system = _assemble_subagent_system(
            spec=spec,
            rules=rules,
            profile=prof,
            ask_mode=ask_mode,
            persona=persona,
            catalog_blocks=catalog_blocks,
        )
    except Exception as err:
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error=f"subagent {spec.id!r}: system assemble failed: {err}"[:400],
            isolation=spec.isolation,
        )

    resolved_model = str(model or "").strip() or resolve_subagent_model(
        spec.model_ref, rules, fallback=""
    )
    if not resolved_model:
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error=f"subagent {spec.id!r}: model unresolved",
            isolation=spec.isolation,
        )

    use_schema = schema if schema is not None else _resolve_subagent_schema(
        spec, profile=prof
    )
    if use_schema is None:
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error=f"subagent {spec.id!r}: no contract schema",
            isolation=spec.isolation,
            model=resolved_model,
        )

    img_list = [
        str(u).strip()
        for u in (images or [])
        if str(u).strip().startswith(("data:image/", "http"))
    ][:4]
    user_content = build_user_message_content(task_text, img_list or None)
    # Child messages are ONLY this turn — never parent history.
    messages = [{"role": "user", "content": user_content}]

    meta = {
        "subagent": spec.id,
        "isolation": "forked_context",
        "stage": stage,
        **(dict(metadata or {})),
    }
    t0 = time.perf_counter()
    try:
        structured_out = await ainvoke_structured(
            schema=use_schema,
            messages=messages,
            model=resolved_model,
            system=system,
            source="design",
            run_name=f"subagent:{spec.id}",
            metadata=meta,
            tags=["design", "subagent", spec.id, "forked_context"],
            timeout=float(timeout),
            stream_chunk_timeout=min(45.0, float(timeout)),
        )
    except Exception as err:
        _log.exception("subagent_failed id=%s", spec.id)
        return SubAgentResult(
            agent_id=spec.id,
            ok=False,
            error=str(err)[:400],
            isolation=spec.isolation,
            model=resolved_model,
            duration_ms=max(0, int((time.perf_counter() - t0) * 1000)),
        )

    payload = structured_out.get("structured")
    if not isinstance(payload, dict):
        payload = {}
    duration_ms = max(0, int((time.perf_counter() - t0) * 1000))
    summary = str(payload.get("summary") or "").strip()[:400]
    return SubAgentResult(
        agent_id=spec.id,
        ok=True,
        summary=summary,
        payload=payload,
        model=resolved_model,
        duration_ms=duration_ms,
        isolation=spec.isolation,
    )


async def run_subagents_parallel(
    jobs: list[dict[str, Any]],
    *,
    rules: dict[str, str] | None = None,
    profile: Any | None = None,
) -> list[SubAgentResult]:
    """Spawn multiple forked sub-agents concurrently."""
    if not jobs:
        return []

    async def _one(job: dict[str, Any]) -> SubAgentResult:
        aid = str(job.get("id") or "").strip()
        spec = None
        if profile is not None:
            spec = profile.get_subagent(aid)
        if spec is not None and not spec.parallel_ok and len(jobs) > 1:
            return SubAgentResult(
                agent_id=aid,
                ok=False,
                error=f"subagent {aid!r} parallel_ok=false",
            )
        return await run_subagent(
            agent_id=aid,
            task=str(job.get("task") or ""),
            rules=rules,
            profile=profile,
            images=job.get("images"),
            catalog_blocks=job.get("catalog_blocks"),
            schema=job.get("schema"),
            model=job.get("model"),
            metadata=job.get("metadata"),
            timeout=float(job.get("timeout") or 90.0),
        )

    return list(await asyncio.gather(*[_one(j) for j in jobs]))


def clear_subagent_background_jobs() -> None:
    """Test helper — drop in-flight tracking (does not cancel running tasks)."""
    _BG_TASKS.clear()
    _BG_RESULTS.clear()


def _result_to_dict(res: SubAgentResult) -> dict[str, Any]:
    return {
        "agent_id": res.agent_id,
        "ok": bool(res.ok),
        "summary": res.summary,
        "payload": res.payload if isinstance(res.payload, dict) else {},
        "model": res.model,
        "duration_ms": int(res.duration_ms or 0),
        "error": res.error,
        "isolation": res.isolation,
        "job_id": res.job_id,
    }


def _result_from_dict(raw: dict[str, Any]) -> SubAgentResult:
    return SubAgentResult(
        agent_id=str(raw.get("agent_id") or ""),
        ok=bool(raw.get("ok")),
        summary=str(raw.get("summary") or ""),
        payload=raw.get("payload") if isinstance(raw.get("payload"), dict) else {},
        model=str(raw.get("model") or ""),
        duration_ms=int(raw.get("duration_ms") or 0),
        error=(str(raw.get("error")) if raw.get("error") else None),
        isolation=str(raw.get("isolation") or "forked_context"),
        job_id=(str(raw.get("job_id")) if raw.get("job_id") else None),
    )


def _bg_redis() -> Any | None:
    try:
        from app.core.config import settings

        url = str(getattr(settings, "redis_url", "") or "").strip()
        if not url:
            return None
        import redis

        return redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=0.4,
            socket_timeout=0.4,
        )
    except Exception:
        return None


def _persist_bg_result(job_id: str, res: SubAgentResult) -> None:
    """Best-effort Redis write so results survive API worker bounce."""
    key = str(job_id or "").strip()
    if not key:
        return
    r = _bg_redis()
    if r is None:
        return
    try:
        import json

        r.setex(
            f"{_BG_REDIS_PREFIX}{key}",
            _BG_REDIS_TTL_SEC,
            json.dumps(_result_to_dict(res), ensure_ascii=False),
        )
    except Exception:
        _log.debug("subagent_bg redis persist failed job=%s", key, exc_info=True)


def _load_bg_result(job_id: str) -> SubAgentResult | None:
    key = str(job_id or "").strip()
    if not key:
        return None
    r = _bg_redis()
    if r is None:
        return None
    try:
        import json

        raw = r.get(f"{_BG_REDIS_PREFIX}{key}")
        if not raw:
            return None
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        return _result_from_dict(data)
    except Exception:
        _log.debug("subagent_bg redis load failed job=%s", key, exc_info=True)
        return None


def get_subagent_job(job_id: str) -> SubAgentResult | None:
    """Return finished background result, or None if still running / unknown."""
    key = str(job_id or "").strip()
    if not key:
        return None
    got = _BG_RESULTS.get(key)
    if got is not None:
        return got
    loaded = _load_bg_result(key)
    if loaded is not None:
        _BG_RESULTS[key] = loaded
    return loaded


def spawn_subagent_background(
    *,
    agent_id: str,
    task: str,
    rules: dict[str, str] | None = None,
    profile: Any | None = None,
    images: list[str] | None = None,
    catalog_blocks: list[str] | None = None,
    schema: Any | None = None,
    model: str | None = None,
    metadata: dict[str, Any] | None = None,
    timeout: float = 90.0,
) -> str:
    """Fire-and-forget spawn; returns job_id. Result lands in get_subagent_job."""
    job_id = uuid.uuid4().hex[:12]

    async def _run() -> None:
        res = await run_subagent(
            agent_id=agent_id,
            task=task,
            rules=rules,
            profile=profile,
            images=images,
            catalog_blocks=catalog_blocks,
            schema=schema,
            model=model,
            metadata=metadata,
            timeout=timeout,
        )
        res.job_id = job_id
        _BG_RESULTS[job_id] = res
        _persist_bg_result(job_id, res)
        _BG_TASKS.pop(job_id, None)

    task_obj = asyncio.create_task(_run(), name=f"subagent-bg:{agent_id}:{job_id}")
    _BG_TASKS[job_id] = task_obj
    return job_id


async def harvest_background_jobs(job_ids: list[str]) -> list[SubAgentResult]:
    """Collect finished background results for the given job ids."""
    out: list[SubAgentResult] = []
    for jid in job_ids:
        key = str(jid or "").strip()
        if not key:
            continue
        # Await briefly if still running so decide can consume same-turn results.
        task = _BG_TASKS.get(key)
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=0.05)
            except (TimeoutError, asyncio.TimeoutError, Exception):
                pass
        got = get_subagent_job(key)
        if got is not None:
            out.append(got)
    return out
