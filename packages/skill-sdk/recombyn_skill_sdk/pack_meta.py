"""Skill pack meta normalize + extends parse (open surface)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

META_NAMES = ("_meta.json",)
SKILL_MD_NAMES = ("SKILL.md",)

_DISABLED = frozenset({False, "false", "0", 0, "no", "off"})
_SCOPE_STAGES = frozenset({"plan", "paint", "review"})


def _normalize_str_list(raw: Any, *, allowed: frozenset[str] | None = None) -> list[str]:
    if raw is None or raw is False:
        return []
    if isinstance(raw, str):
        parts = [p.strip().lower() for p in raw.replace(",", " ").split() if p.strip()]
    elif isinstance(raw, list):
        parts = [str(x).strip().lower() for x in raw if str(x).strip()]
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in parts:
        if allowed is not None and item not in allowed:
            continue
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def pack_has_product_meta(pack_dir: Path) -> bool:
    return any((pack_dir / name).is_file() for name in META_NAMES)


def parse_extends(meta: dict[str, Any]) -> list[str]:
    raw = meta.get("extends") or []
    if isinstance(raw, str):
        raw = [x.strip() for x in raw.split(",") if x.strip()]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        key = str(item or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def normalize_pack_meta(meta: dict[str, Any], *, folder: str) -> dict[str, Any] | None:
    """Normalize pack meta onto the product skill shape.

    Returns ``None`` when the pack is disabled.
    """
    out = dict(meta)
    if "enabled" in out and out.get("enabled") in _DISABLED:
        return None

    key = str(out.get("skill_key") or folder or "").strip()
    if not key:
        return None
    out["skill_key"] = key

    author = str(out.get("author") or "").strip()
    if author:
        out["_author"] = author
    out["scope"] = _normalize_str_list(out.get("scope"), allowed=_SCOPE_STAGES)
    out["required_context"] = _normalize_str_list(out.get("required_context"))
    out["quality_signals"] = _normalize_str_list(out.get("quality_signals"))
    raw_conf = out.get("trigger_confidence")
    if raw_conf is None or raw_conf == "":
        out["trigger_confidence"] = None
    else:
        try:
            out["trigger_confidence"] = max(0.0, min(1.0, float(raw_conf)))
        except (TypeError, ValueError):
            out["trigger_confidence"] = None
    try:
        max_chars = int(out.get("max_prompt_chars") or 0)
    except (TypeError, ValueError):
        max_chars = 0
    out["max_prompt_chars"] = max_chars if max_chars > 0 else 0
    return out
