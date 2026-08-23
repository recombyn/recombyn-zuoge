"""Canvas size / scene helpers for design runs.

Client chip + Admin `default_size_*` only. No prompt/ref soft invent before LLM.
"""

from __future__ import annotations

import re
from typing import Any


def _as_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return str(value)


def _rule_text(rules: dict[str, Any] | None, key: str, default: str = "") -> str:
    rules = rules or {}
    if key not in rules or rules.get(key) is None:
        return default
    return _as_text(rules.get(key), default)


def _parse_wh(raw: str | None) -> tuple[int, int] | None:
    text = _as_text(raw).strip().lower().replace("*", "x").replace("×", "x")
    if not text or "x" not in text:
        return None
    a, b = text.split("x", 1)
    try:
        w, h = int(a), int(b)
    except ValueError:
        return None
    if w <= 0 or h <= 0:
        return None
    return w, h


def scene_key(scene: str | None) -> str:
    return (scene or "").strip().lower()


def scene_keys(rules: dict[str, Any] | None = None) -> frozenset[str]:
    """Admin `canvas.scene_keys` (pipe-separated). Empty Admin → empty frozenset."""
    raw = _rule_text(rules, "canvas.scene_keys").strip()
    if not raw:
        return frozenset()
    return frozenset(p.strip().lower() for p in raw.split("|") if p.strip())


def canvas_dim_locks(canvas_size: str | None) -> tuple[int | None, int | None]:
    """Parse client canvas chip: auto → (None,None); 400xauto → (400,None)."""
    raw = _as_text(canvas_size).strip().lower().replace("*", "x").replace("×", "x")
    raw = re.sub(r"\s+", "", raw)
    if not raw or raw == "auto":
        return None, None
    if "x" not in raw:
        return None, None
    a, b = raw.split("x", 1)

    def _side(tok: str) -> int | None:
        if tok in ("", "auto"):
            return None
        try:
            n = int(tok)
        except ValueError:
            return None
        return n if 64 <= n <= 8000 else None

    return _side(a), _side(b)


def explicit_canvas_size(canvas_size: str | None) -> bool:
    """True when the client sent a fully fixed WxH."""
    fw, fh = canvas_dim_locks(canvas_size)
    return fw is not None and fh is not None


def resolve_agent_scene(
    scene: str | None,
    prompt: str = "",
    canvas_size: str | None = None,
    *,
    medium: dict[str, Any] | None = None,
    ref_sizes: list[tuple[int, int]] | None = None,
    rules: dict[str, Any] | None = None,
) -> tuple[str, bool]:
    """Client scene tab, else Admin default. No prompt/ref soft invent."""
    del prompt, canvas_size, medium, ref_sizes
    keys = scene_keys(rules)
    provided = scene_key(scene)
    # Empty Admin allowlist → accept client tab as-is (do not invent a scene).
    if provided and (not keys or provided in keys):
        return provided, False
    default = _rule_text(rules, "canvas.default_scene").strip().lower()
    if default and (not keys or default in keys):
        return default, False
    return provided or default or "", False


def stock_size_for_scene(
    scene: str | None,
    rules: dict[str, Any] | None = None,
) -> tuple[int, int]:
    """Admin `default_size_{scene}` WxH. Missing → (0, 0)."""
    key = scene_key(scene)
    if not key:
        return 0, 0
    wh = _parse_wh(_rule_text(rules, f"default_size_{key}"))
    return wh if wh else (0, 0)


def parse_size(
    canvas_size: str | None,
    scene: str,
    rules: dict[str, str],
) -> tuple[int, int]:
    """Parsed canvas WxH, else Admin `default_size_{scene}`, else (0, 0)."""
    fw, fh = canvas_dim_locks(canvas_size)
    sk = scene_key(scene)
    default_wh = stock_size_for_scene(sk, rules) if sk else (0, 0)
    default_w, default_h = default_wh

    if fw is not None and fh is not None:
        return fw, fh
    if fw is not None:
        return fw, default_h if default_h > 0 else 0
    if fh is not None:
        return default_w if default_w > 0 else 0, fh

    raw = _as_text(canvas_size).strip().lower().replace("*", "x").replace("×", "x")
    if raw and raw != "auto" and "x" in raw:
        parsed = _parse_wh(raw)
        if parsed:
            return parsed

    if default_w > 0 and default_h > 0:
        return default_w, default_h
    return 0, 0


def early_status_canvas_fields(
    *,
    w: int,
    h: int,
    client_size_locked: bool,
    client_canvas_raw: str | None,
) -> dict[str, Any]:
    """Before 设计思考: Auto must not publish provisional stock WxH."""
    if client_size_locked:
        return {
            "canvas_width": w,
            "canvas_height": h,
            "canvas_size": f"{w}x{h}",
        }
    raw = (
        _as_text(client_canvas_raw).strip().lower().replace("*", "x").replace("×", "x")
        or "auto"
    )
    return {
        "canvas_width": None,
        "canvas_height": None,
        "canvas_size": raw,
    }
