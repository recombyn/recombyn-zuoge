"""Design-run episodes — P1 experience memory.

P1a: write only on canvas success; chat never inserts.
P1b: embed goal+summary; retrieve by cosine top_k (fallback recency).
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import AgentEpisode
from app.services.agent_memory.text_embed import (
    cosine,
    get_text_embeddings,
    pack_vec,
    retrieve_mode,
    schedule_background,
    unpack_vec,
)
from app.services.db import init_schema

logger = logging.getLogger(__name__)


def _col(row: Any, name: str, default: Any = None) -> Any:
    if hasattr(row, name):
        val = getattr(row, name)
        return default if val is None else val
    try:
        if name not in row.keys():
            return default
    except Exception:
        return default
    val = row[name]
    return default if val is None else val


def _rule_on(rules: dict[str, str] | None, key: str, default: str) -> bool:
    raw = ""
    if isinstance(rules, dict) and rules.get(key) is not None:
        raw = str(rules.get(key) or "")
    else:
        raw = default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _top_k(rules: dict[str, str] | None) -> int:
    try:
        raw = "3"
        if isinstance(rules, dict) and rules.get("memory.episode.top_k") is not None:
            raw = str(rules.get("memory.episode.top_k") or "3")
        return max(0, min(10, int(raw.strip() or "3")))
    except ValueError:
        return 3


def _summarize_actions(ops: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in ops or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        slim: dict[str, Any] = {"name": name[:64]}
        for key in ("id", "frameId", "targetId", "name"):
            val = item.get(key)
            if val is not None and str(val).strip():
                slim[key] = str(val)[:80]
        out.append(slim)
        if len(out) >= 40:
            break
    return out


def should_write_episode(
    *,
    chat_only: bool,
    tool_ops_applied: bool,
    rules: dict[str, str] | None = None,
    outcome: str = "success",
    has_reflexion_errors: bool = False,
) -> bool:
    """Hard gate: never store chitchat / reply-only turns.

    P1.1: also persist failed edit/create attempts (validation / reflect exhaust)
    so the next run can retrieve failure experience.
    """
    if not _rule_on(rules, "memory.episode.enabled", "1"):
        return False
    outcome_l = (outcome or "success").strip().lower()
    if outcome_l in ("failed", "error") and has_reflexion_errors and not chat_only:
        return _rule_on(rules, "memory.episode.write_failures", "1")
    if chat_only:
        return False
    if not tool_ops_applied:
        return False
    return True


def _embed_text_for_row(goal: str, summary: str) -> str:
    return f"{(goal or '').strip()}\n{(summary or '').strip()}".strip()[:480]


def embed_episode(episode_id: str) -> bool:
    """Encode goal+summary → emb blob. Returns True when ready."""
    eid = (episode_id or "").strip()
    if not eid:
        return False
    try:
        init_schema()
        with Session(engine) as session:
            row = crud.get_agent_episode(session=session, episode_id=eid)
            if not row:
                return False
            text = _embed_text_for_row(str(row.goal or ""), str(row.summary or ""))
            vec = get_text_embeddings().embed_query_raw(text)
            if vec is None:
                crud.update_agent_episode_embed(
                    session=session,
                    episode_id=eid,
                    embed_status="failed",
                    updated_at=time.time(),
                )
                return False
            from app.services.agent_memory.clip_encoder import EMB_DIM, MODEL_ID

            crud.update_agent_episode_embed(
                session=session,
                episode_id=eid,
                emb=pack_vec(vec),
                emb_dim=int(EMB_DIM),
                emb_model=MODEL_ID,
                embed_status="ready",
                updated_at=time.time(),
            )
        return True
    except Exception:
        logger.exception("embed_episode failed id=%s", eid)
        try:
            with Session(engine) as session:
                crud.update_agent_episode_embed(
                    session=session,
                    episode_id=eid,
                    embed_status="failed",
                    updated_at=time.time(),
                )
        except Exception:
            pass
        return False


def schedule_embed_episode(episode_id: str) -> None:
    eid = (episode_id or "").strip()
    if not eid:
        return
    schedule_background(f"ep-embed-{eid[:12]}", lambda: embed_episode(eid))


def maybe_write_episode(
    *,
    user_id: str,
    session_id: str = "",
    project_id: str = "",
    task_id: str = "",
    scene: str = "",
    goal: str,
    summary: str = "",
    applied_ops: list[Any] | None = None,
    observe: dict[str, Any] | None = None,
    outcome: str = "success",
    chat_only: bool = False,
    tool_ops_applied: bool = False,
    has_reflexion_errors: bool = False,
    rules: dict[str, str] | None = None,
) -> str | None:
    """
    Insert one episode on canvas success, or on failed edit/create (P1.1).
    Returns episode id or None when gated out / failed.
    """
    if not should_write_episode(
        chat_only=chat_only,
        tool_ops_applied=tool_ops_applied,
        rules=rules,
        outcome=outcome,
        has_reflexion_errors=has_reflexion_errors,
    ):
        return None

    uid = (user_id or "").strip()
    goal_t = (goal or "").strip()
    if not uid or not goal_t:
        return None

    # Skip tiny prompts (structural). Greeting detection is the intent LLM's job.
    if len(goal_t) < 4:
        return None

    actions = _summarize_actions(applied_ops)
    obs = observe if isinstance(observe, dict) else {}
    if "ops_count" not in obs:
        obs = {**obs, "ops_count": len(actions)}
    summary_t = (summary or "").strip() or goal_t[:200]
    outcome_t = (outcome or "success").strip().lower()[:16] or "success"
    eid = f"ep_{uuid.uuid4().hex[:18]}"
    now = time.time()

    try:
        init_schema()
        with Session(engine) as session:
            crud.insert_agent_episode(
                session=session,
                row=AgentEpisode(
                    id=eid,
                    user_id=uid,
                    session_id=(session_id or "")[:64],
                    project_id=(project_id or "")[:64],
                    task_id=(task_id or "")[:64],
                    scene=(scene or "")[:32],
                    goal=goal_t[:2000],
                    summary=summary_t[:2000],
                    actions_json=json.dumps(actions, ensure_ascii=False)[:8000],
                    observe_json=json.dumps(obs, ensure_ascii=False)[:4000],
                    outcome=outcome_t,
                    emb=None,
                    emb_dim=0,
                    emb_model="",
                    embed_status="pending",
                    status="active",
                    created_at=now,
                    updated_at=now,
                ),
            )
        logger.info(
            "[episode] wrote id=%s user=%s outcome=%s ops=%s",
            eid,
            uid[:12],
            outcome_t,
            len(actions),
        )
        schedule_embed_episode(eid)
        try:
            from app.services.agent_memory.kg import ingest_episode_graph

            n_kg = ingest_episode_graph(
                user_id=uid,
                scene=scene,
                goal=goal_t,
                summary=summary_t,
                actions=actions,
                outcome=outcome_t,
                rules=rules,
            )
            if n_kg:
                logger.info("[kg] ingested %s triples from episode %s", n_kg, eid)
        except Exception:
            logger.exception("kg ingest failed episode=%s", eid)
        return eid
    except Exception:
        logger.exception("maybe_write_episode failed")
        return None


def _row_to_hit(r: Any, *, retrieve: str, score: float | None = None) -> dict[str, Any]:
    goal = str(_col(r, "goal") or "").strip()
    summary = str(_col(r, "summary") or "").strip()
    actions: list[Any] = []
    try:
        raw = _col(r, "actions_json")
        parsed = json.loads(raw) if raw else []
        if isinstance(parsed, list):
            actions = parsed[:12]
    except Exception:
        actions = []
    op_names = [
        str(a.get("name") or "")
        for a in actions
        if isinstance(a, dict) and a.get("name")
    ]
    hit: dict[str, Any] = {
        "id": str(_col(r, "id") or ""),
        "scene": str(_col(r, "scene") or ""),
        "goal": goal[:300],
        "summary": summary[:300],
        "outcome": str(_col(r, "outcome") or "success"),
        "ops": op_names[:8],
        "created_at": float(_col(r, "created_at") or 0),
        "retrieve": retrieve,
    }
    if score is not None:
        hit["score"] = round(float(score), 4)
    return hit


def _list_recency(uid: str, k: int) -> list[dict[str, Any]]:
    with Session(engine) as session:
        rows = crud.list_agent_episodes_recent(
            session=session, user_id=uid, limit=k
        )
    return [
        _row_to_hit(r, retrieve="recency")
        for r in rows
        if str(_col(r, "goal") or "").strip() or str(_col(r, "summary") or "").strip()
    ]


def _list_by_embedding(uid: str, query: str, k: int) -> list[dict[str, Any]] | None:
    """Return ranked hits, or None to signal fallback to recency."""
    qvec = get_text_embeddings().embed_query_raw(query)
    if qvec is None:
        return None
    with Session(engine) as session:
        rows = crud.list_agent_episodes_recent(
            session=session, user_id=uid, limit=200
        )
    scored: list[tuple[float, Any]] = []
    pending_ids: list[str] = []
    for r in rows:
        status = str(_col(r, "embed_status") or "")
        vec = unpack_vec(_col(r, "emb")) if status == "ready" else None
        if vec is None:
            if status in ("pending", "", "failed"):
                pending_ids.append(str(_col(r, "id") or ""))
            continue
        scored.append((cosine(qvec, vec), r))
    # Opportunistically (re)embed a few pending rows without blocking retrieve.
    for pid in pending_ids[:3]:
        schedule_embed_episode(pid)
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    return [_row_to_hit(r, retrieve="embedding", score=sim) for sim, r in scored[:k]]


def list_recent_episodes(
    user_id: str,
    *,
    rules: dict[str, str] | None = None,
    query: str = "",
) -> list[dict[str, Any]]:
    """
    Retrieve active episodes: embedding top_k when possible, else recency.
    """
    if not _rule_on(rules, "memory.episode.enabled", "1"):
        return []
    k = _top_k(rules)
    if k <= 0:
        return []
    uid = (user_id or "").strip()
    if not uid:
        return []
    mode = retrieve_mode(rules, "memory.episode.retrieve", "embedding")
    try:
        init_schema()
        if mode == "embedding" and (query or "").strip():
            hits = _list_by_embedding(uid, query.strip(), k)
            if hits is not None:
                return hits
        return _list_recency(uid, k)
    except Exception:
        logger.exception("list_recent_episodes failed")
        return []


def format_episode_block(episodes: list[dict[str, Any]]) -> str:
    if not episodes:
        return ""
    lines = [
        "[Past design episodes]",
        "Use as soft prior (layout/ops habits). Prefer USER_PROMPT + current MATERIALS.",
    ]
    for i, ep in enumerate(episodes, start=1):
        bits = [
            f"{i}. [{ep.get('outcome') or '?'}]",
            f"goal={ep.get('goal') or ''}",
        ]
        if ep.get("scene"):
            bits.append(f"scene={ep['scene']}")
        if ep.get("summary") and ep.get("summary") != ep.get("goal"):
            bits.append(f"summary={ep['summary']}")
        if ep.get("score") is not None:
            bits.append(f"sim={ep['score']:.2f}")
        ops = ep.get("ops") or []
        if ops:
            bits.append("ops=" + ",".join(str(x) for x in ops[:8]))
        mode = ep.get("retrieve") or ""
        if mode:
            bits.append(f"via={mode}")
        lines.append(" | ".join(bits)[:500])
    return "\n".join(lines)
