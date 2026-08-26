"""Convert validated canvas tool_ops into project document patches (headless apply)."""
from __future__ import annotations

import copy
import secrets
from typing import Any

from app.services.mcp.tool_registry import is_live_only_tool


def _new_node_id(prefix: str = "") -> str:
    base = secrets.token_hex(5)
    return f"{prefix}{base}" if prefix else base


def _num(value: Any, default: float = 0) -> float:
    try:
        n = float(value)
        return n if n == n else default
    except (TypeError, ValueError):
        return default


def _pick_num(args: dict[str, Any], *keys: str, default: float = 0) -> float:
    for key in keys:
        if key in args and args[key] is not None:
            return _num(args[key], default)
    return default


def _shape_node_from_args(args: dict[str, Any], node_id: str) -> dict[str, Any]:
    shape_type = str(args.get("shapeType") or "rect").strip() or "rect"
    fill = str(args.get("fill") or "#FFFFFF").strip() or "#FFFFFF"
    stroke = str(args.get("stroke") or "#333333").strip() or "#333333"
    border_w = _pick_num(args, "borderWidth", "border-width", default=1)
    x = _pick_num(args, "x", default=40)
    y = _pick_num(args, "y", default=40)
    width = max(1, _pick_num(args, "width", "w", default=120))
    height = max(1, _pick_num(args, "height", "h", default=80))
    attrs: dict[str, Any] = {
        "shapeType": shape_type,
        "fill-color": fill,
        "fill-type": str(args.get("fillType") or args.get("fill-type") or "solid"),
        "border-color": stroke,
        "border-width": border_w,
        "strokeAlign": str(args.get("strokeAlign") or "center"),
        "stroke-enabled": "true",
        "stroke-visible": "true",
        "fill-enabled": "false" if fill == "transparent" else "true",
        "fill-visible": "false" if fill == "transparent" else "true",
    }
    for k in ("path", "name", "brushStyle", "pathPressure"):
        if args.get(k) is not None:
            attrs[k] = args[k]
    if args.get("rotation") is not None:
        attrs["angle"] = _num(args["rotation"])
    if args.get("closed") is not None:
        attrs["closed"] = "true" if args["closed"] in (True, "true", 1) else "false"
    return {
        "id": node_id,
        "key": "shape",
        "x": x,
        "y": y,
        "z": 0,
        "width": width,
        "height": height,
        "attrs": attrs,
        "children": [],
    }


def _text_node_from_args(args: dict[str, Any], node_id: str) -> dict[str, Any]:
    text = str(args.get("text") or "")
    x = _pick_num(args, "x", default=40)
    y = _pick_num(args, "y", default=40)
    width = max(1, _pick_num(args, "width", "w", default=max(80, len(text) * 12)))
    height = max(1, _pick_num(args, "height", "h", default=32))
    font_size = int(_pick_num(args, "fontSize", "font-size", default=16))
    attrs: dict[str, Any] = {
        "text": text,
        "content": text,
        "autoSize": "true",
        "fontSize": font_size,
    }
    if args.get("fill"):
        attrs["color"] = str(args["fill"])
    if args.get("name"):
        attrs["name"] = str(args["name"])
    return {
        "id": node_id,
        "key": "text",
        "x": x,
        "y": y,
        "z": 0,
        "width": width,
        "height": height,
        "attrs": attrs,
        "children": [],
    }


def _merge_update_node(existing: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(existing)
    attrs = dict(out.get("attrs") or {}) if isinstance(out.get("attrs"), dict) else {}
    if args.get("x") is not None:
        out["x"] = _num(args["x"], float(out.get("x") or 0))
    if args.get("y") is not None:
        out["y"] = _num(args["y"], float(out.get("y") or 0))
    if args.get("width") is not None or args.get("w") is not None:
        out["width"] = max(1, _pick_num(args, "width", "w", default=float(out.get("width") or 1)))
    if args.get("height") is not None or args.get("h") is not None:
        out["height"] = max(1, _pick_num(args, "height", "h", default=float(out.get("height") or 1)))
    mapping = {
        "text": "text",
        "fill": "fill-color",
        "stroke": "border-color",
        "borderWidth": "border-width",
        "shapeType": "shapeType",
        "name": "name",
        "rotation": "angle",
        "opacity": "opacity",
        "path": "path",
        "hidden": "hidden",
        "locked": "locked",
    }
    for src, dst in mapping.items():
        if args.get(src) is not None:
            val = args[src]
            if src in ("hidden", "locked"):
                attrs[dst] = "true" if val in (True, "true", 1) else "false"
            else:
                attrs[dst] = val
    if args.get("text") is not None:
        attrs["content"] = str(args["text"])
    out["attrs"] = attrs
    return out


def _ensure_delta(doc: dict[str, Any]) -> dict[str, Any]:
    delta = doc.setdefault("deltaSetLike", {})
    if not isinstance(delta, dict):
        delta = {}
        doc["deltaSetLike"] = delta
    if "ROOT" not in delta or not isinstance(delta.get("ROOT"), dict):
        delta["ROOT"] = {"id": "ROOT", "key": "entry", "children": []}
    return delta


def _append_root_child(doc: dict[str, Any], node_id: str) -> None:
    delta = _ensure_delta(doc)
    root = delta["ROOT"]
    children = list(root.get("children") or [])
    page_children = list(doc.get("pageChildren") or children)
    if node_id not in children:
        children.append(node_id)
    if node_id not in page_children:
        page_children.append(node_id)
    root["children"] = children
    doc["pageChildren"] = page_children


def _append_frame_child(doc: dict[str, Any], frame_id: str, node_id: str) -> None:
    delta = _ensure_delta(doc)
    frame_node = delta.get(frame_id)
    if not isinstance(frame_node, dict):
        _append_root_child(doc, node_id)
        return
    children = list(frame_node.get("children") or [])
    if node_id not in children:
        children.append(node_id)
    frame_node["children"] = children
    delta[frame_id] = frame_node
    node = delta.get(node_id)
    if isinstance(node, dict):
        node = dict(node)
        attrs = dict(node.get("attrs") or {})
        attrs["frameId"] = frame_id
        node["attrs"] = attrs
        delta[node_id] = node


def _create_frame(doc: dict[str, Any], args: dict[str, Any]) -> str:
    fid = str(args.get("frameId") or args.get("id") or _new_node_id("f_"))
    width = max(1, _pick_num(args, "width", "w", default=375))
    height = max(1, _pick_num(args, "height", "h", default=812))
    x = _pick_num(args, "x", default=0)
    y = _pick_num(args, "y", default=0)
    name = str(args.get("name") or "Frame")
    delta = _ensure_delta(doc)
    delta[fid] = {
        "id": fid,
        "key": "frame",
        "x": 0,
        "y": 0,
        "width": width,
        "height": height,
        "attrs": {"name": name},
        "children": [],
    }
    frames = list(doc.get("frames") or [])
    frames.append(
        {
            "id": fid,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "name": name,
            "clipContent": args.get("clipContent") not in (False, "false", 0),
        }
    )
    doc["frames"] = frames
    _append_root_child(doc, fid)
    if not doc.get("activeFrameId"):
        doc["activeFrameId"] = fid
    return fid


def _update_frame(doc: dict[str, Any], args: dict[str, Any]) -> None:
    fid = str(args.get("frameId") or args.get("id") or "").strip()
    if not fid:
        return
    frames = list(doc.get("frames") or [])
    for i, f in enumerate(frames):
        if not isinstance(f, dict) or str(f.get("id")) != fid:
            continue
        nf = dict(f)
        if args.get("x") is not None:
            nf["x"] = _num(args["x"], float(nf.get("x") or 0))
        if args.get("y") is not None:
            nf["y"] = _num(args["y"], float(nf.get("y") or 0))
        if args.get("width") is not None or args.get("w") is not None:
            nf["width"] = max(1, _pick_num(args, "width", "w", default=float(nf.get("width") or 1)))
        if args.get("height") is not None or args.get("h") is not None:
            nf["height"] = max(1, _pick_num(args, "height", "h", default=float(nf.get("height") or 1)))
        if args.get("name") is not None:
            nf["name"] = str(args["name"])
        if args.get("clipContent") is not None:
            nf["clipContent"] = args["clipContent"] not in (False, "false", 0)
        frames[i] = nf
        break
    doc["frames"] = frames
    delta = _ensure_delta(doc)
    if fid in delta and isinstance(delta[fid], dict):
        fn = dict(delta[fid])
        if args.get("width") is not None or args.get("w") is not None:
            fn["width"] = max(1, _pick_num(args, "width", "w", default=float(fn.get("width") or 1)))
        if args.get("height") is not None or args.get("h") is not None:
            fn["height"] = max(1, _pick_num(args, "height", "h", default=float(fn.get("height") or 1)))
        delta[fid] = fn


def _delete_frame(doc: dict[str, Any], frame_id: str) -> None:
    fid = str(frame_id or "").strip()
    if not fid:
        return
    doc["frames"] = [f for f in (doc.get("frames") or []) if str((f or {}).get("id")) != fid]
    delta = _ensure_delta(doc)
    delta.pop(fid, None)
    root = delta.get("ROOT")
    if isinstance(root, dict):
        root["children"] = [c for c in (root.get("children") or []) if str(c) != fid]
    doc["pageChildren"] = [c for c in (doc.get("pageChildren") or []) if str(c) != fid]
    if str(doc.get("activeFrameId") or "") == fid:
        frames = doc.get("frames") or []
        doc["activeFrameId"] = str(frames[0].get("id")) if frames else None


def ops_to_document_patch(
    doc: dict[str, Any],
    ops: list[dict[str, Any]],
) -> dict[str, Any]:
    """Map validated tool_ops to incremental project patch."""
    working = copy.deepcopy(doc) if isinstance(doc, dict) else {}
    delta = _ensure_delta(working)
    upsert: dict[str, Any] = {}
    remove: list[str] = []
    frames_patch: list[Any] | None = None
    canvas_patch: dict[str, Any] | None = None
    touched = False

    for op in ops or []:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if is_live_only_tool(name):
            continue
        args = op.get("args") if isinstance(op.get("args"), dict) else {}

        if name in ("create_shape", "create_path"):
            nid = _new_node_id()
            node = _shape_node_from_args(
                {**args, "shapeType": args.get("shapeType") or ("path" if name == "create_path" else "rect")},
                nid,
            )
            upsert[nid] = node
            frame_id = str(args.get("frameId") or "").strip()
            if frame_id:
                _append_frame_child(working, frame_id, nid)
            else:
                _append_root_child(working, nid)
            upsert["ROOT"] = working["deltaSetLike"]["ROOT"]
            touched = True
        elif name == "create_text":
            nid = _new_node_id()
            upsert[nid] = _text_node_from_args(args, nid)
            frame_id = str(args.get("frameId") or "").strip()
            if frame_id:
                _append_frame_child(working, frame_id, nid)
            else:
                _append_root_child(working, nid)
            upsert["ROOT"] = working["deltaSetLike"]["ROOT"]
            touched = True
        elif name == "update_node":
            nid = str(args.get("nodeId") or args.get("id") or "").strip()
            existing = delta.get(nid)
            if nid and isinstance(existing, dict):
                upsert[nid] = _merge_update_node(existing, args)
                touched = True
        elif name == "delete_nodes":
            ids = args.get("nodeIds") or args.get("ids") or []
            if isinstance(ids, list):
                remove.extend(str(i).strip() for i in ids if str(i or "").strip())
                touched = True
        elif name == "hide_nodes":
            ids = args.get("nodeIds") or args.get("ids") or []
            if isinstance(ids, list):
                for nid in ids:
                    sid = str(nid or "").strip()
                    existing = delta.get(sid)
                    if isinstance(existing, dict):
                        upsert[sid] = _merge_update_node(existing, {"hidden": True})
                        touched = True
        elif name == "create_frame":
            fid = _create_frame(working, args)
            upsert[fid] = working["deltaSetLike"][fid]
            upsert["ROOT"] = working["deltaSetLike"]["ROOT"]
            frames_patch = list(working.get("frames") or [])
            touched = True
        elif name == "update_frame":
            _update_frame(working, args)
            frames_patch = list(working.get("frames") or [])
            touched = True
        elif name == "delete_frame":
            _delete_frame(working, str(args.get("frameId") or args.get("id") or ""))
            frames_patch = list(working.get("frames") or [])
            touched = True
        elif name == "set_canvas_background":
            canvas_patch = dict(working.get("canvas") or {}) if isinstance(working.get("canvas"), dict) else {}
            if args.get("background") is not None:
                canvas_patch["background"] = args["background"]
            if args.get("backgroundColor") is not None:
                canvas_patch["backgroundColor"] = args["backgroundColor"]
            touched = True

    if not touched:
        return {}

    patch: dict[str, Any] = {}
    if upsert:
        patch["upsertNodes"] = upsert
    if remove:
        patch["removeNodeIds"] = remove
    if frames_patch is not None:
        patch["frames"] = frames_patch
    if canvas_patch is not None:
        patch["canvas"] = canvas_patch
    if working.get("pageChildren") is not None:
        patch["pageChildren"] = working.get("pageChildren")
    if working.get("activeFrameId") is not None:
        patch["activeFrameId"] = working.get("activeFrameId")
    return patch
