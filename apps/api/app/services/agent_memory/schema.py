"""Agent memory contracts — task state, short-term turns, patches."""

from __future__ import annotations

import copy
import json
from typing import Any

TASK_STATE_VERSION = 1


def empty_design_memory() -> dict[str, Any]:
    """User / Project / Session design slots (P23)."""
    return {
        "user": {
            "preference": {},
            "rejected_patterns": [],
            "accepted_patterns": [],
        },
        "project": {
            "brand_dna": {},
            "design_system": {},
            "reference_dna": {},
        },
        "session": {
            "brief": {},
            "review": {},
            "iteration": 0,
        },
    }


def _as_str_list(raw: Any, *, limit: int = 24) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text[:200])
        if len(out) >= limit:
            break
    return out


def normalize_design_memory(raw: Any) -> dict[str, Any]:
    base = empty_design_memory()
    if not isinstance(raw, dict):
        return base
    extras = {
        k: copy.deepcopy(v)
        for k, v in raw.items()
        if k not in ("user", "project", "session")
    }
    merged = deep_merge(
        base,
        {k: raw[k] for k in ("user", "project", "session") if k in raw},
    )
    user = merged["user"] if isinstance(merged.get("user"), dict) else base["user"]
    if not isinstance(user.get("preference"), dict):
        user["preference"] = {}
    user["rejected_patterns"] = _as_str_list(user.get("rejected_patterns"))
    user["accepted_patterns"] = _as_str_list(user.get("accepted_patterns"))
    merged["user"] = user
    project = merged["project"] if isinstance(merged.get("project"), dict) else base["project"]
    for key in ("brand_dna", "design_system", "reference_dna"):
        if not isinstance(project.get(key), dict):
            project[key] = {}
    merged["project"] = project
    session = merged["session"] if isinstance(merged.get("session"), dict) else base["session"]
    if not isinstance(session.get("brief"), dict):
        session["brief"] = {}
    if not isinstance(session.get("review"), dict):
        session["review"] = {}
    try:
        session["iteration"] = max(0, int(session.get("iteration") or 0))
    except (TypeError, ValueError):
        session["iteration"] = 0
    merged["session"] = session
    merged.update(extras)
    return merged


def slim_brief_for_memory(brief: dict[str, Any] | None) -> dict[str, Any]:
    src = brief if isinstance(brief, dict) else {}
    keep = (
        "purpose",
        "audience",
        "emotion",
        "visual_thesis",
        "visual_hero",
        "composition",
        "avoid",
        "visual_focus",
        "palette",
        "typography",
        "tokens",
        "reference_lock",
        "style_dna",
        "reference_dna",
    )
    out: dict[str, Any] = {}
    for key in keep:
        val = src.get(key)
        if val in (None, "", [], {}):
            continue
        out[key] = copy.deepcopy(val)
    return out


def slim_review_for_memory(review: dict[str, Any] | None) -> dict[str, Any]:
    src = review if isinstance(review, dict) else {}
    scores = src.get("scores") if isinstance(src.get("scores"), dict) else {}
    out: dict[str, Any] = {}
    if scores:
        out["scores"] = scores
    if src.get("total") is not None:
        try:
            out["total"] = int(src.get("total"))
        except (TypeError, ValueError):
            pass
    if src.get("overall") is not None:
        try:
            out["overall"] = int(src.get("overall"))
        except (TypeError, ValueError):
            pass
    action = str(src.get("action") or "").strip()
    if action:
        out["action"] = action
    summary = str(src.get("summary") or "").strip()
    if summary:
        out["summary"] = summary[:400]
    if "must_fix" in src:
        out["must_fix"] = bool(src.get("must_fix"))
    top = src.get("top_issues")
    if isinstance(top, list) and top:
        slim_top: list[dict[str, Any]] = []
        for item in top[:6]:
            if not isinstance(item, dict):
                continue
            slim_top.append(
                {
                    "priority": item.get("priority"),
                    "issue": str(item.get("issue") or "")[:160],
                    "fix": str(item.get("fix") or "")[:160],
                    "lane": str(item.get("lane") or "")[:32],
                    "evidence": [
                        str(x)[:80] for x in list(item.get("evidence") or [])[:4] if str(x).strip()
                    ],
                }
            )
        if slim_top:
            out["top_issues"] = slim_top
    return out


def _preference_candidate_from_long_text(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw.startswith("{"):
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("signal"):
        return None
    key = str(data.get("signal") or "")
    direction = str(data.get("direction") or "")
    target = str(data.get("target") or "")
    data["_key"] = f"{key}:{direction}:{target}"[:80]
    data["committed"] = True
    return data


def user_design_from_long_hits(hits: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Map long-term rows into the User layer. One hit is evidence, not a new commit."""
    preference: dict[str, Any] = {}
    rejected: list[str] = []
    accepted: list[str] = []
    for hit in hits or []:
        if not isinstance(hit, dict):
            continue
        kind = str(hit.get("kind") or "").strip().lower()
        text = str(hit.get("text") or "").strip()
        if not text:
            continue
        if kind in ("rejected", "rejected_pattern"):
            rejected.append(text[:200])
        elif kind in ("accepted", "accepted_pattern"):
            accepted.append(text[:200])
        elif kind == "preference":
            parsed = _preference_candidate_from_long_text(text)
            if parsed:
                key = str(parsed.get("_key") or text[:80])
                preference[key] = parsed
            else:
                preference[text[:80]] = {
                    "kind": "preference",
                    "score": hit.get("score"),
                }
    return {
        "preference": preference,
        "rejected_patterns": _as_str_list(rejected),
        "accepted_patterns": _as_str_list(accepted),
    }


def merge_user_design_layers(
    session_user: dict[str, Any] | None,
    long_user: dict[str, Any] | None,
) -> dict[str, Any]:
    left = session_user if isinstance(session_user, dict) else {}
    right = long_user if isinstance(long_user, dict) else {}
    pref = dict(left.get("preference") or {}) if isinstance(left.get("preference"), dict) else {}
    if isinstance(right.get("preference"), dict):
        for key, val in right["preference"].items():
            existing = pref.get(key)
            if isinstance(existing, dict) and existing.get("signal"):
                continue
            pref[key] = val
    return {
        "preference": pref,
        "rejected_patterns": _as_str_list(
            list(left.get("rejected_patterns") or []) + list(right.get("rejected_patterns") or [])
        ),
        "accepted_patterns": _as_str_list(
            list(left.get("accepted_patterns") or []) + list(right.get("accepted_patterns") or [])
        ),
    }


def overlay_project_design(
    session_project: dict[str, Any] | None,
    stored_project: dict[str, Any] | None,
) -> dict[str, Any]:
    """Current session wins; empty slots fill from the project's last snapshot."""
    base = empty_design_memory()["project"]
    stored = stored_project if isinstance(stored_project, dict) else {}
    current = session_project if isinstance(session_project, dict) else {}
    return deep_merge(deep_merge(base, stored), current)


def build_design_memory_patch(
    *,
    medium: dict[str, Any] | None,
    brief: dict[str, Any] | None = None,
    review: dict[str, Any] | None = None,
    reference_dna: dict[str, Any] | None = None,
    painted: bool = False,
    brand_dna: dict[str, Any] | None = None,
    design_system: dict[str, Any] | None = None,
    user_layer: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Session brief/review/iteration + project DNA. User layer from P24 when provided."""
    existing = normalize_design_memory(
        (medium or {}).get("design") if isinstance(medium, dict) else None
    )
    session = dict(existing["session"])
    user = dict(existing["user"])
    if isinstance(user_layer, dict):
        user = {
            "preference": dict(user_layer.get("preference") or {})
            if isinstance(user_layer.get("preference"), dict)
            else user["preference"],
            "rejected_patterns": list(user_layer.get("rejected_patterns") or user["rejected_patterns"]),
            "accepted_patterns": list(user_layer.get("accepted_patterns") or user["accepted_patterns"]),
        }
    slim_brief = slim_brief_for_memory(brief)
    if slim_brief:
        session["brief"] = slim_brief
    slim_review = slim_review_for_memory(review)
    if slim_review:
        session["review"] = slim_review
    if painted:
        session["iteration"] = int(session.get("iteration") or 0) + 1
    project = dict(existing["project"])
    if isinstance(reference_dna, dict) and reference_dna:
        project["reference_dna"] = copy.deepcopy(reference_dna)
    if isinstance(brand_dna, dict) and brand_dna:
        project["brand_dna"] = copy.deepcopy(brand_dna)
    if isinstance(design_system, dict) and design_system:
        project["design_system"] = copy.deepcopy(design_system)
    return {
        "user": user,
        "project": project,
        "session": session,
    }


def empty_task_state(
    *,
    session_id: str = "",
    project_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    return {
        "v": TASK_STATE_VERSION,
        "session_id": session_id,
        "project_id": project_id,
        "user_id": user_id,
        "config": {},
        "canvas": {
            "focus_frame_id": None,
            "last_agent_frame_id": None,
            "frames": [],
        },
        "design": empty_design_memory(),
        "last_run": None,
        "referents": {},
        # Layered chat context: structured facts + rolling summary (recent turns stay in short).
        "dialogue": {"summary": "", "facts": [], "updated_at": 0.0},
    }


def deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base) if base else {}
    for key, val in (patch or {}).items():
        if val is None:
            continue
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], val)
        else:
            out[key] = copy.deepcopy(val)
    return out


def normalize_task_state(raw: Any, *, session_id: str = "", project_id: str = "", user_id: str = "") -> dict[str, Any]:
    base = empty_task_state(session_id=session_id, project_id=project_id, user_id=user_id)
    if not isinstance(raw, dict):
        return base
    merged = deep_merge(base, raw)
    merged["v"] = TASK_STATE_VERSION
    if session_id:
        merged["session_id"] = session_id
    if project_id:
        merged["project_id"] = project_id
    if user_id:
        merged["user_id"] = user_id
    canvas = merged.get("canvas")
    if not isinstance(canvas, dict):
        merged["canvas"] = base["canvas"]
    else:
        for k in ("focus_frame_id", "last_agent_frame_id"):
            if canvas.get(k) == "":
                canvas[k] = None
    from app.services.agent_memory.short_term import normalize_dialogue_state

    merged["dialogue"] = normalize_dialogue_state(merged.get("dialogue"))
    merged["design"] = normalize_design_memory(merged.get("design"))
    return merged


def trim_short_turn(turn: dict[str, Any]) -> dict[str, Any] | None:
    role = str(turn.get("role") or "").strip().lower()
    if role not in ("user", "assistant"):
        return None
    text = str(turn.get("text") or "").strip()
    if not text:
        return None
    if re_looks_like_markup(text):
        return None
    text = text[:2800]
    out: dict[str, Any] = {"role": role, "text": text}
    tags = turn.get("tags")
    if isinstance(tags, list) and tags:
        out["tags"] = [str(t) for t in tags[:8]]
    return out


def re_looks_like_markup(text: str) -> bool:
    import re

    return bool(re.search(r"<svg\b|</svg>|\{\s*\"tool_ops\"", text, flags=re.I))
