"""Namespace / pin / key helpers for skill_store."""
from __future__ import annotations

import re
from typing import Any

from .constants import (
    NS_CORE,
    NS_USER,
    SOURCE_ADMIN,
    SOURCE_FILE,
    _NS_KEY_RE,
    _PIN_RE,
    _SLUG_RE,
    _SOURCE_TO_NS,
    _VALID_NAMESPACES,
)


def _normalize_source(raw: Any, *, default: str = SOURCE_ADMIN) -> str:
    s = str(raw or "").strip().lower()
    if s in (SOURCE_ADMIN, SOURCE_FILE):
        return s
    return default

def _normalize_namespace(raw: Any, *, source: str | None = None) -> str:
    s = str(raw or "").strip().lower()
    if s in _VALID_NAMESPACES:
        return s
    if source:
        return _SOURCE_TO_NS.get(_normalize_source(source), NS_USER)
    return NS_USER

def split_namespace_key(raw: str) -> tuple[str | None, str]:
    """Return (namespace|None, local_key) from ``core.x`` / ``ext:x`` / bare ``x``."""
    s = str(raw or "").strip().lower()
    if not s:
        return None, ""
    m = _NS_KEY_RE.match(s)
    if m:
        return m.group(1).lower(), str(m.group(2) or "").strip()
    return None, s

def qualify_skill_key(namespace: str, local_key: str) -> str:
    ns = _normalize_namespace(namespace)
    _, local = split_namespace_key(local_key)
    local = local.strip().lower()
    if not local:
        return ""
    if ns == NS_CORE:
        return local
    return f"{ns}.{local}"

def skill_kind_for_namespace(namespace: str) -> str:
    return "core" if _normalize_namespace(namespace) == NS_CORE else "extension"

def parse_skill_pin(raw: str) -> tuple[str, int | None, str | None]:
    """Split ``key@2`` / ``key@1.0.0`` → (key, int_version|None, pack_version|None)."""
    s = str(raw or "").strip()
    if not s:
        return "", None, None
    m = _PIN_RE.match(s)
    if not m:
        return s, None, None
    base = str(m.group(1) or "").strip()
    pin = str(m.group(2) or "").strip()
    if re.fullmatch(r"\d+", pin):
        return base, max(1, int(pin)), None
    return base, None, pin

def _slug_local_key(name: str) -> str:
    s = _SLUG_RE.sub("-", str(name or "").strip().lower()).strip("-")
    return (s or "skill")[:48]
