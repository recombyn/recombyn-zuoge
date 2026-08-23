"""Festival poster skill ops runner — returns tool_ops only.

Enable with ``DESIGN_SKILL_OPS_RUNNER=true``. Never mutates Redis/DB/canvas
directly; the Design Agent paint gate still validates preferred_tools.
"""
from __future__ import annotations

from typing import Any


def _pick_festival(prompt: str, payload: dict[str, Any]) -> str:
    raw = str(payload.get("festival") or "").strip()
    if raw:
        return raw
    p = str(prompt or "")
    for word in ("中秋", "春节", "国庆", "圣诞", "新年", "Mid-Autumn", "Christmas"):
        if word.lower() in p.lower() or word in p:
            return word
    return "节日"


def _pick_color(prompt: str, payload: dict[str, Any]) -> str:
    raw = str(payload.get("color_theme") or "").strip()
    if raw:
        return raw
    p = str(prompt or "")
    for word, hex_color in (
        ("红", "#C23A2B"),
        ("red", "#C23A2B"),
        ("金", "#D4A017"),
        ("gold", "#D4A017"),
        ("蓝", "#1F4E79"),
        ("blue", "#1F4E79"),
    ):
        if word in p.lower() or word in p:
            return hex_color
    return "#C23A2B"


def run(ctx: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    prompt = str((payload or {}).get("prompt") or (ctx or {}).get("prompt") or "")
    festival = _pick_festival(prompt, payload or {})
    color = _pick_color(prompt, payload or {})
    width = float((payload or {}).get("width") or 1080)
    height = float((payload or {}).get("height") or 1440)
    title = f"{festival}快乐"
    return [
        {
            "name": "create_frame",
            "args": {
                "x": 40,
                "y": 40,
                "width": width,
                "height": height,
                "name": f"{festival} poster",
                "fill": color,
            },
        },
        {
            "name": "create_text",
            "args": {
                "x": 40 + width * 0.12,
                "y": 40 + height * 0.38,
                "text": title,
                "fontSize": max(48, int(width * 0.08)),
                "fill": "#FFFFFF",
            },
        },
        {
            "name": "create_text",
            "args": {
                "x": 40 + width * 0.12,
                "y": 40 + height * 0.52,
                "text": "Holiday KV",
                "fontSize": max(22, int(width * 0.028)),
                "fill": "#F5E6C8",
            },
        },
    ]
