"""Diff consecutive design SVGs into layer-level create/update/delete keys.

LLM skills still emit full SVG; this module turns prev→next into an incremental
patch so the frontend can update only changed layers.
"""

from __future__ import annotations

import re
from typing import Any
from xml.etree import ElementTree as ET

_DRAW = frozenset(
    {"rect", "circle", "ellipse", "line", "path", "polygon", "polyline", "text", "image"}
)
_SKIP = frozenset({"defs", "style", "script", "clippath", "mask", "filter", "marker", "title", "desc"})


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1].lower()
    return str(tag or "").lower()


def _wrap_fragment(svg: str) -> str:
    s = (svg or "").strip()
    if not s:
        return ""
    if re.search(r"<svg\b", s, re.I):
        return s
    return f'<svg xmlns="http://www.w3.org/2000/svg">{s}</svg>'


def _canonicalize(el: ET.Element) -> str:
    """Stable string for equality — drop volatile whitespace noise."""
    raw = ET.tostring(el, encoding="unicode")
    return re.sub(r"\s+", " ", raw).strip()


def extract_layer_map(svg: str) -> dict[str, str]:
    """Map stable layer key → canonical element markup for drawable leaves."""
    wrapped = _wrap_fragment(svg)
    if not wrapped:
        return {}
    try:
        root = ET.fromstring(wrapped)
    except ET.ParseError:
        return {}

    out: dict[str, str] = {}
    g_stack: list[str] = []
    anon = 0
    per_group: dict[str, int] = {}

    def walk(el: ET.Element) -> None:
        nonlocal anon
        tag = _local(el.tag)
        if tag in _SKIP:
            return
        eid = (el.get("id") or "").strip()
        pushed = False
        if tag == "g" and eid:
            g_stack.append(eid)
            pushed = True

        if tag in _DRAW:
            if eid:
                key = eid
            elif g_stack:
                gid = g_stack[-1]
                n = per_group.get(gid, 0)
                per_group[gid] = n + 1
                key = f"{gid}#{n}" if n else gid
            else:
                key = f"@{anon}"
                anon += 1
            # Collision: keep first, suffix later duplicates.
            base = key
            i = 1
            while key in out:
                key = f"{base}~{i}"
                i += 1
            out[key] = _canonicalize(el)

        for child in list(el):
            walk(child)

        if pushed:
            g_stack.pop()

    walk(root)
    return out


def diff_svg_layers(prev_svg: str, next_svg: str) -> dict[str, Any]:
    """
    Compare two SVGs.

    Returns:
      mode: "full" when there is no previous map (first paint) or next is empty
      creates / updates / deletes: layer keys
      counts for UI
    """
    next_map = extract_layer_map(next_svg)
    prev_map = extract_layer_map(prev_svg)

    if not next_map:
        return {
            "mode": "full",
            "creates": [],
            "updates": [],
            "deletes": list(prev_map.keys()),
            "create_count": 0,
            "update_count": 0,
            "delete_count": len(prev_map),
            "total_next": 0,
        }

    if not prev_map:
        keys = list(next_map.keys())
        return {
            "mode": "full",
            "creates": keys,
            "updates": [],
            "deletes": [],
            "create_count": len(keys),
            "update_count": 0,
            "delete_count": 0,
            "total_next": len(keys),
        }

    creates = [k for k in next_map if k not in prev_map]
    deletes = [k for k in prev_map if k not in next_map]
    updates = [k for k in next_map if k in prev_map and prev_map[k] != next_map[k]]

    # If almost nothing aligns, tell the client to replace wholesale.
    kept = len(next_map) - len(creates)
    denom = max(len(prev_map), len(next_map), 1)
    mode = "patch" if (kept / denom) >= 0.35 or denom <= 3 else "full"

    return {
        "mode": mode,
        "creates": creates,
        "updates": updates,
        "deletes": deletes,
        "create_count": len(creates),
        "update_count": len(updates),
        "delete_count": len(deletes),
        "total_next": len(next_map),
    }


def svg_size(svg: str) -> tuple[int, int] | None:
    """Parse width/height from root <svg> attrs or viewBox."""
    raw = (svg or "").strip()
    if not raw:
        return None
    m = re.search(
        r"<svg\b[^>]*\bwidth\s*=\s*[\"']?\s*(\d+(?:\.\d+)?)",
        raw,
        flags=re.I,
    )
    n = re.search(
        r"<svg\b[^>]*\bheight\s*=\s*[\"']?\s*(\d+(?:\.\d+)?)",
        raw,
        flags=re.I,
    )
    if m and n:
        w, h = int(float(m.group(1))), int(float(n.group(1)))
        if 64 <= w <= 8000 and 64 <= h <= 8000:
            return w, h
    vb = re.search(
        r"<svg\b[^>]*\bviewBox\s*=\s*[\"']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)",
        raw,
        flags=re.I,
    )
    if vb:
        w, h = int(float(vb.group(3))), int(float(vb.group(4)))
        if 64 <= w <= 8000 and 64 <= h <= 8000:
            return w, h
    return None


def svg_content_digest(svg: str, *, max_chars: int = 2400) -> str:
    """Compact inventory of what is actually on the canvas (copy, layers, fills)."""
    raw = (svg or "").strip()
    if not raw:
        return ""

    copies: list[str] = []
    for m in re.finditer(r"<text\b[^>]*>(.*?)</text>", raw, flags=re.I | re.S):
        plain = re.sub(r"<[^>]+>", " ", m.group(1))
        plain = re.sub(r"\s+", " ", plain).strip()
        if plain and plain not in copies:
            copies.append(plain)

    ids = re.findall(r'\bid=["\']([^"\']+)["\']', raw, flags=re.I)
    layers: list[str] = []
    for i in ids:
        if i.startswith("layer-") or i.startswith("@"):
            if i not in layers:
                layers.append(i)
        elif i not in layers and len(layers) < 40:
            layers.append(i)

    fills: list[str] = []
    for f in re.findall(r'\bfill=["\']([^"\']+)["\']', raw, flags=re.I):
        v = f.strip()
        if not v or v.lower() in ("none", "transparent", "currentcolor"):
            continue
        if v not in fills:
            fills.append(v)

    tags = {
        "rect": len(re.findall(r"<rect\b", raw, flags=re.I)),
        "text": len(re.findall(r"<text\b", raw, flags=re.I)),
        "path": len(re.findall(r"<path\b", raw, flags=re.I)),
        "circle": len(re.findall(r"<circle\b", raw, flags=re.I)),
        "image": len(re.findall(r"<image\b", raw, flags=re.I)),
    }
    shape_bits = [f"{k}={n}" for k, n in tags.items() if n > 0]

    parts: list[str] = []
    if copies:
        parts.append("VISIBLE_COPY:\n- " + "\n- ".join(copies[:36]))
    if layers:
        parts.append("LAYERS: " + ", ".join(layers[:48]))
    if fills:
        parts.append("FILLS: " + ", ".join(fills[:16]))
    if shape_bits:
        parts.append("SHAPES: " + ", ".join(shape_bits))

    out = "\n".join(parts).strip()
    return out[:max_chars]

