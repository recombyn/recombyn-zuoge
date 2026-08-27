"""Review Agent — optional post-paint craft gate (sparse by default; see review_mode)."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from typing import Any

from langgraph.types import Command

from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    GraphState,
    MULTI_REVIEW_LANES,
    ObserveFactsSchema,
    REVIEW_LANE_CAPS,
    REVIEW_PASS_SCORE,
    REVIEW_REWORK_SCORE,
    REVIEW_SCORE_CAPS,
    ReviewIssueSchema,
    ReviewLaneSchema,
    ReviewTurnSchema,
    clamp_review_scores,
    compute_pareto_scores,
    format_design_brief_for_prompt,
    judge_overall_from_scores,
    optimization_controller_decide,
    pareto_explain,
    sum_review_scores,
)
from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.graph.llm_io import _emit_ux_tip
from app.services.design.runtime.graph.scene_log import _bump
from app.services.design.runtime.host import assemble_stage_system


_log = logging.getLogger(__name__)

# Preview data URLs must not enter durable checkpoints — stash by task_id.
_REVIEW_CTX_LOCK = threading.Lock()
_REVIEW_CTX: dict[str, dict[str, Any]] = {}

_LANE_SIDECAR_NAMES: dict[str, tuple[str, ...]] = {
    "composition": ("visual-review.md", "composition-review.md"),
    "hierarchy": ("hierarchy-review.md",),
    "typography": ("typography-review.md",),
    "color": ("color-review.md",),
    "consistency": ("consistency-review.md",),
    "anti_slop": ("anti-slop-review.md",),
    "originality": ("originality-review.md",),
}
_SLOP_SCENE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("glassmorphism", r"glassmorphism|毛玻璃|玻璃拟态"),
    ("purple gradient", r"purple.?gradient|紫[色]?渐变"),
    ("generic cards", r"generic cards?|equal feature cards"),
    ("particles", r"\bparticles?\b|粒子"),
)


def stash_review_context(
    task_id: str,
    *,
    preview_image: str | None,
    signals: list[str],
) -> None:
    tid = str(task_id or "").strip()
    if not tid:
        return
    with _REVIEW_CTX_LOCK:
        _REVIEW_CTX[tid] = {
            "preview_image": str(preview_image or "").strip() or None,
            "signals": [str(x).strip() for x in (signals or []) if str(x).strip()][:16],
        }


def pop_review_context(task_id: str) -> dict[str, Any]:
    tid = str(task_id or "").strip()
    if not tid:
        return {}
    with _REVIEW_CTX_LOCK:
        return dict(_REVIEW_CTX.pop(tid, {}) or {})


def _review_enabled() -> bool:
    try:
        from app.core.config import settings

        return bool(getattr(settings, "design_review_agent_enabled", True))
    except Exception:
        return True


def _format_review_reflect_note(
    *,
    summary: str,
    fix_brief: str,
    issues: list[dict[str, Any]],
    market_gap: str = "",
    weaknesses: list[str] | None = None,
    total: int | None = None,
    subtraction_actions: list[str] | None = None,
    anti_slop_hits: list[str] | None = None,
    action: str = "repair",
) -> str:
    if action == "rebuild":
        lines = [
            "REVIEW REBUILD (total < 70 — redesign toward DESIGN_BRIEF; do not keep a weak layout):"
        ]
    else:
        lines = [
            "REVIEW REPAIR (70–89 — patch listed issues + subtraction; do not rebuild the whole board):"
        ]
    if total is not None:
        lines.append(f"SCORE: {int(total)}/100")
    brief = str(fix_brief or "").strip()
    if brief:
        lines.append(brief[:480])
    elif summary:
        lines.append(str(summary).strip()[:240])
    gap = str(market_gap or "").strip()
    if gap:
        lines.append(f"MARKET_GAP: {gap[:320]}")
    for hit in list(anti_slop_hits or [])[:4]:
        bit = str(hit or "").strip()
        if bit:
            lines.append(f"SLOP: {bit[:180]}")
    for act in list(subtraction_actions or [])[:4]:
        bit = str(act or "").strip()
        if bit:
            lines.append(f"SUBTRACT: {bit[:180]}")
    for w in list(weaknesses or [])[:4]:
        bit = str(w or "").strip()
        if bit:
            lines.append(f"WEAK: {bit[:180]}")
    for i, row in enumerate(issues[:6], 1):
        sev = str(row.get("severity") or "major").strip()
        issue = str(row.get("issue") or "").strip()
        hint = str(row.get("fix_hint") or "").strip()
        bit = f"{i}. [{sev}] {issue}"
        if hint:
            bit = f"{bit} → {hint}"
        lines.append(bit[:220])
    return "\n".join(lines)[:1100]


def _str_list(raw: Any, *, limit: int = 6) -> list[str]:
    out: list[str] = []
    for item in list(raw or []):
        s = str(item or "").strip()
        if s and s not in out:
            out.append(s[:220])
        if len(out) >= limit:
            break
    return out


def _issues_as_dicts(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in list(raw or []):
        row: dict[str, Any] | None = None
        if isinstance(item, ReviewIssueSchema):
            row = item.model_dump()
        elif isinstance(item, dict):
            try:
                row = ReviewIssueSchema.model_validate(item).model_dump()
            except Exception:
                row = None
        if not row:
            continue
        if not str(row.get("issue") or "").strip() and str(row.get("target") or "").strip():
            act = str(row.get("action") or "patch").strip() or "patch"
            row["issue"] = f"{act} {row['target']}".strip()
        if str(row.get("issue") or "").strip():
            out.append(row)
        if len(out) >= 8:
            break
    return out


_REPAIR_DELETE_ACTIONS = frozenset({"delete"})
_REPAIR_REDUCE_ACTIONS = frozenset({"reduce_size"})
_REPAIR_INCREASE_ACTIONS = frozenset({"increase_size"})
_REPAIR_FORBIDDEN_PATCH_KEYS = frozenset(
    {"nodeid", "id", "frameid", "type", "name", "op_id", "tool"}
)
_REPAIR_PATCH_KEYS = frozenset(
    {
        "fontsize",
        "fontweight",
        "fontfamily",
        "lineheight",
        "letterspacing",
        "text",
        "fill",
        "opacity",
        "stroke",
        "borderwidth",
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "zindex",
        "align",
        "textalign",
    }
)
_REPAIR_ID_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_\-]{1,63}")


def _repair_living_nodes(scene_nodes: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for node in list(scene_nodes or []):
        if not isinstance(node, dict):
            continue
        nid = str(node.get("id") or "").strip()
        if nid:
            out[nid] = node
    return out


def _repair_norm_action(raw: Any) -> str:
    return str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")


def _scene_delta_to_update_args(snap: dict[str, Any], cur: dict[str, Any]) -> dict[str, Any]:
    """Scene snapshot uses w/h; update_node args use width/height."""
    raw: dict[str, Any] = {}
    for key, val in snap.items():
        if key == "id" or val == cur.get(key):
            continue
        raw[key] = val
    if "w" in raw:
        raw["width"] = raw.pop("w")
    if "h" in raw:
        raw["height"] = raw.pop("h")
    return _sanitize_repair_patch(raw)


def _sanitize_repair_patch(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key, val in raw.items():
        name = str(key or "").strip()
        if not name or name.lower() in _REPAIR_FORBIDDEN_PATCH_KEYS:
            continue
        if name.lower() not in _REPAIR_PATCH_KEYS:
            continue
        if val is None:
            continue
        out[name] = val
    return out


def _scale_existing_node(node: dict[str, Any], factor: float) -> dict[str, Any]:
    try:
        fs = float(node.get("fontSize"))
    except (TypeError, ValueError):
        fs = 0.0
    if fs > 0:
        return {"fontSize": max(8, int(round(fs * factor)))}
    try:
        w = float(node.get("w") or 0)
        h = float(node.get("h") or 0)
    except (TypeError, ValueError):
        return {}
    if w <= 8 or h <= 8:
        return {}
    return {"width": max(8, int(round(w * factor))), "height": max(8, int(round(h * factor)))}


def _ids_mentioned(text: str, living: dict[str, dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for tok in _REPAIR_ID_TOKEN.findall(str(text or "")):
        if tok in living and tok not in found:
            found.append(tok)
    return found


def compile_repair_plan_ops(
    issues: list[dict[str, Any]] | None,
    scene_nodes: list[dict[str, Any]] | None,
    subtraction_actions: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Compile Review issues → allowlisted tool_ops. Never creates nodes.

    Review still does not mutate canvas. Runtime owns this compile step.
    Missing / dead targets are skipped; empty result means fall back to Paint.
    """
    living = _repair_living_nodes(scene_nodes)
    if not living:
        return []
    updates: dict[str, dict[str, Any]] = {}
    deletes: list[str] = []

    def mark_delete(nid: str) -> None:
        if nid not in living or nid in deletes:
            return
        deletes.append(nid)
        updates.pop(nid, None)

    def mark_update(nid: str, patch: dict[str, Any]) -> None:
        if nid not in living or nid in deletes or not patch:
            return
        prev = updates.get(nid) or {}
        updates[nid] = {**prev, **patch}

    for item in list(issues or []):
        if not isinstance(item, dict):
            continue
        act = _repair_norm_action(item.get("action"))
        if act.startswith("create"):
            continue
        nid = str(item.get("target") or "").strip()
        if nid not in living:
            continue
        patch = _sanitize_repair_patch(item.get("patch"))
        if act in _REPAIR_DELETE_ACTIONS:
            mark_delete(nid)
            continue
        if patch:
            mark_update(nid, patch)
            continue
        if act in _REPAIR_REDUCE_ACTIONS:
            scaled = _scale_existing_node(living[nid], 0.85)
            if scaled:
                mark_update(nid, scaled)
            continue
        if act in _REPAIR_INCREASE_ACTIONS:
            scaled = _scale_existing_node(living[nid], 1.15)
            if scaled:
                mark_update(nid, scaled)

    for text in list(subtraction_actions or []):
        for nid in _ids_mentioned(str(text or ""), living):
            mark_delete(nid)

    ops: list[dict[str, Any]] = []
    for nid, patch in updates.items():
        ops.append({"name": "update_node", "args": {"nodeId": nid, **patch}})
    if deletes:
        ops.append({"name": "delete_nodes", "args": {"nodeIds": list(deletes)}})
    return ops


_POLISH_DECO_ID = re.compile(
    r"(decor|particle|ornament|accent|spark|glow|flare|noise|sticker)",
    re.I,
)
_POLISH_ALIGN_ISSUE = re.compile(
    r"alignment:\s*([A-Za-z][A-Za-z0-9_\-]*)/([A-Za-z][A-Za-z0-9_\-]*)\s+(left|top)\s+edges",
    re.I,
)
_POLISH_TINY_AREA_RATIO = 0.015
_POLISH_DUP_IOU = 0.82
_POLISH_MAX_DELETES = 4


def _is_image_node(node: dict[str, Any]) -> bool:
    kind = str(node.get("type") or "").strip().lower()
    if kind == "image":
        return True
    return bool(str(node.get("src") or "").strip()) and kind not in ("text",)


def _observe_geom() -> dict[str, Any]:
    from app.services.design.runtime.graph.nodes.observe import (
        _PLATE_AREA_RATIO,
        _box_area,
        _frame_box,
        _intersect_area,
        _is_text_node,
        _node_box,
        _num,
        _pick_focus_frame,
        compute_observe_facts,
    )

    return {
        "plate": _PLATE_AREA_RATIO,
        "box_area": _box_area,
        "frame_box": _frame_box,
        "intersect": _intersect_area,
        "is_text": _is_text_node,
        "node_box": _node_box,
        "num": _num,
        "pick_frame": _pick_focus_frame,
        "compute_facts": compute_observe_facts,
    }


def _polish_facts(raw: Any) -> ObserveFactsSchema:
    if isinstance(raw, ObserveFactsSchema):
        return raw
    if isinstance(raw, dict) and raw:
        try:
            return ObserveFactsSchema.model_validate(raw)
        except Exception:
            return ObserveFactsSchema()
    return ObserveFactsSchema()


def _polish_protected_ids(
    scene_nodes: list[dict[str, Any]],
    scene_frames: list[dict[str, Any]] | None,
    focus_frame_id: str | None,
) -> set[str]:
    g = _observe_geom()
    frame = g["pick_frame"](list(scene_frames or []), list(scene_nodes or []), focus_frame_id)
    fb = g["frame_box"](frame)
    frame_area = max(1.0, fb[2] * fb[3]) if fb else 1.0
    plate = g["plate"]
    protected: set[str] = set()
    texts: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    for node in scene_nodes:
        nid = str(node.get("id") or "").strip()
        box = g["node_box"](node)
        if not nid or box is None:
            continue
        if g["box_area"](box) >= plate * frame_area:
            protected.add(nid)
            continue
        if g["is_text"](node):
            texts.append(node)
        elif _is_image_node(node):
            images.append(node)
    if texts:
        def text_rank(n: dict[str, Any]) -> tuple[float, float]:
            box = g["node_box"](n) or (0.0, 0.0, 0.0, 0.0)
            return (g["num"](n.get("fontSize")), g["box_area"](box))

        protected.add(str(max(texts, key=text_rank).get("id") or "").strip())
    if images:
        def image_rank(n: dict[str, Any]) -> float:
            box = g["node_box"](n) or (0.0, 0.0, 0.0, 0.0)
            return g["box_area"](box)

        protected.add(str(max(images, key=image_rank).get("id") or "").strip())
    return {x for x in protected if x}


def _polish_iou(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    intersect: Any,
    box_area: Any,
) -> float:
    inter = intersect(a, b)
    union = box_area(a) + box_area(b) - inter
    if union <= 0:
        return 0.0
    return inter / union


def _collect_polish_delete_ids(
    scene_nodes: list[dict[str, Any]],
    protected: set[str],
    *,
    subtraction_actions: list[str] | None,
    frame_area: float,
) -> list[str]:
    g = _observe_geom()
    living = _repair_living_nodes(scene_nodes)
    deletes: list[str] = []

    def mark(nid: str) -> None:
        if not nid or nid in protected or nid not in living or nid in deletes:
            return
        if len(deletes) >= _POLISH_MAX_DELETES:
            return
        deletes.append(nid)

    for text in list(subtraction_actions or []):
        for nid in _ids_mentioned(str(text or ""), living):
            mark(nid)

    boxed: list[tuple[dict[str, Any], tuple[float, float, float, float]]] = []
    for node in scene_nodes:
        box = g["node_box"](node)
        if box is None:
            continue
        boxed.append((node, box))

    for node, box in boxed:
        nid = str(node.get("id") or "").strip()
        if nid in protected:
            continue
        area = g["box_area"](box)
        named = bool(_POLISH_DECO_ID.search(nid))
        tiny = area < _POLISH_TINY_AREA_RATIO * frame_area
        deco_kind = (not g["is_text"](node)) and (not _is_image_node(node))
        if deco_kind and (named or tiny):
            mark(nid)

    for i, (na, ba) in enumerate(boxed):
        ida = str(na.get("id") or "").strip()
        for nb, bb in boxed[i + 1 :]:
            idb = str(nb.get("id") or "").strip()
            if not ida or not idb:
                continue
            if str(na.get("type") or "") != str(nb.get("type") or ""):
                continue
            if _polish_iou(ba, bb, g["intersect"], g["box_area"]) < _POLISH_DUP_IOU:
                continue
            smaller = ida if g["box_area"](ba) <= g["box_area"](bb) else idb
            mark(smaller)
    return deletes


def _collect_polish_align_ops(
    facts: ObserveFactsSchema,
    living: dict[str, dict[str, Any]],
    deleted: set[str],
) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()
    for line in list(facts.alignment_issues or [])[:6]:
        m = _POLISH_ALIGN_ISSUE.search(str(line or ""))
        if not m:
            continue
        a, b, edge = m.group(1), m.group(2), m.group(3).lower()
        if a in deleted or b in deleted or a not in living or b not in living:
            continue
        key = tuple(sorted((a, b)) + [edge])
        if key in seen:
            continue
        seen.add(key)
        ops.append(
            {
                "name": "align_nodes",
                "args": {"nodeIds": [a, b], "mode": "left" if edge == "left" else "top"},
            }
        )
        if len(ops) >= 3:
            break
    return ops


def compile_polish_ops(
    scene_nodes: list[dict[str, Any]] | None,
    scene_frames: list[dict[str, Any]] | None = None,
    *,
    observe_facts: Any = None,
    subtraction_actions: list[str] | None = None,
    issues: list[dict[str, Any]] | None = None,
    focus_frame_id: str | None = None,
) -> list[dict[str, Any]]:
    """Subtraction polish: remove / merge / align / reduce. Never create_*.

    Review still does not mutate canvas. Runtime compiles one polish pass
    on pass (or before settle). Hero / H1 / full-bleed plates are protected.
    """
    nodes = [n for n in list(scene_nodes or []) if isinstance(n, dict) and n.get("id")]
    if not nodes:
        return []
    g = _observe_geom()
    frames = [f for f in list(scene_frames or []) if isinstance(f, dict) and f.get("id")]
    facts = _polish_facts(observe_facts)
    if observe_facts is None:
        facts = g["compute_facts"](
            nodes=nodes,
            frames=frames,
            painted=True,
            focus_frame_id=focus_frame_id,
        )
    frame = g["pick_frame"](frames, nodes, focus_frame_id)
    fb = g["frame_box"](frame)
    frame_area = max(1.0, fb[2] * fb[3]) if fb else 1.0
    protected = _polish_protected_ids(nodes, frames, focus_frame_id)
    living = _repair_living_nodes(nodes)

    deletes = _collect_polish_delete_ids(
        nodes,
        protected,
        subtraction_actions=subtraction_actions,
        frame_area=frame_area,
    )
    deleted = set(deletes)

    updates: dict[str, dict[str, Any]] = {}
    for item in list(issues or []):
        if not isinstance(item, dict):
            continue
        act = _repair_norm_action(item.get("action"))
        if act.startswith("create") or act in _REPAIR_DELETE_ACTIONS:
            continue
        nid = str(item.get("target") or "").strip()
        if nid not in living or nid in deleted or nid in protected:
            continue
        patch = _sanitize_repair_patch(item.get("patch"))
        if not patch and act in _REPAIR_REDUCE_ACTIONS:
            patch = _scale_existing_node(living[nid], 0.9)
        if patch:
            prev = updates.get(nid) or {}
            updates[nid] = {**prev, **patch}

    ops: list[dict[str, Any]] = []
    for nid, patch in updates.items():
        ops.append({"name": "update_node", "args": {"nodeId": nid, **patch}})
    ops.extend(_collect_polish_align_ops(facts, living, deleted))
    if deletes:
        ops.append({"name": "delete_nodes", "args": {"nodeIds": list(deletes)}})
    return [
        op
        for op in ops
        if not str(op.get("name") or "").startswith("create_")
    ]


def _apply_score_gate(
    *,
    scores: dict[str, int],
    total: int,
    issues: list[dict[str, Any]],
    anti_slop_hits: list[str],
    passed: bool,
    must_fix: bool,
) -> tuple[bool, bool, str]:
    """Map Runtime total → pass / must_fix / rebuild|repair|pass.

    LLM pass/must_fix/total are ignored once scores exist.
    <70 or blocker → rebuild; 70–89 or major/slop → repair; 90+ clean → pass.
    """
    has_blocker = any(str(x.get("severity") or "") == "blocker" for x in issues)
    has_major = any(str(x.get("severity") or "") == "major" for x in issues)
    if anti_slop_hits:
        has_major = True
    if total < REVIEW_REWORK_SCORE or has_blocker:
        return False, True, "rebuild"
    if total < REVIEW_PASS_SCORE or has_major:
        return False, True, "repair"
    return True, False, "pass"


def _parse_review_structured(raw: Any) -> dict[str, Any]:
    if isinstance(raw, ReviewTurnSchema):
        data = raw.model_dump(by_alias=True)
    elif isinstance(raw, dict):
        data = dict(raw)
    else:
        data = {}
    issues = _issues_as_dicts(data.get("issues"))
    scores = clamp_review_scores(data.get("scores"))
    # Runtime owns total — never trust LLM-provided total.
    total = sum_review_scores(scores)
    anti_slop = _str_list(data.get("anti_slop_hits"), limit=8)
    subtraction = _str_list(data.get("subtraction_actions"), limit=8)
    passed = bool(data.get("pass") if "pass" in data else data.get("pass_"))
    must_fix = bool(data.get("must_fix"))
    action = "pass" if passed and not must_fix else "repair"
    if passed:
        must_fix = False
    elif not must_fix and any(
        str(x.get("severity") or "") in ("blocker", "major") for x in issues
    ):
        must_fix = True
        action = "repair"
    if scores and any(v > 0 for v in scores.values()):
        passed, must_fix, action = _apply_score_gate(
            scores=scores,
            total=total,
            issues=issues,
            anti_slop_hits=anti_slop,
            passed=passed,
            must_fix=must_fix,
        )
    return {
        "pass": passed,
        "summary": str(data.get("summary") or "").strip(),
        "strengths": _str_list(data.get("strengths")),
        "weaknesses": _str_list(data.get("weaknesses")),
        "market_gap": str(data.get("market_gap") or "").strip()[:600],
        "scores": scores,
        "total": total,
        "anti_slop_hits": anti_slop,
        "subtraction_actions": subtraction,
        "must_fix": must_fix,
        "review_action": action,
        "fix_brief": str(data.get("fix_brief") or "").strip(),
        "issues": issues,
        "lanes": list(data.get("lanes") or []) if isinstance(data.get("lanes"), list) else [],
    }


def _hero_target_from_brief(brief: dict[str, Any] | None) -> float | None:
    if not isinstance(brief, dict):
        return None
    comp = brief.get("composition")
    rules = comp.get("rules") if isinstance(comp, dict) else None
    raw = rules.get("hero_coverage") if isinstance(rules, dict) else None
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        n = float(raw)
        return n if n <= 1.0 else n / 100.0
    text = str(raw).strip().replace("%", "")
    try:
        n = float(text)
    except ValueError:
        return None
    return n if n <= 1.0 else n / 100.0


def _avoid_list(brief: dict[str, Any] | None) -> list[str]:
    if not isinstance(brief, dict):
        return []
    raw = brief.get("avoid")
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()][:12]


def content_score_from_issues(issues: list[dict[str, Any]] | None) -> int:
    """Fill the content cap from content-area issues. Not a 8th lane percent."""
    cap = int(REVIEW_SCORE_CAPS.get("content") or 10)
    penalty = 0
    for item in issues or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("area") or "").strip().lower() != "content":
            continue
        sev = str(item.get("severity") or "").strip().lower()
        if sev == "blocker":
            penalty += 6
        elif sev == "major":
            penalty += 4
        else:
            penalty += 2
    return max(0, min(cap, cap - penalty))


def _excerpt_lane_sidecar(docs: str, lane: str) -> str:
    text = str(docs or "")
    if not text:
        return ""
    for name in _LANE_SIDECAR_NAMES.get(lane, (f"{lane}-review.md",)):
        marker = f"### review/{name}"
        start = text.find(marker)
        if start < 0:
            continue
        rest = text[start + len(marker) :]
        nxt = rest.find("\n### ")
        body = rest if nxt < 0 else rest[:nxt]
        return f"{marker}\n{body.strip()}".strip()
    return ""


def _lane_skill_craft(rt: AgentRuntime, lane: str) -> str:
    chunks: list[str] = []
    pending = str(getattr(rt, "pending_skill_details", "") or "")
    excerpt = _excerpt_lane_sidecar(pending, lane)
    if excerpt:
        chunks.append(excerpt)
    keys = list(getattr(rt.run, "skills_loaded", None) or [])
    if keys:
        try:
            from app.services.design.prompts.skill_store.pack_io import _SKILL_GRAPH

            for key in keys[:8]:
                graph = _SKILL_GRAPH.get(str(key).strip().lower()) or {}
                docs = str(graph.get("review_docs") or "")
                bit = _excerpt_lane_sidecar(docs, lane)
                if bit and bit not in chunks:
                    chunks.append(bit)
        except Exception:
            pass
    return "\n\n".join(chunks).strip()[:2000]


def _match_anti_slop_hits(scene_text: str, avoid: list[str]) -> list[str]:
    blob = f"{scene_text or ''}".lower()
    hits: list[str] = []
    for item in avoid:
        token = str(item or "").strip()
        if token and token.lower() in blob and token not in hits:
            hits.append(token)
    for name, pat in _SLOP_SCENE_PATTERNS:
        if name in hits:
            continue
        if re.search(pat, blob, flags=re.I):
            hits.append(name)
    return hits[:8]


def deterministic_lane_seed(
    lane: str,
    *,
    brief: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    scene_text: str = "",
) -> dict[str, Any]:
    """Facts-only seed for one lane. Missing hops stay empty; no taste invention."""
    lid = str(lane or "").strip().lower()
    facts = observe_facts if isinstance(observe_facts, dict) else {}
    evidence: list[str] = []
    issues: list[dict[str, Any]] = []
    hits: list[str] = []
    score: int | None = None
    cap = REVIEW_LANE_CAPS.get(lid)

    if lid == "composition":
        actual = facts.get("hero_coverage")
        target = _hero_target_from_brief(brief)
        if isinstance(actual, (int, float)):
            evidence.append(f"hero_coverage={round(float(actual) * 100)}%")
            if target is not None:
                evidence.append(f"brief_hero={round(float(target) * 100)}%")
                if float(actual) < float(target) * 0.75:
                    score = 8
                    issues.append(
                        {
                            "severity": "major",
                            "area": "composition",
                            "lane": "composition",
                            "issue": (
                                f"hero {round(float(actual) * 100)}% below "
                                f"brief {round(float(target) * 100)}%"
                            ),
                            "fix_hint": "Enlarge the hero; cut competing secondary shapes.",
                            "action": "reduce_size",
                        }
                    )
                elif float(actual) < float(target):
                    score = 14
                else:
                    score = 18
        if facts.get("whitespace_fail"):
            evidence.append("whitespace_fail")
            score = min(score if score is not None else 16, 12)
        if facts.get("overlap"):
            evidence.append("overlap")
            score = min(score if score is not None else 16, 10)
    elif lid == "hierarchy":
        if facts.get("typography_hierarchy_ok") is False:
            evidence.append("typography_hierarchy_ok=false")
            score = 10
            issues.append(
                {
                    "severity": "major",
                    "area": "hierarchy",
                    "lane": "hierarchy",
                    "issue": "title and support type share equal weight",
                    "fix_hint": "Drop support type size; keep one primary focal.",
                    "action": "reduce_size",
                }
            )
        ratio = facts.get("h1_h2_ratio")
        if isinstance(ratio, (int, float)):
            evidence.append(f"h1_h2_ratio={round(float(ratio), 2)}")
            if score is None:
                score = 16 if float(ratio) >= 1.4 else 11
    elif lid == "typography":
        if facts.get("text_overflow"):
            evidence.append("text_overflow")
            score = 8
            issues.append(
                {
                    "severity": "major",
                    "area": "typography",
                    "lane": "typography",
                    "issue": "text overflows its box",
                    "fix_hint": "Reduce type size or shorten copy.",
                    "action": "reduce_size",
                }
            )
        if facts.get("line_height_tight"):
            evidence.append("line_height_tight")
            score = min(score if score is not None else 12, 10)
    elif lid == "anti_slop":
        hits = _match_anti_slop_hits(scene_text, _avoid_list(brief))
        if hits:
            evidence.extend(hits)
            issues.append(
                {
                    "severity": "major",
                    "area": "aesthetic",
                    "lane": "anti_slop",
                    "issue": "anti-slop hits: " + ", ".join(hits[:4]),
                    "fix_hint": "Remove matched slop; restore DESIGN_BRIEF avoid[].",
                    "action": "delete",
                }
            )

    if cap is not None and score is None and (evidence or issues):
        score = int(round(cap * 0.7))
    return {
        "lane": lid,
        "score": score,
        "evidence": evidence,
        "issues": issues,
        "anti_slop_hits": hits,
        "strengths": [],
        "source": "seed",
    }


def parse_review_lane(
    lane: str,
    raw: Any,
    *,
    seed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize one lane payload. LLM score is this dimension only."""
    lid = str(lane or "").strip().lower()
    if lid not in MULTI_REVIEW_LANES:
        lid = str((seed or {}).get("lane") or lid)
    data: dict[str, Any] = {}
    if isinstance(raw, ReviewLaneSchema):
        data = raw.model_dump()
    elif isinstance(raw, dict):
        data = dict(raw)
    base = seed if isinstance(seed, dict) else {}
    cap = REVIEW_LANE_CAPS.get(lid)
    evidence = _str_list(
        list(base.get("evidence") or []) + list(data.get("evidence") or []),
        limit=8,
    )
    hits = _str_list(
        list(base.get("anti_slop_hits") or []) + list(data.get("anti_slop_hits") or []),
        limit=8,
    )
    issues = _issues_as_dicts(
        list(base.get("issues") or []) + list(data.get("issues") or [])
    )
    for item in issues:
        if not str(item.get("lane") or "").strip():
            item["lane"] = lid
        area = str(item.get("area") or "").strip()
        if not area or area == "layout":
            item["area"] = "aesthetic" if lid == "anti_slop" else lid
    score_raw = data.get("score")
    if score_raw is None:
        score_raw = base.get("score")
    score: int | None = None
    if cap is not None:
        if score_raw is None:
            score = None
        else:
            try:
                score = max(0, min(cap, int(round(float(score_raw)))))
            except (TypeError, ValueError):
                score = None
    source = "llm" if data else str(base.get("source") or "seed")
    if data and base.get("source") == "seed":
        source = "seed+llm"
    return {
        "lane": lid,
        "score": score,
        "evidence": evidence,
        "issues": issues,
        "anti_slop_hits": hits,
        "strengths": _str_list(
            list(base.get("strengths") or []) + list(data.get("strengths") or []),
            limit=4,
        ),
        "source": source,
    }


def merge_review_lanes(lanes: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Host merge: 6 scored lanes + content cap + anti_slop hits. Runtime owns total."""
    by_lane: dict[str, dict[str, Any]] = {}
    for row in lanes or []:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("lane") or "").strip().lower()
        if lid in MULTI_REVIEW_LANES:
            by_lane[lid] = row
    for lid in MULTI_REVIEW_LANES:
        if lid not in by_lane:
            by_lane[lid] = parse_review_lane(lid, {}, seed=deterministic_lane_seed(lid))

    llm_any = any(str(by_lane[lid].get("source") or "").find("llm") >= 0 for lid in MULTI_REVIEW_LANES)
    det_findings = any(
        (by_lane[lid].get("issues") or by_lane[lid].get("anti_slop_hits"))
        for lid in MULTI_REVIEW_LANES
    )
    ordered = [by_lane[lid] for lid in MULTI_REVIEW_LANES]
    if not llm_any and not det_findings:
        raise RuntimeError(
            "review_lanes_unavailable: no LLM or deterministic review findings"
        )

    scores_raw: dict[str, int] = {}
    hits: list[str] = []
    issues: list[dict[str, Any]] = []
    strengths: list[str] = []
    subtraction: list[str] = []
    summary_parts: list[str] = []
    for row in ordered:
        lid = str(row.get("lane") or "")
        cap = REVIEW_LANE_CAPS.get(lid)
        score = row.get("score")
        if cap is not None and score is None:
            score = int(round(cap * 0.75))
            row["score"] = score
        if lid in REVIEW_SCORE_CAPS and isinstance(score, (int, float)):
            scores_raw[lid] = int(score)
        hits.extend(list(row.get("anti_slop_hits") or []))
        for item in list(row.get("issues") or []):
            if isinstance(item, dict):
                issues.append(item)
                act = str(item.get("action") or "").strip().lower()
                if act in _REPAIR_DELETE_ACTIONS and item.get("target"):
                    subtraction.append(str(item.get("target")))
        strengths.extend(list(row.get("strengths") or []))
        if lid == "anti_slop":
            summary_parts.append(f"anti_slop hits={len(row.get('anti_slop_hits') or [])}")
        else:
            summary_parts.append(f"{lid} {row.get('score')}/{cap or 0}")

    scores_raw["content"] = content_score_from_issues(issues)
    scores = clamp_review_scores(scores_raw)
    first_fix = ""
    for item in issues:
        hint = str(item.get("fix_hint") or "").strip()
        if hint:
            first_fix = hint
            break
    return {
        "scores": scores,
        "anti_slop_hits": _str_list(hits, limit=8),
        "issues": issues[:8],
        "strengths": _str_list(strengths, limit=6),
        "weaknesses": [
            str(x.get("issue") or "").strip()
            for x in issues[:6]
            if str(x.get("issue") or "").strip()
        ],
        "subtraction_actions": _str_list(subtraction, limit=8),
        "summary": "; ".join(summary_parts)[:400],
        "fix_brief": first_fix[:480],
        "lanes": ordered,
        "market_gap": "",
        "pass": False,
        "must_fix": True,
    }


def _lane_evidence_map(lanes: list[dict[str, Any]] | None) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for row in lanes or []:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("lane") or "").strip()
        if not lid:
            continue
        bits = _str_list(
            list(row.get("evidence") or []) + list(row.get("anti_slop_hits") or []),
            limit=6,
        )
        if bits:
            out[lid] = bits
    return out


def _pct_delta_line(label: str, before: Any, after: Any, delta: Any) -> str | None:
    try:
        a = float(before)
        b = float(after)
        d = float(delta)
    except (TypeError, ValueError):
        return None
    if abs(d) < 0.005:
        return None
    return f"{label} {a:.0%} → {b:.0%} ({d:+.0%})"


def visual_diff_evidence(visual_diff: dict[str, Any] | None) -> list[str]:
    """Hero / whitespace geometry lines for Judge. Pixel status is extra, not taste."""
    if not isinstance(visual_diff, dict):
        return []
    v1 = visual_diff.get("v1") if isinstance(visual_diff.get("v1"), dict) else {}
    v2 = visual_diff.get("v2") if isinstance(visual_diff.get("v2"), dict) else {}
    deltas = visual_diff.get("deltas") if isinstance(visual_diff.get("deltas"), dict) else {}
    out: list[str] = []
    hero = _pct_delta_line(
        "hero",
        v1.get("hero_coverage"),
        v2.get("hero_coverage"),
        deltas.get("hero_coverage"),
    )
    if hero:
        out.append(hero)
    white = _pct_delta_line(
        "whitespace",
        v1.get("whitespace_ratio"),
        v2.get("whitespace_ratio"),
        deltas.get("whitespace_ratio"),
    )
    if white:
        out.append(white)
    return out[:4]


def slim_visual_diff_for_judge(visual_diff: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(visual_diff, dict):
        return None
    pixel = visual_diff.get("pixel") if isinstance(visual_diff.get("pixel"), dict) else {}
    slim_pixel = {
        key: pixel[key]
        for key in ("status", "diff", "ssim", "perceptual", "edge", "layout")
        if key in pixel
    }
    return {
        "deltas": visual_diff.get("deltas") if isinstance(visual_diff.get("deltas"), dict) else {},
        "visual_change": visual_diff.get("visual_change"),
        "pixel_available": bool(visual_diff.get("pixel_available")),
        "pixel": slim_pixel or {"status": "unavailable"},
    }


def _judge_confidence(lanes: list[dict[str, Any]] | None) -> float:
    rows = [r for r in (lanes or []) if isinstance(r, dict)]
    if not rows:
        return 0.0
    n = 0.0
    for row in rows:
        src = str(row.get("source") or "")
        if "llm" in src:
            n += 1.0
        elif row.get("evidence") or row.get("issues") or row.get("anti_slop_hits"):
            n += 0.6
        elif row.get("score") is not None:
            n += 0.3
    return round(min(1.0, n / max(1, len(MULTI_REVIEW_LANES))), 2)


def build_judge_top_issues(
    *,
    lanes: list[dict[str, Any]] | None = None,
    issues: list[dict[str, Any]] | None = None,
    anti_slop_hits: list[str] | None = None,
    visual_diff: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rank lane findings. priority 1 = highest. Never invent tool_ops."""
    ev_map = _lane_evidence_map(lanes)
    geo = visual_diff_evidence(visual_diff)
    if geo:
        ev_map["composition"] = _str_list(
            list(ev_map.get("composition") or []) + geo, limit=6
        )
    ranked: list[tuple[int, dict[str, Any]]] = []
    seen: set[str] = set()

    def _accept(text: str) -> bool:
        key = str(text or "").strip().lower()
        if not key or key in seen:
            return False
        seen.add(key)
        return True

    for item in issues or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("issue") or "").strip()
        if not _accept(text):
            continue
        sev = str(item.get("severity") or "").strip().lower()
        lane = str(item.get("lane") or "").strip()
        if lane == "aesthetic":
            lane = "anti_slop"
        if sev == "blocker":
            rank = 0
        elif lane == "anti_slop" or sev == "major":
            rank = 1 if lane == "anti_slop" else 2
        else:
            rank = 4
        evidence = _str_list(
            list(item.get("evidence") or []) + list(ev_map.get(lane) or []),
            limit=4,
        )
        ranked.append(
            (
                rank,
                {
                    "issue": text[:200],
                    "evidence": evidence,
                    "fix": str(item.get("fix_hint") or "").strip()[:200],
                    "lane": lane,
                },
            )
        )

    for hit in _str_list(anti_slop_hits, limit=8):
        if any(hit.lower() in str(row["issue"]).lower() for _r, row in ranked):
            continue
        label = f"anti-slop: {hit}"
        if not _accept(label):
            continue
        ranked.append(
            (
                1,
                {
                    "issue": label[:200],
                    "evidence": [hit],
                    "fix": "Remove matched slop; restore DESIGN_BRIEF avoid[].",
                    "lane": "anti_slop",
                },
            )
        )

    covered = {str(row.get("lane") or "") for _r, row in ranked}
    for row in lanes or []:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("lane") or "").strip()
        cap = REVIEW_LANE_CAPS.get(lid)
        score = row.get("score")
        if cap is None or lid in covered or not isinstance(score, (int, float)):
            continue
        if float(score) >= cap * 0.5:
            continue
        text = f"{lid} weak ({int(score)}/{cap})"
        if not _accept(text):
            continue
        ranked.append(
            (
                3,
                {
                    "issue": text,
                    "evidence": list(ev_map.get(lid) or [])[:4],
                    "fix": f"Raise {lid} toward DESIGN_BRIEF.",
                    "lane": lid,
                },
            )
        )

    ranked.sort(key=lambda item: (item[0], item[1]["issue"]))
    out: list[dict[str, Any]] = []
    for i, (_rank, row) in enumerate(ranked[:8], start=1):
        out.append(
            {
                "priority": i,
                "issue": row["issue"],
                "evidence": row["evidence"],
                "fix": row["fix"],
                "lane": row["lane"],
            }
        )
    return out


def compose_judge_verdict(
    *,
    scores: dict[str, Any] | None = None,
    lanes: list[dict[str, Any]] | None = None,
    issues: list[dict[str, Any]] | None = None,
    anti_slop_hits: list[str] | None = None,
    llm_overall: Any = None,
    visual_diff: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Judge merge. Runtime overall ignores LLM total. Does not mutate canvas."""
    top = build_judge_top_issues(
        lanes=lanes,
        issues=issues,
        anti_slop_hits=anti_slop_hits,
        visual_diff=visual_diff,
    )
    judge = judge_overall_from_scores(
        {
            "scores": scores or {},
            "overall": llm_overall,
            "total": llm_overall,
            "confidence": _judge_confidence(lanes),
            "anti_slop_hits": list(anti_slop_hits or [])[:8],
            "top_issues": top,
        }
    )
    slim = slim_visual_diff_for_judge(visual_diff)
    if slim:
        judge["visual_diff"] = slim
    return judge


def attach_judge(rt: AgentRuntime, verdict: dict[str, Any]) -> dict[str, Any]:
    """Write judge_verdict onto Runtime (never SceneDocument)."""
    visual_diff = rt.visual_diff if isinstance(rt.visual_diff, dict) else None
    if visual_diff is None and isinstance(verdict.get("visual_diff"), dict):
        visual_diff = verdict.get("visual_diff")
    judge = compose_judge_verdict(
        scores=verdict.get("scores") if isinstance(verdict.get("scores"), dict) else {},
        lanes=verdict.get("lanes") if isinstance(verdict.get("lanes"), list) else [],
        issues=verdict.get("issues") if isinstance(verdict.get("issues"), list) else [],
        anti_slop_hits=verdict.get("anti_slop_hits")
        if isinstance(verdict.get("anti_slop_hits"), list)
        else [],
        llm_overall=verdict.get("overall"),
        visual_diff=visual_diff,
    )
    rt.judge_verdict = judge
    verdict["judge"] = judge
    snap = rt.visual_snapshot if isinstance(rt.visual_snapshot, dict) else {}
    pareto = compute_pareto_scores(
        overall=judge.get("overall"),
        scores=judge.get("scores") if isinstance(judge.get("scores"), dict) else {},
        node_count=len(rt.scene_nodes or []),
        ops_cost=_optimization_ops_cost(rt),
        whitespace_ratio=snap.get("whitespace_ratio"),
        decoration_area=snap.get("decoration_area"),
    )
    judge["pareto"] = pareto
    return judge


def _optimization_ops_cost(rt: AgentRuntime) -> int:
    ops = list(rt.paint_ops or []) or list(rt.step_ops or [])
    if ops:
        return len(ops)
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    for key in ("repair_ops_count", "polish_ops_count"):
        try:
            n = int(flags.get(key) or 0)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return n
    return 0


def _slim_restore_node(node: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    nid = str(node.get("id") or "").strip()
    if nid:
        out["id"] = nid
    for key in (
        "x",
        "y",
        "w",
        "h",
        "fontSize",
        "fill",
        "text",
        "opacity",
        "rotation",
        "zIndex",
        "align",
        "textAlign",
        "fontWeight",
        "fontFamily",
        "lineHeight",
        "letterSpacing",
        "stroke",
        "borderWidth",
        "color",
    ):
        if node.get(key) is not None:
            out[key] = node.get(key)
    return out


def compile_restore_ops(
    current_nodes: list[dict[str, Any]] | None,
    snapshot_nodes: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Restore Vn geometry via update/delete. Never create_*. Review does not write canvas."""
    living = _repair_living_nodes(current_nodes)
    want = _repair_living_nodes(snapshot_nodes)
    if not living or not want:
        return []
    ops: list[dict[str, Any]] = []
    extra = [nid for nid in living if nid not in want]
    for nid, snap in want.items():
        cur = living.get(nid)
        if not cur:
            continue
        patch = _scene_delta_to_update_args(snap, cur)
        if patch:
            ops.append({"name": "update_node", "args": {"nodeId": nid, **patch}})
    if extra:
        ops.append({"name": "delete_nodes", "args": {"nodeIds": extra}})
    return ops


def run_optimization_controller(rt: AgentRuntime, verdict: dict[str, Any]) -> dict[str, Any]:
    """Record snapshot, decide stop/continue/rollback. Never mutates canvas."""
    judge = rt.judge_verdict if isinstance(rt.judge_verdict, dict) else {}
    overall = int(judge.get("overall") or 0)
    issues = verdict.get("issues") if isinstance(verdict.get("issues"), list) else []
    snap = rt.visual_snapshot if isinstance(rt.visual_snapshot, dict) else {}
    cost = _optimization_ops_cost(rt)
    pareto = judge.get("pareto") if isinstance(judge.get("pareto"), dict) else None
    if not pareto:
        pareto = compute_pareto_scores(
            overall=overall,
            scores=judge.get("scores") if isinstance(judge.get("scores"), dict) else {},
            node_count=len(rt.scene_nodes or []),
            ops_cost=cost,
            whitespace_ratio=snap.get("whitespace_ratio"),
            decoration_area=snap.get("decoration_area"),
        )
        if isinstance(rt.judge_verdict, dict):
            rt.judge_verdict["pareto"] = pareto
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    hist = flags.get("optimization_history")
    if not isinstance(hist, list):
        hist = []
        flags["optimization_history"] = hist
    hist.append(
        {
            "iteration": len(hist),
            "overall": overall,
            "issue_count": len(issues),
            "ops_cost": cost,
            "pareto": pareto,
            "nodes": [
                _slim_restore_node(n)
                for n in list(rt.scene_nodes or [])
                if isinstance(n, dict) and n.get("id")
            ],
        }
    )
    if len(hist) > 6:
        del hist[:-6]
    prev_pareto = hist[-2].get("pareto") if len(hist) >= 2 else None
    note = pareto_explain(pareto, prev_pareto)
    if note and isinstance(rt.judge_verdict, dict):
        rt.judge_verdict["pareto_note"] = note
    decision = optimization_controller_decide(
        scores_history=[int(x.get("overall") or 0) for x in hist],
        issue_counts=[int(x.get("issue_count") or 0) for x in hist],
        iteration=max(0, len(hist) - 1),
        diff=rt.visual_diff if isinstance(rt.visual_diff, dict) else None,
        cost=cost,
        costs_history=[int(x.get("ops_cost") or 0) for x in hist],
        pareto_history=[x.get("pareto") for x in hist if isinstance(x.get("pareto"), dict)],
    )
    if note:
        decision["pareto_note"] = note
    if pareto:
        decision["pareto"] = pareto
    rt.optimization = decision
    _emit(
        {
            "type": "optimization",
            "decision": decision.get("decision"),
            "reason": decision.get("reason"),
            "strategy": decision.get("strategy"),
            "iteration": decision.get("iteration"),
            "restore_index": decision.get("restore_index"),
            "targets": list(decision.get("targets") or [])[:6],
            "pareto": pareto,
            "pareto_note": note or None,
        }
    )
    return decision


def _validate_review_ops(
    rt: AgentRuntime,
    st: AgentRunState,
    raw_ops: Any,
    *,
    stage: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    from app.services.design.runtime.seams.tool_pipeline import validate_runtime_ops

    rt.classified_paint_lane = "edit"
    rt.classified_intent = "edit"
    return validate_runtime_ops(rt, st, raw_ops, stage=stage, intent="edit")


def _try_restore_snapshot_command(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    decision: dict[str, Any],
) -> Command | None:
    """Rollback via DesignTransaction tool_ops. Does not continue the optimize loop."""
    hist = rt.flags.get("optimization_history") if isinstance(rt.flags, dict) else None
    if not isinstance(hist, list):
        return None
    try:
        idx = int(decision.get("restore_index"))
    except (TypeError, ValueError):
        return None
    if idx < 0 or idx >= len(hist):
        return None
    snap_nodes = hist[idx].get("nodes") if isinstance(hist[idx], dict) else None
    raw_ops = compile_restore_ops(list(rt.scene_nodes or []), list(snap_nodes or []))
    if not raw_ops:
        return None
    step_ops, op_errors = _validate_review_ops(
        rt, st, raw_ops, stage="review_repair"
    )
    if any(str(op.get("name") or "").startswith("create_") for op in step_ops):
        return None
    if not step_ops:
        _log.info(
            "restore_validate_empty task=%s errors=%s",
            st.task_id[:8],
            list(op_errors or [])[:4],
        )
        return None
    st.push_log(
        phase="optimization_rollback",
        reason="regression",
        restore_index=idx,
        ops_count=len(step_ops),
        summary=f"rollback to V{idx + 1}: {len(step_ops)} ops"[:160],
    )
    st.round = round_i + 1
    rt.step_ops = step_ops
    rt.paint_ops = step_ops
    rt.flags["op_failed"] = False
    rt.flags["review_failed"] = False
    rt.flags["review_action"] = "pass"
    rt.flags["retry"] = False
    rt.flags["ok"] = True
    rt.flags["optimization_halt"] = True
    rt.flags["restore_ops_count"] = len(step_ops)
    rt.terminal = False
    rt.turn = {"intent": "edit", "reply": "", "tool_ops_raw": step_ops}
    _emit(
        {
            "type": "optimization_rollback",
            "restore_index": idx,
            "ops": len(step_ops),
            "task_id": st.task_id,
        }
    )
    if str(rt.flags.get("mode") or "") == "ask":
        return Command(update=_bump(rt), goto="propose")
    return Command(update=_bump(rt), goto="action")


def _scene_digest(rt: AgentRuntime) -> str:
    """Compact scene for Review — reuse paint digest (fills included)."""
    from app.services.design.runtime.graph.scene_log import (
        _scene_digest as _paint_scene_digest,
    )

    try:
        fw = int(rt.w or 0)
        fh = int(rt.h or 0)
    except (TypeError, ValueError):
        fw, fh = 0, 0
    body = _paint_scene_digest(
        list(rt.scene_nodes or []),
        list(rt.scene_frames or []),
        focus_id=str(rt.focus_id or ""),
        focus_w=fw,
        focus_h=fh,
        limit=24,
    )
    ops = list(rt.paint_ops or [])[:8]
    if not ops:
        return body[:2400]
    lines = [body[:2200], "RECENT_PAINT_OPS:"]
    for op in ops:
        if isinstance(op, dict):
            lines.append(f"- {str(op.get('name') or '')[:40]}")
    return "\n".join(lines)[:2800]



def _build_review_user_msg(
    rt: AgentRuntime,
    *,
    signals: list[str],
    has_preview: bool,
    lane: str | None = None,
    seed: dict[str, Any] | None = None,
) -> str:
    brief_obj = rt.design_brief if isinstance(rt.design_brief, dict) else None
    brief = format_design_brief_for_prompt(brief_obj) if brief_obj else ""
    parts = [
        f"USER_GOAL:\n{str(rt.prompt or rt.run.goal or '').strip()[:2000]}",
    ]
    if brief:
        parts.append(
            "DESIGN_BRIEF (execution contract — paint must match this):\n"
            + brief[:4000]
        )
    else:
        parts.append(
            "DESIGN_BRIEF: missing.\n"
            "Judge USER_GOAL + SCENE; be stricter — prefer must_fix if the board "
            "looks improvised without a brief."
        )
    lid = str(lane or "").strip().lower()
    lane_craft = _lane_skill_craft(rt, lid) if lid else ""
    if lane_craft:
        parts.append(
            "SKILL_CRAFT (this lane's review playbook only):\n" + lane_craft
        )
    elif list(getattr(rt.run, "skills_loaded", None) or []):
        keys = ", ".join(str(k) for k in rt.run.skills_loaded[:12])
        parts.append(
            f"SKILL_CRAFT: playbook bodies not in context; loaded keys: {keys}. "
            "Gate on DESIGN_BRIEF fidelity + SCENE; do not invent extra aesthetic curricula."
        )
    parts.append(f"SCENE:\n{_scene_digest(rt)}")
    if has_preview:
        parts.append(
            "PREVIEW_IMAGE: attached below.\n"
            "Look at the screenshot vs DESIGN_BRIEF (+ SKILL_CRAFT when present). "
            "SCENE JSON is supporting evidence."
        )
    else:
        parts.append(
            "PREVIEW_IMAGE: not attached (unavailable or model is non-vision).\n"
            "Judge from DESIGN_BRIEF + SCENE + SIGNALS (+ SKILL_CRAFT) only; "
            "say text-only in summary. Still gate brief fidelity; be conservative on pass."
        )
    if signals:
        parts.append(
            "OBSERVE_FACTS (deterministic host/structure — confirm or dismiss; "
            "do NOT invent aesthetic judgments from these):\n"
            + "\n".join(f"- {s}" for s in signals[:16])
        )
    else:
        parts.append("OBSERVE_FACTS:\n(none)")
    spat = rt.spatial_summary if isinstance(rt.spatial_summary, dict) else None
    if spat and not has_preview:
        try:
            safe_spat = {
                k: v
                for k, v in spat.items()
                if k in ("focused", "peripheral", "overlaps", "viewport")
            }
            parts.append("SPATIAL:\n" + json.dumps(safe_spat, ensure_ascii=False)[:800])
        except Exception:
            pass
    if seed and (seed.get("evidence") or seed.get("anti_slop_hits")):
        bits = list(seed.get("evidence") or []) + [
            f"hit:{h}" for h in list(seed.get("anti_slop_hits") or [])
        ]
        parts.append(
            "LANE_SEED (host facts — confirm or dismiss):\n"
            + "\n".join(f"- {b}" for b in bits[:8])
        )
    cap = REVIEW_LANE_CAPS.get(lid) if lid else None
    if lid:
        if lid == "anti_slop":
            parts.append(
                f"LANE: {lid}. You are the Anti-Slop reviewer only.\n"
                "Emit anti_slop_hits (concrete matches). Do not emit a score. "
                "Do not score other lanes. Do not invent total. Do not emit tool_ops."
            )
        else:
            parts.append(
                f"LANE: {lid}. You are the {lid} reviewer only.\n"
                f"Emit integer score 0-{cap} and evidence for THIS lane. "
                "Do not score other dimensions. Do not invent total. Do not emit tool_ops."
            )
        parts.append(
            'Return ONE JSON object: {"lane":"%s","score":0,"evidence":[],'
            '"issues":[],"anti_slop_hits":[],"strengths":[]}' % lid
        )
    else:
        parts.append(
            "Return scores (composition/hierarchy/typography/color/consistency/"
            "content/originality), anti_slop_hits, subtraction_actions, "
            "pass / must_fix / issues / strengths / weaknesses / market_gap. "
            "Do NOT invent total — Runtime sums scores and maps "
            "<70 rebuild / 70–89 repair / 90+ pass. "
            "Do not emit tool_ops. Prioritize DESIGN_BRIEF fidelity, then SKILL_CRAFT. "
            "Judge design taste only — geometry facts belong to OBSERVE_FACTS."
    )
    return "\n\n".join(parts)


async def _invoke_one_review_lane(
    rt: AgentRuntime,
    lane: str,
    *,
    images: list[str],
    signals: list[str],
    seed: dict[str, Any],
    system: str,
) -> dict[str, Any]:
    from app.services.llm import build_user_message_content
    from app.services.llm.agent import ainvoke_structured

    st = rt.run
    user_msg = _build_review_user_msg(
        rt,
        signals=signals,
        has_preview=bool(images),
        lane=lane,
        seed=seed,
    )
    user_content = build_user_message_content(user_msg, images[:2] or None)
    structured_out = await ainvoke_structured(
        schema=ReviewLaneSchema,
        messages=[{"role": "user", "content": user_content}],
        model=st.family,
        system=system,
        source="design",
        run_name=f"design_review_{lane}:{st.task_id[:8]}",
            metadata={
                "task_id": st.task_id,
                "trace_id": st.trace_id,
                "user_id": rt.user_id,
                "scene": rt.scene_key or "",
                "round": st.round,
            "has_preview": bool(images),
            "stage": "review",
            "agent": "review",
            "lane": lane,
        },
        tags=["design", "lc_design", "review_agent", "review", "review_lane", lane],
            timeout=90.0,
        stream_chunk_timeout=45.0,
    )
    raw = structured_out.get("structured") if isinstance(structured_out, dict) else None
    return parse_review_lane(lane, raw, seed=seed)


async def run_review_lanes(
    rt: AgentRuntime,
    *,
    preview_image: str | None,
    signals: list[str],
) -> list[dict[str, Any]]:
    """Seven distinct lane calls in parallel. Fail-open per lane to its seed."""
    images: list[str] = []
    prev = str(preview_image or "").strip()
    if prev.startswith("data:image/") or prev.startswith("http"):
        images.append(prev)
    if images:
        rt.run.vision_used = True
        rt.last_images = list(images)[:2]

    brief_obj = rt.design_brief if isinstance(rt.design_brief, dict) else None
    brief = brief_obj if isinstance(brief_obj, dict) else None
    facts = rt.observe_facts if isinstance(rt.observe_facts, dict) else {}
    scene_text = _scene_digest(rt)
    seeds = {
        lid: deterministic_lane_seed(
            lid, brief=brief, observe_facts=facts, scene_text=scene_text
        )
        for lid in MULTI_REVIEW_LANES
    }
    ask_mode = str(rt.flags.get("mode") or "") == "ask"
    system = assemble_stage_system(
        rt.rules,
        stage="review",
        ask_mode=ask_mode,
        persona=str(rt.persona or ""),
        catalog_blocks=None,
        locale=str((rt.flags or {}).get("output_locale") or "") or None,
    )

    async def _one(lid: str) -> dict[str, Any]:
        try:
            return await _invoke_one_review_lane(
                rt,
                lid,
                images=images,
                signals=signals,
                seed=seeds[lid],
                system=system,
            )
        except Exception:
            _log.exception("review lane %s failed task=%s", lid, rt.run.task_id[:8])
            return parse_review_lane(lid, {}, seed=seeds[lid])

    return list(await asyncio.gather(*[_one(lid) for lid in MULTI_REVIEW_LANES]))


async def _invoke_review_llm(
    rt: AgentRuntime,
    *,
    preview_image: str | None,
    signals: list[str],
) -> dict[str, Any]:
    st = rt.run
    t0 = time.perf_counter()
    lanes = await run_review_lanes(
        rt, preview_image=preview_image, signals=signals
    )
    merged = merge_review_lanes(lanes)
    parsed = _parse_review_structured(merged)
    parsed["lanes"] = merged.get("lanes") or lanes
    duration_ms = max(0, int((time.perf_counter() - t0) * 1000))
    st.push_log(
        phase="review_agent",
        ok=bool(parsed.get("pass")),
        must_fix=bool(parsed.get("must_fix")) or None,
        issues=[
            x.get("issue") for x in (parsed.get("issues") or [])[:6] if x.get("issue")
        ],
        strengths=list(parsed.get("strengths") or [])[:6] or None,
        weaknesses=list(parsed.get("weaknesses") or [])[:6] or None,
        market_gap=(str(parsed.get("market_gap") or "").strip()[:320] or None),
        summary=(
            parsed.get("summary")
            or ("review pass" if parsed.get("pass") else "review must_fix")
            )[:160],
        duration_ms=duration_ms,
        model=st.family,
        has_preview=bool(preview_image) or None,
        lanes=[str(x.get("lane") or "") for x in lanes],
    )
    return parsed


def _fallback_from_signals(signals: list[str]) -> dict[str, Any]:
    issues = [
        {
            "severity": "major",
            "area": "ops",
            "issue": s,
            "fix_hint": "Fix this host/structure signal on the next paint pass.",
        }
        for s in signals[:6]
    ]
    must = bool(issues)
    weak = [str(s).strip() for s in signals[:4] if str(s).strip()]
    return {
        "pass": not must,
        "summary": ("observe facts clear" if not must else f"observe×{len(issues)}"),
        "strengths": [],
        "weaknesses": weak,
        "market_gap": "",
        "scores": {},
        "total": 0,
        "anti_slop_hits": [],
        "subtraction_actions": [],
        "must_fix": must,
        "review_action": "repair" if must else "pass",
        "fix_brief": (
            ""
            if not must
            else "Address the listed host/structure issues; keep the user goal intact."
        ),
        "issues": issues,
    }



def _try_repair_plan_command(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    verdict: dict[str, Any],
) -> Command | None:
    """Apply compiled Repair Plan via action → DesignTransaction.

    Returns None when there is nothing safe to patch so the caller can
    fall back to Paint LLM retry. Review itself never writes SceneDocument.
    """
    raw_ops = compile_repair_plan_ops(
        list(verdict.get("issues") or []),
        list(rt.scene_nodes or []),
        list(verdict.get("subtraction_actions") or []),
    )
    if not raw_ops:
        return None
    step_ops, op_errors = _validate_review_ops(
        rt, st, raw_ops, stage="review_repair"
    )
    if any(str(op.get("name") or "").startswith("create_") for op in step_ops):
        _log.warning("repair_plan_rejected_create task=%s", st.task_id[:8])
        return None
    if not step_ops:
        _log.info(
            "repair_plan_validate_empty task=%s errors=%s",
            st.task_id[:8],
            list(op_errors or [])[:4],
        )
        return None
    note = _format_review_reflect_note(
        summary=str(verdict.get("summary") or ""),
        fix_brief=str(verdict.get("fix_brief") or ""),
        issues=list(verdict.get("issues") or []),
        market_gap=str(verdict.get("market_gap") or ""),
        weaknesses=list(verdict.get("weaknesses") or []),
        total=verdict.get("total") if isinstance(verdict.get("total"), int) else None,
        subtraction_actions=list(verdict.get("subtraction_actions") or []),
        anti_slop_hits=list(verdict.get("anti_slop_hits") or []),
        action="repair",
    )
    st.note_error(note)
    issue_labels = [
        str(x.get("issue") or "").strip()
        for x in (verdict.get("issues") or [])
        if str(x.get("issue") or "").strip()
    ]
    st.push_log(
        phase="repair",
        error=st.reflect_note,
        reason="review_repair",
        reflect_left=st.reflect_left,
        ops_count=len(step_ops),
        ops=[str(o.get("name") or "") for o in step_ops[:12]],
        issues=issue_labels[:6],
        summary=f"repair plan: {len(step_ops)} ops"[:160],
    )
    st.reflect_left -= 1
    _emit(
        {
            "type": "activity",
            "id": f"repair-{st.task_id}-{round_i}",
            "kind": "review",
            "status": "done",
            "detail": f"Repair plan: {len(step_ops)} ops",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "stage": "review",
        }
    )
    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "review",
            "skill_name": "Review Agent",
            "tokens": rt.last_used,
        }
    )
    st.round = round_i + 1
    rt.step_ops = step_ops
    rt.paint_ops = step_ops
    rt.flags["op_failed"] = False
    rt.flags["review_failed"] = True
    rt.flags["review_action"] = "repair"
    rt.flags["review_repair_used"] = True
    rt.flags["retry"] = True
    rt.flags["ok"] = False
    rt.flags["repair_ops_count"] = len(step_ops)
    rt.terminal = False
    rt.turn = {"intent": "edit", "reply": "", "tool_ops_raw": step_ops}
    if str(rt.flags.get("mode") or "") == "ask":
        return Command(update=_bump(rt), goto="propose")
    return Command(update=_bump(rt), goto="action")


def _try_polish_command(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    verdict: dict[str, Any],
) -> Command | None:
    """One subtraction polish pass via action → DesignTransaction.

    Returns None when there is nothing safe to remove/align/reduce.
    Never emits create_*. Hero / H1 / plates stay.
    """
    raw_ops = compile_polish_ops(
        list(rt.scene_nodes or []),
        list(rt.scene_frames or []),
        observe_facts=rt.observe_facts,
        subtraction_actions=list(verdict.get("subtraction_actions") or []),
        issues=list(verdict.get("issues") or []),
        focus_frame_id=str(rt.focus_id or "") or None,
    )
    if not raw_ops:
        return None
    step_ops, op_errors = _validate_review_ops(
        rt, st, raw_ops, stage="review_polish"
    )
    if any(str(op.get("name") or "").startswith("create_") for op in step_ops):
        _log.warning("polish_rejected_create task=%s", st.task_id[:8])
        return None
    if not step_ops:
        _log.info(
            "polish_validate_empty task=%s errors=%s",
            st.task_id[:8],
            list(op_errors or [])[:4],
        )
        return None
    st.push_log(
        phase="polish",
        reason="review_polish",
        ops_count=len(step_ops),
        ops=[str(o.get("name") or "") for o in step_ops[:12]],
        summary=f"polish subtraction: {len(step_ops)} ops"[:160],
    )
    _emit(
        {
            "type": "activity",
            "id": f"polish-{st.task_id}-{round_i}",
            "kind": "review",
            "status": "done",
            "detail": f"Polish / subtraction: {len(step_ops)} ops",
            "task_id": st.task_id,
            "trace_id": st.trace_id,
            "stage": "review",
        }
    )
    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "review",
            "skill_name": "Review Agent",
            "tokens": rt.last_used,
        }
    )
    st.round = round_i + 1
    rt.step_ops = step_ops
    rt.paint_ops = step_ops
    rt.flags["op_failed"] = False
    rt.flags["review_failed"] = False
    rt.flags["review_action"] = str(verdict.get("review_action") or "pass")
    rt.flags["polish"] = True
    rt.flags["polish_done"] = True
    rt.flags["retry"] = True
    rt.flags["ok"] = not bool(verdict.get("must_fix"))
    rt.flags["polish_ops_count"] = len(step_ops)
    rt.terminal = False
    rt.turn = {"intent": "edit", "reply": "", "tool_ops_raw": step_ops}
    if str(rt.flags.get("mode") or "") == "ask":
        return Command(update=_bump(rt), goto="propose")
    return Command(update=_bump(rt), goto="action")


async def _retry_paint_from_review(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    verdict: dict[str, Any],
) -> Command:
    action = str(verdict.get("review_action") or "repair").strip().lower()
    if action not in ("rebuild", "repair"):
        action = "repair"
    note = _format_review_reflect_note(
        summary=str(verdict.get("summary") or ""),
        fix_brief=str(verdict.get("fix_brief") or ""),
        issues=list(verdict.get("issues") or []),
        market_gap=str(verdict.get("market_gap") or ""),
        weaknesses=list(verdict.get("weaknesses") or []),
        total=verdict.get("total") if isinstance(verdict.get("total"), int) else None,
        subtraction_actions=list(verdict.get("subtraction_actions") or []),
        anti_slop_hits=list(verdict.get("anti_slop_hits") or []),
        action=action,
    )
    st.note_error(note)
    issue_labels = [
        str(x.get("issue") or "").strip()
        for x in (verdict.get("issues") or [])
        if str(x.get("issue") or "").strip()
    ]
    st.push_log(
        phase="reflect",
        error=st.reflect_note,
        reason=f"review_{action}",
        reflect_left=st.reflect_left,
        issues=issue_labels[:6],
        summary=f"review {action}, retry paint: {'; '.join(issue_labels)[:120]}"[:160],
    )
    st.reflect_left -= 1
    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "review",
            "skill_name": "Review Agent",
            "tokens": rt.last_used,
        }
    )
    st.round = round_i + 1
    rt.flags["op_failed"] = False
    rt.flags["review_failed"] = True
    rt.flags["review_action"] = action
    rt.flags["review_repair_used"] = True
    rt.flags["retry"] = True
    rt.flags["ok"] = False
    rt.terminal = False
    return Command(update=_bump(rt), goto="paint_ops")


async def _run_design_quality_gate(rt: AgentRuntime) -> None:
    """P41 lanes belong on this Review hop — not a separate graph node."""
    from app.services.design.intelligence_runtime import get_design_intelligence_client
    from app.services.design.runtime.graph.nodes.governance import (
        should_route_to_governance,
    )

    if not should_route_to_governance(rt):
        return
    await get_design_intelligence_client().govern(rt)


async def _node_review_agent(state: GraphState) -> Command:
    """Review Agent: optional craft gate after observe; may force paint retry."""
    rt = state["rt"]
    st = rt.run
    round_i = st.round
    ctx = pop_review_context(st.task_id)
    preview_image = ctx.get("preview_image")
    signals = list(ctx.get("signals") or [])
    if not isinstance(signals, list):
        signals = []

    if not st.painted:
        rt.flags["scene_ready"] = True
        rt.flags["ok"] = True
        rt.flags["retry"] = False
        rt.terminal = True
        return Command(update=_bump(rt), goto="__settle__")

    # Review Agent: user lock → Admin pin → follow design model → vision.
    from app.services.design.runtime.models_route import resolve_review_model

    family, reason = resolve_review_model(
        rt.rules,
        user_selected_model=rt.user_selected_model,
        design_model=st.family,
    )
    st.family = family
    rt.last_reason = reason
    if "vision" in reason or bool(preview_image):
        st.vision_used = True
    st.push_log(
        phase="model_route",
        skill_key="review",
        model=family,
        model_reason=reason,
        has_images=bool(preview_image) or None,
        vision=True if preview_image else None,
        run_mode=rt.mode or None,
        attempt=int(st.round),
        summary=f"Review pinned model {family}",
    )

    _emit(
        {
            "type": "skill_start",
            "index": round_i,
            "skill_id": None,
            "skill_key": "review",
            "skill_name": "Review Agent",
            "category": "review",
            "model": st.family,
            "model_reason": rt.last_reason,
            "trace_id": st.trace_id,
            "agent": "review",
        }
    )
    _emit(
        {
            "type": "critique_start",
            "round": round_i,
            "reason": "review_agent",
            "source": "review_agent",
            "agent": "review",
        }
    )

    verdict: dict[str, Any]
    if not _review_enabled():
        verdict = _fallback_from_signals(signals)
    else:
        try:
            from app.core.config import settings
            from app.services.design.runtime.graph.nodes.paint import _await_or_abandon

            review_budget = float(
                getattr(settings, "design_review_llm_timeout_sec", 100.0) or 100.0
            )
            verdict = await _await_or_abandon(
                _invoke_review_llm(
                    rt, preview_image=preview_image, signals=signals
                ),
                timeout_sec=max(15.0, review_budget),
                label=f"review:{st.task_id[:8]}",
            )
        except Exception as err:  # noqa: BLE001
            _log.exception("review_agent_llm_failed task=%s", st.task_id[:8])
            st.note_error(f"review_agent_llm_failed: {err}"[:240])
            raise RuntimeError(f"review_agent_llm_failed: {err}") from err

    attach_judge(rt, verdict)
    opt = run_optimization_controller(rt, verdict)

    issues = list(verdict.get("issues") or [])
    issue_text = [
        str(x.get("issue") or "").strip()
        for x in issues
        if str(x.get("issue") or "").strip()
    ]
    strengths = [
        str(x).strip()
        for x in list(verdict.get("strengths") or [])
        if str(x).strip()
    ][:6]
    weaknesses = [
        str(x).strip()
        for x in list(verdict.get("weaknesses") or [])
        if str(x).strip()
    ][:6]
    market_gap = str(verdict.get("market_gap") or "").strip()[:600]
    ok = bool(verdict.get("pass")) and not bool(verdict.get("must_fix"))
    action = str(verdict.get("review_action") or "").strip().lower()
    if action not in ("rebuild", "repair", "pass"):
        action = "pass" if ok else "repair"
    reason_txt = str(verdict.get("summary") or "").strip()
    if not reason_txt:
        reason_txt = "; ".join(issue_text)[:400] if issue_text else "ok"
    total = verdict.get("total")
    lane_rows = [
        {
            "lane": str(x.get("lane") or ""),
            "score": x.get("score"),
            "evidence": list(x.get("evidence") or [])[:4],
            "hits": list(x.get("anti_slop_hits") or [])[:4],
        }
        for x in list(verdict.get("lanes") or [])
        if isinstance(x, dict) and x.get("lane")
    ]
    rt.flags["review"] = {
        "scores": verdict.get("scores") if isinstance(verdict.get("scores"), dict) else {},
        "total": total,
        "action": action,
        "summary": reason_txt[:400],
        "must_fix": bool(verdict.get("must_fix")),
        "issues": issue_text[:6],
        "subtraction_actions": [
            str(x).strip()
            for x in list(verdict.get("subtraction_actions") or [])
            if str(x).strip()
        ][:4],
        "lanes": lane_rows,
        "anti_slop_hits": list(verdict.get("anti_slop_hits") or [])[:8],
        "overall": (rt.judge_verdict or {}).get("overall")
        if isinstance(rt.judge_verdict, dict)
        else total,
        "top_issues": list((rt.judge_verdict or {}).get("top_issues") or [])[:6]
        if isinstance(rt.judge_verdict, dict)
        else [],
        "confidence": (rt.judge_verdict or {}).get("confidence")
        if isinstance(rt.judge_verdict, dict)
        else None,
        "visual_diff": (rt.judge_verdict or {}).get("visual_diff")
        if isinstance(rt.judge_verdict, dict)
        else None,
        "pareto": (rt.judge_verdict or {}).get("pareto")
        if isinstance(rt.judge_verdict, dict)
        else None,
        "pareto_note": (rt.judge_verdict or {}).get("pareto_note")
        if isinstance(rt.judge_verdict, dict)
        else None,
    }
    judge = rt.judge_verdict if isinstance(rt.judge_verdict, dict) else {}
    if isinstance(rt.judge_verdict, dict):
        if strengths:
            rt.judge_verdict["strengths"] = strengths
        if weaknesses:
            rt.judge_verdict["weaknesses"] = weaknesses
        if market_gap:
            rt.judge_verdict["market_gap"] = market_gap
    _emit(
        {
            "type": "critique_done",
            "round": round_i,
            "ok": ok,
            "reason": reason_txt[:400],
            "source": "review_agent",
            "agent": "review",
            "must_fix": bool(verdict.get("must_fix")),
            "review_action": action,
            "total": int(total) if isinstance(total, (int, float)) else None,
            "issues": issue_text[:8],
            "strengths": strengths,
            "weaknesses": weaknesses,
            "market_gap": market_gap,
            "scores": verdict.get("scores")
            if isinstance(verdict.get("scores"), dict)
            else {},
            "lanes": lane_rows,
            "overall": judge.get("overall"),
            "top_issues": list(judge.get("top_issues") or [])[:6],
            "visual_diff": judge.get("visual_diff"),
            "pareto": judge.get("pareto"),
            "pareto_note": judge.get("pareto_note"),
            **({"has_preview": True} if preview_image else {}),
        }
    )
    review_next: list[str] = []
    for row in list(judge.get("top_issues") or [])[:5]:
        if not isinstance(row, dict):
            continue
        fix = str(row.get("fix") or "").strip()
        issue = str(row.get("issue") or "").strip()
        if fix:
            review_next.append(fix)
        elif issue:
            review_next.append(issue)
    if strengths or weaknesses or market_gap or review_next:
        _emit(
            {
                "type": "design_summary",
                "visibility": "user",
                "strengths": strengths[:4] or None,
                "weaknesses": weaknesses[:4] or None,
                "market_gap": market_gap[:280] or None,
                "next_steps": review_next[:5] or None,
                "source": "review",
            }
        )
    taste_bits: list[str] = []
    if strengths:
        taste_bits.append("Strengths: " + "; ".join(strengths[:3]))
    if weaknesses:
        taste_bits.append("Weaknesses: " + "; ".join(weaknesses[:3]))
    if market_gap:
        taste_bits.append(f"Market gap: {market_gap[:280]}")
    if taste_bits:
        _emit(
            {
                "type": "analysis_delta",
                "text": "\n".join(taste_bits)[:900],
                "visibility": "developer",
            }
        )

    opt_kind = str(opt.get("decision") or "")
    opt_reason = str(opt.get("reason") or "")
    if opt_kind == "rollback":
        cmd = _try_restore_snapshot_command(rt, st, round_i=round_i, decision=opt)
        if cmd is not None:
            return cmd
    halt_loop = opt_kind == "rollback" or (
        opt_kind == "stop" and opt_reason not in ("pass", "")
    )

    must_fix = bool(verdict.get("must_fix")) and not ok and not halt_loop
    review_left = st.reflect_left
    if "review_left" in rt.flags:
        try:
            review_left = int(rt.flags.get("review_left"))
        except (TypeError, ValueError):
            review_left = st.reflect_left
    if (
        must_fix
        and review_left > 0
        and not rt.turn.get("done")
        and st.painted
    ):
        rt.flags["review_left"] = max(0, review_left - 1)
        if action == "repair":
            cmd = _try_repair_plan_command(rt, st, round_i=round_i, verdict=verdict)
            if cmd is not None:
                return cmd
        return await _retry_paint_from_review(
            rt, st, round_i=round_i, verdict=verdict
        )

    if (
        not must_fix
        and not halt_loop
        and action != "rebuild"
        and not rt.flags.get("polish_done")
        and st.painted
        and not rt.turn.get("done")
    ):
        cmd = _try_polish_command(rt, st, round_i=round_i, verdict=verdict)
        if cmd is not None:
            rt.flags["review_repair_used"] = True
            return cmd

    if must_fix:
        _emit_ux_tip(
            rt,
            "review_must_fix",
            params={"issues": "; ".join(issue_text[:2]) or "adjust per DESIGN_BRIEF"},
        )

    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "review",
            "skill_name": "Review Agent",
            "tokens": rt.last_used,
        }
    )

    rt.flags["scene_ready"] = True
    rt.flags["op_failed"] = False
    rt.flags["review_failed"] = bool(must_fix)
    rt.flags["review_action"] = action
    rt.flags["ok"] = not bool(must_fix)
    rt.flags["retry"] = False
    rt.terminal = True
    await _run_design_quality_gate(rt)
    return Command(update=_bump(rt), goto="__settle__")
