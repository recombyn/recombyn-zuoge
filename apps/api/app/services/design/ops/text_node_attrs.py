"""Build renderable text node attrs (DATA / ORIGIN_DATA) — mirrors FE sceneText.ts."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

DEFAULT_FONT_FAMILY = "Alibaba PuHuiTi"
DEFAULT_FILL = "#333333"

DEFAULT_TEXT_STYLE: dict[str, Any] = {    "fontSize": 14,
    "fill": DEFAULT_FILL,
    "fontWeight": "normal",
    "fontFamily": DEFAULT_FONT_FAMILY,
    "fontStyle": "normal",
    "textAlign": "left",
    "lineHeight": 1.4,
    "letterSpacing": 0,
    "textDecoration": "none",
}

_TEXT_STYLE_KEYS = (
    "fontSize",
    "fontWeight",
    "fontFamily",
    "fontStyle",
    "textAlign",
    "lineHeight",
    "letterSpacing",
    "textDecoration",
)

_DATA_CFG_TO_STYLE = {
    "SIZE": "fontSize",
    "COLOR": "fill",
    "WEIGHT": "fontWeight",
    "FAMILY": "fontFamily",
    "STYLE": "fontStyle",
    "ALIGN": "textAlign",
    "LINE_HEIGHT": "lineHeight",
    "LETTER_SPACING": "letterSpacing",
    "DECORATION": "textDecoration",
}

_ORIGIN_BASE_TO_STYLE = {
    "fontSize": "fontSize",
    "color": "fill",
    "fontFamily": "fontFamily",
    "textAlign": "textAlign",
    "lineHeight": "lineHeight",
    "letterSpacing": "letterSpacing",
    "textDecoration": "textDecoration",
}

_CREATE_TEXT_FIELDS: tuple[tuple[str, Callable[[Any], Any] | None], ...] = (
    ("fontSize", None),
    ("fill", str),
    ("fontWeight", str),
    ("fontFamily", str),
    ("fontStyle", str),
    ("textAlign", str),
    ("lineHeight", None),
    ("letterSpacing", None),
    ("textDecoration", str),
)

# Tool op args must use fill/fontSize — not document-layer attrs.
_FORBIDDEN_TEXT_OP_FIELDS = frozenset(
    {"color", "content", "attrs", "DATA", "ORIGIN_DATA", "font-base", "markdown", "autoSize"}
)
_TEXT_ALIGNS = frozenset({"left", "center", "right", "justify"})
_FONT_STYLES = frozenset({"normal", "italic", "oblique"})
_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_RGB_COLOR_RE = re.compile(
    r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$",
    re.IGNORECASE,
)
_NAMED_COLORS = frozenset({"transparent", "black", "white"})


def _op_error(code: str, *, fix: str = "", detail: str = "") -> tuple[str, str, str]:
    return code, fix, detail


def _is_number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def validate_text_color(raw: Any) -> bool:
    if raw is None:
        return True
    val = str(raw).strip()
    if not val:
        return False
    low = val.lower()
    if low in _NAMED_COLORS:
        return True
    if _HEX_COLOR_RE.match(val) or _RGB_COLOR_RE.match(val):
        return True
    return False


def validate_text_style_op_args(args: dict[str, Any], *, op_name: str) -> tuple[str, str, str] | None:
    """Validate shared text style fields on create_text / update_node."""
    for key in _FORBIDDEN_TEXT_OP_FIELDS:
        if key in args and args[key] is not None:
            return _op_error(
                f"{op_name}_forbidden_field_{key}",
                fix=f"use args.text/fill/fontSize on {op_name}; do not pass document attrs.{key}",
                detail=key,
            )

    if "fill" in args and args.get("fill") is not None and not validate_text_color(args.get("fill")):
        return _op_error(
            f"{op_name}_invalid_fill",
            fix="fill must be #RGB/#RRGGBB, rgb()/rgba(), or transparent",
            detail=str(args.get("fill"))[:48],
        )

    if args.get("fontSize") is not None:
        if not _is_number(args["fontSize"]):
            return _op_error(
                f"{op_name}_invalid_fontSize",
                fix="fontSize must be a number between 1 and 400",
                detail=str(args.get("fontSize"))[:24],
            )
        size = float(args["fontSize"])
        if size < 1 or size > 400:
            return _op_error(
                f"{op_name}_invalid_fontSize",
                fix="fontSize must be between 1 and 400",
                detail=str(size),
            )

    if args.get("textAlign") is not None:
        align = str(args["textAlign"]).strip().lower()
        if align not in _TEXT_ALIGNS:
            return _op_error(
                f"{op_name}_invalid_textAlign",
                fix="textAlign must be left|center|right|justify",
                detail=align,
            )

    if args.get("fontStyle") is not None:
        style = str(args["fontStyle"]).strip().lower()
        if style not in _FONT_STYLES:
            return _op_error(
                f"{op_name}_invalid_fontStyle",
                fix="fontStyle must be normal|italic|oblique",
                detail=style,
            )

    if args.get("text") is not None and not isinstance(args.get("text"), str):
        return _op_error(
            f"{op_name}_invalid_text_type",
            fix="text must be a string",
            detail=type(args.get("text")).__name__,
        )

    for dim in ("width", "height", "w", "h", "x", "y"):
        if args.get(dim) is not None and not _is_number(args[dim]):
            return _op_error(
                f"{op_name}_invalid_{dim}",
                fix=f"{dim} must be a number",
                detail=str(args.get(dim))[:24],
            )

    return None


def validate_create_text_op_args(args: dict[str, Any]) -> tuple[str, str, str] | None:
    """Validate create_text tool_op args before headless apply."""
    style_err = validate_text_style_op_args(args, op_name="create_text")
    if style_err:
        return style_err

    text = args.get("text")
    has_text = text is not None and str(text) != ""
    if args.get("x") is None or args.get("y") is None:
        return _op_error(
            "create_text_missing_xy",
            fix="re-emit create_text with numeric args.x and args.y",
        )
    if has_text and not isinstance(text, str):
        return _op_error(
            "create_text_invalid_text_type",
            fix="args.text must be a string label",
            detail=type(text).__name__,
        )
    return None


def validate_text_attrs_payload(attrs: dict[str, Any]) -> list[str]:
    """Validate document-layer text attrs after build."""
    errors: list[str] = []
    data_raw = attrs.get("DATA")
    origin_raw = attrs.get("ORIGIN_DATA")
    if not data_raw or not origin_raw:
        errors.append("text_node_missing_DATA")
        return errors

    try:
        data = json.loads(str(data_raw))
        origin = json.loads(str(origin_raw))
    except json.JSONDecodeError:
        errors.append("text_node_invalid_json")
        return errors

    if not isinstance(data, list) or not data:
        errors.append("text_node_empty_DATA")
    if not isinstance(origin, list) or not origin:
        errors.append("text_node_empty_ORIGIN_DATA")

    plain = text_plain_from_attrs(attrs)
    markdown = attrs.get("markdown")
    if isinstance(markdown, str) and plain != markdown:
        errors.append("text_node_text_markdown_mismatch")

    legacy = [k for k in ("text", "content", "color") if attrs.get(k) is not None]
    if legacy:
        errors.append(f"text_node_legacy_fields:{','.join(legacy)}")
    return errors

def normalize_text_font_size(raw: Any, fallback: int = 14) -> int:
    try:
        n = float(raw)
        if n != n:
            return max(1, round(fallback))
        return max(1, min(400, round(n)))
    except (TypeError, ValueError):
        return max(1, round(fallback))


def _is_bold(weight: Any) -> bool:
    if weight in ("bold", "bolder"):
        return True
    try:
        return float(weight) >= 600
    except (TypeError, ValueError):
        return False


def _json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _copy_text_style(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    style = dict(DEFAULT_TEXT_STYLE)
    if overrides:
        style.update({k: v for k, v in overrides.items() if v is not None})
    return style


def _apply_field_map(target: dict[str, Any], source: dict[str, Any], mapping: dict[str, str]) -> None:
    for src, dst in mapping.items():
        val = source.get(src)
        if val is not None and val != "":
            target[dst] = val


def _first_char_config(attrs: dict[str, Any]) -> dict[str, Any]:
    for run in _json_list(attrs.get("DATA")):
        if not isinstance(run, dict):
            continue
        chars = run.get("chars")
        if not isinstance(chars, list):
            continue
        for item in chars:
            if not isinstance(item, dict) or not str(item.get("char") or "").strip():
                continue
            cfg = item.get("config")
            return cfg if isinstance(cfg, dict) else {}
    return {}


def _first_origin_child(attrs: dict[str, Any]) -> dict[str, Any]:
    for block in _json_list(attrs.get("ORIGIN_DATA")):
        if not isinstance(block, dict):
            continue
        children = block.get("children")
        if not isinstance(children, list) or not children:
            continue
        child = children[0]
        return child if isinstance(child, dict) else {}
    return {}


def style_from_create_text_args(args: dict[str, Any], *, box_mode: bool) -> dict[str, Any]:
    """Map create_text tool_op args → text style dict (mirrors FE execCreateText)."""
    style: dict[str, Any] = {}
    for key, cast in _CREATE_TEXT_FIELDS:
        val = args.get(key)
        if val is None:
            continue
        style[key] = cast(val) if cast else val

    if args.get("textAlign") is None and box_mode:
        style["textAlign"] = "center"
    if args.get("lineHeight") is None and not box_mode:
        style["lineHeight"] = 1.15
    return style


def build_text_attrs(text: str, style: dict[str, Any] | None = None) -> dict[str, str]:
    merged = _copy_text_style(style)
    font_size = normalize_text_font_size(merged["fontSize"])
    fill = str(merged["fill"])
    weight = merged["fontWeight"]
    family = str(merged["fontFamily"])
    italic = merged["fontStyle"] == "italic"
    deco = str(merged["textDecoration"])
    plain = str(text or "")

    char_config = {
        "SIZE": font_size,
        "COLOR": fill,
        "WEIGHT": weight,
        "FAMILY": family,
        "STYLE": merged["fontStyle"],
        "ALIGN": merged["textAlign"],
        "LINE_HEIGHT": merged["lineHeight"],
        "LETTER_SPACING": merged["letterSpacing"],
        "DECORATION": deco,
    }
    chars = [{"char": ch, "config": char_config} for ch in plain]

    origin_child = {
        "text": plain,
        "bold": _is_bold(weight),
        "italic": italic,
        "strike": "line-through" in deco,
        "underline": "underline" in deco,
        "overline": "overline" in deco,
        "font-base": {
            "fontSize": font_size,
            "color": fill,
            "fontFamily": family,
            "textAlign": merged["textAlign"],
            "lineHeight": merged["lineHeight"],
            "letterSpacing": merged["letterSpacing"],
            "textDecoration": deco,
        },
    }

    return {
        "DATA": json.dumps([{"chars": chars, "config": {}}], ensure_ascii=False),
        "ORIGIN_DATA": json.dumps([{"children": [origin_child]}], ensure_ascii=False),
    }


def build_markdown_text_attrs(markdown: str, style: dict[str, Any] | None = None) -> dict[str, str]:
    md = str(markdown or "")
    attrs = build_text_attrs(md, style)
    attrs["markdown"] = md
    return attrs


def _origin_plain_text(attrs: dict[str, Any]) -> str:
    for block in _json_list(attrs.get("ORIGIN_DATA")):
        if not isinstance(block, dict):
            continue
        children = block.get("children")
        if not isinstance(children, list):
            continue
        parts = [str(c.get("text") or "") for c in children if isinstance(c, dict)]
        joined = "\n".join(p for p in parts if p)
        if joined:
            return joined
    return ""


def text_plain_from_attrs(attrs: dict[str, Any]) -> str:
    origin = _origin_plain_text(attrs)
    if origin:
        return origin

    for run in _json_list(attrs.get("DATA")):
        if not isinstance(run, dict):
            continue
        chars = run.get("chars")
        if not isinstance(chars, list):
            continue
        out = "".join(str(item.get("char") or "") for item in chars if isinstance(item, dict))
        if out:
            return out

    legacy = attrs.get("text") or attrs.get("content")
    if isinstance(legacy, str) and legacy:
        return legacy
    md = attrs.get("markdown")
    return md if isinstance(md, str) else ""


def parse_style_from_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    style = _copy_text_style()
    _apply_field_map(style, _first_char_config(attrs), _DATA_CFG_TO_STYLE)

    child = _first_origin_child(attrs)
    base = child.get("font-base") if isinstance(child.get("font-base"), dict) else {}
    _apply_field_map(style, base, _ORIGIN_BASE_TO_STYLE)
    if child.get("bold"):
        style["fontWeight"] = "bold"
    if child.get("italic"):
        style["fontStyle"] = "italic"
    return style


def merge_text_node_attrs(existing: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    """Rebuild DATA/ORIGIN_DATA when updating text style via update_node."""
    attrs = dict(existing) if isinstance(existing, dict) else {}
    plain = str(args["text"]) if args.get("text") is not None else text_plain_from_attrs(attrs)

    style = parse_style_from_attrs(attrs)
    for key in _TEXT_STYLE_KEYS:
        if args.get(key) is not None:
            style[key] = args[key]
    if args.get("fill") is not None:
        style["fill"] = args["fill"]

    out = {**attrs, **build_markdown_text_attrs(plain, style)}
    if args.get("name") is not None:
        out["name"] = str(args["name"])
    return out


def validate_renderable_text_node(node: dict[str, Any]) -> list[str]:
    """Ensure a text node can be painted by the web editor."""
    if str(node.get("key") or "") != "text":
        return []
    attrs = node.get("attrs")
    if not isinstance(attrs, dict):
        return ["text_node_missing_attrs"]
    return validate_text_attrs_payload(attrs)


def validate_headless_patch(patch: dict[str, Any]) -> list[str]:
    """Collect schema errors for all text nodes in a headless document patch."""
    upsert = patch.get("upsertNodes")
    if not isinstance(upsert, dict):
        return []
    errors: list[str] = []
    for node in upsert.values():
        if isinstance(node, dict):
            errors.extend(validate_renderable_text_node(node))
    return errors