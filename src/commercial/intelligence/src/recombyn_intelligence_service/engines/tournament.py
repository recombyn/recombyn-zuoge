"""Design tournament (private). Never paints.

Diff vs BasicLocal:
- niche / category rubric weights (optional override from private-eval/rubrics/)
- paint_checks alignment boosts
- weighted dim-wins for bracket matches
- private_signals + rubric_id on the result
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from recombyn_intelligence_service.engines._schemas import (
    TOURNAMENT_DIMS,
    parse_design_candidate_set,
    parse_design_tournament,
    parse_tournament_dim_scores,
    tournament_dim_total,
    tournament_match_prefers,
)
from recombyn_intelligence_service.engines.research import _detect_niches

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

# Tournament-dim weights (not strategy axis weights). Higher = harder to lose that dim.
_DEFAULT_RUBRIC: dict[str, float] = {d: 1.0 for d in TOURNAMENT_DIMS}

_NICHE_RUBRICS: dict[str, dict[str, float]] = {
    "seasonal_event": {
        "composition": 1.40,
        "typography": 1.20,
        "brand": 0.90,
        "originality": 1.25,
        "user_fit": 0.85,
        "technical": 0.80,
    },
    "auth_ui": {
        "composition": 1.20,
        "typography": 1.05,
        "brand": 0.95,
        "originality": 0.90,
        "user_fit": 1.35,
        "technical": 1.25,
    },
    "type_specimen": {
        "composition": 1.10,
        "typography": 1.55,
        "brand": 1.05,
        "originality": 1.15,
        "user_fit": 0.80,
        "technical": 0.95,
    },
    "ecommerce": {
        "composition": 1.15,
        "typography": 1.00,
        "brand": 1.20,
        "originality": 0.95,
        "user_fit": 1.30,
        "technical": 1.10,
    },
}

_CATEGORY_RUBRICS: dict[str, dict[str, float]] = {
    "poster": {
        "composition": 1.35,
        "typography": 1.20,
        "brand": 0.95,
        "originality": 1.15,
        "user_fit": 0.85,
        "technical": 0.85,
    },
    "ai_landing": {
        "composition": 1.15,
        "typography": 1.10,
        "brand": 1.05,
        "originality": 1.30,
        "user_fit": 1.15,
        "technical": 1.00,
    },
    "landing": {
        "composition": 1.15,
        "typography": 1.05,
        "brand": 1.10,
        "originality": 1.10,
        "user_fit": 1.20,
        "technical": 1.00,
    },
    "dashboard": {
        "composition": 1.20,
        "typography": 1.00,
        "brand": 0.90,
        "originality": 0.95,
        "user_fit": 1.30,
        "technical": 1.35,
    },
}

# paint_check substring → (dim, boost) when strategy text aligns
_PAINT_CHECK_BOOSTS: tuple[tuple[str, str, float, tuple[str, ...]], ...] = (
    ("hero_coverage", "composition", 5.0, ("hero", "focal", "60", "coverage")),
    ("ornament_area", "composition", 3.0, ("empty", "quiet", "restrained", "space")),
    ("primary_title", "typography", 4.0, ("title", "hierarchy", "type", "typography")),
    ("one_primary_cta", "user_fit", 5.0, ("cta", "one decisive", "primary action")),
    ("no_equal_feature", "originality", 4.0, ("anti", "avoid", "not three", "editorial")),
    ("one_primary_metric", "technical", 5.0, ("metric", "primary", "task-first")),
    ("no_equal_kpi", "user_fit", 3.0, ("kpi", "wall", "avoid", "primary")),
    ("form_first", "user_fit", 4.0, ("form", "auth", "login", "hierarchy")),
    ("type_contrast", "typography", 5.0, ("contrast", "specimen", "display", "serif")),
)


def _clamp100(n: float) -> float:
    return float(max(0.0, min(100.0, n)))


def _normalize_weights(raw: dict[str, Any] | None) -> dict[str, float]:
    out = dict(_DEFAULT_RUBRIC)
    src = raw if isinstance(raw, dict) else {}
    for dim in TOURNAMENT_DIMS:
        try:
            val = float(src.get(dim))
        except (TypeError, ValueError):
            continue
        if val == val and val > 0:
            out[dim] = max(0.2, min(2.5, val))
    return out


def _rubrics_dir() -> Path:
    # .../recombyn-intelligence/src/recombyn_intelligence_service/engines → repo root
    return Path(__file__).resolve().parents[3] / "private-eval" / "rubrics"


def _load_rubric_file_override() -> tuple[str, dict[str, float]] | None:
    """Optional proprietary JSON from env or private-eval/rubrics/*.json."""
    env_path = str(os.environ.get("RECOMBYN_TOURNAMENT_RUBRIC") or "").strip()
    candidates: list[Path] = []
    if env_path:
        candidates.append(Path(env_path))
    rubrics = _rubrics_dir()
    if rubrics.is_dir():
        for name in ("active.json", "default.json"):
            candidates.append(rubrics / name)
        candidates.extend(sorted(rubrics.glob("*.json")))
    for path in candidates:
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        weights_raw = data.get("weights") if isinstance(data.get("weights"), dict) else data
        weights = _normalize_weights(weights_raw if isinstance(weights_raw, dict) else None)
        rid = str(data.get("id") or path.stem).strip() or path.stem
        return rid, weights
    return None


def resolve_rubric(
    *,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    prompt: str = "",
) -> tuple[str, dict[str, float]]:
    """Pick rubric id + dim weights. File override wins when present."""
    file_hit = _load_rubric_file_override()
    if file_hit:
        return file_hit

    res = research if isinstance(research, dict) else {}
    strat = strategy if isinstance(strategy, dict) else {}
    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    if not niches:
        niches = _detect_niches(prompt)
    cat = str(res.get("category") or strat.get("category") or "").strip().lower()

    for niche in niches:
        profile = _NICHE_RUBRICS.get(niche)
        if profile:
            return f"niche:{niche}", _normalize_weights(profile)

    if cat in _CATEGORY_RUBRICS:
        return f"category:{cat}", _normalize_weights(_CATEGORY_RUBRICS[cat])

    # Map strategy axis_weights → tournament dims when present.
    axis = strat.get("axis_weights") if isinstance(strat.get("axis_weights"), dict) else {}
    if axis:
        mapped = {
            "composition": float(axis.get("composition") or 1.0) * 3.0,
            "typography": float(axis.get("typography") or 1.0) * 3.0,
            "brand": float(axis.get("color") or axis.get("imagery") or 0.3) * 3.0,
            "originality": 1.1,
            "user_fit": float(axis.get("interaction") or 0.3) * 3.0,
            "technical": float(axis.get("interaction") or 0.25) * 2.5 + 0.5,
        }
        return "strategy:axis_weights", _normalize_weights(mapped)

    return "default", dict(_DEFAULT_RUBRIC)


def _strategy_blob(candidate: dict[str, Any]) -> str:
    strat = candidate.get("strategy") if isinstance(candidate.get("strategy"), dict) else {}
    return " ".join(
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


def _paint_check_boosts(
    *,
    text_blob: str,
    paint_checks: list[str],
) -> dict[str, float]:
    boosts = {d: 0.0 for d in TOURNAMENT_DIMS}
    checks = [str(x).lower() for x in paint_checks if str(x).strip()]
    if not checks:
        return boosts
    for check_key, dim, amount, tokens in _PAINT_CHECK_BOOSTS:
        if not any(check_key in c for c in checks):
            continue
        if any(tok in text_blob for tok in tokens):
            boosts[dim] += amount
        else:
            boosts[dim] -= amount * 0.4
    return boosts


def score_candidate_dimensions(
    candidate: dict[str, Any],
    *,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
) -> dict[str, float]:
    """Deterministic plan-level scores + private paint_check alignment."""
    label = str(candidate.get("label") or "").strip()
    base = dict(
        _LABEL_BASE.get(label)
        or {
            "composition": 70,
            "typography": 70,
            "brand": 70,
            "originality": 70,
            "user_fit": 70,
            "technical": 70,
        }
    )
    strat = candidate.get("strategy") if isinstance(candidate.get("strategy"), dict) else {}
    text_blob = _strategy_blob(candidate)
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

    paint_checks = [
        str(x)
        for x in list(res.get("paint_checks") or [])
        + list((strategy or {}).get("paint_checks") or [])
        if str(x).strip()
    ]
    for dim, delta in _paint_check_boosts(text_blob=text_blob, paint_checks=paint_checks).items():
        base[dim] = float(base.get(dim) or 0.0) + delta

    niches = [str(x) for x in list(res.get("niches") or []) if str(x).strip()]
    if "seasonal_event" in niches and re.search(r"hero|focal|motif|event", text_blob):
        base["composition"] += 3
    if "type_specimen" in niches and re.search(r"type|specimen|display|contrast", text_blob):
        base["typography"] += 4
    if "auth_ui" in niches and re.search(r"form|cta|login|hierarchy", text_blob):
        base["user_fit"] += 3

    return parse_tournament_dim_scores({k: _clamp100(v) for k, v in base.items()})


def weighted_dim_total(scores: dict[str, float], weights: dict[str, float]) -> float:
    src = parse_tournament_dim_scores(scores)
    w = _normalize_weights(weights)
    return float(sum(float(src.get(d) or 0.0) * float(w.get(d) or 1.0) for d in TOURNAMENT_DIMS))


def tournament_match_prefers_weighted(
    challenger: dict[str, Any] | None,
    incumbent: dict[str, Any] | None,
    weights: dict[str, float],
) -> tuple[bool, dict[str, str], str]:
    """Weighted dim-wins: a win on a heavy dim counts more than a light dim."""
    a = parse_tournament_dim_scores(challenger or {})
    b = parse_tournament_dim_scores(incumbent or {})
    w = _normalize_weights(weights)
    dim_map: dict[str, str] = {}
    a_pts = 0.0
    b_pts = 0.0
    a_wins = 0
    b_wins = 0
    for dim in TOURNAMENT_DIMS:
        av = float(a.get(dim) or 0.0)
        bv = float(b.get(dim) or 0.0)
        weight = float(w.get(dim) or 1.0)
        if av > bv:
            a_wins += 1
            a_pts += weight
            dim_map[dim] = "challenger"
        elif bv > av:
            b_wins += 1
            b_pts += weight
            dim_map[dim] = "incumbent"
        else:
            dim_map[dim] = "tie"
    if abs(a_pts - b_pts) > 1e-6:
        return (
            a_pts > b_pts,
            dim_map,
            f"wdim {a_pts:.2f}-{b_pts:.2f} (raw {a_wins}-{b_wins})",
        )
    # Fall back to unweighted prefers when weighted points tie.
    prefers, _, reason = tournament_match_prefers(a, b)
    return prefers, dim_map, f"wdim_tie→{reason}"


def score_all_candidates(
    candidates: list[dict[str, Any]],
    *,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for row in candidates:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("id") or "").strip()
        if not cid:
            continue
        out[cid] = score_candidate_dimensions(
            row, research=research, strategy=strategy
        )
    return out


def run_match(
    id_a: str,
    id_b: str,
    scores: dict[str, dict[str, float]],
    *,
    round_i: int,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """One bracket match. Weighted dim wins when rubric present."""
    sa = scores.get(id_a) or {}
    sb = scores.get(id_b) or {}
    w = _normalize_weights(weights)
    a_beats_b, dim_map, reason = tournament_match_prefers_weighted(sa, sb, w)
    winner = id_a if a_beats_b else id_b
    loser = id_b if a_beats_b else id_a
    named: dict[str, str] = {}
    for dim, who in dim_map.items():
        if who == "challenger":
            named[dim] = id_a
        elif who == "incumbent":
            named[dim] = id_b
        else:
            named[dim] = "tie"
    total_note = (
        f"wtotals {id_a}={weighted_dim_total(sa, w):.0f} "
        f"{id_b}={weighted_dim_total(sb, w):.0f} "
        f"| raw {tournament_dim_total(sa):.0f}/{tournament_dim_total(sb):.0f}"
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
    *,
    weights: dict[str, float] | None = None,
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
            match = run_match(
                living[i], living[i + 1], scores, round_i=round_i, weights=weights
            )
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
    *,
    weights: dict[str, float] | None = None,
) -> tuple[str, str, str]:
    """Winner from final; runner-up = final loser; alternative = best remaining."""
    ids = [str(x) for x in candidate_ids if str(x)]
    w = _normalize_weights(weights)
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
        winner = ids[0]
        for cid in ids[1:]:
            prefers, _, _ = tournament_match_prefers_weighted(
                scores.get(cid), scores.get(winner), w
            )
            if prefers:
                runner = winner
                winner = cid
    if not runner:
        rest = [c for c in ids if c != winner]
        runner = rest[0] if rest else ""
        for cid in rest[1:]:
            prefers, _, _ = tournament_match_prefers_weighted(
                scores.get(cid), scores.get(runner), w
            )
            if prefers:
                runner = cid
    remaining = [c for c in ids if c not in (winner, runner)]
    alt = ""
    if remaining:
        alt = remaining[0]
        for cid in remaining[1:]:
            prefers, _, _ = tournament_match_prefers_weighted(
                scores.get(cid), scores.get(alt), w
            )
            if prefers:
                alt = cid
    return winner, runner, alt


def run_design_tournament_pipeline(
    *,
    candidates_bundle: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    prompt: str = "",
    user_pick: str = "",
) -> dict[str, Any]:
    """Full private tournament. Deterministic. Never paints."""
    bundle = parse_design_candidate_set(candidates_bundle or {})
    rows = [r for r in list(bundle.get("candidates") or []) if isinstance(r, dict)]
    ids = [str(r.get("id") or "") for r in rows if str(r.get("id") or "")]
    rubric_id, weights = resolve_rubric(
        research=research, strategy=strategy, prompt=prompt
    )
    scores = score_all_candidates(rows, research=research, strategy=strategy)
    bracket = run_bracket(ids, scores, weights=weights)
    winner, runner, alt = pick_podium(ids, scores, bracket, weights=weights)
    pick = str(user_pick or "").strip()
    source = "bracket"
    if pick and pick in ids:
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
    weighted_totals = {
        cid: round(weighted_dim_total(row, weights), 2)
        for cid, row in scores.items()
    }
    niches = [
        str(x)
        for x in list((research or {}).get("niches") or [])
        if str(x).strip()
    ]
    if not niches and prompt:
        niches = _detect_niches(prompt)
    summary = (
        f"Winner {winner} · Runner-up {runner} · Alternative {alt} "
        f"({source}; rubric={rubric_id})"
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
            "rubric_id": rubric_id,
            "rubric_weights": weights,
            "weighted_totals": weighted_totals,
            "private_signals": {
                "stage": "weighted_bracket",
                "provider_tier": "private",
                "rubric_id": rubric_id,
                "niches": niches[:6],
                "paint_checks": list((research or {}).get("paint_checks") or [])[:8],
            },
        }
    )
