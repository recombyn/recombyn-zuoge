"""Seed / file pack loading for skill_store."""
from __future__ import annotations

import difflib
import json
import logging
import re
from pathlib import Path
from typing import Any

from recombyn_skill_sdk import (
    normalize_pack_meta as _normalize_pack_meta,
    parse_extends as _parse_extends,
    parse_pack_version as _parse_pack_version,
)

from .constants import (
    NS_CORE,
    NS_EXT,
    SOURCE_FILE,
    _SKILL_GRAPH,
)
from .keys import (
    qualify_skill_key,
    split_namespace_key,
)

logger = logging.getLogger(__name__)


def _read_sidecar_dir(pack_dir: Path, folder: str, *, limit_files: int = 8) -> str:
    """Concatenate markdown sidecars under ``references/`` or ``review/``."""
    root = pack_dir / folder
    if not root.is_dir():
        return ""
    chunks: list[str] = []
    files = sorted(
        p for p in root.iterdir() if p.is_file() and p.suffix.lower() in (".md", ".txt")
    )
    for path in files[:limit_files]:
        try:
            text = path.read_text(encoding="utf-8").strip()
        except Exception:
            continue
        if not text:
            continue
        chunks.append(f"### {folder}/{path.name}\n{text}")
    return "\n\n".join(chunks).strip()


def _register_skill_graph(item: dict[str, Any]) -> None:
    """Index extends / context_mode / sidecars for runtime expand (disk packs)."""
    key = str(item.get("skill_key") or "").strip().lower()
    if not key:
        return
    _SKILL_GRAPH[key] = {
        "extends": list(item.get("extends") or []),
        "category": str(item.get("category") or "agent").strip().lower() or "agent",
        "context_mode": str(item.get("context_mode") or "full")
        .strip()
        .lower()
        or "full",
        "scope": list(item.get("scope") or []),
        "required_context": list(item.get("required_context") or []),
        "quality_signals": list(item.get("quality_signals") or []),
        "trigger_confidence": item.get("trigger_confidence"),
        "max_prompt_chars": int(item.get("max_prompt_chars") or 0),
        "rules_excerpt": str(item.get("_rules_excerpt") or "").strip(),
        "review_docs": str(item.get("_review_docs") or "").strip(),
    }


def _clear_skill_graph() -> None:
    _SKILL_GRAPH.clear()


class SkillDependencyCycleError(RuntimeError):
    """Raised when skill ``extends`` graph contains a cycle."""


def detect_skill_extends_cycles(graph: dict[str, dict[str, Any]] | None = None) -> None:
    """DFS cycle detection over ``extends``. Raises SkillDependencyCycleError."""
    g = graph if graph is not None else _SKILL_GRAPH
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node: str, stack: list[str]) -> None:
        if node in done:
            return
        if node in visiting:
            cycle = " → ".join(stack[stack.index(node) :] + [node])
            raise SkillDependencyCycleError(f"skill extends cycle: {cycle}")
        visiting.add(node)
        stack.append(node)
        for dep in list((g.get(node) or {}).get("extends") or []):
            dep_l = str(dep or "").strip().lower()
            if dep_l:
                visit(dep_l, stack)
        stack.pop()
        visiting.remove(node)
        done.add(node)

    for key in sorted(g.keys()):
        visit(key, [])


def skill_graph_entry(skill_key: str) -> dict[str, Any]:
    return dict(_SKILL_GRAPH.get(str(skill_key or "").strip().lower()) or {})


def _compact_rules_excerpt(body: str, *, anti_patterns: str = "") -> str:
    """Prefer Hard rules / Do not / forbid sections for qa compact inject."""
    text = str(body or "").strip()
    if not text and not anti_patterns:
        return ""
    markers = (
        "## Hard rules",
        "## Hard Rules",
        "## Do not",
        "## Anti-slop",
        "## Anti-AI-Slop",
        "## Forbid",
        "## Checklist",
    )
    for marker in markers:
        idx = text.find(marker)
        if idx >= 0:
            chunk = text[idx : idx + 900].strip()
            if anti_patterns:
                chunk = f"{chunk}\n\n{anti_patterns[:600]}".strip()
            return chunk[:1200]
    base = text[:700].strip()
    if anti_patterns:
        base = f"{base}\n\n{anti_patterns[:500]}".strip()
    return base[:1200]


def _skill_md_path(pack_dir: Path) -> Path | None:
    p = pack_dir / "SKILL.md"
    return p if p.is_file() else None


def _repo_root() -> Path:
    """``apps/api`` → repository root."""
    from app.core.config import _API_ROOT

    return _API_ROOT.parent.parent

def _agents_skills_dir() -> Path:
    """Cursor/IDE skills tree — not scanned by the Design Agent."""
    return _repo_root() / ".agents" / "skills"


def _default_plugin_skills_dir() -> Path:
    """Private / self-host mount point: ``<repo>/plugins/skills``."""
    return _repo_root() / "plugins" / "skills"


def _plugin_skills_dirs() -> list[Path]:
    """Configured + default plugin skill roots (exist on disk only)."""
    from app.core.config import settings

    out: list[Path] = []
    seen: set[str] = set()

    def _add(root: Path) -> None:
        try:
            if not root.is_dir():
                return
            key = str(root.resolve()).lower()
        except Exception:
            return
        if key in seen:
            return
        seen.add(key)
        out.append(root)

    _add(_default_plugin_skills_dir())
    raw = str(getattr(settings, "design_skills_plugin_dirs", "") or "").strip()
    for part in raw.split(","):
        p = part.strip()
        if not p:
            continue
        path = Path(p)
        if not path.is_absolute():
            path = _repo_root() / path
        _add(path)
    return out


def _public_skills_dirs() -> list[Path]:
    """Shipped open catalog: ``skills/foundation`` + ``skills/domains``."""
    root = _repo_root() / "skills"
    return [root / "foundation", root / "domains"]


def _file_skills_dir() -> Path:
    """Primary shipped skills dir (foundation first)."""
    foundation = _repo_root() / "skills" / "foundation"
    if foundation.is_dir():
        return foundation
    return foundation


def _file_skills_dirs() -> list[Path]:
    """Public ``skills/*`` + ``plugins/skills``.

    Later roots win on duplicate ``skill_key`` (private plugins override shipped packs).
    ``.agents/skills`` is IDE/Cursor tooling — not scanned by the Design Agent.
    """
    dirs: list[Path] = []
    seen: set[str] = set()
    for root in (
        *_public_skills_dirs(),
        *_plugin_skills_dirs(),
    ):
        try:
            resolved = root.resolve()
        except Exception:
            continue
        key = str(resolved).lower()
        if key in seen or not root.is_dir():
            continue
        seen.add(key)
        dirs.append(root)
    return dirs

def _pack_has_product_meta(pack_dir: Path) -> bool:
    return (pack_dir / "_meta.json").is_file()


# Skills ship as file packs only (NS_CORE/NS_EXT); no DB seed source.
_SEED: list[dict[str, Any]] = []
_SEED_BY_KEY: dict[str, dict[str, Any]] = {}
_CORE_RESERVED_KEYS: frozenset[str] = frozenset()


def _read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None

def _locale_pick(
    locales: Any, *, prefer: tuple[str, ...] = ("zh-CN", "zh", "en-US", "en")
) -> dict[str, Any]:
    if not isinstance(locales, dict):
        return {}
    for key in prefer:
        block = locales.get(key)
        if isinstance(block, dict):
            return block
    for block in locales.values():
        if isinstance(block, dict):
            return block
    return {}

_LOGO_DATA_URL_MAX_BYTES = 48_000


def _file_to_logo_data_url(path: Path) -> str | None:
    """Inline small pack logos so FE/admin can use them as ``<img src>``."""
    import base64
    import urllib.parse

    try:
        raw = path.read_bytes()
    except Exception:
        return None
    if not raw or len(raw) > _LOGO_DATA_URL_MAX_BYTES:
        return None
    suffix = path.suffix.lower()
    if suffix == ".svg":
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            return None
        # Prefer compact URL-encoding for SVG (readable in Admin preview).
        return "data:image/svg+xml," + urllib.parse.quote(text, safe="")
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix)
    if not mime:
        return None
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def _resolve_pack_logo(pack_dir: Path, meta: dict[str, Any]) -> str:
    """Return usable logo URL (http/data) or '' — prefer inlined pack ``assets/icon``."""
    raw = str(meta.get("logo") or "").strip()
    if raw.startswith(("http://", "https://", "data:")):
        return raw
    candidates: list[Path] = []
    if raw:
        p = Path(raw)
        # Never accept absolute paths outside the pack (path traversal / leakage).
        if p.is_absolute():
            return ""
        candidates.append(pack_dir / p)
        candidates.append(pack_dir / Path(raw).name)
    key = pack_dir.name
    # Prefer raster picture icons (marketplace style) over flat SVG glyphs.
    candidates.extend(
        [
            pack_dir / "assets" / "icon.png",
            pack_dir / "assets" / "icon.webp",
            pack_dir / "assets" / "icon.jpg",
            pack_dir / "assets" / "icon.svg",
            pack_dir / "assets" / "logo.png",
            pack_dir / "assets" / "logo.webp",
            pack_dir / "assets" / "logo.svg",
            pack_dir / f"{key}-logo.png",
            pack_dir / f"{key}-logo.webp",
            pack_dir / f"{key}-logo.svg",
            pack_dir / f"{key}-logo.jpg",
            pack_dir / "logo.png",
            pack_dir / "logo.webp",
            pack_dir / "logo.svg",
            pack_dir / "logo.jpg",
        ]
    )
    root = pack_dir.resolve()
    for cand in candidates:
        try:
            if not cand.is_file():
                continue
            resolved = cand.resolve()
            try:
                resolved.relative_to(root)
            except ValueError:
                # Outside this pack dir — deny.
                continue
            data_url = _file_to_logo_data_url(resolved)
            if data_url:
                return data_url
        except Exception:
            continue
    return ""

def _skill_item_from_parts(
    *,
    pack_dir: Path,
    meta: dict[str, Any],
    body: str,
    skill_md_path: Path,
) -> dict[str, Any] | None:
    """Build skill dict from _meta.json + SKILL.md body."""
    from .schema import validate_skill_meta

    folder = pack_dir.name
    key = str(meta.get("skill_key") or folder).strip()
    if not key or key in _SEED_BY_KEY:
        return None
    locales = meta.get("locales") if isinstance(meta.get("locales"), dict) else {}
    loc = _locale_pick(locales)
    display = str(
        loc.get("displayName")
        or meta.get("displayName")
        or key
    ).strip() or key
    description = str(loc.get("description") or meta.get("description") or "").strip()
    when = str(meta.get("when_to_use") or "").strip()
    pos = body.strip()
    if not pos:
        return None
    pack_label, ver_int = _parse_pack_version(meta.get("version") or 1)
    logo = _resolve_pack_logo(pack_dir, meta)
    ns_prefix, stripped = split_namespace_key(key)
    if ns_prefix == NS_CORE:
        return None
    storage_key = qualify_skill_key(NS_EXT, stripped or key) if ns_prefix == NS_EXT else (
        stripped or key
    )
    # Bare file-pack keys stay bare; namespace column still marks ext.
    if not ns_prefix:
        storage_key = (stripped or key).strip().lower()
    if storage_key in _SEED_BY_KEY or (stripped or key) in _SEED_BY_KEY:
        return None
    meta_errs = validate_skill_meta(
        {
            "skill_key": storage_key,
            "name": display,
            "prompt_positive": pos,
            "preferred_tools": meta.get("preferred_tools") or [],
            "allowed_resources": meta.get("allowed_resources"),
            "input_schema": meta.get("input_schema"),
            "output_schema": meta.get("output_schema"),
            "namespace": NS_EXT,
        },
        source=SOURCE_FILE,
    )
    if meta_errs:
        logger.warning("skip skill pack %s: %s", pack_dir.name, ",".join(meta_errs))
        return None
    return {
        "skill_key": storage_key,
        "name": display,
        "description": description,
        "category": str(meta.get("category") or "agent").strip() or "agent",
        "when_to_use": when,
        "prompt_positive": pos,
        "prompt_negative": str(meta.get("prompt_negative") or "").strip(),
        "scenes": str(meta.get("scenes") or "all").strip() or "all",
        "sort_weight": int(meta.get("sort_weight") or 0),
        "preferred_tools": meta.get("preferred_tools") or [],
        "allowed_resources": meta.get("allowed_resources"),
        "input_schema": meta.get("input_schema"),
        "output_schema": meta.get("output_schema"),
        "triggers": meta.get("triggers") or [],
        "mutex_group": str(meta.get("mutex_group") or "").strip(),
        "extends": _parse_extends(meta),
        "context_mode": str(meta.get("context_mode") or "full").strip().lower()
        or "full",
        "scope": list(meta.get("scope") or []),
        "required_context": list(meta.get("required_context") or []),
        "quality_signals": list(meta.get("quality_signals") or []),
        "trigger_confidence": meta.get("trigger_confidence"),
        "max_prompt_chars": int(meta.get("max_prompt_chars") or 0),
        "version": ver_int,
        "pack_version": pack_label,
        "logo": logo,
        "locales": locales if isinstance(locales, dict) else {},
        "source": SOURCE_FILE,
        "namespace": NS_EXT,
        "_path": str(skill_md_path),
        "_pack": str(pack_dir),
        **(
            {"author": str(meta.get("_author") or "").strip()}
            if str(meta.get("_author") or "").strip()
            else {}
        ),
    }

def _load_schema_json(pack_dir: Path) -> tuple[Any, Any]:
    """Optional ``schema.json`` → (input_schema, output_schema)."""
    path = pack_dir / "schema.json"
    if not path.is_file():
        return None, None
    data = _read_json_file(path)
    if not data:
        return None, None
    inp = data.get("input_schema")
    out = data.get("output_schema")
    return inp, out


def _handler_py_path(pack_dir: Path) -> Path | None:
    p = pack_dir / "handler.py"
    return p if p.is_file() else None


def _note_handler(pack_dir: Path) -> str | None:
    """Record optional ``handler.py`` path (executed only when ops runner is on)."""
    path = _handler_py_path(pack_dir)
    if not path:
        return None
    logger.info(
        "skill pack %s has handler.py (ops runner; enable DESIGN_SKILL_OPS_RUNNER)",
        pack_dir.name,
    )
    return str(path)


def _load_pack_dir(pack_dir: Path) -> dict[str, Any] | None:
    """Load one skill pack: ``_meta.json`` + ``SKILL.md``, optional ``schema.json``."""
    if not pack_dir.is_dir():
        return None
    skill_md = _skill_md_path(pack_dir)
    if not skill_md:
        return None
    try:
        body = skill_md.read_text(encoding="utf-8").strip()
    except Exception:
        return None
    if not body:
        return None
    meta_path = pack_dir / "_meta.json"
    if not meta_path.is_file():
        return None
    meta = _read_json_file(meta_path)
    if not meta:
        return None
    meta = _normalize_pack_meta(meta, folder=pack_dir.name)
    if not meta:
        return None

    schema_in, schema_out = _load_schema_json(pack_dir)
    if schema_in is not None and not meta.get("input_schema"):
        meta["input_schema"] = schema_in
    if schema_out is not None and not meta.get("output_schema"):
        meta["output_schema"] = schema_out

    item = _skill_item_from_parts(
        pack_dir=pack_dir,
        meta=meta,
        body=body,
        skill_md_path=skill_md,
    )
    if not item:
        return None
    refs = _read_sidecar_dir(pack_dir, "references")
    review_docs = _read_sidecar_dir(pack_dir, "review")
    anti = ""
    anti_path = pack_dir / "references" / "anti-patterns.md"
    if anti_path.is_file():
        try:
            anti = anti_path.read_text(encoding="utf-8").strip()
        except Exception:
            anti = ""
    item["_rules_excerpt"] = _compact_rules_excerpt(body, anti_patterns=anti)
    item["_review_docs"] = review_docs
    item["_references"] = refs
    if refs and str(item.get("context_mode") or "") == "full":
        # Surface/foundation may append a short references digest (budgeted later).
        item["_references_digest"] = refs[:1800]
    handler = _note_handler(pack_dir)
    if handler:
        item["_handler"] = handler
    _register_skill_graph(item)
    return item


def _load_file_skills() -> list[dict[str, Any]]:
    """Scan design_skills + plugins/skills → skill dicts (later roots win)."""
    by_key: dict[str, dict[str, Any]] = {}
    _clear_skill_graph()
    for root in _file_skills_dirs():
        for pack_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            item = _load_pack_dir(pack_dir)
            if not item:
                continue
            key = str(item.get("skill_key") or "").strip()
            if not key:
                continue
            by_key[key] = item
            _register_skill_graph(item)
    try:
        detect_skill_extends_cycles()
    except SkillDependencyCycleError:
        logger.exception("skill extends cycle detected in file packs")
        raise
    return list(by_key.values())


# ── P30 Skill Evolution (proposal + human approve; never auto-overwrite) ──

_EVAL_FAMILY_SKILL = {
    "poster": "poster_craft",
    "landing": "landing_page",
    "dashboard": "dashboard_ui",
    "image": "image_gen",
}
_FAILURE_RULES: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (
        re.compile(r"title too large|headline.*(large|dominan)|标题.{0,8}(大|抢)", re.I),
        "title too large",
        "Secondary typography must remain at least one hierarchy level below hero.",
    ),
    (
        re.compile(r"decorat|particle|ornament|装饰.{0,8}(多|过)", re.I),
        "decoration too much",
        "Decorative elements must not compete with hero.",
    ),
    (
        re.compile(r"weak focal|focal point|hero.{0,12}(small|weak)|焦点.{0,8}弱", re.I),
        "weak focal point",
        "Hero should occupy 60–80% of the visual attention budget.",
    ),
)
_REPLACE_LINES = {
    "weak focal point": "Hero should be visually dominant.",
}


def _eval_task_id(row: dict[str, Any]) -> str:
    if row.get("caseId"):
        return str(row.get("caseId") or "").strip()
    raw = str(row.get("id") or "").strip()
    return raw.split("@")[0] if "@" in raw else raw


def _eval_task_issues(row: dict[str, Any]) -> list[str]:
    review = row.get("review") if isinstance(row.get("review"), dict) else {}
    raw = row.get("issues") if row.get("issues") is not None else review.get("issues")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            text = str(item.get("issue") or "").strip()
        else:
            text = str(item or "").strip()
        if text:
            out.append(text)
    return out


def _eval_skill_for_task(task_id: str, row: dict[str, Any] | None = None) -> str:
    if isinstance(row, dict):
        explicit = str(row.get("skill") or "").strip()
        if explicit:
            return explicit
    fam = str(task_id or "").split("-")[0]
    return _EVAL_FAMILY_SKILL.get(fam, "")


def _iter_eval_task_rows(eval_doc: Any) -> list[tuple[str, dict[str, Any]]]:
    src = eval_doc if isinstance(eval_doc, dict) else {}
    compact = src.get("tasks")
    rows: list[tuple[str, dict[str, Any]]] = []
    if isinstance(compact, dict) and not isinstance(compact, list):
        for tid, row in compact.items():
            if isinstance(row, dict) and str(tid).strip():
                rows.append((str(tid).strip(), row))
        return rows
    for row in list(src.get("results") or []):
        if not isinstance(row, dict):
            continue
        tid = _eval_task_id(row)
        if tid:
            rows.append((tid, row))
    return rows


def normalize_failure_pattern(text: str) -> str | None:
    blob = str(text or "").strip()
    if not blob:
        return None
    for rx, label, _rule in _FAILURE_RULES:
        if rx.search(blob):
            return label
    return None


def mine_skill_failures(eval_doc: Any) -> list[dict[str, Any]]:
    """Count failure patterns per skill. Eval → Pattern Mining."""
    counts: dict[tuple[str, str], int] = {}
    for tid, row in _iter_eval_task_rows(eval_doc):
        skill = _eval_skill_for_task(tid, row)
        if not skill:
            continue
        for issue in _eval_task_issues(row):
            label = normalize_failure_pattern(issue)
            if not label:
                continue
            key = (skill, label)
            counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))
    return [
        {"skill_key": skill, "pattern": pattern, "count": n}
        for (skill, pattern), n in ranked
    ]


def _rule_for_pattern(pattern: str) -> str:
    for _rx, label, rule in _FAILURE_RULES:
        if label == pattern:
            return rule
    return ""


def _insert_hard_rule(text: str, line: str) -> str:
    blob = str(text or "")
    marker = "## Hard rules"
    idx = blob.find(marker)
    if idx < 0:
        idx = blob.find("## Hard Rules")
        marker = "## Hard Rules"
    if idx < 0:
        return blob.rstrip() + f"\n\n## Hard rules\n\n1. {line}\n"
    rest = blob[idx:]
    nxt = rest.find("\n## ", 1)
    section = rest if nxt < 0 else rest[:nxt]
    after = "" if nxt < 0 else rest[nxt:]
    nums = [int(n) for n in re.findall(r"^(\d+)\.\s", section, re.M)]
    n = (max(nums) + 1) if nums else 1
    section = section.rstrip() + f"\n{n}. {line}\n"
    if nxt < 0:
        return blob[:idx] + section
    return blob[:idx] + section + after


def _apply_failure_rules(current_md: str, patterns: list[dict[str, Any]]) -> str:
    text = str(current_md or "")
    seen: set[str] = set()
    for row in patterns:
        label = str(row.get("pattern") or "").strip()
        if not label or label in seen:
            continue
        seen.add(label)
        rule = _rule_for_pattern(label)
        if not rule:
            continue
        old = _REPLACE_LINES.get(label) or ""
        if old and old in text and rule not in text:
            text = text.replace(old, rule, 1)
            continue
        if rule in text:
            continue
        text = _insert_hard_rule(text, rule)
    return text


def _bump_pack_version(raw: Any) -> str:
    s = str(raw if raw is not None else "1").strip() or "1"
    if re.fullmatch(r"-?\d+", s):
        return str(max(1, int(s)) + 1)
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", s)
    if m:
        return f"{int(m.group(1))}.{int(m.group(2))}.{int(m.group(3)) + 1}"
    m2 = re.match(r"^(\d+)\.(\d+)$", s)
    if m2:
        return f"{int(m2.group(1))}.{int(m2.group(2))}.1"
    return f"{s}.1"


def _unified_skill_diff(current_md: str, proposed_md: str, *, path: str) -> str:
    return "".join(
        difflib.unified_diff(
            str(current_md or "").splitlines(keepends=True),
            str(proposed_md or "").splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def build_skill_proposal(
    *,
    skill_key: str,
    failures: list[dict[str, Any]] | None,
    current_md: str,
    base_version: str = "1",
) -> dict[str, Any]:
    """Skill improvement proposal + unified diff. Does not write production files."""
    key = str(skill_key or "").strip()
    scoped = [
        row
        for row in list(failures or [])
        if isinstance(row, dict) and str(row.get("skill_key") or "") == key
    ]
    if not scoped:
        scoped = [row for row in list(failures or []) if isinstance(row, dict)]
    proposed = _apply_failure_rules(current_md, scoped)
    rel = f"{key}/SKILL.md" if key else "SKILL.md"
    return {
        "status": "pending",
        "skill_key": key,
        "base_version": str(base_version or "1"),
        "next_version": _bump_pack_version(base_version),
        "patterns": [
            {
                "pattern": str(row.get("pattern") or ""),
                "count": int(row.get("count") or 0),
            }
            for row in scoped
            if str(row.get("pattern") or "").strip()
        ],
        "diff": _unified_skill_diff(current_md, proposed, path=rel),
        "current_md": str(current_md or ""),
        "proposed_md": proposed,
        "approved_by": None,
    }


def approve_skill_proposal(proposal: dict[str, Any], *, by: str = "human") -> dict[str, Any]:
    """Human approve only. Still does not write production Skill."""
    out = dict(proposal or {})
    if str(out.get("status") or "") == "rejected":
        return out
    out["status"] = "approved"
    out["approved_by"] = str(by or "human")
    return out


def reject_skill_proposal(proposal: dict[str, Any], *, by: str = "human") -> dict[str, Any]:
    out = dict(proposal or {})
    out["status"] = "rejected"
    out["approved_by"] = None
    out["rejected_by"] = str(by or "human")
    return out


def regression_blocks_deploy(compare_report: Any) -> bool:
    """Reuse PR19 thresholds: avg drop > 3 or key task drop > 5 → FAIL."""
    if not isinstance(compare_report, dict):
        return True
    if compare_report.get("skipped"):
        return True
    return bool(compare_report.get("fail"))


def deploy_skill_proposal(
    proposal: dict[str, Any],
    *,
    pack_dir: Path,
    compare_report: dict[str, Any] | None,
) -> dict[str, Any]:
    """Write SKILL.md + version bump only after human approve AND regression pass."""
    src = proposal if isinstance(proposal, dict) else {}
    dest = Path(pack_dir)
    if str(src.get("status") or "") != "approved":
        return {"ok": False, "reason": "not_approved", "wrote": False}
    if regression_blocks_deploy(compare_report):
        return {"ok": False, "reason": "regression_fail", "wrote": False}
    body = str(src.get("proposed_md") or "")
    if not body.strip():
        return {"ok": False, "reason": "empty_proposal", "wrote": False}
    dest.mkdir(parents=True, exist_ok=True)
    md_path = dest / "SKILL.md"
    md_path.write_text(body, encoding="utf-8")
    meta_path = dest / "_meta.json"
    meta = _read_json_file(meta_path) or {}
    meta["version"] = str(src.get("next_version") or _bump_pack_version(meta.get("version")))
    if src.get("skill_key") and not meta.get("skill_key"):
        meta["skill_key"] = src.get("skill_key")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    out = dict(src)
    out["status"] = "deployed"
    return {"ok": True, "reason": "deployed", "wrote": True, "proposal": out}


# ── P39 Skill A/B Testing (Adaptive Skill) ──────────────────────────────────
# Skill → A/B variants → eval scores → winner candidate → human promote.
# Winner NEVER auto-writes production; reuse approve + regression + deploy.


def _replace_or_insert_hero_band(text: str, band: str) -> str:
    """Force a Hero attention-band hard rule (A/B axis)."""
    blob = str(text or "")
    rule = f"Hero should occupy {band} of the visual attention budget."
    patterns = (
        r"Hero should occupy [^\n]+ of the visual attention budget\.",
        r"Hero should be visually dominant\.",
        r"Hero should occupy [^\n]+\.",
    )
    for pat in patterns:
        if re.search(pat, blob):
            return re.sub(pat, rule, blob, count=1)
    return _insert_hard_rule(blob, rule)


def build_skill_ab_experiment(
    *,
    skill_key: str,
    current_md: str,
    base_version: str = "12",
    variant_a: dict[str, Any] | None = None,
    variant_b: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create Vn-A / Vn-B Skill markdown variants. Does not write production."""
    key = str(skill_key or "").strip()
    base_v = str(base_version or "12").strip() or "12"
    a_in = variant_a if isinstance(variant_a, dict) else {}
    b_in = variant_b if isinstance(variant_b, dict) else {}
    # Spec default: poster_craft V12-A Hero 60–80% vs V12-B Hero 55–75%.
    a_band = str(a_in.get("hero_band") or "60–80%").strip()
    b_band = str(b_in.get("hero_band") or "55–75%").strip()
    a_id = str(a_in.get("id") or f"V{base_v}-A").strip()
    b_id = str(b_in.get("id") or f"V{base_v}-B").strip()
    a_md = str(a_in.get("md") or "").strip() or _replace_or_insert_hero_band(
        current_md, a_band
    )
    b_md = str(b_in.get("md") or "").strip() or _replace_or_insert_hero_band(
        current_md, b_band
    )
    return {
        "status": "running",
        "skill_key": key,
        "base_version": base_v,
        "variants": [
            {
                "id": a_id,
                "label": str(a_in.get("label") or f"Hero {a_band}"),
                "hero_band": a_band,
                "md": a_md,
            },
            {
                "id": b_id,
                "label": str(b_in.get("label") or f"Hero {b_band}"),
                "hero_band": b_band,
                "md": b_md,
            },
        ],
        "task_count": 0,
        "scores": {},
        "winner_id": "",
        "candidate": None,
    }


def average_eval_review_total(eval_doc: Any) -> float | None:
    """Mean review.total across eval tasks (Runtime-owned score, not LLM claim)."""
    totals: list[float] = []
    for _tid, row in _iter_eval_task_rows(eval_doc):
        if not isinstance(row, dict):
            continue
        review = row.get("review") if isinstance(row.get("review"), dict) else {}
        raw = review.get("total")
        if raw is None:
            raw = row.get("total")
        try:
            totals.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not totals:
        return None
    return round(sum(totals) / len(totals), 4)


def compare_skill_ab(
    experiment: dict[str, Any],
    *,
    eval_a: Any = None,
    eval_b: Any = None,
    score_a: float | None = None,
    score_b: float | None = None,
    task_count: int | None = None,
) -> dict[str, Any]:
    """A/B score compare. Higher mean wins; ties → A (stable). Never deploys."""
    exp = dict(experiment or {})
    variants = [v for v in list(exp.get("variants") or []) if isinstance(v, dict)]
    if len(variants) < 2:
        return {
            **exp,
            "status": "error",
            "reason": "need_two_variants",
            "winner_id": "",
        }
    a_id = str(variants[0].get("id") or "A")
    b_id = str(variants[1].get("id") or "B")
    a_avg = score_a if score_a is not None else average_eval_review_total(eval_a)
    b_avg = score_b if score_b is not None else average_eval_review_total(eval_b)
    if a_avg is None or b_avg is None:
        return {
            **exp,
            "status": "error",
            "reason": "missing_scores",
            "scores": {a_id: a_avg, b_id: b_avg},
            "winner_id": "",
        }
    n = int(task_count or 0)
    if n <= 0:
        n_a = sum(1 for _ in _iter_eval_task_rows(eval_a)) if eval_a is not None else 0
        n_b = sum(1 for _ in _iter_eval_task_rows(eval_b)) if eval_b is not None else 0
        n = max(n_a, n_b, int(exp.get("task_count") or 0))
    winner = a_id if float(a_avg) >= float(b_avg) else b_id
    exp["status"] = "compared"
    exp["task_count"] = n
    exp["scores"] = {a_id: float(a_avg), b_id: float(b_avg)}
    exp["winner_id"] = winner
    exp["margin"] = round(abs(float(a_avg) - float(b_avg)), 4)
    return exp


def build_skill_ab_candidate(
    experiment: dict[str, Any],
    *,
    current_md: str = "",
) -> dict[str, Any]:
    """Winner → next-version Skill candidate (pending). Does not write production."""
    exp = experiment if isinstance(experiment, dict) else {}
    winner_id = str(exp.get("winner_id") or "").strip()
    variants = [v for v in list(exp.get("variants") or []) if isinstance(v, dict)]
    winner = next((v for v in variants if str(v.get("id") or "") == winner_id), None)
    if not winner:
        return {
            "status": "pending",
            "ok": False,
            "reason": "no_winner",
            "skill_key": str(exp.get("skill_key") or ""),
        }
    key = str(exp.get("skill_key") or "").strip()
    base_v = str(exp.get("base_version") or "12")
    if re.fullmatch(r"\d+", base_v):
        next_v = str(int(base_v) + 1)
    else:
        next_v = _bump_pack_version(base_v)
    proposed = str(winner.get("md") or "")
    current = str(current_md or "")
    if not current:
        other = next((v for v in variants if str(v.get("id") or "") != winner_id), None)
        current = str((other or {}).get("md") or proposed)
    rel = f"{key}/SKILL.md" if key else "SKILL.md"
    scores = exp.get("scores") if isinstance(exp.get("scores"), dict) else {}
    return {
        "status": "pending",
        "ok": True,
        "reason": "ab_winner_candidate",
        "skill_key": key,
        "base_version": base_v,
        "next_version": next_v,
        "winner_id": winner_id,
        "winner_label": str(winner.get("label") or ""),
        "hero_band": str(winner.get("hero_band") or ""),
        "ab_scores": dict(scores),
        "task_count": int(exp.get("task_count") or 0),
        "diff": _unified_skill_diff(current, proposed, path=rel),
        "current_md": current,
        "proposed_md": proposed,
        "approved_by": None,
        "source": "skill_ab",
    }


def promote_skill_ab_candidate(
    candidate: dict[str, Any],
    *,
    by: str = "human",
) -> dict[str, Any]:
    """Human promote gate for A/B winner. Still does not write production Skill."""
    src = candidate if isinstance(candidate, dict) else {}
    if not src.get("ok") and str(src.get("reason") or "") == "no_winner":
        return dict(src)
    return approve_skill_proposal(src, by=by)
