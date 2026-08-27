"""Shared schema/parse helpers for intelligence engines.

Lightweight dict normalize (no LangGraph). Prefer keeping engine pipelines
deterministic and free of SceneDocument mutations.
"""

from __future__ import annotations

from typing import Any

TOURNAMENT_DIMS: tuple[str, ...] = (
    "composition",
    "typography",
    "brand",
    "originality",
    "user_fit",
    "technical",
)

REFERENCE_DNA_AXES: tuple[str, ...] = (
    "minimalism",
    "editorial",
    "contrast",
    "density",
    "asymmetry",
    "texture",
    "decoration",
)

AUTONOMOUS_HOPS: tuple[str, ...] = (
    "intent",
    "research",
    "strategy",
    "reference",
    "brief",
    "candidates",
    "tournament",
    "swarm",
    "simulation",
    "execution",
    "observe",
    "review",
    "optimization",
    "counterfactual",
    "governance",
    "knowledge",
    "final",
)

_AUTONOMOUS_HOP_STATUSES = frozenset(
    {"pending", "running", "done", "skipped", "deferred"}
)


def _as_dict(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def _clamp_unit(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = default
    if n != n:  # NaN
        n = default
    return max(0.0, min(1.0, n))


def parse_reference_analyze(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    out: dict[str, Any] = {
        "composition": _as_dict(data.get("composition")),
        "hierarchy": _as_dict(data.get("hierarchy")),
        "palette": _as_dict(data.get("palette")),
        "typography": _as_dict(data.get("typography")),
        "imagery": _as_dict(data.get("imagery")),
        "grid": str(data.get("grid") or ""),
        "spacing": str(data.get("spacing") or ""),
        "lighting": str(data.get("lighting") or ""),
        "material": str(data.get("material") or ""),
        "depth": str(data.get("depth") or ""),
        "contrast": str(data.get("contrast") or ""),
        "rhythm": str(data.get("rhythm") or ""),
    }
    dens = data.get("density")
    out["density"] = _clamp_unit(dens) if dens is not None else None
    return out


def parse_reference_dna(raw: Any) -> dict[str, Any]:
    src = _as_dict(raw)
    axes_in = src.get("visual_dna") if isinstance(src.get("visual_dna"), dict) else src
    visual: dict[str, float] = {}
    for axis in REFERENCE_DNA_AXES:
        visual[axis] = _clamp_unit((axes_in or {}).get(axis), 0.0)
    return {"visual_dna": visual}


def parse_autonomous_hop(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    status = str(data.get("status") or "pending").strip().lower()
    if status not in _AUTONOMOUS_HOP_STATUSES:
        status = "pending"
    return {
        "id": str(data.get("id") or ""),
        "status": status,
        "note": str(data.get("note") or ""),
    }


def parse_autonomous_art_director(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("autonomous_art_director")
        if isinstance(data.get("autonomous_art_director"), dict)
        else data
    )
    parsed = _as_dict(inner)
    mode = str(parsed.get("mode") or "idle").strip().lower()
    if mode not in ("idle", "goal", "micro_edit"):
        mode = "idle"
    hops: list[dict[str, Any]] = []
    for row in list(parsed.get("hops") or []):
        if isinstance(row, dict):
            hops.append(parse_autonomous_hop(row))
    active = bool(parsed.get("active"))
    if active and not hops:
        hops = [parse_autonomous_hop({"id": hid, "status": "pending"}) for hid in AUTONOMOUS_HOPS]
    return {
        "active": active,
        "goal": str(parsed.get("goal") or "")[:800],
        "mode": mode,
        "hops": hops,
        "summary": str(parsed.get("summary") or "")[:240],
    }


def parse_design_strategy(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("design_strategy")
        if isinstance(data.get("design_strategy"), dict)
        else data
    )
    return _as_dict(inner)


def parse_design_candidate(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = data.get("candidate") if isinstance(data.get("candidate"), dict) else data
    parsed = _as_dict(inner)
    strat = parsed.get("strategy")
    if isinstance(strat, dict):
        parsed["strategy"] = parse_design_strategy(strat)
    return parsed


def parse_design_candidate_set(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("design_candidates")
        if isinstance(data.get("design_candidates"), dict)
        else data
    )
    parsed = _as_dict(inner)
    cleaned: list[dict[str, Any]] = []
    for row in list(parsed.get("candidates") or []):
        cleaned.append(parse_design_candidate(row if isinstance(row, dict) else {}))
    parsed["candidates"] = cleaned
    parsed["count"] = len(cleaned)
    if not parsed.get("primary_id") and cleaned:
        parsed["primary_id"] = str(cleaned[0].get("id") or "")
    return parsed


def parse_tournament_dim_scores(raw: Any) -> dict[str, float]:
    data = _as_dict(raw)
    out: dict[str, float] = {}
    for key in TOURNAMENT_DIMS:
        try:
            out[key] = float(max(0.0, min(100.0, float(data.get(key) or 0.0))))
        except (TypeError, ValueError):
            out[key] = 0.0
    return out


def parse_design_tournament(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("design_tournament")
        if isinstance(data.get("design_tournament"), dict)
        else data
    )
    parsed = _as_dict(inner)
    scores_in = parsed.get("scores") if isinstance(parsed.get("scores"), dict) else {}
    scores_out: dict[str, dict[str, float]] = {}
    for cid, row in scores_in.items():
        scores_out[str(cid)] = parse_tournament_dim_scores(row)
    parsed["scores"] = scores_out
    bracket: list[dict[str, Any]] = []
    for match in list(parsed.get("bracket") or []):
        if isinstance(match, dict):
            bracket.append(dict(match))
    parsed["bracket"] = bracket
    return parsed


def tournament_dim_total(scores: dict[str, Any] | None) -> float:
    src = parse_tournament_dim_scores(scores or {})
    return float(sum(src.get(k, 0.0) for k in TOURNAMENT_DIMS))


def tournament_match_prefers(
    challenger: dict[str, Any] | None,
    incumbent: dict[str, Any] | None,
) -> tuple[bool, dict[str, str], str]:
    a = parse_tournament_dim_scores(challenger or {})
    b = parse_tournament_dim_scores(incumbent or {})
    dim_map: dict[str, str] = {}
    a_wins = 0
    b_wins = 0
    for dim in TOURNAMENT_DIMS:
        av = float(a.get(dim) or 0.0)
        bv = float(b.get(dim) or 0.0)
        if av > bv:
            a_wins += 1
            dim_map[dim] = "challenger"
        elif bv > av:
            b_wins += 1
            dim_map[dim] = "incumbent"
        else:
            dim_map[dim] = "tie"
    if a_wins > b_wins:
        return True, dim_map, f"dim_wins {a_wins}-{b_wins}"
    if b_wins > a_wins:
        return False, dim_map, f"dim_wins {a_wins}-{b_wins}"
    for key in ("originality", "user_fit", "composition"):
        if float(a.get(key) or 0.0) != float(b.get(key) or 0.0):
            wins = float(a.get(key) or 0.0) > float(b.get(key) or 0.0)
            return wins, dim_map, f"tiebreak:{key}"
    at = tournament_dim_total(a)
    bt = tournament_dim_total(b)
    if at != bt:
        return at > bt, dim_map, "tiebreak:total"
    return False, dim_map, "tie"


def parse_design_swarm(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = data.get("design_swarm") if isinstance(data.get("design_swarm"), dict) else data
    parsed = _as_dict(inner)
    parsed["delegated"] = [
        dict(row) for row in list(parsed.get("delegated") or []) if isinstance(row, dict)
    ]
    parsed["conflicts"] = [
        dict(row) for row in list(parsed.get("conflicts") or []) if isinstance(row, dict)
    ]
    parsed["final_direction"] = [
        str(x).strip() for x in list(parsed.get("final_direction") or []) if str(x).strip()
    ][:16]
    parsed["need_subagents"] = [
        str(x).strip() for x in list(parsed.get("need_subagents") or []) if str(x).strip()
    ][:16]
    return parsed


def parse_design_simulation(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("design_simulation")
        if isinstance(data.get("design_simulation"), dict)
        else data
    )
    parsed = _as_dict(inner)
    att = parsed.get("attention") if isinstance(parsed.get("attention"), dict) else {}
    parsed["attention"] = dict(att)
    adj = parsed.get("attention_adjusted")
    parsed["attention_adjusted"] = dict(adj) if isinstance(adj, dict) else None
    for key in ("hierarchy", "readability", "density", "conversion"):
        try:
            parsed[key] = float(max(0.0, min(100.0, float(parsed.get(key) or 0.0))))
        except (TypeError, ValueError):
            parsed[key] = 0.0
    parsed["warnings"] = [
        str(x).strip() for x in list(parsed.get("warnings") or []) if str(x).strip()
    ][:12]
    parsed["adjustments"] = [
        str(x).strip() for x in list(parsed.get("adjustments") or []) if str(x).strip()
    ][:12]
    return parsed


def parse_design_counterfactual(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    inner = (
        data.get("design_counterfactual")
        if isinstance(data.get("design_counterfactual"), dict)
        else data
    )
    return _as_dict(inner)


_SNAP_KEYS = (
    "node_count",
    "hero_coverage",
    "title_area",
    "decoration_area",
    "whitespace_ratio",
    "text_area",
    "color_area",
    "bbox_coverage",
    "spacing_mean",
    "alignment_issue_count",
)


def normalize_visual_snapshot(raw: Any) -> dict[str, Any]:
    src = _as_dict(raw)
    out: dict[str, Any] = {}
    for key in _SNAP_KEYS:
        if key in src:
            out[key] = src[key]
    return out


def _visual_change_mag(*vals: Any) -> float:
    acc = 0.0
    for raw in vals:
        if raw is None:
            continue
        try:
            acc += min(1.0, abs(float(raw)))
        except (TypeError, ValueError):
            continue
    return round(min(1.0, acc), 4)


def compute_visual_diff(v1: Any, v2: Any) -> dict[str, Any]:
    """Geometry-only visual diff (no pixel decode in private service)."""
    snap1 = normalize_visual_snapshot(v1)
    snap2 = normalize_visual_snapshot(v2)
    deltas: dict[str, float] = {}
    for key in _SNAP_KEYS:
        a, b = snap1.get(key), snap2.get(key)
        if a is None or b is None:
            continue
        try:
            deltas[key] = float(b) - float(a)
        except (TypeError, ValueError):
            continue
    change = {
        "layout": _visual_change_mag(
            deltas.get("hero_coverage"),
            deltas.get("whitespace_ratio"),
            deltas.get("bbox_coverage"),
            (deltas.get("node_count") or 0) / 50.0,
            (deltas.get("alignment_issue_count") or 0) / 10.0,
        ),
        "typography": _visual_change_mag(
            deltas.get("title_area"),
            deltas.get("text_area"),
        ),
        "color": _visual_change_mag(deltas.get("color_area")),
        "imagery": _visual_change_mag(
            deltas.get("hero_coverage"),
            deltas.get("decoration_area"),
        ),
    }
    return {
        "v1": snap1,
        "v2": snap2,
        "deltas": deltas,
        "visual_change": change,
        "pixel_available": False,
        "pixel": {"status": "unavailable"},
    }
