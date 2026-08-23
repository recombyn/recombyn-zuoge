"""Spatial placement geometry and validation for free-canvas creates."""
from __future__ import annotations

from typing import Any

from app.services.design.ops.tool_ops_contract import format_op_error

def _box_num(d: dict[str, Any], key: str, *, default: float = 0.0) -> float:
    if key in d and d[key] is not None:
        try:
            return float(d[key])
        except (TypeError, ValueError):
            pass
    return default


def _boxes_overlap(a: dict[str, float], b: dict[str, float], *, gap: float = 0.0) -> bool:
    return not (
        a["x"] + a["w"] + gap <= b["x"]
        or b["x"] + b["w"] + gap <= a["x"]
        or a["y"] + a["h"] + gap <= b["y"]
        or b["y"] + b["h"] + gap <= a["y"]
    )


def _box_inside(inner: dict[str, float], outer: dict[str, float], *, pad: float = 0.0) -> bool:
    return (
        inner["x"] >= outer["x"] + pad
        and inner["y"] >= outer["y"] + pad
        and inner["x"] + inner["w"] <= outer["x"] + outer["w"] - pad
        and inner["y"] + inner["h"] <= outer["y"] + outer["h"] - pad
    )


def _world_occupied_in_viewport(
    spatial: dict[str, Any],
    vp: dict[str, float],
    *,
    focus_frame: dict[str, Any] | None,
) -> list[dict[str, float]]:
    """Occupied world boxes that intersect the camera (for blank-slot search)."""
    fox = foy = 0.0
    in_frame = False
    if isinstance(focus_frame, dict):
        fox = _box_num(focus_frame, "x")
        foy = _box_num(focus_frame, "y")
        in_frame = True
    out: list[dict[str, float]] = []
    for n in spatial.get("focused") or []:
        if not isinstance(n, dict):
            continue
        w = _box_num(n, "w")
        h = _box_num(n, "h")
        if w <= 1 or h <= 1:
            continue
        box = {
            "x": fox + _box_num(n, "x") if in_frame else _box_num(n, "x"),
            "y": foy + _box_num(n, "y") if in_frame else _box_num(n, "y"),
            "w": w,
            "h": h,
        }
        if _boxes_overlap(box, vp, gap=0):
            out.append(box)
    for f in spatial.get("peripheral") or []:
        if not isinstance(f, dict):
            continue
        w = _box_num(f, "w")
        h = _box_num(f, "h")
        if w <= 1 or h <= 1:
            continue
        box = {"x": _box_num(f, "x"), "y": _box_num(f, "y"), "w": w, "h": h}
        if _boxes_overlap(box, vp, gap=0):
            out.append(box)
    if in_frame and _box_num(focus_frame, "w") > 8:
        fb = {
            "x": fox,
            "y": foy,
            "w": _box_num(focus_frame, "w"),
            "h": _box_num(focus_frame, "h"),
        }
        if _boxes_overlap(fb, vp, gap=0):
            # Treat the artboard shell as occupied so free-canvas creates sit beside it.
            out.append(fb)
    return out


def _pick_viewport_blank_slot(
    vp: dict[str, float],
    occupied: list[dict[str, float]],
    *,
    cw: float,
    ch: float,
    gap: float = 24.0,
) -> dict[str, float]:
    """Empty viewport → center; else prefer right/below aligned to existing content."""
    center = {
        "x": round(vp["x"] + max(gap, (vp["w"] - cw) / 2)),
        "y": round(vp["y"] + max(gap, (vp["h"] - ch) / 2)),
        "w": round(cw),
        "h": round(ch),
    }
    if not occupied:
        return center

    candidates: list[dict[str, float]] = []
    for o in occupied:
        candidates.extend(
            [
                {"x": o["x"] + o["w"] + gap, "y": o["y"], "w": cw, "h": ch},  # right, top-align
                {"x": o["x"], "y": o["y"] + o["h"] + gap, "w": cw, "h": ch},  # below, left-align
                {"x": o["x"] + o["w"] + gap, "y": o["y"] + o["h"] - ch, "w": cw, "h": ch},  # right, bottom-align
                {"x": o["x"] + o["w"] - cw, "y": o["y"] + o["h"] + gap, "w": cw, "h": ch},  # below, right-align
            ]
        )
    # Union right / below as last spatial fallbacks before center.
    max_r = max((o["x"] + o["w"] for o in occupied), default=vp["x"])
    max_b = max((o["y"] + o["h"] for o in occupied), default=vp["y"])
    min_x = min((o["x"] for o in occupied), default=vp["x"])
    min_y = min((o["y"] for o in occupied), default=vp["y"])
    candidates.append({"x": max_r + gap, "y": min_y, "w": cw, "h": ch})
    candidates.append({"x": min_x, "y": max_b + gap, "w": cw, "h": ch})

    for raw in candidates:
        slot = {
            "x": round(raw["x"]),
            "y": round(raw["y"]),
            "w": round(cw),
            "h": round(ch),
        }
        if not _box_inside(slot, vp, pad=gap * 0.5):
            continue
        if any(_boxes_overlap(slot, o, gap=gap * 0.5) for o in occupied):
            continue
        return slot
    return center



def _derive_suggested_place_world(
    spatial: dict[str, Any] | None,
    *,
    focus_frame: dict[str, Any] | None = None,
) -> dict[str, float] | None:
    """Viewport-first place: blank slot (align if possible) or camera center.

    NOTE: The return value is used only for tests and utility callers.
    The paint prompt no longer injects these coords as suggestions to the model
    (see _format_spatial_placement which returns "").
    """
    spatial = spatial if isinstance(spatial, dict) else {}
    vp_raw = spatial.get("viewport")
    if isinstance(vp_raw, dict):
        vw = _box_num(vp_raw, "w")
        vh = _box_num(vp_raw, "h")
        if vw > 8 and vh > 8:
            vp = {
                "x": _box_num(vp_raw, "x"),
                "y": _box_num(vp_raw, "y"),
                "w": vw,
                "h": vh,
            }
            cw = min(320.0, max(80.0, vw * 0.22))
            ch = min(240.0, max(80.0, vh * 0.22))
            occupied = _world_occupied_in_viewport(spatial, vp, focus_frame=focus_frame)
            return _pick_viewport_blank_slot(vp, occupied, cw=cw, ch=ch)

    sp = spatial.get("suggested_place")
    if isinstance(sp, dict) and isinstance(focus_frame, dict):
        fox = _box_num(focus_frame, "x")
        foy = _box_num(focus_frame, "y")
        fw = _box_num(focus_frame, "w")
        fh = _box_num(focus_frame, "h")
        if fw > 8 and fh > 8:
            return {
                "x": round(fox + _box_num(sp, "x")),
                "y": round(foy + _box_num(sp, "y")),
                "w": round(_box_num(sp, "w", default=320)),
                "h": round(_box_num(sp, "h", default=200)),
            }
    if isinstance(focus_frame, dict):
        fox = _box_num(focus_frame, "x")
        foy = _box_num(focus_frame, "y")
        fw = _box_num(focus_frame, "w")
        fh = _box_num(focus_frame, "h")
        if fw > 8 and fh > 8:
            cw = min(320.0, max(80.0, fw * 0.25))
            ch = min(200.0, max(80.0, fh * 0.25))
            return {
                "x": round(fox + max(24.0, (fw - cw) / 2)),
                "y": round(foy + max(24.0, (fh - ch) / 2)),
                "w": round(cw),
                "h": round(ch),
            }
    return None


def _format_spatial_placement(
    spatial: dict[str, Any] | None,
    *,
    focus_frame: dict[str, Any] | None = None,
) -> str:
    """No invented place slots (320×200 etc.) — those poisoned create_frame size.

    Keep this empty: paint uses USER_PROMPT / CANVAS_SIZE / FOCUS_FRAME only.
    """
    del spatial, focus_frame
    return ""


def _focus_frame_from_rt(rt: Any) -> dict[str, Any] | None:
    focus_id = str(getattr(rt, "focus_id", "") or "").strip()
    if not focus_id:
        return None
    for f in getattr(rt, "scene_frames", None) or []:
        if isinstance(f, dict) and str(f.get("id") or "") == focus_id:
            return f
    return None


def _point_outside_world_box(
    x: float,
    y: float,
    box: dict[str, Any],
    *,
    pad: float = 0.0,
) -> bool:
    bx = _box_num(box, "x")
    by = _box_num(box, "y")
    bw = _box_num(box, "w")
    bh = _box_num(box, "h")
    if bw <= 0 or bh <= 0:
        return False
    return (
        x < bx - pad
        or y < by - pad
        or x > bx + bw + pad
        or y > by + bh + pad
    )


def _create_op_placement_fields(op: dict[str, Any]) -> tuple[Any, Any, str]:
    """Return (x, y, frameId) from normalized {args} or flat model shape."""
    args = op.get("args") if isinstance(op.get("args"), dict) else None
    src = args if args is not None else op
    return src.get("x"), src.get("y"), str(src.get("frameId") or "").strip()


def _batch_opens_new_frame(ops: list[dict[str, Any]]) -> bool:
    """True when this paint batch creates a new artboard (camera check N/A yet)."""
    for op in ops:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if name in ("create_frame", "ensure_frame"):
            return True
    return False


def _placement_errors_for_free_creates(rt: Any, ops: list[dict[str, Any]]) -> list[str]:
    """Reject free-canvas creates outside the artboard/camera.

    Does not mutate ops. Frame-scoped creates (frameId set) are skipped.
    Batches that include create_frame/ensure_frame are skipped entirely — Host
    opens+binds that plate first; rejecting free x/y here would also drop the
    create_frame (ops_gate returns [] on any placement error).
    create_frame is a paint/LLM choice (user may opt out) — not enforced here.
    """
    if not ops:
        return []
    if _batch_opens_new_frame(ops):
        return []
    spatial = (
        getattr(rt, "spatial_summary", None)
        if isinstance(getattr(rt, "spatial_summary", None), dict)
        else {}
    )
    focus_frame = _focus_frame_from_rt(rt)
    vp = spatial.get("viewport") if isinstance(spatial, dict) else None
    # Prefer artboard bounds when present — FE camera viewport is noisier (Yjs/pan lag).
    if isinstance(focus_frame, dict) and _box_num(focus_frame, "w") > 0:
        view_box = focus_frame
        pad = max(
            48.0,
            0.2 * min(_box_num(view_box, "w"), _box_num(view_box, "h")),
        )
    elif isinstance(vp, dict) and _box_num(vp, "w") > 0:
        view_box = vp
        pad = max(
            96.0,
            0.4 * min(_box_num(view_box, "w"), _box_num(view_box, "h")),
        )
    else:
        return []
    errors: list[str] = []
    create_names = ("create_shape", "create_text", "create_image", "create_svg")
    for op in ops:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if name not in create_names:
            continue
        ox_raw, oy_raw, frame_id = _create_op_placement_fields(op)
        if frame_id:
            continue
        if ox_raw is None and oy_raw is None:
            continue
        try:
            ox = float(ox_raw if ox_raw is not None else 0)
            oy = float(oy_raw if oy_raw is not None else 0)
        except (TypeError, ValueError):
            continue
        if not _point_outside_world_box(ox, oy, view_box, pad=pad):
            continue
        focus_id = str(getattr(rt, "focus_id", "") or "").strip() or "FOCUS_FRAME_ID"
        errors.append(
            format_op_error(
                "placement_outside_viewport",
                fix=(
                    f"re-emit {name} with frameId={focus_id} and frame-local "
                    f"x/y inside the artboard (0..w, 0..h); do not invent free-canvas "
                    f"world coords or stock place sizes"
                ),
                detail=(
                    f"{name} at world ({int(round(ox))},{int(round(oy))}) "
                    f"outside artboard/viewport"
                ),
            )
        )
    return errors[:8]


build_placement_block = _format_spatial_placement
placement_errors_for_free_creates = _placement_errors_for_free_creates
