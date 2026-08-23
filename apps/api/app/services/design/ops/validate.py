"""Hard validation for SVG fragments / JSON skill outputs."""

from __future__ import annotations

import json
import re
from typing import Any


_FORBIDDEN = re.compile(r"<(?:[\w.-]+:)?(script|foreignObject|iframe)\b", re.I)
_SVG_BLOCK = re.compile(
    r"<(?:[\w.-]+:)?svg\b[\s\S]*?</(?:[\w.-]+:)?svg>",
    re.I,
)
_SVG_OPEN = re.compile(r"<(?:[\w.-]+:)?svg\b[^>]*>[\s\S]*", re.I)
_SVGISH = (
    "<g",
    "<path",
    "<rect",
    "<text",
    "<circle",
    "<ellipse",
    "<image",
    "<line",
    "<polygon",
    "<polyline",
)


def extract_svg(text: str) -> str | None:
    if not text:
        return None
    m = _SVG_BLOCK.search(text)
    if m:
        return m.group(0)
    # Unclosed root (models often omit </svg>) — take from first <svg …> to end.
    m = _SVG_OPEN.search(text)
    if m:
        return m.group(0)
    low = text.lower()
    if "<" in text and any(t in low for t in _SVGISH):
        return text
    return None


def extract_json(text: str) -> Any | None:
    """LangChain ``JsonOutputParser`` first; fence/greedy only if parser fails."""
    if not text:
        return None
    try:
        from langchain_core.output_parsers import JsonOutputParser

        parsed = JsonOutputParser().parse(text)
        if parsed is not None:
            return parsed
    except Exception:
        pass
    # Rescue truncated / noisy model output (skill SVG paths still need this).
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", raw)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except Exception:
            return None


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Dict-only: LangChain parse + mid-prose fence / brace / ``intent`` rescue."""
    raw = (text or "").strip()
    if not raw:
        return None
    # Prefer shared extract_json (LangChain → rescue), then insist on dict.
    got = extract_json(raw)
    if isinstance(got, dict):
        return got
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL | re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
    if not raw.startswith("{"):
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        m2 = re.search(r"\{[^{}]*\"intent\"[^{}]*\}", text or "", re.DOTALL)
        if not m2:
            return None
        try:
            obj = json.loads(m2.group(0))
        except json.JSONDecodeError:
            return None
    return obj if isinstance(obj, dict) else None


def hard_validate(
    output: str,
    *,
    output_format: str,
    rules: dict[str, str] | None = None,
    scene: str | None = None,
) -> tuple[bool, str]:
    rules = rules or {}
    checklist = (rules.get("validate.checklist") or "no_script").lower()
    block_cond = (rules.get("validate.block_conditions") or "hard_validate_fail;banned_output").lower()

    fmt = (output_format or "json").lower()
    if _FORBIDDEN.search(output or ""):
        return False, "forbidden_svg_elements"
    if "no_script" in checklist and _FORBIDDEN.search(output or ""):
        return False, "checklist_no_script"

    if fmt == "json":
        data = extract_json(output)
        if data is None:
            return False, "invalid_json"
        if isinstance(data, dict) and "ok" in data and data.get("ok") is False:
            issues = data.get("issues") or []
            if issues:
                return False, "validate_failed"
        return True, "ok"

    if fmt in ("text", "markdown", "plain", "summary"):
        text = str(output or "").strip()
        if len(text) < 8:
            return False, "empty_text"
        if extract_svg(text):
            return False, "unexpected_svg"
        return True, "ok"

    svg = extract_svg(output)
    if not svg:
        return False, "missing_svg"
    if "banned_output" in block_cond and re.search(r"watermark|lorem ipsum", svg, re.I):
        return False, "blocked_banned_output"
    sparse, sparse_why = is_sparse_design_svg(svg, scene=scene or "")
    if sparse:
        return False, sparse_why
    return True, "ok"


def assess_svg_richness(svg: str) -> dict[str, int]:
    raw = svg or ""
    tags = ("rect", "circle", "ellipse", "line", "path", "polygon", "polyline", "text", "image")
    counts = {t: len(re.findall(rf"<{t}\b", raw, flags=re.I)) for t in tags}
    drawables = sum(counts.values())
    return {
        **counts,
        "drawables": drawables,
        "texts": counts["text"],
    }


def is_sparse_design_svg(svg: str, *, scene: str = "") -> tuple[bool, str]:
    """
    True when SVG is effectively empty for a UI/poster job (e.g. only a white bg).
    Illustration/image scenes allow fewer elements.
    """
    stats = assess_svg_richness(svg)
    drawables = stats["drawables"]
    texts = stats["texts"]
    scene_l = (scene or "").strip().lower()

    if scene_l == "image":
        if drawables < 1:
            return True, "sparse_svg:no_shapes"
        return False, "ok"

    # website / mobile / poster / unknown — need real content, not a lone plate.
    if drawables <= 1 and texts == 0:
        return True, "sparse_svg:background_only"
    if drawables < 4 and texts < 1:
        return True, "sparse_svg:too_few_elements"
    if scene_l in ("mobile", "website") and texts < 2 and drawables < 6:
        return True, "sparse_svg:missing_ui_copy"
    return False, "ok"


_DRAWABLE_LOCAL = frozenset(
    {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}
)


def _local_tag(tag: str) -> str:
    if not tag:
        return ""
    if "}" in tag:
        return tag.rsplit("}", 1)[-1].lower()
    return tag.lower()


def _path_d_ok(d: str) -> str | None:
    """Return error code if path ``d`` is empty/invalid; None if ok.

    Uses ``svg.path.parse_path`` so glued arcs / incomplete commands fail the same
    way a real parser would, instead of a hand-rolled token arity check.
    """
    from svg.path import parse_path
    from svg.path.parser import InvalidPathError

    raw = (d or "").strip()
    if not raw:
        return "svg_path_empty_d"
    try:
        parse_path(raw)
    except (InvalidPathError, ValueError, TypeError):
        return "svg_path_d_invalid"
    return None


def validate_agent_svg_markup(raw: str) -> str | None:
    """Validate create_svg / create_icon markup for the canvas agent.

    Returns None if OK, else a short error code for the model retry turn.
    Accepts full ``<svg>…</svg>`` or a drawable fragment (path/circle/…).
    """
    import xml.etree.ElementTree as ET

    markup = (raw or "").strip()
    if not markup:
        return "svg_empty"
    if _FORBIDDEN.search(markup):
        return "svg_forbidden_element"
    wrapped = markup
    if not re.match(r"<svg[\s>]", markup, flags=re.I):
        wrapped = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            f"{markup}</svg>"
        )
    try:
        root = ET.fromstring(wrapped)
    except ET.ParseError:
        return "svg_xml_parse_error"
    if _local_tag(root.tag) != "svg":
        return "svg_root_missing"
    drawables = 0
    for el in root.iter():
        tag = _local_tag(el.tag)
        if tag not in _DRAWABLE_LOCAL:
            continue
        drawables += 1
        if tag == "path":
            err = _path_d_ok(el.attrib.get("d") or "")
            if err:
                return err
    if drawables < 1:
        return "svg_no_drawables"
    return None
