"""Design Tournament (P35) — BasicLocal open floor.

Kernel path: Decide → IntelligenceClient.tournament → BasicLocal → here.

Community floor: multi-dim bracket (dim wins beat raw total) + user override.
Advanced ranking / private taste lives behind Remote → private Intelligence.

Unselected candidates never write user canvas.
"""
from __future__ import annotations

import re
from typing import Any

from app.services.design.runtime.graph.nodes.candidates import (
    apply_candidates_to_runtime,
)
from app.services.design.runtime.graph.state import (
    TOURNAMENT_DIMS,
    AgentRuntime,
    parse_design_candidate_set,
    parse_design_tournament,
    parse_tournament_dim_scores,
    tournament_dim_total,
    tournament_match_prefers,
)
from app.services.design.runtime.graph.emit_sse import _emit

# Label → base multi-dim profile (0–100). Lane character, not canvas paint.
_LABEL_BASE: dict[str, dict[str, float]] = {
    "Editorial": {
        "composition": 86,
        "typography": 90,
        "brand": 72,
        "originality": 78,
        "user_fit": 74,
        "technical": 70,
    },
    "Minimal Product": {
        "composition": 84,
        "typography": 72,
        "brand": 70,
        "originality": 76,
        "user_fit": 88,
        "technical": 90,
    },
    "Art Direction": {
        "composition": 88,
        "typography": 82,
        "brand": 86,
        "originality": 92,
        "user_fit": 68,
        "technical": 66,
    },
    "Experimental": {
        "composition": 74,
        "typography": 70,
        "brand": 64,
        "originality": 96,
        "user_fit": 58,
        "technical": 62,
    },
    "Brand-led": {
        "composition": 78,
        "typography": 80,
        "brand": 94,
        "originality": 70,
        "user_fit": 86,
        "technical": 78,
    },
}


def _clamp100(n: float) -> float:
    return float(max(0.0, min(100.0, n)))


def score_candidate_dimensions(
    candidate: dict[str, Any],
    *,
    research: dict[str, Any] | None = None,
) -> dict[str, float]:
    """Deterministic plan-level scores from Strategy axes + lane label."""
    label = str(candidate.get("label") or "").strip()
    base = dict(_LABEL_BASE.get(label) or {
        "composition": 70,
        "typography": 70,
        "brand": 70,
        "originality": 70,
        "user_fit": 70,
        "technical": 70,
    })
    strat = candidate.get("strategy") if isinstance(candidate.get("strategy"), dict) else {}
    text_blob = " ".join(
        str(strat.get(k) or "")
        for k in (
            "positioning",
            "visual_thesis",
            "differentiation",
            "composition_strategy",
            "typography_strategy",
            "imagery_strategy",
            "color_strategy",
            "interaction_strategy",
        )
    ).lower()
    anti = list(strat.get("anti_category_strategy") or [])
    anti_n = len([x for x in anti if str(x).strip()])

    if re.search(r"asymmetric|editorial|hero|focal|grid", text_blob):
        base["composition"] += 4
    if re.search(r"serif|type|typography|hierarchy", text_blob):
        base["typography"] += 4
    if re.search(r"brand|token|system", text_blob):
        base["brand"] += 4
    if anti_n >= 4 or re.search(r"avoid|anti|experimental|unexpected", text_blob):
        base["originality"] += 3 + min(6, anti_n)
    if re.search(r"product|cta|task|user|operator", text_blob):
        base["user_fit"] += 4
    if re.search(r"readable|restrained|quiet|system|metric", text_blob):
        base["technical"] += 4

    res = research if isinstance(research, dict) else {}
    if res.get("anti_category_strategy") or res.get("avoid"):
        base["originality"] += 2

    return parse_tournament_dim_scores({k: _clamp100(v) for k, v in base.items()})


def score_all_candidates(
    candidates: list[dict[str, Any]],
    *,
    research: dict[str, Any] | None = None,
) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for row in candidates:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("id") or "").strip()
        if not cid:
            continue
        out[cid] = score_candidate_dimensions(row, research=research)
    return out


def run_match(
    id_a: str,
    id_b: str,
    scores: dict[str, dict[str, float]],
    *,
    round_i: int,
) -> dict[str, Any]:
    """One bracket match. Dim wins decide — not raw total."""
    sa = scores.get(id_a) or {}
    sb = scores.get(id_b) or {}
    a_beats_b, dim_map, reason = tournament_match_prefers(sa, sb)
    winner = id_a if a_beats_b else id_b
    loser = id_b if a_beats_b else id_a
    # Remap dim_map keys to candidate ids for emit clarity
    named: dict[str, str] = {}
    for dim, who in dim_map.items():
        if who == "challenger":
            named[dim] = id_a
        elif who == "incumbent":
            named[dim] = id_b
        else:
            named[dim] = "tie"
    total_note = (
        f"totals {id_a}={tournament_dim_total(sa):.0f} "
        f"{id_b}={tournament_dim_total(sb):.0f}"
    )
    return {
        "round": round_i,
        "a": id_a,
        "b": id_b,
        "winner": winner,
        "loser": loser,
        "reason": f"{reason}; {total_note}",
        "dim_wins": named,
    }


def run_bracket(
    candidate_ids: list[str],
    scores: dict[str, dict[str, float]],
) -> list[dict[str, Any]]:
    """Elimination bracket. Odd count → bye advances."""
    ids = [str(x) for x in candidate_ids if str(x)]
    if len(ids) < 2:
        return []
    bracket: list[dict[str, Any]] = []
    round_i = 1
    living = list(ids)
    while len(living) > 1:
        nxt: list[str] = []
        i = 0
        while i < len(living):
            if i + 1 >= len(living):
                nxt.append(living[i])
                i += 1
                continue
            match = run_match(living[i], living[i + 1], scores, round_i=round_i)
            bracket.append(match)
            nxt.append(str(match["winner"]))
            i += 2
        living = nxt
        round_i += 1
    return bracket


def pick_podium(
    candidate_ids: list[str],
    scores: dict[str, dict[str, float]],
    bracket: list[dict[str, Any]],
) -> tuple[str, str, str]:
    """Winner from final; runner-up = final loser; alternative = best remaining."""
    ids = [str(x) for x in candidate_ids if str(x)]
    if not ids:
        return "", "", ""
    if len(ids) == 1:
        return ids[0], "", ""
    winner = ""
    runner = ""
    if bracket:
        final = bracket[-1]
        winner = str(final.get("winner") or "")
        runner = str(final.get("loser") or "")
    if not winner:
        # Fallback: multi-dim seed order (still not raw-total-only for ordering:
        # use dim-win sort vs first).
        winner = ids[0]
        for cid in ids[1:]:
            prefers, _, _ = tournament_match_prefers(scores.get(cid), scores.get(winner))
            if prefers:
                runner = winner
                winner = cid
    if not runner:
        rest = [c for c in ids if c != winner]
        runner = rest[0] if rest else ""
        for cid in rest[1:]:
            prefers, _, _ = tournament_match_prefers(scores.get(cid), scores.get(runner))
            if prefers:
                runner = cid
    remaining = [c for c in ids if c not in (winner, runner)]
    alt = ""
    if remaining:
        alt = remaining[0]
        for cid in remaining[1:]:
            prefers, _, _ = tournament_match_prefers(scores.get(cid), scores.get(alt))
            if prefers:
                alt = cid
    return winner, runner, alt


def run_design_tournament_pipeline(
    *,
    candidates_bundle: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    user_pick: str = "",
) -> dict[str, Any]:
    """Full tournament. Deterministic. Never paints."""
    bundle = parse_design_candidate_set(candidates_bundle or {})
    rows = [r for r in list(bundle.get("candidates") or []) if isinstance(r, dict)]
    ids = [str(r.get("id") or "") for r in rows if str(r.get("id") or "")]
    scores = score_all_candidates(rows, research=research)
    bracket = run_bracket(ids, scores)
    winner, runner, alt = pick_podium(ids, scores, bracket)
    pick = str(user_pick or "").strip()
    source = "bracket"
    if pick and pick in ids:
        # User override: previous winner becomes runner-up when displaced.
        if pick != winner:
            if winner and winner != pick:
                if runner == pick:
                    runner = winner
                elif not runner:
                    runner = winner
            winner = pick
            source = "user"
            if alt == winner:
                alt = ""
            if runner == winner:
                runner = next((c for c in ids if c != winner), "")
    summary = (
        f"Winner {winner} · Runner-up {runner} · Alternative {alt} ({source})"
    )
    return parse_design_tournament(
        {
            "winner_id": winner,
            "runner_up_id": runner,
            "alternative_id": alt,
            "scores": scores,
            "bracket": bracket,
            "user_pick": pick if source == "user" else "",
            "source": source,
            "summary": summary,
            "provider": "basic-local",
        }
    )


def should_run_design_tournament(rt: AgentRuntime) -> bool:
    intent = str(
        getattr(rt, "classified_intent", "") or ""
    ).strip().lower()
    if intent in ("chat", "ask"):
        return False
    bundle = getattr(rt, "design_candidates", None)
    return isinstance(bundle, dict) and bool(list(bundle.get("candidates") or []))


def apply_tournament_to_runtime(rt: AgentRuntime, result: dict[str, Any]) -> None:
    """Stash tournament; promote Winner as selected candidate (still no paint ops)."""
    clean = parse_design_tournament(result)
    rt.design_tournament = clean
    winner = str(clean.get("winner_id") or "").strip()
    if not winner:
        return
    bundle = getattr(rt, "design_candidates", None)
    if not isinstance(bundle, dict):
        return
    updated = parse_design_candidate_set(bundle)
    for row in list(updated.get("candidates") or []):
        if not isinstance(row, dict):
            continue
        row["selected"] = str(row.get("id") or "") == winner
    updated["primary_id"] = winner
    apply_candidates_to_runtime(rt, updated)


def format_tournament_for_decide(result: dict[str, Any] | None) -> str:
    src = result if isinstance(result, dict) else {}
    if not src.get("winner_id"):
        return ""
    lines = [
        "DESIGN_TOURNAMENT (host-owned). Multi-dim bracket — not raw total.",
        f"Winner: {src.get('winner_id')} · Runner-up: {src.get('runner_up_id')} · "
        f"Alternative: {src.get('alternative_id')} ({src.get('source') or 'bracket'})",
    ]
    scores = src.get("scores") if isinstance(src.get("scores"), dict) else {}
    wid = str(src.get("winner_id") or "")
    if wid and isinstance(scores.get(wid), dict):
        parts = [f"{d}={float(scores[wid].get(d) or 0):.0f}" for d in TOURNAMENT_DIMS]
        lines.append("Winner dims: " + ", ".join(parts))
    for match in list(src.get("bracket") or [])[:6]:
        if not isinstance(match, dict):
            continue
        lines.append(
            f"R{match.get('round')}: {match.get('a')} vs {match.get('b')} → "
            f"{match.get('winner')} ({match.get('reason')})"
        )
    lines.append("Unselected candidates must NOT write the user canvas.")
    return "\n".join(lines)[:1600]


async def run_design_tournament(rt: AgentRuntime) -> dict[str, Any] | None:
    """Execute tournament and promote Winner. Fail-open."""
    if not should_run_design_tournament(rt):
        return None
    st = rt.run
    _emit(
        {
            "type": "activity",
            "id": "design-tournament",
            "kind": "explored",
            "status": "running",
            "code": "design_tournament_running", "summary": "DESIGN_TOURNAMENT: multi-dim bracket → Winner",
        }
    )
    try:
        bundle = getattr(rt, "design_candidates", None)
        research = getattr(rt, "design_research", None)
        flags = rt.flags if isinstance(rt.flags, dict) else {}
        user_pick = str(flags.get("user_pick") or "").strip()
        result = run_design_tournament_pipeline(
            candidates_bundle=bundle if isinstance(bundle, dict) else None,
            research=research if isinstance(research, dict) else None,
            user_pick=user_pick,
        )
        apply_tournament_to_runtime(rt, result)
        st.push_log(
            phase="design_tournament",
            summary=str(result.get("summary") or "")[:160],
            winner=result.get("winner_id"),
            runner_up=result.get("runner_up_id"),
            source=result.get("source"),
        )
        _emit(
            {
                "type": "activity",
                "id": "design-tournament",
                "kind": "explored",
                "status": "done",
                "summary": (
                    f"DESIGN_TOURNAMENT: Winner {result.get('winner_id')} · "
                    f"RUp {result.get('runner_up_id')} · Alt {result.get('alternative_id')}"
                )[:200],
            }
        )
        _emit(
            {
                "type": "design_tournament",
                "winner_id": result.get("winner_id"),
                "runner_up_id": result.get("runner_up_id"),
                "alternative_id": result.get("alternative_id"),
                "source": result.get("source"),
                "bracket": list(result.get("bracket") or [])[:8],
                "summary": str(result.get("summary") or "")[:240],
            }
        )
        block = format_tournament_for_decide(result)
        if block:
            _emit({"type": "analysis_delta", "text": block[:1200], "visibility": "developer"})
        return result
    except Exception as err:  # noqa: BLE001
        st.note_error(f"design_tournament_failed: {err}"[:240])
        st.push_log(
            phase="design_tournament",
            error=str(err)[:200],
            summary="design tournament failed (Decide continues)",
        )
        _emit(
            {
                "type": "activity",
                "id": "design-tournament",
                "kind": "explored",
                "status": "done",
                "code": "design_tournament_skipped", "summary": "DESIGN_TOURNAMENT: skipped (failed)",
            }
        )
        return None
