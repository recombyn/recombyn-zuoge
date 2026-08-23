"""Intelligence remote request helpers (open).

``remote_result_usable`` lives in ``recombyn_protocol``.
This module builds ``build_intelligence_request`` (needs Runtime-shaped objects).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

__all__ = [
    "build_intelligence_request",
]


def _as_dict(val: Any) -> dict[str, Any] | None:
    return val if isinstance(val, dict) else None


def _flag(rt: Any, key: str) -> Any:
    flags = getattr(rt, "flags", None)
    if not isinstance(flags, dict):
        return None
    return flags.get(key)


def _images(rt: Any) -> list[str]:
    raw = getattr(rt, "images", None)
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()][:4]


def _painted(rt: Any) -> bool:
    run = getattr(rt, "run", None)
    return bool(getattr(run, "painted", False)) if run is not None else False


_METHOD_CONTEXT: dict[str, tuple[str, ...]] = {
    "analyze_reference": ("reference_dna", "reference_analyze", "reference_lock"),
    "retrieve_memory": ("memory_notes",),
    "research": ("reference_dna", "reference_analyze", "memory_notes", "design_research", "eval_patterns"),
    "strategy": ("design_brief", "design_research", "reference_lock"),
    "propose_candidates": ("design_brief", "design_research", "design_strategy"),
    "tournament": ("design_research", "design_strategy", "design_candidates"),
    "swarm_direction": ("design_research", "design_strategy", "design_tournament"),
    "simulate": ("design_research", "design_strategy", "design_swarm", "observe_facts"),
    "counterfactual": ("design_research", "design_strategy", "design_simulation", "observe_facts"),
    "review": ("design_brief", "design_strategy", "design_simulation", "design_counterfactual", "observe_facts", "judge_verdict"),
    "optimize": ("design_strategy", "design_simulation", "design_counterfactual"),
    "govern": ("design_brief", "design_strategy", "observe_facts", "judge_verdict", "visual_diff"),
    "autonomous_plan": ("design_brief",),
    "autonomous_sync": ("design_brief", "design_research", "design_strategy", "design_candidates", "design_tournament", "design_swarm", "design_simulation", "design_counterfactual", "design_governance", "autonomous_art_director", "observe_facts"),
    "write_principle": ("design_research", "design_strategy", "design_governance"),
}


def _run_id(rt: Any) -> str:
    run = getattr(rt, "run", None)
    return str(
        getattr(run, "task_id", "")
        or getattr(run, "trace_id", "")
        or getattr(rt, "task_id", "")
        or ""
    ).strip()


def build_intelligence_request(method: str, rt: Any) -> dict[str, Any]:
    """JSON body for ``POST {base}/v1/{method}`` (RemoteIntelligenceProvider)."""
    flags = getattr(rt, "flags", None)
    flag_map = dict(flags) if isinstance(flags, dict) else {}
    brief = _as_dict(getattr(rt, "design_brief", None))
    ops = getattr(rt, "apply_ops", None)
    apply_ops = list(ops) if isinstance(ops, list) else []

    canonical = str(method or "").strip()
    values: dict[str, Any] = {
        "design_brief": brief,
        "design_research": _as_dict(getattr(rt, "design_research", None)),
        "design_strategy": _as_dict(getattr(rt, "design_strategy", None)),
        "design_candidates": _as_dict(getattr(rt, "design_candidates", None)),
        "design_tournament": _as_dict(getattr(rt, "design_tournament", None)),
        "design_swarm": _as_dict(getattr(rt, "design_swarm", None)),
        "design_simulation": _as_dict(getattr(rt, "design_simulation", None)),
        "design_counterfactual": _as_dict(getattr(rt, "design_counterfactual", None)),
        "design_governance": _as_dict(getattr(rt, "design_governance", None)),
        "autonomous_art_director": _as_dict(getattr(rt, "autonomous_art_director", None)),
        "reference_dna": _as_dict(getattr(rt, "reference_dna", None)),
        "reference_analyze": _as_dict(getattr(rt, "reference_analyze", None)),
        "reference_lock": _as_dict(getattr(rt, "reference_lock", None)),
        "observe_facts": _as_dict(getattr(rt, "observe_facts", None)),
        "judge_verdict": _as_dict(getattr(rt, "judge_verdict", None)),
        "visual_diff": _as_dict(getattr(rt, "visual_diff", None)),
        "memory_notes": list(_flag(rt, "memory_notes") or []) if isinstance(_flag(rt, "memory_notes"), list) else [],
        "eval_patterns": list(_flag(rt, "eval_patterns") or []) if isinstance(_flag(rt, "eval_patterns"), list) else [],
    }
    body: dict[str, Any] = {
        "method": canonical,
        "run_id": _run_id(rt),
        "prompt": str(getattr(rt, "prompt", "") or ""),
        "scene_key": str(getattr(rt, "scene_key", "") or ""),
        "intent": str(getattr(rt, "classified_intent", "") or ""),
        "flags": {
            key: flag_map[key]
            for key in ("force_autonomous",)
            if key in flag_map
        },
        "images": _images(rt) if canonical in {"analyze_reference", "research", "review"} else [],
        "painted": _painted(rt) if canonical in {"autonomous_sync", "review", "govern"} else False,
        "knowledge_written": bool(_flag(rt, "knowledge_written")) if canonical in {"autonomous_sync", "write_principle"} else False,
        "apply_ops": apply_ops[:80] if canonical in {"govern", "review"} else [],
    }
    for key in _METHOD_CONTEXT.get(canonical, ()):
        body[key] = values.get(key)
    digest = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    body["input_hash"] = hashlib.sha256(digest.encode("utf-8")).hexdigest()[:32]
    return body
