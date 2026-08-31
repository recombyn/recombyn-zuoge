"""Agent graph state types and structured-output schemas."""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, TypedDict

from pydantic import BaseModel, Field

from recombyn_protocol import (
    AUTONOMOUS_HOPS,
    DESIGN_BRIEF_P0_FIELDS,
    DESIGN_BRIEF_P1_FIELDS,
    GOVERNANCE_LANES,
    MULTI_REVIEW_LANES,
    OptimizationDecisionKind,
    REFERENCE_DNA_AXES,
    REVIEW_LANE_CAPS,
    REVIEW_PASS_SCORE,
    REVIEW_REWORK_SCORE,
    REVIEW_SCORE_CAPS,
    REVIEW_SCORE_RAW_MAX,
    REVIEW_SCORE_TOTAL_MAX,
    TOURNAMENT_DIMS,
    AutonomousArtDirectorSchema,
    AutonomousHopSchema,
    CounterfactualHypothesisSchema,
    CounterfactualKind,
    CounterfactualTrialSchema,
    DecideTurnSchema,
    DesignBriefCompositionSchema,
    DesignBriefSchema,
    DesignCandidateSchema,
    DesignCandidateSetSchema,
    DesignCounterfactualSchema,
    DesignGovernanceSchema,
    DesignResearchReportSchema,
    DesignSimulationAttentionSchema,
    DesignSimulationSchema,
    DesignStrategySchema,
    DesignSwarmResultSchema,
    DesignTokens,
    DesignTournamentResultSchema,
    GovernanceLaneResultSchema,
    JudgeIssueSchema,
    JudgeVerdictSchema,
    ObserveFactsSchema,
    OptimizationDecisionSchema,
    PaintOpsSchema,
    PaintToolOp,
    PaletteBrief,
    ParetoScoresSchema,
    PreferenceSignalSchema,
    ReferenceAnalyzeSchema,
    ReferenceCompositionSchema,
    ReferenceDnaSchema,
    ReferenceHierarchySchema,
    ReferenceImagerySchema,
    ReferenceIntelligenceTurnSchema,
    ReferencePaletteSchema,
    ReferenceTypographySchema,
    ResearchTurnSchema,
    ReviewAction,
    ReviewIssueSchema,
    ReviewLaneSchema,
    ReviewScoresSchema,
    ReviewTurnSchema,
    SceneVisualSnapshot,
    SwarmConflictSchema,
    SwarmProposalSchema,
    TournamentDimScoresSchema,
    TournamentMatchSchema,
    TypographyBrief,
    VisionScoutTurnSchema,
    VisualChangeSchema,
    VisualDiffSchema,
    DesignTransaction,
    DesignTransactionPhase,
    new_design_transaction,
    resolve_transaction_phase,
)

from app.services.design.prompts.rules_text import _as_text
from app.services.design.runtime.decision_log import DesignRunDecision

_log = logging.getLogger(__name__)
logger = _log
_DEFAULT_MAX_ROUNDS = 4
# Allow one craft fix + one long-canvas continue without Admin rule overrides.
_DEFAULT_MAX_REFLECT = 2
_SCENE_WAIT_SEC = 12.0


# Design Brief / Review / Observe / Paint schemas — owned by recombyn_protocol.


def _brief_field_nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set)):
        return any(_brief_field_nonempty(x) for x in value)
    if isinstance(value, dict):
        if not value:
            return False
        # composition: need archetype or rules
        if "archetype" in value or "rules" in value:
            arch = str(value.get("archetype") or "").strip()
            rules = value.get("rules")
            return bool(arch) or bool(rules)
        return any(_brief_field_nonempty(v) for v in value.values())
    return bool(value)


def parse_design_brief(raw: Any) -> dict[str, Any] | None:
    """Normalize Decide design_brief → dict, or None if empty/unusable."""
    if raw is None:
        return None
    if isinstance(raw, DesignBriefSchema):
        return raw.model_dump()
    if isinstance(raw, dict):
        data = dict(raw)
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        # Prefer JSON object; non-JSON strings are rejected.
        if text.startswith("{") and text.endswith("}"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    data = parsed
                else:
                    return None
            except Exception:
                return None
        else:
            return None
    else:
        return None
    try:
        return DesignBriefSchema.model_validate(data).model_dump()
    except Exception:
        return data if data else None


def design_brief_p0_missing(brief: dict[str, Any] | None) -> list[str]:
    """Return missing P0 field names."""
    if not brief:
        return list(DESIGN_BRIEF_P0_FIELDS)
    missing: list[str] = []
    for key in DESIGN_BRIEF_P0_FIELDS:
        if not _brief_field_nonempty(brief.get(key)):
            missing.append(key)
    return missing


def format_design_brief_for_prompt(brief: dict[str, Any] | str | None) -> str:
    """Full brief JSON for Review / logs (includes reference_dna)."""
    if brief is None:
        return ""
    if isinstance(brief, str):
        return brief.strip()[:4000]
    parsed = parse_design_brief(brief) or {}
    if not parsed:
        return ""
    try:
        return json.dumps(parsed, ensure_ascii=False, indent=2)[:4000]
    except Exception:
        return str(parsed)[:4000]


def format_design_brief_for_paint(brief: dict[str, Any] | str | None) -> str:
    """Paint execution contract: lock + P0/P1, never DNA axis adjectives."""
    if brief is None:
        return ""
    if isinstance(brief, str):
        parsed = parse_design_brief(brief) or {}
        if not parsed:
            return brief.strip()[:4000]
    else:
        parsed = parse_design_brief(brief) or {}
    if not parsed:
        return ""
    paint = dict(parsed)
    paint.pop("reference_dna", None)
    try:
        return json.dumps(paint, ensure_ascii=False, indent=2)[:4000]
    except Exception:
        return str(paint)[:4000]


def clamp_review_scores(raw: Any) -> dict[str, int]:
    """Clamp each dimension to its cap; ignore unknown keys for the sum."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, int] = {}
    for key, cap in REVIEW_SCORE_CAPS.items():
        try:
            val = int(round(float(src.get(key, 0) or 0)))
        except (TypeError, ValueError):
            val = 0
        out[key] = max(0, min(cap, val))
    return out


def sum_review_scores(scores: dict[str, int]) -> int:
    """Sum clamped dimensional scores (caps total 100)."""
    return int(sum(int(scores.get(k, 0) or 0) for k in REVIEW_SCORE_CAPS))


# Runtime tuning knobs (not wire schemas) — stay in Kernel.
OPTIMIZATION_MAX_ITERS = 4
OPTIMIZATION_MIN_DELTA = 1
PARETO_QUALITY_SLACK = 1
PREFERENCE_MIN_FREQUENCY = 5
PREFERENCE_MIN_CONFIDENCE = 0.7


def _clamp_unit(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = default
    if n != n:  # NaN
        n = default
    return max(0.0, min(1.0, n))


def parse_reference_analyze(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    parsed = ReferenceAnalyzeSchema.model_validate(data).model_dump()
    if parsed.get("density") is not None:
        parsed["density"] = _clamp_unit(parsed["density"])
    return parsed


def parse_reference_dna(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    axes_in = src.get("visual_dna") if isinstance(src.get("visual_dna"), dict) else src
    visual: dict[str, float] = {}
    for axis in REFERENCE_DNA_AXES:
        visual[axis] = _clamp_unit((axes_in or {}).get(axis), 0.0)
    return ReferenceDnaSchema(visual_dna=visual).model_dump()


def parse_design_strategy(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = data.get("design_strategy") if isinstance(data.get("design_strategy"), dict) else data
    return DesignStrategySchema.model_validate(inner or {}).model_dump()


def parse_design_candidate(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = data.get("candidate") if isinstance(data.get("candidate"), dict) else data
    parsed = DesignCandidateSchema.model_validate(inner or {}).model_dump()
    strat = parsed.get("strategy")
    if isinstance(strat, dict):
        parsed["strategy"] = parse_design_strategy(strat)
    return parsed


def parse_design_candidate_set(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_candidates")
        if isinstance(data.get("design_candidates"), dict)
        else data
    )
    parsed = DesignCandidateSetSchema.model_validate(inner or {}).model_dump()
    cleaned: list[dict[str, Any]] = []
    for row in list(parsed.get("candidates") or []):
        cleaned.append(parse_design_candidate(row if isinstance(row, dict) else {}))
    parsed["candidates"] = cleaned
    parsed["count"] = len(cleaned)
    if not parsed.get("primary_id") and cleaned:
        parsed["primary_id"] = str(cleaned[0].get("id") or "")
    return parsed


def parse_tournament_dim_scores(raw: Any) -> dict[str, float]:
    data = raw if isinstance(raw, dict) else {}
    parsed = TournamentDimScoresSchema.model_validate(data or {}).model_dump()
    out: dict[str, float] = {}
    for key in TOURNAMENT_DIMS:
        try:
            out[key] = float(max(0.0, min(100.0, float(parsed.get(key) or 0.0))))
        except (TypeError, ValueError):
            out[key] = 0.0
    return out


def parse_design_tournament(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_tournament")
        if isinstance(data.get("design_tournament"), dict)
        else data
    )
    parsed = DesignTournamentResultSchema.model_validate(inner or {}).model_dump()
    scores_in = parsed.get("scores") if isinstance(parsed.get("scores"), dict) else {}
    scores_out: dict[str, dict[str, float]] = {}
    for cid, row in scores_in.items():
        scores_out[str(cid)] = parse_tournament_dim_scores(row)
    parsed["scores"] = scores_out
    bracket: list[dict[str, Any]] = []
    for match in list(parsed.get("bracket") or []):
        if isinstance(match, dict):
            bracket.append(TournamentMatchSchema.model_validate(match).model_dump())
    parsed["bracket"] = bracket
    return parsed


def parse_design_swarm(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = data.get("design_swarm") if isinstance(data.get("design_swarm"), dict) else data
    parsed = DesignSwarmResultSchema.model_validate(inner or {}).model_dump()
    delegated: list[dict[str, Any]] = []
    for row in list(parsed.get("delegated") or []):
        if isinstance(row, dict):
            delegated.append(SwarmProposalSchema.model_validate(row).model_dump())
    parsed["delegated"] = delegated
    conflicts: list[dict[str, Any]] = []
    for row in list(parsed.get("conflicts") or []):
        if isinstance(row, dict):
            conflicts.append(SwarmConflictSchema.model_validate(row).model_dump())
    parsed["conflicts"] = conflicts
    parsed["final_direction"] = [
        str(x).strip() for x in list(parsed.get("final_direction") or []) if str(x).strip()
    ][:16]
    parsed["need_subagents"] = [
        str(x).strip() for x in list(parsed.get("need_subagents") or []) if str(x).strip()
    ][:16]
    return parsed


def parse_design_simulation(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_simulation")
        if isinstance(data.get("design_simulation"), dict)
        else data
    )
    parsed = DesignSimulationSchema.model_validate(inner or {}).model_dump()
    att = parsed.get("attention") if isinstance(parsed.get("attention"), dict) else {}
    parsed["attention"] = DesignSimulationAttentionSchema.model_validate(att or {}).model_dump()
    adj = parsed.get("attention_adjusted")
    if isinstance(adj, dict):
        parsed["attention_adjusted"] = DesignSimulationAttentionSchema.model_validate(
            adj
        ).model_dump()
    else:
        parsed["attention_adjusted"] = None
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
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_counterfactual")
        if isinstance(data.get("design_counterfactual"), dict)
        else data
    )
    parsed = DesignCounterfactualSchema.model_validate(inner or {}).model_dump()
    hyps: list[dict[str, Any]] = []
    for row in list(parsed.get("hypotheses") or []):
        if isinstance(row, dict):
            hyps.append(CounterfactualHypothesisSchema.model_validate(row).model_dump())
    parsed["hypotheses"] = hyps
    trials: list[dict[str, Any]] = []
    for row in list(parsed.get("trials") or []):
        if isinstance(row, dict):
            trials.append(CounterfactualTrialSchema.model_validate(row).model_dump())
    parsed["trials"] = trials
    return parsed


def parse_design_governance(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_governance")
        if isinstance(data.get("design_governance"), dict)
        else data
    )
    parsed = DesignGovernanceSchema.model_validate(inner or {}).model_dump()
    lanes: list[dict[str, Any]] = []
    for row in list(parsed.get("lanes") or []):
        if isinstance(row, dict):
            lanes.append(GovernanceLaneResultSchema.model_validate(row).model_dump())
    parsed["lanes"] = lanes
    parsed["explain"] = [
        str(x).strip() for x in list(parsed.get("explain") or []) if str(x).strip()
    ][:16]
    if any(str(l.get("status") or "") == "fail" for l in lanes):
        parsed["status"] = "fail"
    return parsed


def parse_autonomous_art_director(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("autonomous_art_director")
        if isinstance(data.get("autonomous_art_director"), dict)
        else data
    )
    parsed = AutonomousArtDirectorSchema.model_validate(inner or {}).model_dump()
    hops: list[dict[str, Any]] = []
    for row in list(parsed.get("hops") or []):
        if isinstance(row, dict):
            hops.append(AutonomousHopSchema.model_validate(row).model_dump())
    # Fill missing hops from canonical order when active.
    if parsed.get("active") and not hops:
        hops = [
            AutonomousHopSchema(id=hid, status="pending").model_dump()
            for hid in AUTONOMOUS_HOPS
        ]
    parsed["hops"] = hops
    return parsed


def tournament_dim_total(scores: dict[str, Any] | None) -> float:
    src = parse_tournament_dim_scores(scores or {})
    return float(sum(src.get(k, 0.0) for k in TOURNAMENT_DIMS))


def tournament_match_prefers(
    challenger: dict[str, Any] | None,
    incumbent: dict[str, Any] | None,
) -> tuple[bool, dict[str, str], str]:
    """Multi-dim match: dim wins beat raw total (P35 — not「谁 total 高」).

    Returns (challenger_wins, dim_winner_map, reason).
    """
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
    # Tie on dim count → originality → user_fit → composition → total
    for key in ("originality", "user_fit", "composition"):
        if float(a.get(key) or 0.0) != float(b.get(key) or 0.0):
            wins = float(a.get(key) or 0.0) > float(b.get(key) or 0.0)
            return wins, dim_map, f"tiebreak:{key}"
    at = tournament_dim_total(a)
    bt = tournament_dim_total(b)
    if at != bt:
        return at > bt, dim_map, "tiebreak:total"
    return False, dim_map, "tie"


def segment_reference_analyze(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    """Slice composition / hierarchy / imagery from an analyze payload."""
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "composition": src.get("composition") if isinstance(src.get("composition"), dict) else {},
        "hierarchy": src.get("hierarchy") if isinstance(src.get("hierarchy"), dict) else {},
        "imagery": src.get("imagery") if isinstance(src.get("imagery"), dict) else {},
    }


def extract_reference_features(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    """Palette / type / density / material laws (not taste words)."""
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "palette": src.get("palette") if isinstance(src.get("palette"), dict) else {},
        "typography": src.get("typography") if isinstance(src.get("typography"), dict) else {},
        "density": src.get("density"),
        "grid": str(src.get("grid") or ""),
        "spacing": str(src.get("spacing") or ""),
        "lighting": str(src.get("lighting") or ""),
        "material": str(src.get("material") or ""),
        "depth": str(src.get("depth") or ""),
        "contrast": str(src.get("contrast") or ""),
        "rhythm": str(src.get("rhythm") or ""),
    }


def derive_reference_dna(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    """Why it looks this way — axes from laws, not pixels."""
    src = analyzed if isinstance(analyzed, dict) else {}
    density = _clamp_unit(src.get("density"), 0.5)
    comp = src.get("composition") if isinstance(src.get("composition"), dict) else {}
    typo = src.get("typography") if isinstance(src.get("typography"), dict) else {}
    imagery = src.get("imagery") if isinstance(src.get("imagery"), dict) else {}
    ctype = str(comp.get("type") or "").lower()
    balance = str(comp.get("balance") or "").lower()
    scale = str(typo.get("scale") or "").lower()
    t_contrast = str(typo.get("contrast") or "").lower()
    istyle = str(imagery.get("style") or "").lower()
    lighting = str(src.get("lighting") or imagery.get("lighting") or "").lower()
    material = str(src.get("material") or "").lower()

    if "asymmetric" in ctype:
        asymmetry = 0.75
    elif "center" in ctype or "symmetr" in ctype:
        asymmetry = 0.22
    else:
        asymmetry = 0.45
    editorial = 0.4
    if "editorial" in ctype or "editorial" in istyle:
        editorial = 0.88
    elif scale == "large":
        editorial = 0.7
    contrast_n = 0.5
    if t_contrast == "high" or balance == "dynamic":
        contrast_n = 0.78
    elif t_contrast == "low" or balance in ("static", "stable"):
        contrast_n = 0.35
    decoration = _clamp_unit(density * 0.4)
    if "decor" in ctype:
        decoration = 0.7
    minimalism = _clamp_unit(1.0 - density * 0.8 - decoration * 0.3)
    texture = 0.35
    if any(k in lighting for k in ("soft", "atmospheric", "directional", "tactile")):
        texture = 0.48
    if material:
        texture = max(texture, 0.55)
    return parse_reference_dna(
        {
            "visual_dna": {
                "minimalism": round(minimalism, 2),
                "editorial": round(editorial, 2),
                "contrast": round(contrast_n, 2),
                "density": round(density, 2),
                "asymmetry": round(asymmetry, 2),
                "texture": round(texture, 2),
                "decoration": round(decoration, 2),
            }
        }
    )


def _dna_from_llm_or_derive(analyzed: dict[str, Any], raw_dna: Any) -> dict[str, Any]:
    derived = derive_reference_dna(analyzed)
    src = raw_dna
    if isinstance(raw_dna, dict) and isinstance(raw_dna.get("visual_dna"), dict):
        src = raw_dna.get("visual_dna")
    if not isinstance(src, dict) or not src:
        return derived
    merged = dict(derived.get("visual_dna") or {})
    for axis in REFERENCE_DNA_AXES:
        if axis in src and src[axis] is not None:
            merged[axis] = _clamp_unit(src[axis])
    return parse_reference_dna({"visual_dna": merged})


def build_reference_lock(
    analyzed: dict[str, Any] | None,
    dna: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Allow content to change; forbid changing core visual language."""
    _ = dna
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "allow": ["content", "images", "brand_details"],
        "forbid": ["changing core visual language"],
        "composition": src.get("composition") if isinstance(src.get("composition"), dict) else {},
        "palette": src.get("palette") if isinstance(src.get("palette"), dict) else {},
        "typography": src.get("typography") if isinstance(src.get("typography"), dict) else {},
        "imagery": src.get("imagery") if isinstance(src.get("imagery"), dict) else {},
        "hierarchy": src.get("hierarchy") if isinstance(src.get("hierarchy"), dict) else {},
    }


def compile_reference_intelligence(raw_analyze: Any, raw_dna: Any = None) -> dict[str, Any]:
    """ingest payload → analyze → segment → extract → dna → lock."""
    analyze = parse_reference_analyze(raw_analyze)
    return {
        "analyze": analyze,
        "segments": segment_reference_analyze(analyze),
        "features": extract_reference_features(analyze),
        "dna": _dna_from_llm_or_derive(analyze, raw_dna),
        "lock": build_reference_lock(analyze),
    }


def merge_reference_into_brief(
    brief: dict[str, Any] | None,
    *,
    analyze: dict[str, Any] | None = None,
    dna: dict[str, Any] | None = None,
    lock: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fill empty P1 reference slots. Never clobber Decide-authored P0."""
    out = dict(brief or {})
    if dna and not out.get("reference_dna"):
        out["reference_dna"] = dna
    if lock and not out.get("reference_lock"):
        out["reference_lock"] = lock
    features = extract_reference_features(analyze) if analyze else {}
    if analyze and not out.get("style_dna"):
        style: dict[str, Any] = {}
        if features.get("lighting"):
            style["lighting"] = features["lighting"]
        if features.get("material"):
            style["material"] = features["material"]
        density = features.get("density")
        if isinstance(density, (int, float)):
            style["density"] = (
                "low" if density < 0.34 else ("high" if density > 0.66 else "medium")
            )
        if style:
            out["style_dna"] = style
    pal = features.get("palette") if isinstance(features.get("palette"), dict) else {}
    if not out.get("palette") and pal:
        hexes = list(pal.get("dominant") or []) + list(pal.get("accent") or [])
        if hexes:
            out["palette"] = {"hex": [str(x) for x in hexes[:6]], "roles": {}}
    if not out.get("typography") and features.get("typography"):
        out["typography"] = features["typography"]
    parsed = parse_design_brief(out)
    return parsed if parsed else out


def format_reference_intel_for_decide(
    *,
    analyze: dict[str, Any] | None = None,
    dna: dict[str, Any] | None = None,
    lock: dict[str, Any] | None = None,
) -> str:
    """Decide-only block. Paint never receives this (DNA stays out of paint adjectives)."""
    _ = analyze
    parts: list[str] = [
        "REFERENCE_INTEL (host-owned). Copy into design_brief.reference_lock / "
        "reference_dna. Do not invent competing DNA. Never paste axis numbers into thought/reply."
    ]
    if lock:
        try:
            parts.append("REFERENCE_LOCK:\n" + json.dumps(lock, ensure_ascii=False)[:1800])
        except Exception:
            parts.append("REFERENCE_LOCK: (unprintable)")
    if dna:
        try:
            parts.append(
                "REFERENCE_DNA (design_brief.reference_dna only):\n"
                + json.dumps(dna, ensure_ascii=False)[:800]
            )
        except Exception:
            parts.append("REFERENCE_DNA: (unprintable)")
    return "\n\n".join(parts) if (lock or dna) else ""


def parse_preference_signal(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    parsed = PreferenceSignalSchema.model_validate(data).model_dump()
    parsed["strength"] = _clamp_unit(parsed.get("strength"), 0.0)
    parsed["confidence"] = _clamp_unit(parsed.get("confidence"), 0.0)
    try:
        parsed["evidence"] = max(0, int(parsed.get("evidence") or 0))
    except (TypeError, ValueError):
        parsed["evidence"] = 0
    try:
        parsed["frequency"] = max(0, int(parsed.get("frequency") or 0))
    except (TypeError, ValueError):
        parsed["frequency"] = 0
    return parsed


def preference_should_commit(signal: dict[str, Any] | PreferenceSignalSchema) -> bool:
    """One edit is never enough. Need evidence + frequency + confidence."""
    row = parse_preference_signal(signal if isinstance(signal, dict) else signal.model_dump())
    if row["frequency"] < PREFERENCE_MIN_FREQUENCY:
        return False
    if row["confidence"] < PREFERENCE_MIN_CONFIDENCE:
        return False
    return row["evidence"] >= PREFERENCE_MIN_FREQUENCY


def preference_candidate_key(signal: dict[str, Any] | None) -> str:
    row = parse_preference_signal(signal or {})
    sig = str(row.get("signal") or "").strip() or "unknown"
    direction = str(row.get("direction") or "").strip() or "adjust"
    target = str(row.get("target") or "").strip() or "board"
    return f"{sig}:{direction}:{target}"[:80]


def preferred_range_for_signal(signal: str, direction: str) -> dict[str, float] | None:
    sig = str(signal or "").strip()
    direction_l = str(direction or "").strip().lower()
    if sig == "typography_scale" and direction_l == "decrease":
        return {"min": 0.75, "max": 0.9}
    if sig == "typography_scale" and direction_l == "increase":
        return {"min": 1.05, "max": 1.25}
    if sig == "density" and direction_l == "decrease":
        return {"min": 0.2, "max": 0.4}
    if sig == "decoration" and direction_l == "decrease":
        return {"min": 0.0, "max": 0.2}
    if sig == "contrast" and direction_l == "increase":
        return {"min": 0.7, "max": 1.0}
    if sig == "hero_coverage" and direction_l == "decrease":
        return {"min": 0.45, "max": 0.6}
    if sig == "hero_coverage" and direction_l == "increase":
        return {"min": 0.65, "max": 0.8}
    return None


_EDIT_PREF_RULES: tuple[tuple[str, str, str, str, float], ...] = (
    (r"标题.{0,6}(太大|过大)|headline.{0,16}(too big|too large)|title.{0,12}(too big|too large)", "typography_scale", "decrease", "headline", 0.8),
    (r"标题.{0,6}(太小|再大|加大)|headline.{0,16}(too small|bigger)|title.{0,12}(too small|bigger)", "typography_scale", "increase", "headline", 0.8),
    (r"(太挤|太密|字太密|少点字|more whitespace|too dense|too cramped)|多[一点]?留白", "density", "decrease", "board", 0.75),
    (r"(太花|太满|少点装饰|less decoration|too busy|too decorative)", "decoration", "decrease", "board", 0.75),
    (r"(对比不够|对比太弱|more contrast|too flat)", "contrast", "increase", "board", 0.75),
    (r"(主视觉|hero).{0,6}(太大|过大)|hero.{0,12}(too big|too large)", "hero_coverage", "decrease", "hero", 0.8),
    (r"(主视觉|hero).{0,6}(太小|再大)|hero.{0,12}(too small|bigger)", "hero_coverage", "increase", "hero", 0.8),
)
_ANTI_SLOP_PREF: tuple[tuple[str, str], ...] = (
    ("glassmorphism", r"玻璃拟态|毛玻璃|glassmorphism"),
    ("purple gradient", r"紫[色]?渐变|purple gradient"),
    ("generic cards", r"通用卡片|generic cards?"),
    ("glow", r"乱[用]?发光|random glow"),
)


def analyze_edit_preference(text: str) -> dict[str, Any] | None:
    """Edit Analyzer — deterministic laws from the user edit, not taste LLM."""
    raw = str(text or "").strip()
    if not raw:
        return None
    for pattern, signal, direction, target, strength in _EDIT_PREF_RULES:
        if re.search(pattern, raw, flags=re.I):
            return parse_preference_signal(
                {
                    "signal": signal,
                    "direction": direction,
                    "target": target,
                    "strength": strength,
                    "evidence": 1,
                    "frequency": 1,
                    "confidence": 0.0,
                }
            )
    avoid = re.search(
        r"(?:不要|别用|禁止|别加|avoid|don't use|do not use)\s*([^。！？\n]{1,24})",
        raw,
        flags=re.I,
    )
    if avoid:
        clause = str(avoid.group(1) or "").strip()
        target = clause[:40]
        for name, pat in _ANTI_SLOP_PREF:
            if re.search(pat, raw, flags=re.I) or re.search(pat, clause, flags=re.I):
                target = name
                break
        if target:
            return parse_preference_signal(
                {
                    "signal": "anti_slop",
                    "direction": "avoid",
                    "target": target,
                    "strength": 0.85,
                    "evidence": 1,
                    "frequency": 1,
                    "confidence": 0.0,
                }
            )
    return None


def accumulate_preference_candidate(
    user_layer: dict[str, Any] | None,
    incoming: dict[str, Any] | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Confidence update. Same-direction streak; opposite direction resets frequency."""
    base = user_layer if isinstance(user_layer, dict) else {}
    user = {
        "preference": dict(base.get("preference") or {})
        if isinstance(base.get("preference"), dict)
        else {},
        "rejected_patterns": list(base.get("rejected_patterns") or [])
        if isinstance(base.get("rejected_patterns"), list)
        else [],
        "accepted_patterns": list(base.get("accepted_patterns") or [])
        if isinstance(base.get("accepted_patterns"), list)
        else [],
    }
    if not incoming:
        return user, []
    fresh = parse_preference_signal(incoming)
    if not str(fresh.get("signal") or "").strip():
        return user, []
    key = preference_candidate_key(fresh)
    prev = user["preference"].get(key) if isinstance(user["preference"].get(key), dict) else {}
    was_committed = bool(prev.get("committed"))
    family = f"{fresh['signal']}:{fresh['target']}"
    streak = 1
    evidence = 1
    if prev and str(prev.get("direction") or "") == fresh["direction"]:
        try:
            streak = int(prev.get("frequency") or 0) + 1
        except (TypeError, ValueError):
            streak = 1
        try:
            evidence = int(prev.get("evidence") or 0) + 1
        except (TypeError, ValueError):
            evidence = 1
    else:
        # Opposite or first: keep total evidence, reset consecutive frequency.
        try:
            evidence = int(prev.get("evidence") or 0) + 1
        except (TypeError, ValueError):
            evidence = 1
        for other_key, other in list(user["preference"].items()):
            if not isinstance(other, dict):
                continue
            other_family = f"{other.get('signal')}:{other.get('target')}"
            if other_family == family and other_key != key:
                try:
                    other["frequency"] = max(0, int(other.get("frequency") or 0) - 1)
                except (TypeError, ValueError):
                    other["frequency"] = 0
                user["preference"][other_key] = other
    strength = float(fresh.get("strength") or 0.8)
    confidence = _clamp_unit(
        (streak / float(PREFERENCE_MIN_FREQUENCY)) * max(strength, PREFERENCE_MIN_CONFIDENCE)
    )
    candidate = {
        **fresh,
        "evidence": evidence,
        "frequency": streak,
        "confidence": round(confidence, 3),
        "committed": bool(was_committed),
        "preferred_range": prev.get("preferred_range"),
    }
    newly: list[dict[str, Any]] = []
    if not was_committed and preference_should_commit(candidate):
        candidate["committed"] = True
        rng = preferred_range_for_signal(candidate["signal"], candidate["direction"])
        if rng:
            candidate["preferred_range"] = rng
        newly.append(dict(candidate))
        label = f"{candidate['target']} {candidate['signal']} {candidate['direction']}".strip()
        if candidate["direction"] == "avoid":
            if label not in user["rejected_patterns"] and candidate["target"] not in user["rejected_patterns"]:
                user["rejected_patterns"] = (user["rejected_patterns"] + [str(candidate["target"])[:200]])[:24]
        elif candidate["direction"] in ("increase", "decrease", "prefer"):
            if label not in user["accepted_patterns"]:
                user["accepted_patterns"] = (user["accepted_patterns"] + [label[:200]])[:24]
    user["preference"][key] = candidate
    return user, newly


def apply_committed_preferences_to_brief(
    brief: dict[str, Any] | None,
    user_layer: dict[str, Any] | None,
) -> dict[str, Any]:
    """Committed prefs enter Brief. Uncommitted evidence never does."""
    out = dict(brief or {})
    pref = (user_layer or {}).get("preference") if isinstance(user_layer, dict) else {}
    if not isinstance(pref, dict):
        return out
    avoid = [str(x) for x in (out.get("avoid") or []) if str(x).strip()] if isinstance(out.get("avoid"), list) else []
    for cand in pref.values():
        if not isinstance(cand, dict) or not cand.get("committed"):
            continue
        sig = str(cand.get("signal") or "")
        direction = str(cand.get("direction") or "")
        target = str(cand.get("target") or "")
        rng = cand.get("preferred_range") if isinstance(cand.get("preferred_range"), dict) else None
        if sig == "typography_scale" and rng:
            ty = dict(out["typography"]) if isinstance(out.get("typography"), dict) else {}
            slot = "headline_scale" if target == "headline" else f"{target or 'type'}_scale"
            ty[slot] = rng
            out["typography"] = ty
        if sig == "anti_slop" and direction == "avoid" and target:
            if target not in avoid:
                avoid.append(target)
        if sig == "density" and rng:
            tokens = dict(out["tokens"]) if isinstance(out.get("tokens"), dict) else {}
            tokens["density_range"] = rng
            out["tokens"] = tokens
    if avoid:
        out["avoid"] = avoid
    return out


def judge_overall_from_scores(raw: Any) -> dict[str, Any]:
    """Runtime owns overall. LLM-provided overall/total is ignored."""
    src = raw if isinstance(raw, dict) else {}
    scores_in = src.get("scores") if isinstance(src.get("scores"), dict) else src
    scores = clamp_review_scores(scores_in)
    overall = sum_review_scores(scores)
    hits = src.get("anti_slop_hits") if isinstance(src.get("anti_slop_hits"), list) else []
    issues_raw = src.get("top_issues") if isinstance(src.get("top_issues"), list) else []
    issues: list[dict[str, Any]] = []
    for item in issues_raw[:8]:
        if isinstance(item, dict):
            issues.append(JudgeIssueSchema.model_validate(item).model_dump())
    return JudgeVerdictSchema(
        scores=scores,
        overall=overall,
        confidence=_clamp_unit(src.get("confidence"), 0.0),
        anti_slop_hits=[str(x) for x in hits[:8]],
        top_issues=issues,
        pareto=src.get("pareto") if isinstance(src.get("pareto"), dict) else None,
    ).model_dump()


def compute_visual_diff(
    v1: Any,
    v2: Any,
    *,
    pixel_v1: str | None = None,
    pixel_v2: str | None = None,
) -> dict[str, Any]:
    """Geometry always. Pixel metrics only when both screenshots decode."""
    snap1 = SceneVisualSnapshot.model_validate(v1 if isinstance(v1, dict) else {}).model_dump()
    snap2 = SceneVisualSnapshot.model_validate(v2 if isinstance(v2, dict) else {}).model_dump()
    deltas: dict[str, float] = {}
    for key in (
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
    ):
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
    pixel = compute_pixel_diff(pixel_v1, pixel_v2)
    available = bool(pixel.get("status") == "ok")
    return VisualDiffSchema(
        v1=snap1,
        v2=snap2,
        deltas=deltas,
        visual_change=change,
        pixel_available=available,
        pixel=pixel,
    ).model_dump()


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


def compute_pixel_diff(pixel_v1: str | None, pixel_v2: str | None) -> dict[str, Any]:
    """SSIM / pixel / perceptual / edge / layout. HTTP URLs stay unavailable (no fetch)."""
    im1 = _decode_preview_gray(pixel_v1)
    im2 = _decode_preview_gray(pixel_v2)
    if im1 is None or im2 is None:
        return {"status": "unavailable"}
    try:
        from PIL import Image

        w = min(int(im1.size[0]), int(im2.size[0]), 64)
        h = min(int(im1.size[1]), int(im2.size[1]), 64)
        if h < 4 or w < 4:
            return {"status": "unavailable"}
        a = im1.resize((w, h), Image.Resampling.BOX)
        b = im2.resize((w, h), Image.Resampling.BOX)
        pa = _image_pixels(a)
        pb = _image_pixels(b)
        n = float(len(pa)) or 1.0
        diff = sum(abs(int(x) - int(y)) for x, y in zip(pa, pb)) / (n * 255.0)
        ssim = _ssim_gray(pa, pb)
        perceptual = (
            sum((int(x) - int(y)) ** 2 for x, y in zip(pa, pb)) / n
        ) ** 0.5 / 255.0
        e1 = _edge_mag(pa, w, h)
        e2 = _edge_mag(pb, w, h)
        edge = sum(abs(x - y) for x, y in zip(e1, e2)) / (n * 255.0)
        occ1 = _image_pixels(a.resize((16, 16), Image.Resampling.BOX))
        occ2 = _image_pixels(b.resize((16, 16), Image.Resampling.BOX))
        layout = sum(abs(int(x) - int(y)) for x, y in zip(occ1, occ2)) / (
            float(len(occ1) or 1) * 255.0
        )
        return {
            "status": "ok",
            "diff": round(float(diff), 4),
            "ssim": round(float(ssim), 4),
            "perceptual": round(float(perceptual), 4),
            "edge": round(float(edge), 4),
            "layout": round(float(layout), 4),
        }
    except Exception:
        return {"status": "unavailable"}


def _decode_preview_gray(raw: str | None) -> Any:
    text = str(raw or "").strip()
    if not text.startswith("data:image/"):
        return None
    try:
        import base64
        import io
        from PIL import Image

        _header, _, b64 = text.partition(",")
        if not b64:
            return None
        blob = base64.b64decode(b64)
        return Image.open(io.BytesIO(blob)).convert("L")
    except Exception:
        return None


def _image_pixels(im: Any) -> list[Any]:
    fn = getattr(im, "get_flattened_data", None)
    if callable(fn):
        return list(fn())
    return list(im.getdata())


def _edge_mag(pixels: list[Any], w: int, h: int) -> list[int]:
    out = [0] * (w * h)
    for y in range(h - 1):
        row = y * w
        for x in range(w - 1):
            i = row + x
            gx = int(pixels[i + 1]) - int(pixels[i])
            gy = int(pixels[i + w]) - int(pixels[i])
            out[i] = min(255, abs(gx) + abs(gy))
    return out


def _ssim_gray(a: Any, b: Any) -> float:
    seq_a = list(a)
    seq_b = list(b)
    n = float(len(seq_a) or 1)
    mu_a = sum(float(x) for x in seq_a) / n
    mu_b = sum(float(x) for x in seq_b) / n
    var_a = sum((float(x) - mu_a) ** 2 for x in seq_a) / n
    var_b = sum((float(x) - mu_b) ** 2 for x in seq_b) / n
    cov = sum((float(x) - mu_a) * (float(y) - mu_b) for x, y in zip(seq_a, seq_b)) / n
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2
    num = (2 * mu_a * mu_b + c1) * (2 * cov + c2)
    den = (mu_a ** 2 + mu_b ** 2 + c1) * (var_a + var_b + c2)
    if den <= 0:
        return 1.0
    return float(max(0.0, min(1.0, num / den)))


def compute_pareto_scores(
    *,
    overall: int | float | None = None,
    scores: dict[str, Any] | None = None,
    node_count: int | None = None,
    ops_cost: int | None = None,
    whitespace_ratio: float | None = None,
    decoration_area: float | None = None,
) -> dict[str, Any]:
    """Quality + originality + consistency + simplicity + ops_cost. Runtime-owned."""
    src = scores if isinstance(scores, dict) else {}
    quality = int(overall or 0)
    nodes = max(0, int(node_count or 0))
    white = _clamp_unit(whitespace_ratio, 0.2)
    deco = _clamp_unit(decoration_area, 0.1)
    simplicity = int(
        round(
            100.0
            * (
                0.45 * max(0.0, 1.0 - nodes / 40.0)
                + 0.35 * min(1.0, white / 0.4)
                + 0.20 * max(0.0, 1.0 - deco / 0.3)
            )
        )
    )
    cost = 0
    if ops_cost is not None:
        try:
            cost = max(0, int(ops_cost))
        except (TypeError, ValueError):
            cost = 0
    orig = src.get("originality")
    cons = src.get("consistency")
    try:
        orig_n = int(orig) if orig is not None else None
    except (TypeError, ValueError):
        orig_n = None
    try:
        cons_n = int(cons) if cons is not None else None
    except (TypeError, ValueError):
        cons_n = None
    return ParetoScoresSchema(
        quality=quality,
        originality=orig_n,
        consistency=cons_n,
        simplicity=simplicity,
        ops_cost=cost,
    ).model_dump()


def pareto_prefers(challenger: Any, incumbent: Any) -> bool:
    """True when challenger should replace incumbent. 91/38 beats 92/100."""
    a = challenger if isinstance(challenger, dict) else {}
    b = incumbent if isinstance(incumbent, dict) else {}
    if not a or not b:
        return False
    try:
        q_a = int(a.get("quality") or 0)
        q_b = int(b.get("quality") or 0)
    except (TypeError, ValueError):
        return False
    try:
        c_a = int(a["ops_cost"]) if a.get("ops_cost") is not None else None
        c_b = int(b["ops_cost"]) if b.get("ops_cost") is not None else None
    except (TypeError, ValueError):
        c_a, c_b = None, None
    if c_a is None or c_b is None:
        return False
    if q_a >= q_b - PARETO_QUALITY_SLACK and c_a < c_b and (c_a * 2) <= c_b:
        return True
    orig_a = float(a.get("originality") or 0)
    orig_b = float(b.get("originality") or 0)
    cons_a = float(a.get("consistency") or 0)
    cons_b = float(b.get("consistency") or 0)
    simp_a = float(a.get("simplicity") or 0)
    simp_b = float(b.get("simplicity") or 0)
    if (
        q_a >= q_b
        and c_a <= c_b
        and orig_a >= orig_b
        and cons_a >= cons_b
        and simp_a >= simp_b
        and (q_a > q_b or c_a < c_b or orig_a > orig_b or cons_a > cons_b or simp_a > simp_b)
    ):
        return True
    return False


def pareto_explain(challenger: Any, incumbent: Any) -> str:
    a = challenger if isinstance(challenger, dict) else {}
    b = incumbent if isinstance(incumbent, dict) else {}
    if not a or not b:
        return ""
    if not pareto_prefers(a, b):
        return ""
    return (
        f"quality {int(a.get('quality') or 0)} / ops {int(a.get('ops_cost') or 0)} "
        f"preferred over quality {int(b.get('quality') or 0)} / ops {int(b.get('ops_cost') or 0)}"
    )


def _optimization_decision(
    *,
    decision: OptimizationDecisionKind,
    strategy: str,
    reason: str,
    iteration: int,
    targets: list[str] | None = None,
    restore_index: int | None = None,
    cost: int | None = None,
    pareto: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = OptimizationDecisionSchema(
        decision=decision,
        strategy=strategy,
        reason=reason,
        targets=list(targets or []),
        restore_index=restore_index,
        iteration=iteration,
    ).model_dump()
    if cost is not None:
        body["cost"] = cost
    if pareto:
        body["pareto"] = pareto
    return body


def optimization_controller_decide(
    *,
    scores_history: list[int],
    issue_counts: list[int] | None = None,
    iteration: int = 0,
    max_iters: int = OPTIMIZATION_MAX_ITERS,
    pass_at: int = REVIEW_PASS_SCORE,
    diff: dict[str, Any] | None = None,
    cost: int | None = None,
    costs_history: list[int] | None = None,
    pareto_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Stop / continue / rollback. Regression restores the previous snapshot."""
    issues = list(issue_counts or [])
    paretos = [p for p in list(pareto_history or []) if isinstance(p, dict)]
    current_pareto = paretos[-1] if paretos else None
    extra_cost = cost
    if extra_cost is None and costs_history:
        extra_cost = costs_history[-1]
    if not scores_history:
        return _optimization_decision(
            decision="continue",
            strategy="generate",
            reason="no_scores",
            iteration=iteration,
            cost=extra_cost,
            pareto=current_pareto,
        )
    current = int(scores_history[-1])
    if current >= pass_at:
        return _optimization_decision(
            decision="stop",
            strategy="pass",
            reason="pass",
            iteration=iteration,
            cost=extra_cost,
            pareto=current_pareto,
        )
    if iteration >= max_iters:
        return _optimization_decision(
            decision="stop",
            strategy="limit",
            reason="iteration_limit",
            iteration=iteration,
            cost=extra_cost,
            pareto=current_pareto,
        )
    if len(scores_history) >= 2:
        prev = int(scores_history[-2])
        prev_pareto = paretos[-2] if len(paretos) >= 2 else None
        cost_win = pareto_prefers(current_pareto, prev_pareto)
        if current < prev and not cost_win:
            return _optimization_decision(
                decision="rollback",
                strategy="restore",
                reason="regression",
                restore_index=len(scores_history) - 2,
                iteration=iteration,
                cost=extra_cost,
                pareto=current_pareto,
            )
        delta = current - prev
        issues_worse = len(issues) >= 2 and issues[-1] > issues[-2]
        if delta < OPTIMIZATION_MIN_DELTA and not cost_win:
            reason = "issue_reduction" if issues_worse else "score_delta"
            return _optimization_decision(
                decision="stop",
                strategy="no_improve",
                reason=reason,
                iteration=iteration,
                cost=extra_cost,
                pareto=current_pareto,
            )
    deltas = diff.get("deltas") if isinstance(diff, dict) else None
    strategy = "rebuild" if current < REVIEW_REWORK_SCORE else "subtractive"
    targets = (
        ["reduce_headline", "remove_decoration", "increase_whitespace"]
        if strategy == "subtractive"
        else ["rebuild_composition"]
    )
    if isinstance(deltas, dict) and (deltas.get("hero_coverage") or 0) < -0.1:
        targets = ["rebuild_composition", "increase_whitespace"]
        strategy = "rebuild"
    return _optimization_decision(
        decision="continue",
        strategy=strategy,
        reason="improve",
        targets=targets,
        iteration=iteration,
        cost=extra_cost,
        pareto=current_pareto,
    )


def parse_design_research_report(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    inner = (
        data.get("design_research")
        if isinstance(data.get("design_research"), dict)
        else data
    )
    return DesignResearchReportSchema.model_validate(inner or {}).model_dump()


# Fallback paint kits (structural — not content-category lists).
_DEFAULT_PAINT_CREATE_TOOLS = (
    "create_frame",
    "create_shape",
    "create_text",
    "create_icon",
    "create_svg",
    "create_image",
    "create_lottie",
)
_DEFAULT_PAINT_EDIT_TOOLS = (
    "create_shape",
    "create_text",
    "create_icon",
    "create_svg",
    "create_image",
    "create_lottie",
    "update_node",
    "delete_nodes",
)


def _thought_chat_prompt():
    """Canonical LangChain ChatPromptTemplate for Design Agent thought turns."""
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages(
        [
            ("system", "{system}"),
            (
                "human",
                "{recent_dialogue}"
                "USER_PROMPT:\n{prompt}\n\n"
                "CANVAS_SIZE: {canvas_size}\n\n"
                "SCENE: {scene}\n\n"
                "{scene_digest}\n\n"
                "{pending_blocks}"
                "{plan_block}"
                "{memory_block}"
                "{error_block}",
            ),
        ]
    )



@dataclass
class AgentRunState:
    """P1.2 explicit run state for ReAct + audit."""

    trace_id: str
    task_id: str
    goal: str
    round: int = 0
    intent: str = "chat"
    reply: str = ""
    # Ask mode: validated ops held until user picks apply action.
    proposed_ops: list[dict[str, Any]] = field(default_factory=list)
    # Stable id for server-bound Ask confirm (chat + design_task.meta).
    proposal_id: str = ""
    # Ask interaction UI from model: {mode, options:[{label, action}]}.
    choice_ui: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    applied_ops: list[dict[str, Any]] = field(default_factory=list)
    # op_ids already pushed to FE via tool_ops SSE — skip on LangGraph resume.
    emitted_op_ids: list[str] = field(default_factory=list)
    # Design Engine V3 — active AI transaction (BEGIN → chunk → COMMIT/ROLLBACK).
    active_transaction_id: str = ""
    active_transaction_phase: str = ""
    active_transaction_base_revision: int = 0
    reflect_left: int = 1
    reflect_note: str = ""
    painted: bool = False
    total_tokens: int = 0
    family: str = "doubao"
    plan: list[str] = field(default_factory=list)
    dual_picked: bool = False
    images_hydrated: int = 0
    # Host-side image gen (Seedream etc.) ? not ReAct chat tokens.
    images_used: dict[str, int] = field(default_factory=dict)
    # Billing meters / UsageEvent atoms for settle quote (protocol UsageEventSchema).
    billing_meters: dict[str, float] = field(default_factory=dict)
    usage_events: list[dict[str, Any]] = field(default_factory=list)
    # simple | medium | complex ? from precheck.task_tiers matrix
    task_tier: str = ""
    # True when look-at-image (vision model) was selected or switched to
    vision_used: bool = False
    # Deferred tools: op_keys whose full details were injected this run.
    tools_loaded: list[str] = field(default_factory=list)
    # Deferred skill keys injected this run.
    skills_loaded: list[str] = field(default_factory=list)
    # Forked subagents already spawned this run (auto-trigger dedupe).
    subagents_loaded: list[str] = field(default_factory=list)
    # Published Admin flow identity (for run replay).
    flow_id: str = ""
    flow_version: int = 0
    current_node_id: str = ""
    # Langfuse root trace id when CallbackHandler reports last_trace_id.
    langfuse_trace_id: str = ""
    # perf_counter start of this run (Admin duration / step t_ms).
    t0: float = 0.0
    _last_log_t: float = 0.0
    log: list[dict[str, Any]] = field(default_factory=list)

    def push_log(self, **row: Any) -> None:
        now = time.perf_counter()
        entry = {"round": self.round, **{k: v for k, v in row.items() if v is not None}}
        if self.current_node_id and "node_id" not in entry:
            entry["node_id"] = self.current_node_id
        if self.t0 > 0:
            entry.setdefault("t_ms", max(0, int((now - self.t0) * 1000)))
            if self._last_log_t > 0:
                entry.setdefault(
                    "duration_ms", max(0, int((now - self._last_log_t) * 1000))
                )
            self._last_log_t = now
        self.log.append(entry)
        if len(self.log) > 180:
            self.log = self.log[-180:]

    def note_images(self, model_id: str, count: int) -> None:
        n = max(0, int(count or 0))
        mid = (model_id or "").strip()
        if n <= 0 or not mid:
            return
        self.images_hydrated += n
        self.images_used[mid] = self.images_used.get(mid, 0) + n
        self.billing_meters["image.gen"] = float(
            self.billing_meters.get("image.gen", 0) + n
        )

    def note_tokens(self, tokens: int, *, model_id: str = "", source: str = "llm") -> None:
        """Record a usage atom. Caller still owns ``total_tokens`` aggregation."""
        n = max(0, int(tokens or 0))
        if n <= 0:
            return
        self.billing_meters["llm.tokens_out"] = float(
            self.billing_meters.get("llm.tokens_out", 0) + n
        )
        self.usage_events.append(
            {
                "event_id": f"ue_{len(self.usage_events)+1}",
                "source": source or "design_agent",
                "model_id": (model_id or "").strip(),
                "status": "ok",
                "usage": {"output_tokens": n, "total_tokens": n},
            }
        )
        if len(self.usage_events) > 64:
            self.usage_events = self.usage_events[-64:]

    def note_agent_step(self, step: str = "agent.steps") -> None:
        key = (step or "agent.steps").strip() or "agent.steps"
        self.billing_meters[key] = float(self.billing_meters.get(key, 0) + 1)
        self.billing_meters["agent.steps"] = float(
            self.billing_meters.get("agent.steps", 0) + 1
        )

    def note_error(self, err: str) -> None:
        e = (err or "").strip()
        if not e:
            return
        self.errors.append(e[:240])
        if len(self.errors) > 20:
            self.errors = self.errors[-20:]
        self.reflect_note = e[:500]

    def to_execution_log(self) -> dict[str, Any]:
        models_used: dict[str, int] = {}
        for step in self.log:
            mid = _as_text(step.get("model")).strip()
            if not mid:
                continue
            # Skip pure image / route markers without tokens when model is image-only step
            try:
                tok = int(step.get("tokens") or 0)
            except (TypeError, ValueError):
                tok = 0
            phase = _as_text(step.get("phase")).strip()
            # Route / switch / hydrate markers ? tokens live on LLM phases.
            if phase in (
                "route",
                "model_route",
                "model_switch",
                "hydrate",
                "need_tools",
                "tool_details",
                "clarify",
            ) and tok <= 0:
                continue
            models_used[mid] = models_used.get(mid, 0) + max(0, tok)
        return {
            "trace_id": self.trace_id,
            "task_id": self.task_id,
            "goal": (self.goal or "")[:2000],
            "round": self.round,
            "intent": self.intent,
            "errors": list(self.errors),
            "ops_count": len(self.applied_ops),
            "painted": self.painted,
            "total_tokens": self.total_tokens,
            "model": self.family,
            "task_tier": self.task_tier or None,
            "vision_used": bool(self.vision_used),
            "models_used": [
                {"model": mid, "tokens": tok} for mid, tok in models_used.items()
            ],
            "images_hydrated": self.images_hydrated,
            "images_used": [
                {"model": mid, "count": n} for mid, n in self.images_used.items()
            ],
            "plan": list(self.plan),
            "dual_picked": self.dual_picked,
            "tools_loaded": list(self.tools_loaded),
            "skills_loaded": list(self.skills_loaded),
            "subagents_loaded": list(self.subagents_loaded),
            "flow_id": self.flow_id or None,
            "flow_version": self.flow_version or None,
            "total_duration_ms": (
                max(0, int((time.perf_counter() - self.t0) * 1000))
                if self.t0 > 0
                else None
            ),
            "path": [
                str(s.get("phase") or "").strip()
                for s in self.log
                if isinstance(s, dict) and str(s.get("phase") or "").strip()
            ],
            "steps": list(self.log),
        }


@dataclass
class AgentGraphRunInput:
    """Host args for ``run_agent_graph`` (wallet callables stay off graph state)."""

    user_id: str
    mode: str
    prompt: str
    rules: dict[str, str]
    user_selected_model: str | None
    canvas_id: str | None
    canvas_size: str | None
    scene: str | None
    scene_nodes: list[dict[str, Any]]
    scene_frames: list[dict[str, Any]]
    spatial_summary: dict[str, Any] | None
    focus_frame_id: str | None
    images: list[str] | None
    memory_in: dict[str, Any] | None
    session_id: str
    project_id: str
    hold: int
    free_daily: bool
    t0: float
    settle_hold_fn: Any
    refund_hold_fn: Any
    # Stable API-assigned id for worker-backed runs.
    task_id: str | None = None
    apply_ops: list[dict[str, Any]] | None = None
    proposal_id: str | None = None
    proposal_task_id: str | None = None
    interaction_mode: str | None = None
    skill_refs: list[str] | None = None
    locale: str | None = None
    design_intensity: str | None = None


@dataclass
class AgentRuntime:
    """Mutable host context shared across LangGraph nodes."""

    user_id: str
    mode: str
    prompt: str
    rules: dict[str, str]
    user_selected_model: str | None
    canvas_id: str | None
    canvas_size: str | None
    scene_key: str
    scene_nodes: list[dict[str, Any]]
    scene_frames: list[dict[str, Any]]
    focus_id: str
    images: list[str]
    memory_in: dict[str, Any] | None
    session_id: str
    project_id: str
    hold: int
    free_daily: bool
    t0: float
    # Must stay None in graph state — durable checkpointer cannot pickle callables.
    # Real fns live in build._RUN.hold_fns (see ``_bind_design_hold_fns``).
    settle_hold_fn: Any
    refund_hold_fn: Any
    apply_ops: list[dict[str, Any]]
    w: int
    h: int
    run: AgentRunState
    decision: DesignRunDecision
    mem_blocks: str = ""
    mem_short: list[Any] = field(default_factory=list)
    mem_short_all: list[Any] = field(default_factory=list)
    mem_medium: dict[str, Any] = field(default_factory=dict)
    system: str = ""
    size_auto_hint: str = ""
    persona: str = ""
    defer_tools: bool = True
    max_rounds: int = _DEFAULT_MAX_ROUNDS
    pending_tool_details: str = ""
    pending_tool_keys: list[str] = field(default_factory=list)
    pending_skill_details: str = ""
    pending_skill_keys: list[str] = field(default_factory=list)
    pending_subagent_details: str = ""
    turn: dict[str, Any] = field(default_factory=dict)
    step_ops: list[dict[str, Any]] = field(default_factory=list)
    op_errors: list[str] = field(default_factory=list)
    paint_ops: list[dict[str, Any]] = field(default_factory=list)
    last_used: int = 0
    last_reason: str = ""
    last_content: str = ""
    last_think: str = ""
    last_user_msg: str = ""
    last_images: list[str] | None = None
    flags: dict[str, Any] = field(default_factory=dict)
    skip_loop: bool = False
    terminal: bool = False
    fatal: str = ""
    flow_id: str = "lc_design"
    flow_version: int = 0
    current_node_id: str = ""
    # Upstream intent gate (intent_classify); empty when node absent/skipped.
    classified_intent: str = ""
    classified_paint_lane: str = ""
    classified_reply: str = ""
    # Typed intent → execution hand-off.
    design_plan: dict[str, Any] | None = None
    # Decide → paint/review execution contract (structured; format at prompt time).
    design_brief: dict[str, Any] | None = None
    # PR10 Observe QA snapshot (facts only; never SceneDocument).
    observe_facts: dict[str, Any] | None = None
    # FE dual-context map (empty_rects / suggested_place / viewport).
    spatial_summary: dict[str, Any] | None = None
    # Phase 2 slots — empty until P22+. Never written into SceneDocument.
    reference_analyze: dict[str, Any] | None = None
    reference_dna: dict[str, Any] | None = None
    reference_lock: dict[str, Any] | None = None
    design_strategy: dict[str, Any] | None = None
    design_research: dict[str, Any] | None = None
    design_candidates: dict[str, Any] | None = None
    design_tournament: dict[str, Any] | None = None
    design_swarm: dict[str, Any] | None = None
    design_simulation: dict[str, Any] | None = None
    design_counterfactual: dict[str, Any] | None = None
    design_governance: dict[str, Any] | None = None
    autonomous_art_director: dict[str, Any] | None = None
    visual_snapshot: dict[str, Any] | None = None
    visual_diff: dict[str, Any] | None = None
    judge_verdict: dict[str, Any] | None = None
    optimization: dict[str, Any] | None = None


class GraphState(TypedDict):
    rt: AgentRuntime
    tick: NotRequired[int]
