"""Shared constants and module-level mutable state for skill_store."""
from __future__ import annotations

import re
import threading
from typing import Any

_SKILLS_READY = False
_SKILLS_LOCK = threading.RLock()
_HOT_RELOAD_STOP = threading.Event()
_HOT_RELOAD_THREAD: threading.Thread | None = None
_DISK_SIGNATURE: str | None = None

SOURCE_ADMIN = "admin"
SOURCE_FILE = "file"
_PROTECTED_FROM_FILE = frozenset({SOURCE_ADMIN})

NS_CORE = "core"
NS_EXT = "ext"
NS_USER = "user"
_VALID_NAMESPACES = frozenset({NS_CORE, NS_EXT, NS_USER})
_SOURCE_TO_NS = {
    SOURCE_FILE: NS_EXT,
    SOURCE_ADMIN: NS_USER,
}

# Ops always allowed even when preferred_tools allowlist is active.
_ALWAYS_ALLOW_OPS = frozenset(
    {
        "ask_user",
        "update_node",
        "delete_nodes",
        "align_nodes",
        "distribute_nodes",
        "move_nodes",
        "resize_nodes",
        "reorder_nodes",
        "group_nodes",
        "ungroup_nodes",
        # Constructive vector / icon / motion — must not be gated by create-skill prefs.
        "boolean_op",
        "create_icon",
        "create_lottie",
        "outline_text",
    }
)

MAX_SKILL_DETAIL_CHARS = 14000
_META_NAMES = ("_meta.json",)
_SKILL_MD_NAMES = ("SKILL.md",)
# Skill V3 category order: foundation → brand → craft → surface → qa
_SKILL_CATEGORY_ORDER: dict[str, int] = {
    "foundation": 0,
    "brand": 1,
    "craft": 2,
    "surface": 3,
    "image": 2,  # helper craft (image_gen), not a competing surface
    "qa": 4,
    "agent": 5,
}
# Per-category char budgets when assembling SKILL_DETAILS (paint path).
_SKILL_CATEGORY_BUDGET: dict[str, int] = {
    "foundation": 1600,
    "craft": 1200,
    "image": 1200,
    "brand": 1400,
    "surface": 4200,
    "deliverable": 4200,
    "ui": 4200,
    "qa": 700,
    "agent": 1000,
}
# Disk-pack graph (rebuilt on file load) — avoids DB migration for extends.
_SKILL_GRAPH: dict[str, dict[str, Any]] = {}
_NS_KEY_RE = re.compile(r"^(core|ext|user)[.:/](.+)$", re.IGNORECASE)
_PIN_RE = re.compile(r"^(.+?)@([0-9]+(?:\.[0-9]+){0,2})$")

_RUNTIME_SKILL_KEYS: frozenset[str] | None = None
_RUNTIME_SKILL_INDEX: dict[str, dict[str, Any]] | None = None

_INTERNAL_RESOURCE_KINDS = frozenset({"tools"})

_SLUG_RE = re.compile(r"[^a-z0-9]+")

_MAX_USER_SKILL_ZIP_BYTES = 5 * 1024 * 1024
_MAX_USER_SKILL_ZIP_UNCOMPRESSED = 20 * 1024 * 1024
_ZIP_LOGO_EXTS = (".png", ".svg", ".webp", ".jpg", ".jpeg")
