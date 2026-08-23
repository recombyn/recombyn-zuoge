"""Canvas tool_ops contract — schema version, allowlist, validation, dedupe (layer ③→⑦)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from app.services.design.ops.validate import extract_json

logger = logging.getLogger(__name__)

TOOL_OPS_SCHEMA_VERSION = "2026-08-01-v3"

# Soft-forbid emoji-as-icon in create_text (stress craftFlags: emoji_text_ops).
_EMOJI_AS_ICON_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\u2600-\u27BF\U0001F1E0-\U0001F1FF]"
)


def format_op_error(code: str, *, fix: str = "", detail: str = "") -> str:
    """Stable error line for LAST_ERROR / paint retry — model can parse code + fix."""
    code_s = str(code or "invalid_op").strip() or "invalid_op"
    parts = [f"code={code_s}"]
    fix_s = str(fix or "").strip()
    if fix_s:
        parts.append(f"fix={fix_s}")
    detail_s = str(detail or "").strip()
    if detail_s:
        parts.append(f"detail={detail_s}")
    return "; ".join(parts)


_CSS_GRADIENT_RE = re.compile(
    r"^(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(",
    re.IGNORECASE,
)
_ALLOWED_FILL_TYPES = frozenset(
    {"solid", "linear", "radial", "angular", "diffuse", "image"}
)


def _looks_like_css_gradient(raw: object) -> bool:
    return bool(_CSS_GRADIENT_RE.match(str(raw or "").strip()))


def _validate_shape_fill_args(name: str, args: dict[str, Any]) -> str | None:
    """Reject CSS gradient strings; require native fillType + fill/fillEnd."""
    if "fill" in args and args.get("fill") is not None:
        val = args.get("fill")
        if _looks_like_css_gradient(val):
            return format_op_error(
                f"{name}_css_gradient_fill",
                fix=(
                    "do not put CSS linear-gradient()/radial-gradient() in fill; "
                    "use fillType=linear|radial|angular|diffuse with fill + fillEnd "
                    "(+ gradientAngle?)"
                ),
                detail=f"fill={str(val)[:96]}",
            )
    fill_type_raw = args.get("fillType")
    if fill_type_raw is not None and str(fill_type_raw).strip():
        ft = str(fill_type_raw).strip().lower()
        if ft not in _ALLOWED_FILL_TYPES:
            return format_op_error(
                f"{name}_invalid_fillType",
                fix="fillType must be solid|linear|radial|angular|diffuse|image",
                detail=f"fillType={ft}",
            )
    return None


def _tools_from_seed(*, enabled_only: bool = True) -> list[dict[str, Any]]:
    """Cold-start / unit-test catalog when ``design_canvas_tool`` is empty."""
    try:
        from app.services.design.ops.action_registry import default_canvas_actions
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for item in default_canvas_actions():
        if not isinstance(item, dict):
            continue
        key = str(item.get("op_key") or "").strip()
        if not key:
            continue
        enabled = item.get("enabled", True)
        if enabled_only and not enabled:
            continue
        schema = item.get("args_schema")
        if isinstance(schema, dict):
            try:
                schema_s = json.dumps(schema, ensure_ascii=False)
            except Exception:
                schema_s = ""
        else:
            schema_s = str(schema or "").strip()
        out.append(
            {
                "op_key": key,
                "kind": str(item.get("kind") or "").strip() or "create",
                "label": str(item.get("label") or "").strip(),
                "model_hint": str(item.get("model_hint") or "").strip(),
                "args_schema": schema_s,
                "enabled": bool(enabled),
                "sort_order": int(item.get("sort_order") or 0),
            }
        )
    out.sort(key=lambda t: (int(t.get("sort_order") or 0), str(t.get("op_key") or "")))
    return out


def list_canvas_tools(*, enabled_only: bool = True) -> list[dict[str, Any]]:
    """Rows from ``design_canvas_tool``; seed JSON if the table is empty."""
    try:
        from sqlmodel import Session

        from app import crud
        from app.core.db import engine

        with Session(engine) as session:
            rows = crud.list_design_canvas_tools(
                session=session, enabled_only=enabled_only
            )
        out: list[dict[str, Any]] = []
        for r in rows or []:
            key = str(r.op_key or "").strip()
            if not key:
                continue
            out.append(
                {
                    "op_key": key,
                    "kind": str(r.kind or "").strip() or "create",
                    "label": str(r.label or "").strip(),
                    "model_hint": str(r.model_hint or "").strip(),
                    "args_schema": str(r.args_schema or "").strip(),
                    "enabled": int(r.enabled or 0) == 1,
                    "sort_order": int(r.sort_order or 0),
                }
            )
        if out:
            return out
    except Exception:
        logger.debug("list_canvas_tools unavailable", exc_info=True)
    return _tools_from_seed(enabled_only=enabled_only)


def allowed_canvas_tool_keys() -> frozenset[str]:
    """Enabled op_keys from DB, else ``canvas_actions_seed.json``."""
    return frozenset(
        t["op_key"] for t in list_canvas_tools(enabled_only=True) if t.get("op_key")
    )


def format_canvas_tools_for_model(rules: dict[str, str] | None = None) -> str:
    """Capability block for LLM prompts — Action registry (+ schema + hint)."""
    del rules  # allowlist = design_canvas_tool.enabled only
    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    tools = list_canvas_tools(enabled_only=True)
    if not tools:
        return render_prompt_body("agent.prompt.tools_registry_empty")
    head = render_prompt_body("agent.prompt.tools_registry_header")
    lines: list[str] = [head] if head else []
    for t in tools:
        key = t["op_key"]
        label = (t.get("label") or "").strip()
        hint = (t.get("model_hint") or "").strip()
        schema = (t.get("args_schema") or "").strip()
        head = f"`{key}`" + (f" ({label})" if label else "")
        parts = [head]
        if hint:
            parts.append(hint)
        if schema:
            parts.append(f"args={schema}")
        lines.append("- " + " — ".join(parts))
    return "\n".join(lines)


def format_canvas_tools_catalog(rules: dict[str, str] | None = None) -> str:
    """Short tool index for deferred loading — names + one-line purpose only."""
    del rules
    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    tools = list_canvas_tools(enabled_only=True)
    if not tools:
        return render_prompt_body("agent.prompt.tools_catalog_empty")
    head = render_prompt_body("agent.prompt.tools_catalog_header")
    lines: list[str] = [head] if head else []
    for t in tools:
        key = str(t.get("op_key") or "").strip()
        if not key:
            continue
        label = str(t.get("label") or "").strip()
        hint = str(t.get("model_hint") or "").strip()
        blurb = label or (hint[:48] + ("…" if len(hint) > 48 else "") if hint else "")
        if blurb:
            lines.append(f"- `{key}` — {blurb}")
        else:
            lines.append(f"- `{key}`")
    return "\n".join(lines)


def format_canvas_tools_details(
    op_keys: list[str] | tuple[str, ...] | set[str],
    *,
    rules: dict[str, str] | None = None,
) -> str:
    """Full hint + args_schema for selected op_keys only."""
    del rules
    wanted: list[str] = []
    seen: set[str] = set()
    for raw in op_keys or []:
        key = str(raw or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        wanted.append(key)
        if len(wanted) >= 12:
            break
    if not wanted:
        return ""
    by_key = {
        str(t.get("op_key") or "").strip(): t
        for t in list_canvas_tools(enabled_only=True)
        if t.get("op_key")
    }
    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    header = render_prompt_body("agent.prompt.tool_details_header").strip()
    lines: list[str] = [header] if header else []
    missing: list[str] = []
    for key in wanted:
        t = by_key.get(key)
        if not t:
            missing.append(key)
            continue
        label = str(t.get("label") or "").strip()
        hint = str(t.get("model_hint") or "").strip()
        schema = str(t.get("args_schema") or "").strip()
        head = f"### `{key}`" + (f" ({label})" if label else "")
        lines.append(head)
        if hint:
            ln = render_prompt_body(
                "agent.prompt.tool_details_hint_line", hint=hint
            ).strip()
            if ln:
                lines.append(ln)
        if schema:
            ln = render_prompt_body(
                "agent.prompt.tool_details_args_line", schema=schema
            ).strip()
            if ln:
                lines.append(ln)
    if missing:
        ln = render_prompt_body(
            "agent.prompt.tool_details_unknown", keys=", ".join(missing)
        ).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def normalize_need_tools(
    raw: Any,
    *,
    max_n: int = 8,
) -> list[str]:
    """Parse model need_tools → allowlisted op_keys (order preserved)."""
    if raw is None:
        return []
    items: list[Any]
    if isinstance(raw, str):
        items = re.split(r"[\s,;|]+", raw)
    elif isinstance(raw, list):
        items = raw
    else:
        return []
    allow = allowed_canvas_tool_keys()
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        if allow and key not in allow:
            continue
        seen.add(key)
        out.append(key)
        if len(out) >= max_n:
            break
    return out


def _max_ops_per_step(rules: dict[str, str] | None) -> int:
    """Admin ``tool_ops.max_per_step`` (+ optional ``tool_ops.hard_max`` clamp).

    Empty / invalid max_per_step → code default (P0 zero-base Admin).
    Empty hard_max → no code clamp.
    """
    _DEFAULT_MAX = 48
    rules = rules or {}
    raw = str(rules.get("tool_ops.max_per_step") or "").strip()
    if not raw:
        n = _DEFAULT_MAX
    else:
        try:
            n = max(0, int(raw))
        except ValueError:
            n = _DEFAULT_MAX
    hard_raw = str(rules.get("tool_ops.hard_max") or "").strip()
    if hard_raw:
        try:
            n = min(n, max(0, int(hard_raw)))
        except ValueError:
            pass
    return n


def _coerce_op_args(item: dict[str, Any]) -> dict[str, Any]:
    """Canvas args only — ``op_id`` lives on the op envelope."""
    nested = item.get("args")
    args = dict(nested) if isinstance(nested, dict) else {}
    args.pop("op_id", None)
    return args


def _envelope_op_id(item: dict[str, Any]) -> str:
    raw = item.get("op_id")
    if raw is None:
        return ""
    return str(raw).strip()[:64]


def _parse_raw_ops(content: str | dict[str, Any] | list[Any] | None) -> list[dict[str, Any]]:
    """Parse model JSON into raw op dicts (before allowlist / validation)."""
    if isinstance(content, (dict, list)):
        data = content
    else:
        data = extract_json(content or "")
    ops_raw: list[Any] = []
    if isinstance(data, dict):
        cand = data.get("tool_ops")
        if isinstance(cand, list):
            ops_raw = cand
    elif isinstance(data, list):
        ops_raw = data
    out: list[dict[str, Any]] = []
    for item in ops_raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        row = {"name": name, "args": _coerce_op_args(item)}
        oid = _envelope_op_id(item)
        if oid:
            row["op_id"] = oid
        out.append(row)
    return out


def _stable_op_id(name: str, args: dict[str, Any], index: int, existing: str = "") -> str:
    if existing:
        return str(existing).strip()[:64]
    try:
        blob = json.dumps({"name": name, "args": args}, sort_keys=True, ensure_ascii=False)
    except Exception:
        blob = f"{name}:{index}"
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]
    return f"op-{index}-{name}-{digest}"


def _lottie_animation_raw(args: dict[str, Any]) -> Any:
    return args.get("animationData")


def _validate_single_op(
    name: str,
    args: dict[str, Any],
    *,
    scene_node_ids: set[str] | None,
    scene_frame_ids: set[str] | None = None,
) -> str | None:
    if name not in allowed_canvas_tool_keys():
        return format_op_error(
            "tool_not_allowed",
            fix="use an allowlisted canvas tool name",
            detail=f"name={name}",
        )
    if name == "update_node":
        nid = str(args.get("nodeId") or "").strip()
        if not nid:
            return format_op_error(
                "update_node_missing_nodeId",
                fix="re-emit update_node with nodeId from SCENE_NODES",
            )
        if scene_node_ids is not None and nid not in scene_node_ids:
            return format_op_error(
                "update_node_unknown_id",
                fix="pick nodeId from SCENE_NODES",
                detail=f"nodeId={nid}",
            )
        fill_err = _validate_shape_fill_args(name, args)
        if fill_err:
            return fill_err
        return None
    if name == "delete_nodes":
        ids = args.get("nodeIds")
        if not isinstance(ids, list) or not [x for x in ids if str(x).strip()]:
            return format_op_error(
                "delete_nodes_missing_nodeIds",
                fix="re-emit delete_nodes with args.nodeIds=[...]",
            )
        if scene_node_ids is not None:
            for raw in ids:
                sid = str(raw).strip()
                if sid and sid not in scene_node_ids:
                    return format_op_error(
                        "delete_nodes_unknown_id",
                        fix="use nodeIds from SCENE_NODES",
                        detail=f"nodeId={sid}",
                    )
        return None
    if name == "delete_frame":
        fid = str(args.get("frameId") or "").strip()
        if not fid:
            return format_op_error(
                "delete_frame_missing_frameId",
                fix="re-emit delete_frame with args.frameId from SCENE_FRAMES",
            )
        if scene_frame_ids is not None and fid not in scene_frame_ids:
            return format_op_error(
                "delete_frame_unknown_id",
                fix="pick frameId from SCENE_FRAMES",
                detail=f"frameId={fid}",
            )
        return None
    if name == "create_svg" or name == "create_icon":
        svg = str(args.get("svg") or "").strip()
        if not svg:
            return format_op_error(
                f"{name}_missing_svg",
                fix=f"re-emit {name} with args.svg markup",
            )
        from app.services.design.ops.validate import validate_agent_svg_markup

        svg_err = validate_agent_svg_markup(svg)
        if svg_err:
            return format_op_error(
                f"{name}_invalid_svg",
                fix="pass valid mini SVG markup in args.svg",
                detail=svg_err,
            )
        return None
    if name == "create_shape":
        if args.get("shapeType") is None:
            return format_op_error(
                "create_shape_missing_shapeType",
                fix="re-emit create_shape with args.shapeType (rect|ellipse|…)",
            )
        svg = str(args.get("svg") or "").strip()
        if svg:
            from app.services.design.ops.validate import validate_agent_svg_markup

            svg_err = validate_agent_svg_markup(svg)
            if svg_err:
                return format_op_error(
                    "create_shape_invalid_svg",
                    fix="fix svg markup or omit svg",
                    detail=svg_err,
                )
        fill_err = _validate_shape_fill_args(name, args)
        if fill_err:
            return fill_err
        return None
    if name == "set_canvas_background":
        fill_err = _validate_shape_fill_args(name, args)
        if fill_err:
            return fill_err
        return None
    if name == "create_text":
        if args.get("text") is None:
            if args.get("x") is None or args.get("y") is None:
                return format_op_error(
                    "create_text_missing_text_or_position",
                    fix="re-emit create_text with args.text and x/y",
                )
        text_s = str(args.get("text") or "")
        if _EMOJI_AS_ICON_RE.search(text_s):
            stripped = _EMOJI_AS_ICON_RE.sub("", text_s).strip()
            # Short / emoji-only labels are marks — use create_icon / create_svg.
            if len(stripped) <= 2 and len(text_s.strip()) <= 8:
                return format_op_error(
                    "create_text_emoji_as_icon",
                    fix="use create_icon or create_svg for marks; create_text for real labels only",
                    detail=text_s.strip()[:40],
                )
        return None
    if name == "create_image":
        has_attach = args.get("attachmentIndex") is not None
        has_url = bool(str(args.get("src") or "").strip())
        has_gen = bool(str(args.get("genPrompt") or "").strip())
        if not has_attach and not has_url and not has_gen:
            return format_op_error(
                "create_image_missing_source",
                fix="re-emit create_image with src, attachmentIndex, or genPrompt",
            )
        return None
    if name == "create_lottie":
        has_gen = bool(str(args.get("genPrompt") or "").strip())
        raw = _lottie_animation_raw(args)
        has_data = False
        if isinstance(raw, dict) and raw.get("layers"):
            has_data = True
        elif isinstance(raw, str) and raw.strip():
            has_data = True
        if not has_gen and not has_data:
            return format_op_error(
                "create_lottie_missing_source",
                fix="re-emit create_lottie with genPrompt or animationData",
            )
        return None
    return None


def _collect_delete_node_ids(args: dict[str, Any]) -> list[str]:
    ids = args.get("nodeIds")
    if not isinstance(ids, list):
        return []
    return [str(x).strip() for x in ids if str(x).strip()]


def _normalize_inventory_text(s: str) -> str:
    return re.sub(r"\s+", "", str(s or "")).lower()


def _find_matching_text_node(
    scene_nodes: list[dict[str, Any]] | None,
    text: str,
    used: set[str],
) -> dict[str, Any] | None:
    needle = _normalize_inventory_text(text)
    if not needle:
        return None
    texts = [
        n
        for n in (scene_nodes or [])
        if isinstance(n, dict)
        and n.get("id")
        and str(n.get("type") or "").lower() == "text"
    ]
    for n in texts:
        nid = str(n.get("id") or "")
        if nid in used:
            continue
        if _normalize_inventory_text(str(n.get("text") or "")) == needle:
            return n
    for n in texts:
        nid = str(n.get("id") or "")
        if nid in used:
            continue
        t = _normalize_inventory_text(str(n.get("text") or ""))
        if not t or min(len(t), len(needle)) < 2:
            continue
        if t in needle or needle in t:
            return n
    return None


def _reject_shape_morph_ops(
    ops: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Detect delete+create_shape morphs — do not rewrite; tell the model to use update_node."""
    if len(ops) < 2:
        return ops, []
    delete_idxs: list[int] = []
    create_idxs: list[int] = []
    deleted: list[str] = []
    for i, raw in enumerate(ops):
        name = str(raw.get("name") or "").strip()
        args = raw.get("args") if isinstance(raw.get("args"), dict) else {}
        if name == "delete_nodes":
            ids = _collect_delete_node_ids(args)
            if ids:
                delete_idxs.append(i)
                deleted.extend(ids)
        elif name == "create_shape":
            create_idxs.append(i)
    if len(deleted) != 1 or len(create_idxs) != 1 or len(delete_idxs) != 1:
        return ops, []
    create = ops[create_idxs[0]]
    cargs = create.get("args") if isinstance(create.get("args"), dict) else {}
    shape_type = cargs.get("shapeType")
    if shape_type is None or not str(shape_type).strip():
        return ops, []
    drop = {delete_idxs[0], create_idxs[0]}
    kept = [raw for i, raw in enumerate(ops) if i not in drop]
    err = format_op_error(
        "prefer_update_node_shapeType",
        fix=(
            f"re-emit update_node nodeId={deleted[0]} shapeType={shape_type} "
            f"(include fill/x/y/width/height as needed)"
        ),
        detail="delete_nodes+create_shape morphs z-order",
    )
    return kept, [err]


def _reject_create_text_as_edit(
    ops: list[dict[str, Any]],
    scene_nodes: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Detect create_text that matches SCENE_NODES — do not rewrite to update_node.

    Edit turns only. New design create must be allowed to add similar labels
    (e.g. another「登录」) onto a fresh plate without rewriting ambient boards.
    """
    existing_texts = [
        n
        for n in (scene_nodes or [])
        if isinstance(n, dict)
        and n.get("id")
        and str(n.get("type") or "").lower() == "text"
    ]
    if not existing_texts:
        return ops, []
    used_text_ids: set[str] = set()
    kept: list[dict[str, Any]] = []
    errors: list[str] = []
    for raw in ops:
        name = str(raw.get("name") or "").strip()
        args = raw.get("args") if isinstance(raw.get("args"), dict) else {}
        if name != "create_text":
            kept.append(raw)
            continue
        text = str(args.get("text") or "")
        match = _find_matching_text_node(scene_nodes, text, used_text_ids)
        if not match:
            kept.append(raw)
            continue
        mid = str(match.get("id") or "")
        used_text_ids.add(mid)
        errors.append(
            format_op_error(
                "prefer_update_node",
                fix=(
                    f"re-emit update_node nodeId={mid} with text/fontSize/color "
                    f"(do not create_text)"
                ),
                detail=f"create_text matches SCENE_NODES id={mid}",
            )
        )
    return kept, errors


_CREATE_CONTENT_OPS = frozenset(
    {
        "create_shape",
        "create_text",
        "create_image",
        "create_svg",
        "create_lottie",
        "create_icon",
    }
)


def _reject_ambient_mutates_on_new_design(
    ops: list[dict[str, Any]],
    scene_nodes: list[dict[str, Any]] | None,
    scene_frames: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """New design create must not update/delete pre-existing scene nodes.

    User asked for a new deliverable — leave sibling boards/nodes alone unless
    they explicitly requested an edit.
    """
    scene_ids = {
        str(n.get("id") or "").strip()
        for n in (scene_nodes or [])
        if isinstance(n, dict) and str(n.get("id") or "").strip()
    }
    frame_ids = {
        str(f.get("id") or "").strip()
        for f in (scene_frames or [])
        if isinstance(f, dict) and str(f.get("id") or "").strip()
    }
    if not scene_ids and not frame_ids:
        return ops, []
    kept: list[dict[str, Any]] = []
    errors: list[str] = []
    for raw in ops:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        args = raw.get("args") if isinstance(raw.get("args"), dict) else {}
        if name == "update_node":
            nid = str(args.get("nodeId") or "").strip()
            if nid and nid in scene_ids:
                errors.append(
                    format_op_error(
                        "new_design_leave_ambient",
                        fix=(
                            "new design: create_* onto HOST_ARTBOARD / FOCUS only; "
                            f"do not update_node ambient id={nid}"
                        ),
                        detail="create lane must not rewrite existing scene nodes",
                    )
                )
                continue
        if name in _CREATE_CONTENT_OPS:
            fid = str(args.get("frameId") or "").strip()
            if fid and fid in frame_ids:
                errors.append(
                    format_op_error(
                        "new_design_leave_ambient",
                        fix=(
                            "new design: create_* onto HOST_ARTBOARD / FOCUS only; "
                            f"do not pass ambient frameId={fid}"
                        ),
                        detail="create lane must not parent content under existing boards",
                    )
                )
                continue
        if name == "delete_nodes":
            ids = args.get("nodeIds") or []
            if not isinstance(ids, list):
                ids = [ids] if ids else []
            hit = [str(x).strip() for x in ids if str(x).strip() in scene_ids]
            if hit:
                errors.append(
                    format_op_error(
                        "new_design_leave_ambient",
                        fix=(
                            "new design: do not delete_nodes ambient ids; "
                            "create a new plate instead "
                            f"(hit={','.join(hit[:4])})"
                        ),
                        detail="create lane must not wipe existing scene nodes",
                    )
                )
                continue
        if name == "delete_frame":
            fid = str(args.get("frameId") or "").strip()
            if fid and fid in frame_ids:
                errors.append(
                    format_op_error(
                        "new_design_leave_ambient",
                        fix=(
                            "new design: do not delete_frame existing boards; "
                            "open/create a sibling plate"
                        ),
                        detail=f"delete_frame ambient id={fid}",
                    )
                )
                continue
        kept.append(raw)
    return kept, errors


def _require_create_frame_for_auto_new_design(
    ops: list[dict[str, Any]],
    *,
    canvas_size: str | None,
    host_plate_ready: bool,
) -> list[str]:
    """Smart/auto new design: size (create_frame) before content.

    Host opens+binds from that WxH, then content paints into FOCUS. Locked
    composer WxH already early-opens a plate — skip.
    """
    from app.services.design.readpath.canvas_scene import explicit_canvas_size

    if host_plate_ready or explicit_canvas_size(canvas_size):
        return []
    has_frame = any(
        isinstance(o, dict) and str(o.get("name") or "").strip() == "create_frame"
        for o in (ops or [])
    )
    has_content = any(
        isinstance(o, dict) and str(o.get("name") or "").strip() in _CREATE_CONTENT_OPS
        for o in (ops or [])
    )
    if has_content and not has_frame:
        return [
            format_op_error(
                "auto_size_create_frame_first",
                fix=(
                    "CANVAS_SIZE is auto: emit create_frame FIRST with width×height "
                    "(infer from USER_PROMPT / deliverable), then create_* inside it. "
                    "Host will open+bind that plate before paint."
                ),
                detail="Smart size must resolve via create_frame before content ops",
            )
        ]
    return []


def normalize_agent_tool_ops(
    raw_ops: list[dict[str, Any]],
    *,
    scene_nodes: list[dict[str, Any]] | None = None,
    scene_frames: list[dict[str, Any]] | None = None,
    rules: dict[str, str] | None = None,
    paint_lane: str | None = None,
    classified_intent: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Allowlist + per-op validation + op_id + dedupe.

    Semantic mistakes are rejected with errors for the model to re-emit — never
    silently rewritten (no create→update morph, no inventing nodeId).
    Returns (ops, errors). ops empty with errors → orchestrator should retry/fail.
    FE must execute these ops as-is (no client rewrite).
    """
    from app.services.design.runtime.models_route import (
        normalize_paint_lane,
        normalize_user_intent,
    )

    errors: list[str] = []
    scene_ids: set[str] | None = None
    if scene_nodes:
        scene_ids = {str(n["id"]) for n in scene_nodes if isinstance(n, dict) and n.get("id")}
    scene_frame_ids: set[str] | None = None
    if scene_frames:
        scene_frame_ids = {
            str(f["id"]) for f in scene_frames if isinstance(f, dict) and f.get("id")
        }

    intent = normalize_user_intent(classified_intent)
    lane = normalize_paint_lane(paint_lane, intent=intent or "chat")
    # Full design create next to existing work — never force-edit ambient nodes.
    new_design_create = intent == "design" and lane == "create"

    max_ops = _max_ops_per_step(rules)
    if len(raw_ops) > max_ops:
        errors.append(
            format_op_error(
                "too_many_ops",
                fix=f"emit at most {max_ops} tool_ops this step",
                detail=f"{len(raw_ops)}>{max_ops}",
            )
        )
        raw_ops = raw_ops[:max_ops]

    working: list[dict[str, Any]] = []
    for item in raw_ops:
        if not isinstance(item, dict):
            errors.append(
                format_op_error(
                    "op_not_object",
                    fix="each tool_ops item must be {name, args}",
                )
            )
            continue
        name = str(item.get("name") or "").strip()
        args = _coerce_op_args(item)
        if not name:
            errors.append(
                format_op_error(
                    "missing_name",
                    fix="each tool_op needs name + args",
                )
            )
            continue
        row = {"name": name, "args": args}
        oid = _envelope_op_id(item)
        if oid:
            row["op_id"] = oid
        working.append(row)

    # Validate intent — reject, do not rewrite into a "fixed" op.
    working, morph_errs = _reject_shape_morph_ops(working)
    errors.extend(morph_errs)
    if new_design_create:
        working, ambient_errs = _reject_ambient_mutates_on_new_design(
            working, scene_nodes, scene_frames
        )
        errors.extend(ambient_errs)
    else:
        working, text_errs = _reject_create_text_as_edit(working, scene_nodes)
        errors.extend(text_errs)

    normalized: list[dict[str, Any]] = []
    for idx, item in enumerate(working):
        name = str(item.get("name") or "").strip()
        args = dict(item.get("args") or {})
        err = _validate_single_op(
            name, args, scene_node_ids=scene_ids, scene_frame_ids=scene_frame_ids
        )
        if err:
            errors.append(err)
            continue
        op_id = _stable_op_id(name, args, idx, _envelope_op_id(item))
        normalized.append({"name": name, "args": args, "op_id": op_id})

    # Dedupe by op_id (SSE replay / model duplicates).
    seen_ids: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for op in normalized:
        oid = str(op.get("op_id") or "")
        if oid and oid in seen_ids:
            continue
        if oid:
            seen_ids.add(oid)
        deduped.append(op)

    # Dedupe identical update_node (fill + nodeId + text).
    seen_updates: set[str] = set()
    final: list[dict[str, Any]] = []
    for op in deduped:
        if op["name"] != "update_node":
            final.append(op)
            continue
        a = op.get("args") or {}
        key = (
            f"{a.get('nodeId')}:{a.get('fill') or ''}:"
            f"{a.get('cornerRadius') or ''}:{a.get('text') or ''}"
        )
        if key in seen_updates:
            continue
        seen_updates.add(key)
        final.append(op)

    if not final and raw_ops and not errors:
        errors.append(
            format_op_error(
                "no_valid_ops_after_filter",
                fix="emit non-empty tool_ops with valid name + args",
            )
        )
    return final, errors


def extract_and_validate_tool_ops(
    content: str | dict[str, Any] | list[Any] | None,
    *,
    scene_nodes: list[dict[str, Any]] | None = None,
    scene_frames: list[dict[str, Any]] | None = None,
    rules: dict[str, str] | None = None,
    paint_lane: str | None = None,
    classified_intent: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    raw = _parse_raw_ops(content)
    return normalize_agent_tool_ops(
        raw,
        scene_nodes=scene_nodes,
        scene_frames=scene_frames,
        rules=rules,
        paint_lane=paint_lane,
        classified_intent=classified_intent,
    )


def _find_ops_array_body(text: str) -> str | None:
    """Return the inside of ``\"tool_ops\":[ ... ]`` (may be incomplete)."""
    if not text:
        return None
    m = re.search(r'"tool_ops"\s*:\s*\[', text)
    if not m:
        return None
    return text[m.end() :]


def _iter_complete_json_objects(array_body: str) -> list[str]:
    """Split a (possibly truncated) JSON array body into complete `{...}` object strings."""
    out: list[str] = []
    i = 0
    n = len(array_body)
    while i < n:
        while i < n and array_body[i] in " \t\r\n,":
            i += 1
        if i >= n or array_body[i] == "]":
            break
        if array_body[i] != "{":
            break
        depth = 0
        in_str = False
        esc = False
        start = i
        while i < n:
            ch = array_body[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        out.append(array_body[start : i + 1])
                        i += 1
                        break
            i += 1
        else:
            break
    return out


def extract_streaming_tool_ops(
    content: str,
    *,
    already_ids: set[str] | None = None,
    scene_nodes: list[dict[str, Any]] | None = None,
    rules: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], set[str]]:
    """
    Pull newly completed ops from a partial model stream (ops array growing).
    Returns (new_normalized_ops, updated_already_ids).
    """
    seen = set(already_ids or ())
    body = _find_ops_array_body(content or "")
    if not body:
        return [], seen
    raw: list[dict[str, Any]] = []
    for chunk in _iter_complete_json_objects(body):
        try:
            obj = json.loads(chunk)
        except Exception:
            continue
        if isinstance(obj, dict):
            raw.append(obj)
    if not raw:
        return [], seen
    # Re-index so stable op_ids match final extract when args are identical.
    normalized, _errs = normalize_agent_tool_ops(raw, scene_nodes=scene_nodes, rules=rules)
    fresh: list[dict[str, Any]] = []
    for op in normalized:
        oid = str(op.get("op_id") or "")
        if oid and oid in seen:
            continue
        if oid:
            seen.add(oid)
        fresh.append(op)
    return fresh, seen


def tool_ops_activity_counts(ops: list[dict[str, Any]]) -> tuple[int, int, int]:
    """Return (created, updated, deleted) for activity SSE."""
    created = updated = deleted = 0
    for op in ops:
        name = str(op.get("name") or "")
        if name in (
            "create_shape",
            "create_text",
            "create_image",
            "create_svg",
            "create_lottie",
            "create_icon",
        ):
            created += 1
        elif name == "update_node":
            updated += 1
        elif name in ("delete_nodes", "delete_frame"):
            deleted += 1
    return created, updated, deleted


def tool_ops_batch_detail(batch: list[dict[str, Any]], *, limit: int = 10) -> str:
    """One-line ops summary for activity SSE — locale-neutral (op keys + content)."""
    parts: list[str] = []
    for op in batch or []:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        args = op.get("args") if isinstance(op.get("args"), dict) else {}
        if name == "create_shape":
            st = str(args.get("shapeType") or "shape").strip() or "shape"
            fill = str(args.get("fill") or "").strip()
            parts.append(f"+{st}" + (f" ({fill})" if fill else ""))
        elif name == "create_text":
            t = str(args.get("text") or "").replace("\n", " ").strip()
            parts.append(f'+text "{t[:20]}"' if t else "+text")
        elif name == "create_image":
            parts.append("+image")
        elif name == "create_svg":
            parts.append("+svg")
        elif name == "create_lottie":
            parts.append("+lottie")
        elif name == "create_icon":
            parts.append("+icon")
        elif name == "create_frame":
            parts.append("+frame")
        elif name == "update_node":
            nid = str(args.get("nodeId") or "")[:8]
            fill = str(args.get("fill") or "").strip()
            if fill:
                parts.append(f"update fill {fill}")
            elif nid:
                parts.append(f"update {nid}")
            else:
                parts.append("update")
        elif name == "delete_nodes":
            n = len(args.get("nodeIds") or [])
            parts.append(f"delete×{n or 1}")
        elif name == "delete_frame":
            parts.append("delete_frame")
        elif name:
            parts.append(name)
        if len(parts) >= limit:
            break
    return ", ".join(parts)


def tool_ops_activity_events(
    *,
    batch: list[dict[str, Any]],
    totals: dict[str, int],
    skill_index: int,
) -> list[dict[str, Any]]:
    """Backend-authored activity rows for product timeline capsules/rows."""
    created, updated, deleted = tool_ops_activity_counts(batch)
    totals["created"] = int(totals.get("created") or 0) + created
    totals["updated"] = int(totals.get("updated") or 0) + updated
    totals["deleted"] = int(totals.get("deleted") or 0) + deleted
    evs: list[dict[str, Any]] = []
    detail = tool_ops_batch_detail(batch)
    # Confirm row only when there is no success capsule for this batch.
    # Labels come from FE i18n (activityAdded / Updated / …). Keep summary = ops list.
    if detail and not created and not updated and not deleted:
        seq = (
            int(totals["created"])
            + int(totals["updated"])
            + int(totals["deleted"])
        )
        evs.append(
            {
                "type": "activity",
                "id": f"ops-tool-{skill_index}-{seq}",
                "kind": "tool",
                "status": "done",
                "summary": detail,
                "index": skill_index,
            }
        )
    if totals["created"] > 0:
        n = totals["created"]
        evs.append(
            {
                "type": "activity",
                "id": "ops-add-live",
                "kind": "added",
                "status": "done",
                "count": n,
                "summary": detail or None,
                "index": skill_index,
            }
        )
    if totals["updated"] > 0 and totals["created"] <= 0:
        n = totals["updated"]
        evs.append(
            {
                "type": "activity",
                "id": "ops-upd-live",
                "kind": "updated",
                "status": "done",
                "count": n,
                "summary": detail or None,
                "index": skill_index,
            }
        )
    if totals["deleted"] > 0 and totals["created"] <= 0 and totals["updated"] <= 0:
        n = totals["deleted"]
        evs.append(
            {
                "type": "activity",
                "id": "ops-del-live",
                "kind": "deleted",
                "status": "done",
                "count": n,
                "summary": detail or None,
                "index": skill_index,
            }
        )
    return evs


def tool_ops_for_sse(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip internal fields if needed; keep op_id for client dedupe."""
    out: list[dict[str, Any]] = []
    for op in ops:
        name = op.get("name")
        args = dict(op.get("args") or {})
        args.pop("op_id", None)
        oid = op.get("op_id")
        if name == "create_shape" and args.get("path") is not None:
            path = str(args.get("path") or "")
            logger.info(
                "[tool_ops path diag] type=%s xy=%s,%s size=%sx%s fill=%s pathLen=%s head=%s",
                args.get("shapeType"),
                args.get("x"),
                args.get("y"),
                args.get("width"),
                args.get("height"),
                args.get("fill"),
                len(path),
                path[:200],
            )
        out.append({"name": name, "args": args, **({"op_id": oid} if oid else {})})
    return out


def _rule_flag(rules: dict[str, str] | None, key: str, default: str = "1") -> bool:
    raw = str((rules or {}).get(key, default) or default).strip().lower()
    return raw not in ("0", "false", "off", "no", "")


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def tidy_tool_ops_scene(
    nodes: list[dict[str, Any]] | None,
    *,
    canvas_w: int,
    canvas_h: int,
    rules: dict[str, str] | None = None,
    clamp_geometry: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Deterministic canvas tidy for tool_ops path (SVG layerize equivalent).

    Returns (ops_to_apply, tidied_nodes, notes). Controlled by Admin:
    ``layerize.tool_ops`` (default on). No prompt/skill copy here.

    ``clamp_geometry``: when False (edit-in-place / free world canvas), do not
    emit x/y clamps — world coords outside chip WxH would yank nodes off-camera.
    """
    if not _rule_flag(rules, "layerize.tool_ops", "1"):
        return [], list(nodes or []), []
    w = max(1, int(canvas_w or 1))
    h = max(1, int(canvas_h or 1))
    notes: list[str] = []
    ops: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    seen_fp: dict[str, str] = {}
    delete_ids: list[str] = []

    # Free-canvas / infinite paper: most nodes sit outside 0..chip — clamping
    # them into WxH looks like "图层还在、画布空了".
    rows_in = [n for n in (nodes or []) if isinstance(n, dict) and str(n.get("id") or "").strip()]
    if clamp_geometry and rows_in:
        outside = 0
        for n in rows_in:
            x = _num(n.get("x"))
            y = _num(n.get("y"))
            if x < -1 or y < -1 or x > w + 1 or y > h + 1:
                outside += 1
        if outside >= max(1, (len(rows_in) + 1) // 2):
            clamp_geometry = False
            notes.append("skip_clamp:free_world")

    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        row = dict(n)
        nid = str(row.get("id") or "").strip()
        if not nid:
            continue
        text = str(row.get("text") or "").strip()
        ntype = str(row.get("type") or "").lower()
        # Drop empty text nodes.
        if ntype == "text" and not text:
            delete_ids.append(nid)
            notes.append(f"drop_empty_text:{nid[:8]}")
            continue

        x = _num(row.get("x"))
        y = _num(row.get("y"))
        nw = max(1.0, _num(row.get("w"), 1.0))
        nh = max(1.0, _num(row.get("h"), 1.0))
        if clamp_geometry:
            # Clamp into artboard (create path with frame-local coords only).
            cx = min(max(0.0, x), float(w - 1))
            cy = min(max(0.0, y), float(h - 1))
            cw = min(nw, float(w) - cx)
            ch = min(nh, float(h) - cy)
            if cw < 1:
                cw = 1.0
            if ch < 1:
                ch = 1.0
            clamped = (
                abs(cx - x) > 0.5
                or abs(cy - y) > 0.5
                or abs(cw - nw) > 0.5
                or abs(ch - nh) > 0.5
            )
            if clamped:
                row["x"], row["y"], row["w"], row["h"] = cx, cy, cw, ch
                oid = f"tidy-clamp-{nid}"
                args = {
                    "nodeId": nid,
                    "x": round(cx, 2),
                    "y": round(cy, 2),
                    "width": round(cw, 2),
                    "height": round(ch, 2),
                }
                ops.append({"name": "update_node", "args": args, "op_id": oid})
                notes.append(f"clamp:{nid[:8]}")

        fill = str(row.get("fill") or "").strip().lower()
        fp = (
            f"{ntype}|{fill}|{int(round(_num(row.get('x'))))}|"
            f"{int(round(_num(row.get('y'))))}|{int(round(_num(row.get('w'), 1)))}|"
            f"{int(round(_num(row.get('h'), 1)))}|{text[:24]}"
        )
        if fp in seen_fp and ntype not in ("frame", "artboard", "group"):
            delete_ids.append(nid)
            notes.append(f"dedupe:{nid[:8]}~{seen_fp[fp][:8]}")
            continue
        seen_fp[fp] = nid
        kept.append(row)

    if delete_ids:
        oid = "tidy-delete-" + str(len(delete_ids))
        ops.append(
            {
                "name": "delete_nodes",
                "args": {"nodeIds": delete_ids},
                "op_id": oid,
            }
        )
        kept = [n for n in kept if str(n.get("id") or "") not in set(delete_ids)]

    return ops, kept, notes[:40]


def assess_tool_ops_result(
    ops: list[dict[str, Any]] | None,
    *,
    intent: str | None,
    scene: str | None,
    nodes: list[dict[str, Any]] | None = None,
    rules: dict[str, str] | None = None,
    skill_keys: list[str] | None = None,
) -> tuple[bool, str]:
    """Post-validate tool_ops result (density + light structure). Admin rules only."""
    intent_l = (intent or "").strip().lower()
    if intent_l not in ("create", "sibling"):
        return True, "ok"

    rules = dict(rules or {})
    create_names = {
        x.strip()
        for x in str(rules.get("validate.create_op_names") or "").split("|")
        if x.strip()
    }
    if not create_names:
        create_names = {
            "create_shape",
            "create_text",
            "create_icon",
            "create_image",
            "create_svg",
            "create_lottie",
            "create_frame",
        }
    creates = [
        o
        for o in (ops or [])
        if isinstance(o, dict) and str(o.get("name") or "") in create_names
    ]
    texts = [o for o in creates if str(o.get("name") or "") == "create_text"]
    scene_l = (scene or "").strip().lower()

    min_creates = 0
    raw_min = ""
    if scene_l:
        raw_min = str(rules.get(f"validate.min_creates.{scene_l}") or "").strip()
    if not raw_min:
        raw_min = str(rules.get("validate.min_creates") or "").strip()
    if raw_min:
        try:
            min_creates = max(0, int(raw_min))
        except ValueError:
            min_creates = 0
    if not min_creates:
        # Soft defaults only when craft skills are loaded — never blanket-min
        # generic creates (integration CRUD / single-op asks would clear to []).
        skills = {str(k).strip() for k in (skill_keys or []) if str(k).strip()}
        if skills & {"dashboard_ui", "landing_page", "mobile_app_ui"}:
            min_creates = 8
        elif skills & {"poster_craft", "banner_ad", "ecommerce_surface", "resume_layout"}:
            min_creates = 5

    min_texts = 0
    try:
        if rules.get("validate.min_texts"):
            min_texts = max(0, int(str(rules.get("validate.min_texts")).strip()))
    except ValueError:
        pass

    if min_creates and len(creates) < min_creates:
        return False, f"sparse_tool_ops:too_few_elements:{len(creates)}<{min_creates}"
    if min_texts and len(texts) < min_texts:
        return False, f"sparse_tool_ops:missing_ui_copy:{len(texts)}<{min_texts}"

    # Structure: projected inventory (pre-apply scene + creates − deletes).
    # Do NOT use empty pre-apply scene alone — that false-fails every create-on-blank
    # with sparse_tool_ops:scene_too_thin:0 and clears valid tool_ops (stress 0/10).
    if (
        min_creates
        and nodes is not None
        and _rule_flag(rules, "validate.require_nodes", "1")
    ):
        living_ids = {
            str(n.get("id") or "").strip()
            for n in nodes
            if isinstance(n, dict) and str(n.get("id") or "").strip()
        }
        for o in ops or []:
            if not isinstance(o, dict):
                continue
            name = str(o.get("name") or "").strip()
            args = o.get("args") if isinstance(o.get("args"), dict) else {}
            if name in create_names:
                cid = str(args.get("nodeId") or "").strip()
                if cid:
                    living_ids.add(cid)
                elif name != "create_frame":
                    # Anonymous create still counts toward projected density.
                    living_ids.add(f"__anon_{len(living_ids)}")
            if name == "delete_nodes":
                for x in args.get("nodeIds") or []:
                    living_ids.discard(str(x or "").strip())
        if len(living_ids) < max(1, min_creates // 2):
            return False, f"sparse_tool_ops:scene_too_thin:{len(living_ids)}"

    return True, "ok"

def validation_failure_reason(errors: list[str]) -> str:
    return "tool_ops_invalid:" + ";".join(errors[:8])
