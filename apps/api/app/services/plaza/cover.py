"""Plaza list covers — prefer active / first artboard (no dedicated 「封面」 required)."""

from __future__ import annotations

import copy
import json
from typing import Any

# Legacy name still recognized when picking a cover frame, but not required.
COVER_FRAME_NAME = "封面"


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def list_artboard_frames(document: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Valid artboards with positive size."""
    if not isinstance(document, dict):
        return []
    frames = document.get("frames")
    if not isinstance(frames, list):
        return []
    out: list[dict[str, Any]] = []
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        w = max(0.0, _num(frame.get("width")))
        h = max(0.0, _num(frame.get("height")))
        if w > 0 and h > 0:
            out.append(frame)
    return out


def _frame_by_id(frames: list[dict[str, Any]], frame_id: str) -> dict[str, Any] | None:
    for frame in frames:
        if str(frame.get("id") or "") == frame_id:
            return frame
    return None


def _frame_by_name(frames: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for frame in frames:
        if str(frame.get("name") or "").strip() == name:
            return frame
    return None


def find_cover_frame(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Frame used for Plaza list cards.
    Prefer activeFrameId, then a board named 「封面」, then the first artboard.
    """
    frames = list_artboard_frames(document)
    if not frames or not isinstance(document, dict):
        return None

    active_id = str(document.get("activeFrameId") or "").strip()
    if active_id:
        active = _frame_by_id(frames, active_id)
        if active:
            return active

    named = _frame_by_name(frames, COVER_FRAME_NAME)
    if named:
        return named

    return frames[0]


def _node_center(node: dict[str, Any]) -> tuple[float, float]:
    x = _num(node.get("x"))
    y = _num(node.get("y"))
    w = max(0.0, _num(node.get("width")))
    h = max(0.0, _num(node.get("height")))
    return x + w / 2.0, y + h / 2.0


def _inside_frame(cx: float, cy: float, frame: dict[str, Any]) -> bool:
    fx = _num(frame.get("x"))
    fy = _num(frame.get("y"))
    fw = max(1.0, _num(frame.get("width"), 1.0))
    fh = max(1.0, _num(frame.get("height"), 1.0))
    return fx <= cx <= fx + fw and fy <= cy <= fy + fh


def validate_cover_for_publish(document: dict[str, Any] | None) -> tuple[bool, str]:
    """Return (ok, error_code). Artboard is optional."""
    if not isinstance(document, dict):
        return False, "invalid_document"
    return True, ""


def extract_full_document_cover(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """Fallback cover when there is no artboard — full scene snapshot."""
    if not isinstance(document, dict):
        return None
    dsl = document.get("deltaSetLike")
    if not isinstance(dsl, dict):
        dsl = {}
    children: list[str] = []
    nodes: dict[str, Any] = {}
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for key, node in dsl.items():
        if key == "ROOT" or not isinstance(node, dict):
            continue
        nid = str(node.get("id") or key)
        cloned = copy.deepcopy(node)
        cloned["id"] = nid
        nodes[nid] = cloned
        children.append(nid)
        x = _num(cloned.get("x"))
        y = _num(cloned.get("y"))
        w = max(1.0, _num(cloned.get("width"), 1.0))
        h = max(1.0, _num(cloned.get("height"), 1.0))
        min_x = min(min_x, x)
        min_y = min(min_y, y)
        max_x = max(max_x, x + w)
        max_y = max(max_y, y + h)

    doc_w = max(1.0, _num(document.get("width"), 794.0))
    doc_h = max(1.0, _num(document.get("height"), 1123.0))
    if children and min_x < max_x and min_y < max_y:
        pad = 40.0
        ox = max(0.0, min_x - pad)
        oy = max(0.0, min_y - pad)
        fw = max(1.0, (max_x - min_x) + pad * 2)
        fh = max(1.0, (max_y - min_y) + pad * 2)
        for nid in children:
            n = nodes[nid]
            n["x"] = _num(n.get("x")) - ox
            n["y"] = _num(n.get("y")) - oy
        doc_w, doc_h = fw, fh

    bg = document.get("backgroundColor") or "#ffffff"
    fid = "frame_full"
    return {
        "width": doc_w,
        "height": doc_h,
        "backgroundColor": bg,
        "backgroundFillType": "solid",
        "frames": [
            {
                "id": fid,
                "name": fid,
                "x": 0,
                "y": 0,
                "width": doc_w,
                "height": doc_h,
                "backgroundColor": bg,
            }
        ],
        "activeFrameId": fid,
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "children": children},
            **nodes,
        },
    }


def extract_frame_document(
    document: dict[str, Any] | None,
    frame: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Build a lightweight single-frame document from one artboard (+ nodes inside)."""
    if not frame or not isinstance(document, dict):
        return None

    fw = max(1.0, _num(frame.get("width"), 1.0))
    fh = max(1.0, _num(frame.get("height"), 1.0))
    fx = _num(frame.get("x"))
    fy = _num(frame.get("y"))
    fid = str(frame.get("id") or "frame")

    dsl = document.get("deltaSetLike")
    if not isinstance(dsl, dict):
        dsl = {}

    children: list[str] = []
    nodes: dict[str, Any] = {}
    for key, node in dsl.items():
        if key == "ROOT" or not isinstance(node, dict):
            continue
        cx, cy = _node_center(node)
        if not _inside_frame(cx, cy, frame):
            continue
        cloned = copy.deepcopy(node)
        cloned["x"] = _num(cloned.get("x")) - fx
        cloned["y"] = _num(cloned.get("y")) - fy
        nid = str(cloned.get("id") or key)
        cloned["id"] = nid
        nodes[nid] = cloned
        children.append(nid)

    cover_frame = {
        "id": fid,
        "name": str(frame.get("name") or "").strip() or fid,
        "x": 0,
        "y": 0,
        "width": fw,
        "height": fh,
        "backgroundColor": frame.get("backgroundColor")
        or document.get("backgroundColor")
        or "#ffffff",
    }

    return {
        "width": fw,
        "height": fh,
        "backgroundColor": cover_frame["backgroundColor"],
        "backgroundFillType": "solid",
        "frames": [cover_frame],
        "activeFrameId": fid,
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "children": children},
            **nodes,
        },
    }


def extract_cover_document(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """Plaza list: artboard when present, else full document."""
    framed = extract_frame_document(document, find_cover_frame(document))
    if framed:
        return framed
    return extract_full_document_cover(document)


def cover_json_dumps(document: dict[str, Any] | None) -> str | None:
    """Persist list cover snapshot (artboard or full document)."""
    ok, _ = validate_cover_for_publish(document)
    if not ok:
        return None
    cover = extract_cover_document(document)
    if not cover:
        return None
    return json.dumps(cover, ensure_ascii=False, separators=(",", ":"))
