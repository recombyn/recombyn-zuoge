"""Parse / validate root plugin.json for .recombyn-plugin packs."""

from __future__ import annotations

import re
from typing import Any

FORMAT_NAME = "recombyn-plugin"
PLUGIN_JSON = "plugin.json"
PLUGIN_SIG = "plugin.sig"
KINDS = frozenset({"skill", "canvas"})
INSTALL_TARGETS = frozenset({"user", "disk"})

_SLUG_RE = re.compile(r"[^a-z0-9_-]+")


def slug_plugin_id(raw: str) -> str:
    s = _SLUG_RE.sub("-", str(raw or "").strip().lower()).strip("-_")
    return s[:64] or "plugin"


def parse_plugin_manifest(meta: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    errs: list[str] = []
    fmt = str(meta.get("format") or "").strip().lower()
    if fmt != FORMAT_NAME:
        errs.append("format_invalid")
    try:
        ver = int(meta.get("formatVersion") or 1)
    except (TypeError, ValueError):
        ver = 0
    if ver < 1:
        errs.append("format_version_invalid")
    kind = str(meta.get("kind") or "skill").strip().lower()
    if kind not in KINDS:
        errs.append("kind_invalid")
    pid = slug_plugin_id(str(meta.get("id") or ""))
    if not pid or pid == "plugin" and not str(meta.get("id") or "").strip():
        # allow folder fallback later
        pass
    install = str(meta.get("install") or ("disk" if kind == "canvas" else "user")).strip().lower()
    if install not in INSTALL_TARGETS:
        errs.append("install_invalid")
    if kind == "canvas" and install != "disk":
        errs.append("canvas_requires_disk_install")
    if errs:
        return None, errs
    perms = meta.get("permissions")
    if not isinstance(perms, list):
        perms = []
    return {
        "format": FORMAT_NAME,
        "formatVersion": ver,
        "id": pid,
        "kind": kind,
        "name": str(meta.get("name") or pid).strip() or pid,
        "version": str(meta.get("version") or "1.0.0").strip() or "1.0.0",
        "author": str(meta.get("author") or "").strip(),
        "permissions": [str(x).strip() for x in perms if str(x).strip()],
        "install": install,
        "raw": meta,
    }, []
