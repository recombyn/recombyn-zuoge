"""Document ↔ scene inventory helpers for MCP canvas dispatch."""
from __future__ import annotations

from typing import Any


def _node_left_top(doc: dict[str, Any], node: dict[str, Any]) -> tuple[float, float]:
    left = float(node.get("x") or 0)
    top = float(node.get("y") or 0)
    parent_id = str(node.get("parentId") or "").strip()
    if parent_id and parent_id != "ROOT":
        parent = (doc.get("deltaSetLike") or {}).get(parent_id)
        if isinstance(parent, dict):
            px, py = _node_left_top(doc, parent)
            left += px
            top += py
    return left, top


def _fill_for_inventory(node: dict[str, Any]) -> str:
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    for key in ("fill-color", "fill", "background-color"):
        raw = str(attrs.get(key) or "").strip()
        if raw and raw not in ("transparent", "none"):
            return raw
    return ""


def _text_for_inventory(node: dict[str, Any]) -> str:
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    for key in ("text", "content", "markdown"):
        raw = str(attrs.get(key) or "").strip()
        if raw:
            return raw[:500]
    return ""


def inventory_item_from_node(
    doc: dict[str, Any],
    node_id: str,
    node: dict[str, Any],
    *,
    frame_id: str | None = None,
    origin_x: float = 0,
    origin_y: float = 0,
) -> dict[str, Any]:
    left, top = _node_left_top(doc, node)
    key = str(node.get("key") or "").lower()
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    shape_type = str(attrs.get("shapeType") or key or "shape").lower()
    w = max(1, int(round(float(node.get("width") or 1))))
    h = max(1, int(round(float(node.get("height") or 1))))
    item: dict[str, Any] = {
        "id": node_id,
        "type": "text" if key == "text" else shape_type or key or "shape",
        "x": int(round(left - origin_x)),
        "y": int(round(top - origin_y)),
        "w": w,
        "h": h,
    }
    if frame_id:
        item["frameId"] = frame_id
    fill = _fill_for_inventory(node)
    if fill:
        item["fill"] = fill
    stroke = str(attrs.get("border-color") or "").strip()
    if stroke and stroke not in ("transparent", "none"):
        item["stroke"] = stroke
    if key == "text":
        text = _text_for_inventory(node)
        if text:
            item["text"] = text
    name = str(attrs.get("name") or "").strip()
    if name:
        item["name"] = name
    return item


def scene_frames_from_document(doc: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(doc, dict):
        return []
    frames = doc.get("frames")
    if not isinstance(frames, list):
        return []
    out: list[dict[str, Any]] = []
    for f in frames:
        if not isinstance(f, dict) or not f.get("id"):
            continue
        out.append(
            {
                "id": str(f["id"]),
                "x": float(f.get("x") or 0),
                "y": float(f.get("y") or 0),
                "width": max(1, float(f.get("width") or 1)),
                "height": max(1, float(f.get("height") or 1)),
                "name": str(f.get("name") or ""),
            }
        )
    return out


def scene_nodes_from_document(doc: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Build agent-style SCENE_NODES inventory from a stored project document."""
    if not isinstance(doc, dict):
        return []
    delta = doc.get("deltaSetLike")
    if not isinstance(delta, dict):
        return []
    frames = scene_frames_from_document(doc)
    frame_ids = {str(f["id"]) for f in frames}
    by_id: dict[str, dict[str, Any]] = {}

    for fid in frame_ids:
        frame_node = delta.get(fid)
        if not isinstance(frame_node, dict):
            continue
        fx = float(next((f["x"] for f in frames if f["id"] == fid), 0) or 0)
        fy = float(next((f["y"] for f in frames if f["id"] == fid), 0) or 0)
        child_ids = frame_node.get("children") if isinstance(frame_node.get("children"), list) else []
        for cid in child_ids:
            sid = str(cid or "").strip()
            child = delta.get(sid)
            if not sid or not isinstance(child, dict):
                continue
            by_id[sid] = inventory_item_from_node(
                doc, sid, child, frame_id=fid, origin_x=fx, origin_y=fy
            )

    page_children = doc.get("pageChildren")
    if isinstance(page_children, list):
        root_ids = [str(c) for c in page_children if str(c or "").strip()]
    else:
        root = delta.get("ROOT")
        root_ids = (
            [str(c) for c in root.get("children") or [] if str(c or "").strip()]
            if isinstance(root, dict)
            else []
        )
    for sid in root_ids:
        if sid in by_id or sid in frame_ids or sid == "ROOT":
            continue
        node = delta.get(sid)
        if not isinstance(node, dict):
            continue
        by_id[sid] = inventory_item_from_node(doc, sid, node)

    return list(by_id.values())


def summarize_scene(doc: dict[str, Any] | None) -> dict[str, Any]:
    nodes = scene_nodes_from_document(doc)
    frames = scene_frames_from_document(doc)
    types: dict[str, int] = {}
    for n in nodes:
        t = str(n.get("type") or "node")
        types[t] = types.get(t, 0) + 1
    return {
        "nodeCount": len(nodes),
        "frameCount": len(frames),
        "types": types,
        "frames": [
            {
                "id": f["id"],
                "x": f["x"],
                "y": f["y"],
                "width": f["width"],
                "height": f["height"],
                "name": f.get("name") or "",
            }
            for f in frames
        ],
        "nodes": nodes[:80],
    }
