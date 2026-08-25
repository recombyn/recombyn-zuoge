"""Observe node — scene feedback HITL + deterministic QA.

Kernel boundary — **Observe owns deterministic facts only**:
  overflow, overlap, alignment, spacing, bounds, type hierarchy,
  whitespace_ratio, edge crowding.

Observe does **not** judge aesthetic taste. That belongs to Review + Skills.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from langgraph.types import Command, interrupt

from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    GraphState,
    ObserveFactsSchema,
    _SCENE_WAIT_SEC,
    parse_design_brief,
)
from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.graph.llm_io import _emit_ux_tip
from app.services.design.runtime.graph.paint_kit import _structure_verify_issues
from app.services.design.runtime.graph.scene_log import _bump

# PR10 deterministic QA — facts only. Do not treat these as taste.
_PLATE_AREA_RATIO = 0.85
_OVERLAP_MIN_AREA = 64.0
_ALIGN_NEAR_MIN = 2.0
_ALIGN_NEAR_MAX = 8.0
_SPACING_TIGHT_MAX = 6.0
_EDGE_MARGIN_RATIO = 0.04
_EDGE_MARGIN_MIN = 16.0
_TYPE_HIERARCHY_MIN_RATIO = 1.25
_LINE_HEIGHT_MIN = 1.05
_DEFAULT_EMPTY_SPACE = 0.15
_POSTER_SKILL_KEYS = frozenset({"poster_craft", "composition"})
_CJK_RE = re.compile(r"[\u3400-\u9fff]")


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return fallback
    return n if n == n else fallback


def _node_box(node: dict[str, Any]) -> tuple[float, float, float, float] | None:
    w = _num(node.get("w"))
    h = _num(node.get("h"))
    if w <= 0 or h <= 0:
        return None
    return (_num(node.get("x")), _num(node.get("y")), w, h)


def _box_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2]) * max(0.0, box[3])


def _intersect_area(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    iw = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    ih = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    return iw * ih


def _gap_axis(a0: float, a1: float, b0: float, b1: float) -> float:
    """Positive gap between 1D intervals; 0 if they overlap."""
    if a1 < b0:
        return b0 - a1
    if b1 < a0:
        return a0 - b1
    return 0.0


def _is_text_node(node: dict[str, Any]) -> bool:
    return str(node.get("type") or "").strip().lower() == "text"


def _parse_pct_range(raw: Any) -> tuple[float | None, float | None]:
    if raw is None or raw == "":
        return None, None
    if isinstance(raw, (int, float)):
        v = float(raw)
        v = v / 100.0 if v > 1 else v
        return v, None
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(raw))]
    if not nums:
        return None, None
    vals = [n / 100.0 if n > 1 else n for n in nums]
    if len(vals) == 1:
        return vals[0], None
    return min(vals[0], vals[1]), max(vals[0], vals[1])


def _brief_composition_rules(design_brief: Any) -> dict[str, Any]:
    parsed = parse_design_brief(design_brief) if design_brief else None
    if not isinstance(parsed, dict):
        return {}
    comp = parsed.get("composition")
    if isinstance(comp, dict):
        rules = comp.get("rules")
        return dict(rules) if isinstance(rules, dict) else {}
    return {}


def _min_empty_space(design_brief: Any, skills_loaded: list[str] | None) -> float | None:
    rules = _brief_composition_rules(design_brief)
    raw = rules.get("empty_space") if rules else None
    if raw is None:
        raw = rules.get("whitespace") if rules else None
    lo, _hi = _parse_pct_range(raw)
    if lo is not None:
        return lo
    keys = {str(k).strip().lower() for k in (skills_loaded or [])}
    if keys & _POSTER_SKILL_KEYS:
        return _DEFAULT_EMPTY_SPACE
    return None


def _pick_focus_frame(
    frames: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    focus_frame_id: str | None,
) -> dict[str, Any] | None:
    fid = str(focus_frame_id or "").strip()
    if fid:
        for f in frames:
            if str(f.get("id") or "") == fid:
                return f
    counts: dict[str, int] = {}
    for n in nodes:
        nid = str(n.get("frameId") or "").strip()
        if nid:
            counts[nid] = counts.get(nid, 0) + 1
    if counts:
        best = max(counts, key=counts.get)
        for f in frames:
            if str(f.get("id") or "") == best:
                return f
    return frames[0] if frames else None


def _frame_box(frame: dict[str, Any] | None) -> tuple[float, float, float, float] | None:
    if not frame:
        return None
    w = _num(frame.get("w"))
    h = _num(frame.get("h"))
    if w <= 0 or h <= 0:
        return None
    return (_num(frame.get("x")), _num(frame.get("y")), w, h)


def _content_boxes(
    nodes: list[dict[str, Any]],
    frame_area: float,
) -> list[tuple[dict[str, Any], tuple[float, float, float, float]]]:
    out: list[tuple[dict[str, Any], tuple[float, float, float, float]]] = []
    for n in nodes:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        box = _node_box(n)
        if box is None:
            continue
        if _box_area(box) >= _PLATE_AREA_RATIO * frame_area:
            continue
        out.append((n, box))
    return out


def build_scene_visual_snapshot(
    *,
    nodes: list[dict[str, Any]] | None = None,
    frames: list[dict[str, Any]] | None = None,
    focus_frame_id: str | None = None,
    facts: ObserveFactsSchema | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Geometry snapshot for Visual Diff. Never taste, never SceneDocument."""
    from app.services.design.runtime.graph.state import SceneVisualSnapshot

    facts_d: dict[str, Any] = {}
    if isinstance(facts, ObserveFactsSchema):
        facts_d = facts.model_dump()
    elif isinstance(facts, dict):
        facts_d = facts
    clean = [n for n in (nodes or []) if isinstance(n, dict) and n.get("id")]
    clean_frames = [f for f in (frames or []) if isinstance(f, dict) and f.get("id")]
    frame = _pick_focus_frame(clean_frames, clean, focus_frame_id)
    fb = _frame_box(frame)
    node_count = len(clean)
    if not fb:
        return SceneVisualSnapshot(
            node_count=node_count,
            hero_coverage=facts_d.get("hero_coverage"),
            whitespace_ratio=facts_d.get("whitespace_ratio"),
            alignment_issue_count=len(facts_d.get("alignment_issues") or []),
        ).model_dump()
    _fx, _fy, fw, fh = fb
    frame_area = max(1.0, fw * fh)
    content = _content_boxes(clean, frame_area)
    text_area = 0.0
    title_area = 0.0
    hero_area = 0.0
    color_area = 0.0
    boxes: list[tuple[float, float, float, float]] = []
    for n, box in content:
        area = _box_area(box)
        boxes.append(box)
        if _is_text_node(n):
            text_area += area
            if area > title_area:
                title_area = area
            continue
        fill = str(n.get("fill") or "").strip()
        if fill:
            color_area += area
        if area > hero_area:
            hero_area = area
    deco = 0.0
    for n, box in content:
        if _is_text_node(n):
            continue
        area = _box_area(box)
        if area < hero_area:
            deco += area
    bbox_coverage = None
    if boxes:
        x0 = min(b[0] for b in boxes)
        y0 = min(b[1] for b in boxes)
        x1 = max(b[0] + b[2] for b in boxes)
        y1 = max(b[1] + b[3] for b in boxes)
        bbox_coverage = round(min(1.0, max(0.0, (x1 - x0) * (y1 - y0) / frame_area)), 4)
    gaps: list[float] = []
    ordered = sorted(boxes, key=lambda b: (b[1], b[0]))
    for i, a in enumerate(ordered[:-1]):
        b = ordered[i + 1]
        gap = _gap_axis(a[1], a[1] + a[3], b[1], b[1] + b[3])
        if gap > 0:
            gaps.append(gap)
    spacing_mean = round(sum(gaps) / len(gaps), 2) if gaps else None
    hero = facts_d.get("hero_coverage")
    if hero is None and hero_area > 0:
        hero = round(hero_area / frame_area, 4)
    white = facts_d.get("whitespace_ratio")
    if white is None:
        occupied = min(1.0, sum(_box_area(b) for b in boxes) / frame_area)
        white = round(max(0.0, 1.0 - occupied), 4)
    return SceneVisualSnapshot(
        node_count=node_count,
        hero_coverage=hero,
        title_area=round(title_area / frame_area, 4) if title_area else 0.0,
        decoration_area=round(deco / frame_area, 4) if deco else 0.0,
        whitespace_ratio=white,
        text_area=round(text_area / frame_area, 4) if text_area else 0.0,
        color_area=round(color_area / frame_area, 4) if color_area else 0.0,
        bbox_coverage=bbox_coverage,
        spacing_mean=spacing_mean,
        alignment_issue_count=len(facts_d.get("alignment_issues") or []),
    ).model_dump()


def record_visual_diff(
    rt: AgentRuntime,
    *,
    facts: ObserveFactsSchema | dict[str, Any] | None = None,
    preview_image: str | None = None,
) -> dict[str, Any] | None:
    """V1 vs V2 geometry (always) + pixel when both previews decode. Never writes canvas."""
    from app.services.design.runtime.graph.state import compute_visual_diff

    snap = build_scene_visual_snapshot(
        nodes=list(rt.scene_nodes or []),
        frames=list(rt.scene_frames or []),
        focus_frame_id=str(getattr(rt, "focus_id", "") or "") or None,
        facts=facts,
    )
    prev = rt.visual_snapshot if isinstance(rt.visual_snapshot, dict) else None
    prev_preview = ""
    if isinstance(rt.flags, dict):
        prev_preview = str(rt.flags.get("visual_preview") or "").strip()
        rt.flags["visual_preview"] = str(preview_image or "").strip() or None
    rt.visual_snapshot = snap
    if not prev:
        rt.visual_diff = None
        return None
    diff = compute_visual_diff(
        prev,
        snap,
        pixel_v1=prev_preview or None,
        pixel_v2=str(preview_image or "").strip() or None,
    )
    rt.visual_diff = diff
    return diff


def _approx_text_width(text: str, font_size: float) -> float:
    total = 0.0
    for ch in text:
        total += font_size if _CJK_RE.search(ch) else font_size * 0.55
    return total


def format_observe_facts(facts: ObserveFactsSchema) -> list[str]:
    """Compact OBSERVE_FACTS lines for Review (metrics first, then FAILs)."""
    lines: list[str] = []
    if facts.hero_coverage is not None:
        lines.append(f"hero coverage = {round(facts.hero_coverage * 100)}%")
    if facts.whitespace_ratio is not None:
        lines.append(f"whitespace = {round(facts.whitespace_ratio * 100)}%")
    if facts.h1_h2_ratio is not None:
        lines.append(f"H1/H2 ratio = {facts.h1_h2_ratio:.2f}")
    elif facts.h1_size is not None:
        lines.append(f"H1 = {int(round(facts.h1_size))}")
    lines.append(f"edge crowding = {str(bool(facts.edge_crowding)).lower()}")
    lines.append(f"overlap = {str(bool(facts.overlap)).lower()}")
    if facts.overflow:
        lines.append("overflow = true")
    for issue in facts.issues:
        if issue not in lines:
            lines.append(issue)
    return lines[:16]


def compute_observe_facts(
    *,
    nodes: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    painted: bool = True,
    intent: str = "",
    paint_ops: list[dict[str, Any]] | None = None,
    op_results: list[dict[str, Any]] | None = None,
    design_brief: Any = None,
    skills_loaded: list[str] | None = None,
    focus_frame_id: str | None = None,
) -> ObserveFactsSchema:
    """Geometry / type / whitespace / edge facts. No aesthetic judgment."""
    structure = _structure_verify_issues(
        nodes=nodes,
        frames=frames,
        painted=painted,
        intent=intent,
        paint_ops=paint_ops,
        op_results=op_results,
    )
    facts = ObserveFactsSchema(structure_issues=list(structure))
    if not painted:
        facts.issues = list(structure)
        return facts

    clean = [n for n in (nodes or []) if isinstance(n, dict) and n.get("id")]
    clean_frames = [f for f in (frames or []) if isinstance(f, dict) and f.get("id")]
    frame = _pick_focus_frame(clean_frames, clean, focus_frame_id)
    fb = _frame_box(frame)
    if not fb:
        facts.issues = list(structure)
        return facts

    _fx, _fy, fw, fh = fb
    frame_area = max(1.0, fw * fh)
    local = (0.0, 0.0, fw, fh)

    boxed: list[tuple[dict[str, Any], tuple[float, float, float, float]]] = []
    for n in clean:
        box = _node_box(n)
        if box is None:
            continue
        boxed.append((n, box))

    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]] = []
    for n, box in boxed:
        if _box_area(box) >= _PLATE_AREA_RATIO * frame_area:
            continue
        content.append((n, box))

    _qa_overflow_bounds(facts, content, local)
    _qa_overlap_align_spacing(facts, content)
    _qa_typography(facts, content)
    _qa_whitespace_hero(facts, content, frame_area, design_brief, skills_loaded)
    _qa_edge_crowding(facts, content, local, fw, fh)

    issues = list(structure)
    for extra in (
        facts.bounds_issues,
        facts.alignment_issues,
        facts.spacing_issues,
        facts.issues,
    ):
        for item in extra:
            if item not in issues:
                issues.append(item)
    facts.issues = issues[:16]
    return facts


def _qa_overflow_bounds(
    facts: ObserveFactsSchema,
    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]],
    local: tuple[float, float, float, float],
) -> None:
    lx, ly, lw, lh = local
    for n, box in content:
        x, y, w, h = box
        nid = str(n.get("id") or "?")
        if x + w < lx or y + h < ly or x > lx + lw or y > ly + lh:
            facts.bounds_issues.append(f"bounds: {nid} outside frame")
            continue
        over_l = max(0.0, lx - x)
        over_t = max(0.0, ly - y)
        over_r = max(0.0, (x + w) - (lx + lw))
        over_b = max(0.0, (y + h) - (ly + lh))
        over = max(over_l, over_t, over_r, over_b)
        if over > 1.0:
            facts.overflow = True
            facts.issues.append(f"overflow: {nid} extends {int(round(over))}px past frame")


def _qa_overlap_align_spacing(
    facts: ObserveFactsSchema,
    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]],
) -> None:
    for i, (na, ba) in enumerate(content):
        ax, ay, aw, ah = ba
        for nb, bb in content[i + 1 :]:
            area = _intersect_area(ba, bb)
            if area >= _OVERLAP_MIN_AREA:
                facts.overlap = True
                facts.issues.append(
                    f"overlap: {na.get('id')} ∩ {nb.get('id')} ({int(round(area))}px²)"
                )
                continue
            dx = abs(ax - bb[0])
            dy = abs(ay - bb[1])
            if _ALIGN_NEAR_MIN <= dx <= _ALIGN_NEAR_MAX and dy > _ALIGN_NEAR_MAX:
                facts.alignment_issues.append(
                    f"alignment: {na.get('id')}/{nb.get('id')} left edges {dx:.0f}px apart"
                )
            if _ALIGN_NEAR_MIN <= dy <= _ALIGN_NEAR_MAX and dx > _ALIGN_NEAR_MAX:
                facts.alignment_issues.append(
                    f"alignment: {na.get('id')}/{nb.get('id')} top edges {dy:.0f}px apart"
                )
            gx = _gap_axis(ax, ax + aw, bb[0], bb[0] + bb[2])
            gy = _gap_axis(ay, ay + ah, bb[1], bb[1] + bb[3])
            if gx == 0.0 and 0 < gy <= _SPACING_TIGHT_MAX:
                facts.spacing_issues.append(
                    f"spacing: {na.get('id')}/{nb.get('id')} {gy:.0f}px apart"
                )
            elif gy == 0.0 and 0 < gx <= _SPACING_TIGHT_MAX:
                facts.spacing_issues.append(
                    f"spacing: {na.get('id')}/{nb.get('id')} {gx:.0f}px apart"
                )
    facts.alignment_issues = facts.alignment_issues[:6]
    facts.spacing_issues = facts.spacing_issues[:6]


def _qa_typography(
    facts: ObserveFactsSchema,
    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]],
) -> None:
    texts: list[tuple[dict[str, Any], tuple[float, float, float, float], float]] = []
    for n, box in content:
        if not _is_text_node(n):
            continue
        size = _num(n.get("fontSize"))
        if size <= 0:
            continue
        texts.append((n, box, size))
        box_h = box[3]
        if box_h + 0.5 < size * 0.9:
            facts.text_overflow = True
            facts.issues.append(
                f"text overflow: {n.get('id')} font {int(size)}px in {box_h:.0f}px box"
            )
        lh = _num(n.get("lineHeight"), 0.0)
        if 0 < lh < _LINE_HEIGHT_MIN:
            facts.line_height_tight = True
            facts.issues.append(f"line-height: {n.get('id')} {lh:.2f} < {_LINE_HEIGHT_MIN}")
        raw_text = str(n.get("text") or "")
        if raw_text and _approx_text_width(raw_text, size) > box[2] * 1.08:
            if box_h < size * 1.8:
                facts.text_overflow = True
                msg = f"text overflow: {n.get('id')} copy wider than box"
                if msg not in facts.issues:
                    facts.issues.append(msg)
    sizes = sorted({round(s, 1) for _, _, s in texts}, reverse=True)
    if sizes:
        facts.h1_size = sizes[0]
    if len(sizes) >= 2:
        facts.h2_size = sizes[1]
        if facts.h2_size > 0:
            facts.h1_h2_ratio = round(facts.h1_size / facts.h2_size, 2)
            if facts.h1_h2_ratio < _TYPE_HIERARCHY_MIN_RATIO:
                facts.typography_hierarchy_ok = False
                facts.issues.append(
                    f"Typography hierarchy insufficient (H1={int(facts.h1_size)} H2={int(facts.h2_size)})"
                )


def _qa_whitespace_hero(
    facts: ObserveFactsSchema,
    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]],
    frame_area: float,
    design_brief: Any,
    skills_loaded: list[str] | None,
) -> None:
    occupied = 0.0
    hero_area = 0.0
    for n, box in content:
        area = _box_area(box)
        occupied += area
        if _is_text_node(n):
            continue
        if area > hero_area:
            hero_area = area
    occupied_ratio = min(1.0, occupied / max(1.0, frame_area))
    facts.whitespace_ratio = round(max(0.0, 1.0 - occupied_ratio), 4)
    if hero_area > 0:
        facts.hero_coverage = round(hero_area / max(1.0, frame_area), 4)
    min_empty = _min_empty_space(design_brief, skills_loaded)
    if min_empty is not None and facts.whitespace_ratio < min_empty:
        facts.whitespace_fail = True
        facts.issues.append(
            f"whitespace_ratio={round(facts.whitespace_ratio * 100)}% FAIL "
            f"(empty_space≥{round(min_empty * 100)}%)"
        )


def _qa_edge_crowding(
    facts: ObserveFactsSchema,
    content: list[tuple[dict[str, Any], tuple[float, float, float, float]]],
    local: tuple[float, float, float, float],
    fw: float,
    fh: float,
) -> None:
    margin = max(_EDGE_MARGIN_MIN, min(fw, fh) * _EDGE_MARGIN_RATIO)
    lx, ly, lw, lh = local
    crowded: list[str] = []
    for n, box in content:
        x, y, w, h = box
        if _box_area(box) >= 0.55 * fw * fh:
            continue
        dist = min(x - lx, y - ly, (lx + lw) - (x + w), (ly + lh) - (y + h))
        if dist < margin:
            crowded.append(str(n.get("id") or "?"))
    if crowded:
        facts.edge_crowding = True
        facts.issues.append(
            "edge crowding: " + ", ".join(crowded[:6]) + f" < {int(round(margin))}px from edge"
        )


def _scene_interrupt_payload(st: AgentRunState, *, round_i: int) -> dict[str, Any]:
    return {
        "kind": "scene_feedback",
        "task_id": st.task_id,
        "trace_id": st.trace_id,
        "round": int(round_i),
        "timeout_ms": int(_SCENE_WAIT_SEC * 1000),
    }


def _normalize_resume_snap(raw: Any) -> dict[str, Any] | None:
    """Command(resume=…) value → scene snapshot, or None for timeout/empty."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        if raw.get("timeout"):
            return None
        if raw.get("cancelled") or raw.get("paused"):
            return None
        if any(
            k in raw
            for k in (
                "nodes",
                "frames",
                "op_results",
                "spatial",
                "preview_image",
                "transaction_id",
                "transaction_status",
            )
        ):
            out = {
                "nodes": list(raw.get("nodes") or [])
                if isinstance(raw.get("nodes"), list)
                else [],
                "frames": list(raw.get("frames") or [])
                if isinstance(raw.get("frames"), list)
                else [],
                "spatial": raw.get("spatial")
                if isinstance(raw.get("spatial"), dict)
                else None,
                "op_results": list(raw.get("op_results") or [])
                if isinstance(raw.get("op_results"), list)
                else [],
            }
            prev = str(raw.get("preview_image") or "").strip()
            if prev.startswith("data:image/") or prev.startswith("http"):
                out["preview_image"] = prev
            tid = str(raw.get("transaction_id") or "").strip()
            if tid:
                out["transaction_id"] = tid
            status = str(raw.get("transaction_status") or "").strip().lower()
            if status in ("ack", "rollback", "commit"):
                out["transaction_status"] = status
            if raw.get("base_revision") is not None:
                try:
                    out["base_revision"] = int(raw.get("base_revision"))
                except (TypeError, ValueError):
                    pass
            return out
    return None


def _clear_active_transaction(st: AgentRunState, snap: dict[str, Any] | None) -> None:
    """Clear Host active tx after FE ACK/rollback (or drop stale id mismatch)."""
    active = str(st.active_transaction_id or "").strip()
    if not active:
        return
    if not snap:
        return
    tid = str(snap.get("transaction_id") or "").strip()
    status = str(snap.get("transaction_status") or "").strip().lower()
    if tid and tid != active:
        return
    if status not in ("ack", "rollback", "commit") and not tid:
        return
    st.active_transaction_id = ""
    st.active_transaction_phase = ""
    st.active_transaction_base_revision = 0
    st.push_log(
        phase="transaction_ack",
        transaction_id=tid or active,
        transaction_status=status or "ack",
        summary=f"tx {(tid or active)} {status or 'ack'}",
    )


def _op_receipt_issues(
    emitted_ops: list[dict[str, Any]] | None,
    op_results: list[dict[str, Any]] | None,
) -> list[str]:
    """Return missing or invalid client receipts for this emitted operation batch."""
    expected: dict[str, str] = {}
    for op in emitted_ops or []:
        if not isinstance(op, dict):
            continue
        oid = str(op.get("op_id") or "").strip()
        if oid:
            expected[oid] = str(op.get("name") or "op").strip() or "op"
    if not expected:
        return []
    received: dict[str, dict[str, Any]] = {}
    for result in op_results or []:
        if not isinstance(result, dict):
            continue
        oid = str(result.get("op_id") or "").strip()
        if oid:
            received[oid] = result
    issues: list[str] = []
    missing = [f"{name} ({oid})" for oid, name in expected.items() if oid not in received]
    unknown = [oid for oid in received if oid not in expected]
    if missing:
        issues.append("missing operation receipts: " + ", ".join(missing[:8]))
    if unknown:
        issues.append("unknown operation receipts: " + ", ".join(unknown[:8]))
    for oid, name in expected.items():
        result = received.get(oid)
        if result and str(result.get("name") or "").strip() not in ("", name):
            issues.append(f"receipt operation mismatch: {oid}")
    return issues


def _critique_enabled(rt: Any | None = None) -> bool:
    """Prefer AgentProfile / rules overlay, then settings.design_critique_enabled."""
    rules = getattr(rt, "rules", None) if rt is not None else None
    if isinstance(rules, dict):
        raw = str(rules.get("design.critique.enabled") or "").strip().lower()
        if raw in ("0", "false", "off", "no"):
            return False
        if raw in ("1", "true", "on", "yes"):
            return True
    try:
        from app.services.design.runtime.agent_profile import get_active_agent_profile

        prof = get_active_agent_profile()
        if "critique_enabled" in prof.runtime_flags:
            return bool(prof.runtime_flags["critique_enabled"])
    except Exception:
        pass
    try:
        from app.core.config import settings

        return bool(getattr(settings, "design_critique_enabled", True))
    except Exception:
        return True


def _review_stage_enabled() -> bool:
    """Profile still lists review as a stage (topology)."""
    try:
        from app.services.design.runtime.agent_profile import get_active_agent_profile

        prof = get_active_agent_profile()
        enabled = {
            str(s).strip().lower()
            for s in (prof.stages_enabled or ())
            if str(s).strip()
        }
        return "review" in enabled
    except Exception:
        return True


def _review_mode(rt: Any | None = None) -> str:
    """auto | off | always — default auto (sparse Review, not every design paint)."""
    flags = getattr(rt, "flags", None) if rt is not None else None
    if isinstance(flags, dict):
        raw = str(flags.get("review_mode") or "").strip().lower()
        if raw in ("auto", "off", "always"):
            return raw
    rules = getattr(rt, "rules", None) if rt is not None else None
    if isinstance(rules, dict):
        for key in ("design.review.mode", "agent.review.mode"):
            raw = str(rules.get(key) or "").strip().lower()
            if raw in ("auto", "off", "always"):
                return raw
            if raw in ("0", "false", "no"):
                return "off"
            if raw in ("1", "true", "yes", "on"):
                return "always"
    try:
        from app.services.design.runtime.agent_profile import get_active_agent_profile

        prof = get_active_agent_profile()
        raw = str(prof.runtime_flags.get("review_mode") or "").strip().lower()
        if raw in ("auto", "off", "always"):
            return raw
    except Exception:
        pass
    try:
        from app.core.config import settings

        if not bool(getattr(settings, "design_review_agent_enabled", True)):
            return "off"
        raw = str(getattr(settings, "design_review_mode", "auto") or "auto").strip().lower()
        if raw in ("auto", "off", "always"):
            return raw
    except Exception:
        pass
    return "auto"


def _is_paint_retry_turn(rt: Any) -> bool:
    flags = getattr(rt, "flags", None)
    if isinstance(flags, dict):
        if flags.get("critique_failed") or flags.get("op_failed") or flags.get("review_failed"):
            return True
    st = getattr(rt, "run", None)
    note = str(getattr(st, "reflect_note", "") or "").strip().upper()
    return note.startswith("CRITIQUE") or "MUST_FIX" in note or "REVIEW" in note


def _is_high_stakes_review_turn(rt: Any) -> bool:
    """Narrow high-cost creates — not every poster skill (that would ≈ always)."""
    if bool(getattr(rt, "images", None)):
        try:
            from app.services.design.runtime.models_route import normalize_user_intent

            if normalize_user_intent(getattr(rt, "classified_intent", None)) == "design":
                return True
        except Exception:
            return True
    frames = 0
    for op in list(getattr(rt, "paint_ops", None) or []):
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if name == "create_frame":
            frames += 1
            if frames >= 2:
                return True
    return False


def _should_route_to_review(rt: Any) -> bool:
    """Sparse Review gate — aesthetic / high-stakes only.

    Modes (settings / rules / profile ``review_mode``):
    - off: never
    - always: every design paint (canvas_op never)
    - auto: paint retry that is not a live structure fail, or high-stakes
      (ref images + design, multi-artboard)

    ``facts.issues`` are Observe structure facts — they never open Review.
    ``review_repair_used`` forbids a second Review hop.
    Intent LLM owns canvas_op vs design; no prompt-length/keyword taste guess.
    """
    if not _review_stage_enabled():
        return False
    mode = _review_mode(rt)
    if mode == "off":
        return False
    if bool((getattr(rt, "flags", None) or {}).get("review_repair_used")):
        return False
    try:
        from app.services.design.runtime.models_route import normalize_user_intent

        intent = normalize_user_intent(getattr(rt, "classified_intent", None))
        if intent == "canvas_op":
            return False
    except Exception:
        pass
    if mode == "always":
        return True
    if _is_paint_retry_turn(rt):
        return True
    if _is_high_stakes_review_turn(rt):
        return True
    return False


def _create_op_xy(op: dict[str, Any]) -> tuple[float, float] | None:
    """World x/y for a create op, or None if missing / frame-scoped."""
    args = op.get("args") if isinstance(op.get("args"), dict) else op
    if not isinstance(args, dict):
        return None
    frame_id = str(args.get("frameId") or "").strip()
    if frame_id:
        return None
    try:
        return float(args["x"]), float(args["y"])
    except (KeyError, TypeError, ValueError):
        return None


def _spatial_grounding_issues(rt: AgentRuntime) -> list[str]:
    """Structural host checks only — not layout taste (that belongs in Skills/Review).

    Post-paint observe must NOT re-check FE viewport placement: camera / Yjs lag
    makes viewport_world stale and forces false re-paint. Viewport rejection stays
    in the pre-apply paint gate (`_placement_errors_for_free_creates`).
    """
    issues: list[str] = []
    creates = [
        op
        for op in (rt.paint_ops or [])
        if isinstance(op, dict)
        and str(op.get("name") or "").startswith("create_")
    ]
    pts = [xy for op in creates if (xy := _create_op_xy(op)) is not None]

    if len(pts) >= 2:
        stacked = sum(
            1
            for i, (x0, y0) in enumerate(pts)
            for x1, y1 in pts[i + 1 :]
            if abs(x0 - x1) < 48 and abs(y0 - y1) < 48
        )
        if stacked:
            issues.append(
                f"creates stacked ({stacked} near-duplicate positions) — "
                "offset by varying x/y inside FOCUS_FRAME (frame-local, keep frameId)"
            )
    return issues[:6]


def _is_structure_retry_text(text: str) -> bool:
    """Overflow / overlap / empty / alignment / type hierarchy → paint, not Review."""
    low = text.lower()
    if not low:
        return False
    if low.startswith(("overflow", "bounds", "overlap", "alignment", "empty")):
        return True
    if "typography hierarchy" in low:
        return True
    return False


def _observe_retry_issues(facts: ObserveFactsSchema) -> list[str]:
    """Host paint-retry: structure facts only. Taste stays in Review."""
    retry: list[str] = []
    for item in list(facts.structure_issues) + list(facts.bounds_issues) + list(
        facts.alignment_issues
    ):
        text = str(item).strip()
        if text and text not in retry:
            retry.append(text)
    for item in facts.issues:
        text = str(item).strip()
        if not text or text in retry:
            continue
        if _is_structure_retry_text(text):
            retry.append(text)
    return retry[:10]


def _observe_settle(
    rt: AgentRuntime,
    *,
    ok: bool,
    critique_issues: list[str] | None = None,
) -> Command:
    if critique_issues:
        _emit_ux_tip(
            rt,
            "observe_critique_failed",
            params={"issues": "; ".join(critique_issues[:2])},
        )
    rt.flags["scene_ready"] = True
    rt.flags["op_failed"] = False
    rt.flags["ok"] = bool(ok)
    rt.flags["retry"] = False
    rt.terminal = True
    return Command(update=_bump(rt), goto="__settle__")


def _observe_goto_review(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    preview_image: str | None,
    observe_signals: list[str],
    critique_issues: list[str],
) -> Command:
    from app.services.design.runtime.graph.nodes.review import stash_review_context

    stash_review_context(
        st.task_id,
        preview_image=preview_image,
        signals=observe_signals or list(critique_issues or []),
    )
    st.push_log(
        phase="observe",
        summary="observe done → Review Agent (auto gate)",
        has_preview=bool(preview_image) or None,
        critique_signals=len(critique_issues or []) or None,
        review_mode=_review_mode(rt),
    )
    rt.flags["scene_ready"] = True
    rt.flags["op_failed"] = False
    rt.flags["retry"] = False
    rt.terminal = False
    return Command(update=_bump(rt), goto="review")


async def _route_after_observe_facts(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    critique_issues: list[str],
    preview_image: str | None,
    observe_signals: list[str],
) -> Command:
    """Structure → paint or settle. Review only after that, never from facts.issues."""
    if rt.flags.get("optimization_halt"):
        return _observe_settle(rt, ok=True)

    used_review = bool(rt.flags.get("review_repair_used"))
    can_paint = (
        bool(critique_issues)
        and st.reflect_left > 0
        and not rt.turn.get("done")
        and st.painted
        and not used_review
    )
    if can_paint:
        return await _retry_paint_from_critique(
            rt, st, round_i=round_i, issues=critique_issues
        )
    if used_review:
        return _observe_settle(
            rt, ok=not bool(critique_issues), critique_issues=critique_issues
        )
    if critique_issues:
        return _observe_settle(rt, ok=False, critique_issues=critique_issues)
    if _should_route_to_review(rt) and st.painted:
        return _observe_goto_review(
            rt,
            st,
            preview_image=preview_image,
            observe_signals=observe_signals,
            critique_issues=critique_issues,
        )
    return _observe_settle(rt, ok=True)


def _run_post_paint_critique(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    preview_image: str | None = None,
    op_results: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Observe QA after FE scene lands. Retry = structure; taste → Review."""
    if not st.painted:
        rt.observe_facts = None
        return []
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    facts = compute_observe_facts(
        nodes=list(rt.scene_nodes or []),
        frames=list(rt.scene_frames or []),
        painted=True,
        intent=str(st.intent or ""),
        paint_ops=list(rt.paint_ops or []),
        op_results=list(op_results or []),
        design_brief=brief,
        skills_loaded=list(getattr(st, "skills_loaded", None) or []),
        focus_frame_id=str(getattr(rt, "focus_id", "") or "") or None,
    )
    for issue in _spatial_grounding_issues(rt):
        if issue not in facts.structure_issues:
            facts.structure_issues.append(issue)
        if issue not in facts.issues:
            facts.issues.append(issue)
    rt.observe_facts = facts.model_dump()
    record_visual_diff(rt, facts=facts, preview_image=preview_image)
    retry = _observe_retry_issues(facts)
    if not _critique_enabled(rt):
        return []
    _emit(
        {
            "type": "critique_start",
            "round": round_i,
            "reason": "post_paint",
        }
    )
    ok = not retry
    reason = "; ".join(retry)[:400] if retry else "ok"
    _emit(
        {
            "type": "critique_done",
            "round": round_i,
            "ok": ok,
            "reason": reason,
            **({"has_preview": True} if preview_image else {}),
        }
    )
    st.push_log(
        phase="critique",
        ok=ok,
        issues=retry or None,
        observe_facts=format_observe_facts(facts)[:8] or None,
        has_preview=bool(preview_image) or None,
        summary=("critique ok" if ok else f"critique: {reason}")[:160],
    )
    return retry


def _format_critique_reflect_note(issues: list[str]) -> str:
    """Paint-retry brief: structural CRITIQUE only (no aesthetic coaching)."""
    lines = ["CRITIQUE (fix paint — structural host issues):"]
    for i, issue in enumerate(issues[:6], 1):
        lines.append(f"{i}. {str(issue).strip()[:200]}")
    joined = " ".join(str(x).lower() for x in issues)
    if any(
        k in joined
        for k in ("place", "viewport", "stacked", "placement", "outside")
    ):
        lines.append(
            "Placement: set frameId=FOCUS_FRAME_ID on every create_* "
            "and use frame-local x/y (0..w, 0..h from TARGET_CANVAS)."
        )
    return "\n".join(lines)[:720]


async def _retry_paint_from_critique(
    rt: AgentRuntime,
    st: AgentRunState,
    *,
    round_i: int,
    issues: list[str],
) -> Command:
    note = _format_critique_reflect_note(issues)
    st.note_error(note)
    st.push_log(
        phase="reflect",
        error=st.reflect_note,
        reason="critique_failed",
        reflect_left=st.reflect_left,
        issues=issues[:6],
        summary=f"critique failed, retry paint: {'; '.join(issues)[:120]}"[:160],
    )
    st.reflect_left -= 1
    _emit(
        {
            "type": "skill_done",
            "index": round_i,
            "skill_key": "react",
            "skill_name": "Design Agent",
            "tokens": rt.last_used,
        }
    )
    st.round = round_i + 1
    rt.flags["op_failed"] = False
    rt.flags["critique_failed"] = True
    rt.flags["retry"] = True
    rt.flags["ok"] = False
    return Command(update=_bump(rt), goto="paint_ops")


async def _node_observe(
    state: GraphState,
) -> Command:
    rt = state["rt"]
    st = rt.run
    round_i = st.round
    from app.services.design.runtime.graph.build import (
        mark_design_running,
        mark_design_waiting_client,
    )
    from app.services.design.admin.task_store import peek_run_intent

    await asyncio.to_thread(mark_design_waiting_client, st.task_id)

    # Formal HITL: pause graph until driver resumes with FE scene (or timeout).
    # Node restarts from the top on resume — mark_waiting is idempotent.
    resume_raw = interrupt(_scene_interrupt_payload(st, round_i=round_i))

    intent = await asyncio.to_thread(peek_run_intent, st.task_id)
    if intent in ("pause", "cancel"):
        raise asyncio.CancelledError()

    if intent not in ("pause", "cancel"):
        await asyncio.to_thread(mark_design_running, st.task_id)

    snap = _normalize_resume_snap(resume_raw)
    preview_image: str | None = None
    op_failures: list[dict[str, Any]] = []
    op_results: list[dict[str, Any]] = []
    if snap:
        nodes = [
            n for n in (snap.get("nodes") or []) if isinstance(n, dict) and n.get("id")
        ][:120]
        frames = [
            f for f in (snap.get("frames") or []) if isinstance(f, dict) and f.get("id")
        ][:32]
        rt.scene_nodes = nodes
        rt.scene_frames = frames
        spatial = snap.get("spatial")
        if isinstance(spatial, dict):
            rt.spatial_summary = spatial
        prev = str(snap.get("preview_image") or "").strip()
        if prev:
            preview_image = prev
            rt.flags["preview_image"] = True
        op_results = [
            r for r in (snap.get("op_results") or []) if isinstance(r, dict)
        ]
        receipt_issues = _op_receipt_issues(rt.paint_ops, op_results)
        if receipt_issues:
            reason = "; ".join(receipt_issues[:3])
            st.note_error(f"scene_receipt_unconfirmed: {reason}")
            st.push_log(
                phase="observe",
                ok=False,
                error="scene_receipt_unconfirmed",
                summary=f"observe unconfirmed: {reason}"[:240],
            )
            _emit_ux_tip(
                rt,
                "observe_ops_failed",
                params={"count": str(len(receipt_issues)), "notes": reason[:180]},
            )
            rt.terminal = True
            rt.flags["ok"] = False
            rt.flags["scene_ready"] = False
            rt.flags["scene_unconfirmed"] = True
            rt.flags["op_receipt_unconfirmed"] = True
            rt.flags["retry"] = False
            return Command(update=_bump(rt), goto="__settle__")
        op_failures = [r for r in op_results if not r.get("ok", True)]
        _clear_active_transaction(st, snap)
        fail_bits = [
            f"{r.get('name') or 'op'}: {r.get('error') or 'failed'}"
            for r in op_failures[:8]
            if isinstance(r, dict)
        ]
        st.push_log(
            phase="observe",
            nodes=len(nodes),
            frames=len(frames),
            ok=not op_failures,
            op_failed=len(op_failures) or None,
            op_errors=fail_bits or None,
            summary=(
                f"observe nodes={len(nodes)} frames={len(frames)}"
                + (f" · failed×{len(op_failures)}" if op_failures else " · ok")
            ),
        )
    else:
        st.note_error("scene_feedback_timeout: FE did not confirm canvas changes")
        st.push_log(
            phase="observe",
            ok=False,
            error="timeout",
            summary="observe timeout: FE did not post scene",
        )
        # Stale inventory must NOT drive critique → paint retry (empty board /
        # placement false positives). Preserve the canvas, but do not claim the
        # client applied the transaction without an explicit acknowledgement.
        if rt.skip_loop:
            if st.reply:
                _emit({"type": "token", "text": st.reply})
        _emit_ux_tip(rt, "observe_scene_timeout", params={})
        rt.terminal = True
        rt.flags["ok"] = False
        rt.flags["scene_ready"] = False
        rt.flags["scene_timeout"] = True
        rt.flags["scene_unconfirmed"] = True
        rt.flags["op_failed"] = False
        rt.flags["retry"] = False
        return Command(update=_bump(rt), goto="__settle__")

    if rt.skip_loop:
        if st.reply:
            _emit({"type": "token", "text": st.reply})
        rt.terminal = True
        rt.flags["ok"] = True
        rt.flags["scene_ready"] = bool(snap)
        rt.flags["op_failed"] = False
        return Command(update=_bump(rt), goto="__settle__")

    if op_failures:
        fail_notes = "; ".join(
            f"{r.get('name') or 'op'}: {r.get('error') or 'failed'}"
            for r in op_failures[:3]
        )
        all_failed = len(rt.paint_ops) > 0 and len(op_failures) >= len(rt.paint_ops)
        if all_failed:
            st.painted = False
        st.note_error(f"op_apply_failed: {fail_notes}")
        st.push_log(
            phase="reflect",
            error=st.reflect_note,
            reason="op_apply_failed",
            op_failed=len(op_failures),
            reflect_left=st.reflect_left,
            summary=f"ops failed×{len(op_failures)}: {fail_notes}"[:160],
        )
        _emit(
            {
                "type": "activity",
                "id": f"opfail-{round_i}",
                "kind": "skipped",
                "status": "done",
                "count": len(op_failures),
                "detail": f"ops_failed×{len(op_failures)}: {fail_notes}"[:200],
                "index": round_i,
            }
        )
        if st.reflect_left > 0 and not rt.turn.get("done"):
            st.reflect_left -= 1
            _emit(
                {
                    "type": "skill_done",
                    "index": round_i,
                    "skill_key": "react",
                    "skill_name": "Design Agent",
                    "tokens": rt.last_used,
                }
            )
            st.round = round_i + 1
            rt.flags["op_failed"] = True
            rt.flags["retry"] = True
            rt.flags["ok"] = False
            return Command(update=_bump(rt), goto="paint_ops")
        _emit_ux_tip(
            rt,
            "observe_ops_failed",
            params={"count": str(len(op_failures)), "notes": fail_notes[:80]},
        )
        _emit(
            {
                "type": "skill_done",
                "index": round_i,
                "skill_key": "react",
                "tokens": rt.last_used,
            }
        )
        rt.terminal = True
        rt.flags["ok"] = False
        return Command(update=_bump(rt), goto="__settle__")

    critique_issues = _run_post_paint_critique(
        rt,
        st,
        round_i=round_i,
        preview_image=preview_image,
        op_results=op_results,
    )
    facts_raw = rt.observe_facts if isinstance(rt.observe_facts, dict) else {}
    facts = ObserveFactsSchema.model_validate(facts_raw) if facts_raw else ObserveFactsSchema()
    observe_signals = format_observe_facts(facts)
    return await _route_after_observe_facts(
        rt,
        st,
        round_i=round_i,
        critique_issues=critique_issues,
        preview_image=preview_image,
        observe_signals=observe_signals,
    )
