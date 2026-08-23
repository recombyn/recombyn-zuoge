"""Lightweight knowledge graph (P3 / P25) — user-scoped SPO triples.

No graph DB: SQL triples only.
- Factual anchors from the episode (goal / ops / hex colors observed in text).
- Design chain after Review: Principle → Pattern → Context → Execution →
  Issue → Correction → Outcome (deterministic from Brief / Observe / Review).
- Semantic triples from Admin **skill** + **global rules** (same pattern as goal_critic).
  Do not hardcode style/mood vocab here — edit skill ``kg_extract`` or rule ``memory.kg.*``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema

logger = logging.getLogger(__name__)

_HEX = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
# Retrieval noise only (not product style rules).
_RETRIEVE_STOP = frozenset(
    {
        "的",
        "了",
        "和",
        "与",
        "the",
        "a",
        "an",
        "and",
        "for",
        "with",
        "to",
        "of",
    }
)

_KG_SKILL_KEY_FALLBACK = "kg_extract"
_DESIGN_CHAIN_PRED_FALLBACK = (
    "has_pattern|in_context|executed_as|had_issue|corrected_by|yielded_outcome"
)
DESIGN_CHAIN_PREDICATES = frozenset(
    p.strip() for p in _DESIGN_CHAIN_PRED_FALLBACK.split("|") if p.strip()
)
# P40 — transferable Principle hops (project-isolated; never brand copy).
_CROSS_PROJECT_PRED_FALLBACK = "abstracted_from|applies_in|correlates_with"
CROSS_PROJECT_PREDICATES = frozenset(
    p.strip() for p in _CROSS_PROJECT_PRED_FALLBACK.split("|") if p.strip()
)
_ALLOWED_PREDICATES_FALLBACK = (
    "has_goal|last_summary|uses_color|used_op|"
    "prefers_mood|prefers_layout|about|avoids|"
    + _DESIGN_CHAIN_PRED_FALLBACK
    + "|"
    + _CROSS_PROJECT_PRED_FALLBACK
)
_ARCHETYPE_AS_PRINCIPLE = {
    "center_hero": "single_focus",
    "single_focus": "single_focus",
    "left_text_right_visual": "split_focus",
    "editorial_split": "editorial",
    "full_bleed": "full_bleed",
}


def _rule_on(rules: dict[str, str] | None, key: str, default: str) -> bool:
    raw = default
    if isinstance(rules, dict) and rules.get(key) is not None:
        raw = str(rules.get(key) or default)
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _rule_text(rules: dict[str, str] | None, key: str, default: str = "") -> str:
    if isinstance(rules, dict) and rules.get(key) is not None:
        return str(rules.get(key) or default)
    return default


def enabled(rules: dict[str, str] | None) -> bool:
    return _rule_on(rules, "memory.kg.enabled", "1")


def _top_k(rules: dict[str, str] | None) -> int:
    try:
        raw = _rule_text(rules, "memory.kg.top_k", "8")
        return max(0, min(24, int(raw.strip() or "8")))
    except ValueError:
        return 8


def _max_triples(rules: dict[str, str] | None) -> int:
    try:
        raw = _rule_text(rules, "memory.kg.max_triples", "16")
        return max(1, min(32, int(raw.strip() or "16")))
    except ValueError:
        return 16


def _kg_skill_key(rules: dict[str, str] | None) -> str:
    return (
        _rule_text(rules, "memory.kg.skill_key", _KG_SKILL_KEY_FALLBACK).strip()
        or _KG_SKILL_KEY_FALLBACK
    )


def _allowed_predicates(rules: dict[str, str] | None) -> frozenset[str]:
    raw = _rule_text(rules, "memory.kg.predicates", _ALLOWED_PREDICATES_FALLBACK)
    parts = [p.strip() for p in raw.replace(",", "|").split("|") if p.strip()]
    base = (
        frozenset(parts)
        if parts
        else frozenset(
            p.strip() for p in _ALLOWED_PREDICATES_FALLBACK.split("|") if p.strip()
        )
    )
    return base | DESIGN_CHAIN_PREDICATES | CROSS_PROJECT_PREDICATES


def _norm_node(s: str, *, limit: int = 96) -> str:
    t = re.sub(r"\s+", " ", (s or "").strip())
    return t[:limit]


def _tokens(text: str) -> list[str]:
    """Query tokens for retrieve scoring (stopwords = noise, not design rules)."""
    raw = (text or "").lower()
    parts = re.findall(r"[\u4e00-\u9fff]{2,8}|[a-zA-Z][#a-zA-Z0-9_-]{2,24}", raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if p in _RETRIEVE_STOP or p in seen:
            continue
        seen.add(p)
        out.append(p)
        if len(out) >= 12:
            break
    return out


def upsert_triple(
    *,
    user_id: str,
    subject: str,
    predicate: str,
    obj: str,
    weight_delta: float = 1.0,
    source: str = "episode",
) -> str | None:
    uid = (user_id or "").strip()
    s = _norm_node(subject)
    p = _norm_node(predicate, limit=48)
    o = _norm_node(obj)
    if not uid or not s or not p or not o:
        return None
    now = time.time()
    try:
        init_schema()
        with Session(engine) as session:
            return crud.upsert_agent_kg_triple_weight(
                session=session,
                user_id=uid,
                subject=s,
                predicate=p,
                object_=o,
                weight_delta=weight_delta,
                source=source or "episode",
                now=now,
            )
    except Exception:
        logger.exception("upsert_triple failed")
        return None


def extract_factual_triples_from_episode(
    *,
    scene: str,
    goal: str,
    summary: str = "",
    actions: list[Any] | None = None,
    outcome: str = "success",
) -> list[tuple[str, str, str]]:
    """Episode facts only — no style/mood vocab. Semantic tags come from skill LLM."""
    if (outcome or "").strip().lower() not in ("success", "partial", "ok", ""):
        return []
    sc = (scene or "").strip().lower() or ""
    goal_t = (goal or "").strip()
    summary_t = (summary or "").strip()
    triples: list[tuple[str, str, str]] = []

    triples.append((f"scene:{sc}", "has_goal", goal_t[:120] or summary_t[:120]))
    if summary_t and summary_t != goal_t:
        triples.append((f"scene:{sc}", "last_summary", summary_t[:120]))

    # Observed hex literals in user text / summary (data, not a style dictionary).
    for hex_c in _HEX.findall(f"{goal_t} {summary_t}")[:4]:
        triples.append((f"scene:{sc}", "uses_color", hex_c.upper()))

    op_names: list[str] = []
    for a in actions or []:
        if isinstance(a, dict):
            name = str(a.get("name") or "").strip()
            if name:
                op_names.append(name)
        elif isinstance(a, str) and a.strip():
            op_names.append(a.strip())
    for name in op_names[:8]:
        triples.append((f"scene:{sc}", "used_op", name[:64]))

    return _dedupe_triples(triples)[:24]


def _dedupe_triples(
    triples: list[tuple[str, str, str]],
) -> list[tuple[str, str, str]]:
    seen: set[tuple[str, str, str]] = set()
    out: list[tuple[str, str, str]] = []
    for t in triples:
        key = (t[0], t[1], t[2])
        if key in seen or not t[2]:
            continue
        seen.add(key)
        out.append(t)
    return out


def _coverage_label(raw: Any, key: str = "hero_coverage") -> str | None:
    """0.42 / 42 / '70%' → 'hero_coverage:42%'. Structured facts, not mood vocab."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        n = float(raw)
        pct = int(round(n * 100.0)) if 0.0 <= n <= 1.0 else int(round(n))
        return f"{key}:{pct}%"
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("%"):
        num = text[:-1].strip()
        try:
            return f"{key}:{int(round(float(num)))}%"
        except ValueError:
            return f"{key}:{_norm_node(text, limit=32)}"
    try:
        n = float(text)
        pct = int(round(n * 100.0)) if 0.0 <= n <= 1.0 else int(round(n))
        return f"{key}:{pct}%"
    except ValueError:
        return f"{key}:{_norm_node(text, limit=32)}"


def _principle_from_brief(brief: dict[str, Any] | None) -> str | None:
    if not isinstance(brief, dict):
        return None
    comp = brief.get("composition")
    if not isinstance(comp, dict):
        return None
    arch = str(comp.get("archetype") or "").strip().lower()
    if not arch:
        return None
    return _ARCHETYPE_AS_PRINCIPLE.get(arch, arch)


def _pattern_from_brief(brief: dict[str, Any] | None) -> str | None:
    if not isinstance(brief, dict):
        return None
    comp = brief.get("composition")
    rules = comp.get("rules") if isinstance(comp, dict) else None
    if isinstance(rules, dict) and rules.get("hero_coverage") is not None:
        return _coverage_label(rules.get("hero_coverage"))
    return None


def _context_from_inputs(
    *,
    skills: list[str] | None,
    scene: str,
    brief: dict[str, Any] | None,
) -> str | None:
    purpose = ""
    if isinstance(brief, dict):
        purpose = str(brief.get("purpose") or "")
    blob = " ".join([*(str(s) for s in (skills or [])), scene or "", purpose]).lower()
    if "poster" in blob or "海报" in blob:
        return "poster"
    if "banner" in blob or "横幅" in blob:
        return "banner"
    sc = (scene or "").strip().lower()
    if sc:
        return _norm_node(sc, limit=32)
    for sk in skills or []:
        key = str(sk or "").strip()
        if key:
            return _norm_node(key, limit=32)
    return None


def _execution_from_observe(observe_facts: dict[str, Any] | None) -> str | None:
    if not isinstance(observe_facts, dict):
        return None
    if observe_facts.get("hero_coverage") is not None:
        return _coverage_label(observe_facts.get("hero_coverage"))
    return None


def _issue_from_review(
    review: dict[str, Any] | None,
    observe_facts: dict[str, Any] | None,
) -> str | None:
    src = review if isinstance(review, dict) else {}
    issues = src.get("issues")
    if isinstance(issues, list):
        for item in issues:
            text = str(item).strip()
            if text:
                return _norm_node(text, limit=80)
    summary = str(src.get("summary") or "").strip()
    action = str(src.get("action") or "").strip().lower()
    must_fix = bool(src.get("must_fix"))
    if must_fix or action in ("repair", "rebuild"):
        if summary and summary.lower() not in ("ok", "pass"):
            return _norm_node(summary, limit=80)
        return action or None
    facts = observe_facts if isinstance(observe_facts, dict) else {}
    obs_issues = facts.get("issues")
    if isinstance(obs_issues, list):
        for item in obs_issues:
            text = str(item).strip()
            if text:
                return _norm_node(text, limit=80)
    return None


def _correction_from_review(
    review: dict[str, Any] | None,
    flags: dict[str, Any] | None,
) -> str | None:
    src = review if isinstance(review, dict) else {}
    flag = flags if isinstance(flags, dict) else {}
    explicit = src.get("correction")
    if explicit is not None and str(explicit).strip():
        return _norm_node(str(explicit), limit=64)
    acts = src.get("subtraction_actions")
    if isinstance(acts, list):
        for item in acts:
            text = str(item).strip()
            if text:
                return _norm_node(text, limit=64)
    if flag.get("polish"):
        return "reduce_secondary"
    action = str(src.get("action") or "").strip().lower()
    if action == "rebuild":
        return "rebuild"
    if action == "repair":
        return "repair"
    return None


def _outcome_from_review(
    review: dict[str, Any] | None,
    prev_review: dict[str, Any] | None,
) -> str | None:
    src = review if isinstance(review, dict) else {}
    if src.get("total") is None:
        return None
    try:
        curr = int(src.get("total"))
    except (TypeError, ValueError):
        return None
    prev_src = prev_review if isinstance(prev_review, dict) else {}
    if prev_src.get("total") is None:
        return str(curr)
    try:
        prev = int(prev_src.get("total"))
    except (TypeError, ValueError):
        return str(curr)
    if prev == curr:
        return str(curr)
    return f"{prev}→{curr}"


def extract_design_chain_triples(
    *,
    brief: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    review: dict[str, Any] | None = None,
    scene: str = "",
    skills: list[str] | None = None,
    prev_review: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> list[tuple[str, str, str]]:
    """Principle → Pattern → Context → Execution → Issue → Correction → Outcome.

    Missing hops are skipped. Does not invent Brief / Review / DNA.
    """
    if not isinstance(brief, dict):
        brief = None
    if not isinstance(observe_facts, dict):
        observe_facts = None
    if not isinstance(review, dict):
        review = None
    if not brief and not review and not observe_facts:
        return []

    principle = _principle_from_brief(brief)
    pattern = _pattern_from_brief(brief)
    context = _context_from_inputs(skills=skills, scene=scene, brief=brief)
    execution = _execution_from_observe(observe_facts)
    issue = _issue_from_review(review, observe_facts)
    correction = _correction_from_review(review, flags)
    outcome = _outcome_from_review(review, prev_review)

    triples: list[tuple[str, str, str]] = []
    if principle and pattern:
        triples.append((f"principle:{principle}", "has_pattern", pattern))
    if pattern and context:
        triples.append((f"pattern:{pattern}", "in_context", context))
    if context and execution:
        triples.append((f"context:{context}", "executed_as", execution))
    elif pattern and execution:
        triples.append((f"pattern:{pattern}", "executed_as", execution))
    if execution and issue:
        triples.append((f"execution:{execution}", "had_issue", issue))
    if issue and correction:
        triples.append((f"issue:{issue}", "corrected_by", correction))
    if correction and outcome:
        triples.append((f"correction:{correction}", "yielded_outcome", outcome))
    elif execution and outcome:
        triples.append((f"execution:{execution}", "yielded_outcome", outcome))
    return _dedupe_triples(triples)


def record_design_chain(
    *,
    user_id: str,
    brief: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    review: dict[str, Any] | None = None,
    scene: str = "",
    skills: list[str] | None = None,
    painted: bool = False,
    prev_review: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
    rules: dict[str, str] | None = None,
) -> int:
    """Upsert design-chain triples after Review. Fail-open. Never writes SceneDocument."""
    if not enabled(rules):
        return 0
    uid = (user_id or "").strip()
    if not uid:
        return 0
    if not painted and not isinstance(review, dict) and not isinstance(brief, dict):
        return 0
    triples = extract_design_chain_triples(
        brief=brief,
        observe_facts=observe_facts,
        review=review,
        scene=scene,
        skills=skills,
        prev_review=prev_review,
        flags=flags,
    )
    n = 0
    for s, p, o in triples:
        if upsert_triple(
            user_id=uid,
            subject=s,
            predicate=p,
            obj=o,
            weight_delta=1.0,
            source="design_chain",
        ):
            n += 1
    return n


def score_triple_for_retrieve(
    *,
    subject: str,
    predicate: str,
    obj: str,
    weight: float = 1.0,
    scene: str = "",
    tokens: list[str] | None = None,
    source: str = "",
) -> float:
    """1-hop score. Design-chain hops are boosted for Decide retrieve."""
    score = float(weight or 1.0)
    sc = (scene or "").strip().lower()
    subj = subject or ""
    pred = predicate or ""
    if sc and subj == f"scene:{sc}":
        score += 5.0
    elif sc and subj.startswith("scene:"):
        score += 0.5
    blob = f"{subj} {pred} {obj}".lower()
    for tok in tokens or []:
        if tok and tok in blob:
            score += 1.2
    if pred in DESIGN_CHAIN_PREDICATES:
        score += 2.0
    if pred == "yielded_outcome":
        score += 1.0
    if (source or "").strip() == "design_chain":
        score += 1.5
    return score


def _skill_by_key(skill_key: str) -> dict[str, Any] | None:
    key = (skill_key or "").strip().lower()
    if not key:
        return None
    try:
        from app.services.design.readpath.catalog import list_skills

        for sk in list_skills():
            if str(sk.get("skill_key") or "").strip().lower() == key:
                return sk
    except Exception:
        logger.exception("list_skills for kg failed")
    return None


def _parse_triples_json(
    content: str,
    *,
    scene: str,
    allowed: frozenset[str],
    limit: int,
) -> list[tuple[str, str, str]]:
    text = (content or "").strip()
    if not text:
        return []
    brace = text.find("{")
    bracket = text.find("[")
    raw: Any = None
    if brace >= 0 and (bracket < 0 or brace < bracket):
        try:
            raw = json.loads(text[brace : text.rfind("}") + 1])
        except Exception:
            raw = None
    if raw is None and bracket >= 0:
        try:
            raw = json.loads(text[bracket : text.rfind("]") + 1])
        except Exception:
            raw = None
    items: list[Any] = []
    if isinstance(raw, dict):
        items = raw.get("triples") or []
    sc = (scene or "").strip().lower() or ""
    out: list[tuple[str, str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        s = str(it.get("s") or "").strip()
        p = str(it.get("p") or "").strip()
        o = str(it.get("o") or "").strip()
        if not p or not o:
            continue
        if p not in allowed:
            continue
        if not s:
            s = f"scene:{sc}"
        out.append((s[:128], p[:64], o[:200]))
        if len(out) >= limit:
            break
    return _dedupe_triples(out)


async def extract_triples_via_skill(
    *,
    scene: str,
    goal: str,
    summary: str = "",
    actions: list[Any] | None = None,
    rules: dict[str, str] | None = None,
    model_family: str = "auto",
) -> list[tuple[str, str, str]]:
    """LLM SPO extract — prompt from Admin skill / memory.kg.system rule."""
    skill_key = _kg_skill_key(rules)
    skill = _skill_by_key(skill_key)
    system = ""
    extract_model = model_family
    if skill:
        system = str(skill.get("prompt_positive") or "").strip()
        neg = str(skill.get("prompt_negative") or "").strip()
        if neg:
            system = f"{system}\n\nAvoid:\n{neg}"
        if str(skill.get("default_model") or "").strip():
            extract_model = str(skill.get("default_model")).strip()
    if not system:
        system = _rule_text(rules, "memory.kg.system").strip()
    if not system:
        logger.info("kg extract skipped: empty skill `%s` and memory.kg.system", skill_key)
        return []

    try:
        max_tokens = int(_rule_text(rules, "memory.kg.max_tokens", "512").strip() or "512")
    except ValueError:
        max_tokens = 512
    max_tokens = max(128, min(2048, max_tokens))
    limit = _max_triples(rules)
    allowed = _allowed_predicates(rules)

    try:
        ops_raw = json.dumps(actions or [], ensure_ascii=False)[:3000]
    except Exception:
        ops_raw = "[]"
    pred_hint = "|".join(sorted(allowed))
    user = (
        f"SCENE: {(scene or '').strip() or ""}\n\n"
        f"USER_GOAL:\n{(goal or '')[:2000]}\n\n"
        f"SUMMARY:\n{(summary or '')[:2000]}\n\n"
        f"OPS:\n{ops_raw}\n\n"
        f"Allowed predicates: {pred_hint}\n"
        'Return JSON: {"triples":[{"s":"scene:...","p":"...","o":"..."}]}'
    )
    try:
        from app.services.design.runtime.llm_step import complete_skill_step

        out, _tokens_used = await complete_skill_step(
            model_family=extract_model,
            system=system,
            user=user,
            max_tokens=max_tokens,
            rules=rules if isinstance(rules, dict) else None,
        )
    except Exception:
        logger.exception("kg skill extract failed")
        return []
    return _parse_triples_json(out or "", scene=scene, allowed=allowed, limit=limit)


def _run_async(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Already in a loop (unlikely in background thread) — use a fresh loop.
    return asyncio.run(coro)


def enrich_episode_graph_llm(
    *,
    user_id: str,
    scene: str,
    goal: str,
    summary: str = "",
    actions: list[Any] | None = None,
    rules: dict[str, str] | None = None,
    model_family: str = "auto",
) -> int:
    """Sync wrapper for background thread: skill-based triples → upsert."""
    if not enabled(rules):
        return 0
    triples = _run_async(
        extract_triples_via_skill(
            scene=scene,
            goal=goal,
            summary=summary,
            actions=actions,
            rules=rules,
            model_family=model_family,
        )
    )
    n = 0
    for s, p, o in triples or []:
        if upsert_triple(
            user_id=user_id,
            subject=s,
            predicate=p,
            obj=o,
            weight_delta=1.0,
            source="kg_skill",
        ):
            n += 1
    return n


def schedule_kg_skill_enrich(
    *,
    user_id: str,
    scene: str,
    goal: str,
    summary: str = "",
    actions: list[Any] | None = None,
    rules: dict[str, str] | None = None,
    model_family: str = "auto",
) -> None:
    if not enabled(rules):
        return
    if not _rule_on(rules, "memory.kg.llm_extract", "1"):
        return
    uid = (user_id or "").strip()
    if not uid:
        return
    actions_copy = list(actions or [])
    rules_copy = dict(rules) if isinstance(rules, dict) else None

    def _job() -> None:
        n = enrich_episode_graph_llm(
            user_id=uid,
            scene=scene,
            goal=goal,
            summary=summary,
            actions=actions_copy,
            rules=rules_copy,
            model_family=model_family,
        )
        if n:
            logger.info("[kg] skill enrich wrote %s triples user=%s", n, uid[:12])

    from app.services.agent_memory.text_embed import schedule_background

    schedule_background(f"kg-enrich-{uid[:8]}-{int(time.time()) % 100000}", _job)


def ingest_episode_graph(
    *,
    user_id: str,
    scene: str,
    goal: str,
    summary: str = "",
    actions: list[Any] | None = None,
    outcome: str = "success",
    rules: dict[str, str] | None = None,
    model_family: str = "auto",
) -> int:
    """Write factual triples now; schedule skill LLM enrich in background."""
    if not enabled(rules):
        return 0
    n = 0
    for s, p, o in extract_factual_triples_from_episode(
        scene=scene,
        goal=goal,
        summary=summary,
        actions=actions,
        outcome=outcome,
    ):
        if upsert_triple(
            user_id=user_id,
            subject=s,
            predicate=p,
            obj=o,
            weight_delta=1.0,
            source="episode",
        ):
            n += 1
    schedule_kg_skill_enrich(
        user_id=user_id,
        scene=scene,
        goal=goal,
        summary=summary,
        actions=actions,
        rules=rules,
        model_family=model_family,
    )
    return n


def retrieve_triples(
    user_id: str,
    *,
    query: str = "",
    scene: str = "",
    rules: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """1-hop retrieve: prefer scene:* subject, then keyword match on S/O."""
    if not enabled(rules):
        return []
    k = _top_k(rules)
    if k <= 0:
        return []
    uid = (user_id or "").strip()
    if not uid:
        return []
    sc = (scene or "").strip().lower()
    toks = _tokens(query)
    try:
        init_schema()
        with Session(engine) as session:
            rows = crud.list_agent_kg_triples_for_retrieve(
                session=session, user_id=uid, limit=300
            )
    except Exception:
        logger.exception("retrieve_triples failed")
        return []

    scored: list[tuple[float, dict[str, Any]]] = []
    for r in rows:
        subj = str(r.subject or "")
        pred = str(r.predicate or "")
        obj = str(r.object or "")
        w = float(r.weight or 1.0)
        src = str(getattr(r, "source", "") or "")
        score = score_triple_for_retrieve(
            subject=subj,
            predicate=pred,
            obj=obj,
            weight=w,
            scene=sc,
            tokens=toks,
            source=src,
        )
        scored.append(
            (
                score,
                {
                    "s": subj,
                    "p": pred,
                    "o": obj,
                    "weight": round(w, 2),
                    "score": round(score, 2),
                    "source": src,
                },
            )
        )
    scored.sort(key=lambda x: -x[0])
    out: list[dict[str, Any]] = []
    seen_key: set[str] = set()
    for _sc, hit in scored:
        key = f"{hit['s']}|{hit['p']}|{hit['o']}"
        if key in seen_key:
            continue
        pred_count = sum(1 for h in out if h["p"] == hit["p"])
        if pred_count >= 3:
            continue
        seen_key.add(key)
        out.append(hit)
        if len(out) >= k:
            break
    return out


def list_triples_admin(
    *,
    user_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Admin inspection of SPO rows."""
    lim = max(1, min(500, int(limit or 100)))
    off = max(0, int(offset or 0))
    uid = (user_id or "").strip() or None
    try:
        init_schema()
        with Session(engine) as session:
            total = crud.count_agent_kg_triples_active(session=session, user_id=uid)
            rows = crud.list_agent_kg_triples_admin(
                session=session, user_id=uid, limit=lim, offset=off
            )
    except Exception:
        logger.exception("list_triples_admin failed")
        return {"items": [], "total": 0}
    items = [
        {
            "id": str(r.id),
            "userId": str(r.user_id),
            "s": str(r.subject),
            "p": str(r.predicate),
            "o": str(r.object),
            "weight": float(r.weight or 1),
            "source": str(r.source or ""),
            "status": str(r.status or ""),
            "createdAt": float(r.created_at or 0),
            "updatedAt": float(r.updated_at or 0),
        }
        for r in rows
    ]
    return {"items": items, "total": total}


def soft_delete_triple(triple_id: str) -> bool:
    tid = (triple_id or "").strip()
    if not tid:
        return False
    try:
        init_schema()
        with Session(engine) as session:
            return crud.soft_delete_agent_kg_triple(
                session=session, triple_id=tid, updated_at=time.time()
            )
    except Exception:
        logger.exception("soft_delete_triple failed")
        return False


def format_kg_block(triples: list[dict[str, Any]]) -> str:
    if not triples:
        return ""
    chain = [
        t
        for t in triples
        if str(t.get("p") or "") in DESIGN_CHAIN_PREDICATES
    ]
    cross = [
        t
        for t in triples
        if str(t.get("p") or "") in CROSS_PROJECT_PREDICATES
    ]
    other = [
        t
        for t in triples
        if str(t.get("p") or "") not in DESIGN_CHAIN_PREDICATES
        and str(t.get("p") or "") not in CROSS_PROJECT_PREDICATES
    ]
    lines = ["[Knowledge graph]"]
    if chain:
        lines.append(
            "Design chain: Principle → Pattern → Context → Execution → "
            "Issue → Correction → Outcome."
        )
        for i, t in enumerate(chain, start=1):
            lines.append(
                f"{i}. ({t.get('s')}) -[{t.get('p')}]-> ({t.get('o')})"
                f"  w={t.get('weight', 1)}"
            )
    if cross:
        lines.append(
            "Cross-project Principles (transferable; never brand/client copy)."
        )
        start = len(chain) + 1
        for i, t in enumerate(cross, start=start):
            lines.append(
                f"{i}. ({t.get('s')}) -[{t.get('p')}]-> ({t.get('o')})"
                f"  w={t.get('weight', 1)}"
            )
    if other:
        if chain or cross:
            lines.append("Other priors (S-P-O). Prefer USER_PROMPT + MATERIALS.")
        else:
            lines.append(
                "Soft priors from past successful runs (S-P-O). Prefer USER_PROMPT + MATERIALS."
            )
        start = len(chain) + len(cross) + 1
        for i, t in enumerate(other, start=start):
            lines.append(
                f"{i}. ({t.get('s')}) -[{t.get('p')}]-> ({t.get('o')})"
                f"  w={t.get('weight', 1)}"
            )
    return "\n".join(lines)


# ── P40 Cross-project Principle (transferable; project-isolated) ────────────
# Migrate Principle, never 「客户爱 120px 标题」 / brand hex / client copy.

_PROJECT_SPECIFIC_RX = re.compile(
    r"(?:"
    r"\b\d{2,4}\s*px\b|"
    r"客户喜欢|这个客户|this client|client prefers|"
    r"brand\s*color|品牌色|logo\s*url|"
    r"#[0-9a-fA-F]{3,8}\b|"
    r"font[-_]?family\s*[:=]"
    r")",
    re.I,
)

_TYPE_CONTRAST_RX = re.compile(
    r"大标题|大字|typography\s*contrast|high\s*type|large\s*title|display\s*type",
    re.I,
)
_NEG_SPACE_RX = re.compile(
    r"大留白|留白|negative[-\s]?space|whitespace|empty\s*space",
    re.I,
)
_EDITORIAL_RX = re.compile(r"editorial|编辑|杂志感", re.I)


def is_project_specific_memory(text: str) -> bool:
    """True when the note is client/brand concrete — must NOT transfer."""
    return bool(_PROJECT_SPECIFIC_RX.search(str(text or "")))


def abstract_outcome_to_principle(
    *,
    evidence: str,
    composition_class: str = "editorial",
    signals: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Abstract project outcome → transferable Design Principle.

    Spec: 「大标题 + 大留白」→ Editorial + typography contrast ↔ negative-space.
    Reject: 「这个客户喜欢 120px 标题」.
    """
    raw = str(evidence or "").strip()
    if not raw:
        return None
    if is_project_specific_memory(raw):
        return {
            "ok": False,
            "reason": "project_specific",
            "principle": "",
            "rejected": raw[:200],
        }
    sig = signals if isinstance(signals, dict) else {}
    has_type = bool(_TYPE_CONTRAST_RX.search(raw)) or bool(sig.get("typography_contrast"))
    has_space = bool(_NEG_SPACE_RX.search(raw)) or bool(sig.get("negative_space"))
    comp = str(
        composition_class
        or sig.get("composition_class")
        or ("editorial" if _EDITORIAL_RX.search(raw) else "")
        or "editorial"
    ).strip().lower() or "editorial"
    if not (has_type and has_space):
        # Allow explicit signal-only path.
        if not (sig.get("typography_contrast") and sig.get("negative_space")):
            return {
                "ok": False,
                "reason": "insufficient_signals",
                "principle": "",
                "rejected": raw[:200],
            }
        has_type = True
        has_space = True
    principle = (
        f"In {comp.capitalize()} composition, high typography contrast "
        f"correlates with high negative-space ratio."
    )
    return {
        "ok": True,
        "reason": "abstracted",
        "principle": principle,
        "composition_class": comp,
        "factors": ["typography_contrast", "negative_space_ratio"],
        "source_evidence": raw[:240],
        "rejected": "",
    }


def extract_cross_project_principle(
    *,
    project_id: str,
    evidence: str,
    composition_class: str = "editorial",
    signals: dict[str, Any] | None = None,
    outcome_score: float | int | None = None,
) -> dict[str, Any]:
    """Project A outcome → Principle node (still project-tagged for provenance)."""
    abstracted = abstract_outcome_to_principle(
        evidence=evidence,
        composition_class=composition_class,
        signals=signals,
    )
    pid = str(project_id or "").strip() or "unknown"
    if not abstracted or not abstracted.get("ok"):
        return {
            "ok": False,
            "reason": (abstracted or {}).get("reason") or "abstract_failed",
            "project_id": pid,
            "principle": "",
            "triples": [],
        }
    text = str(abstracted.get("principle") or "")
    node = f"principle:{_norm_node(text, limit=120)}"
    triples = [
        (node, "abstracted_from", f"project:{_norm_node(pid, limit=40)}"),
        (
            node,
            "correlates_with",
            "typography_contrast+negative_space_ratio",
        ),
    ]
    return {
        "ok": True,
        "reason": "ok",
        "project_id": pid,
        "principle": text,
        "principle_node": node,
        "composition_class": abstracted.get("composition_class"),
        "factors": list(abstracted.get("factors") or []),
        "outcome_score": outcome_score,
        "triples": triples,
        "transferable": True,
    }


def migrate_principle_across_projects(
    principle: dict[str, Any] | None,
    *,
    to_project: str,
    strip_brand: bool = True,
) -> dict[str, Any]:
    """Apply Principle to Project B. Never copies brand colors / px / client taste."""
    src = principle if isinstance(principle, dict) else {}
    text = str(src.get("principle") or "").strip()
    to_pid = str(to_project or "").strip()
    if not text or not to_pid:
        return {"ok": False, "reason": "missing_principle_or_project", "triples": []}
    if strip_brand and is_project_specific_memory(text):
        return {"ok": False, "reason": "principle_still_project_specific", "triples": []}
    # Drop any accidental brand fields from the payload.
    clean = {
        "principle": text,
        "composition_class": src.get("composition_class") or "editorial",
        "factors": list(src.get("factors") or []),
        "from_project": src.get("project_id") or "",
        "to_project": to_pid,
        "brand": None,
        "client_pref": None,
        "colors": [],
        "font_px": None,
    }
    node = str(src.get("principle_node") or f"principle:{_norm_node(text, limit=120)}")
    triples = [
        (node, "applies_in", f"project:{_norm_node(to_pid, limit=40)}"),
    ]
    from_pid = str(src.get("project_id") or "").strip()
    if from_pid and from_pid != to_pid:
        triples.append(
            (node, "abstracted_from", f"project:{_norm_node(from_pid, limit=40)}")
        )
    return {
        "ok": True,
        "reason": "migrated",
        "principle": text,
        "principle_node": node,
        "to_project": to_pid,
        "payload": clean,
        "triples": _dedupe_triples(triples),
    }


def cross_project_transferables(
    principles: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Filter list to transferable Principles only."""
    out: list[dict[str, Any]] = []
    for row in list(principles or []):
        if not isinstance(row, dict):
            continue
        text = str(row.get("principle") or "")
        if not text or is_project_specific_memory(text):
            continue
        if row.get("transferable") is False:
            continue
        if row.get("ok") is False:
            continue
        out.append(row)
    return out
