"""Prompt packs — seed under ``seeds/design_prompt_packs/`` (``_index.json`` + staged ``*.md``)."""
from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import resolve_seed_dir
from app import crud
from app.core.db import engine
from sqlmodel import Session

_PACKS_READY = False
_PACKS_LOCK = threading.RLock()

# Shared seed files: `<!-- pack:kind -->` then body until the next pack marker.
_PACK_SECTION_RE = re.compile(
    r"<!--\s*pack:([^\s]+?)\s*-->\s*\n?",
    re.MULTILINE,
)


def _safe_pack_kind(kind: str) -> str | None:
    k = str(kind or "").strip()
    if not k or "/" in k or "\\" in k or ".." in k:
        return None
    return k


def _safe_seed_relpath(rel: str) -> str | None:
    """Relative path under the packs root (no escape)."""
    raw = str(rel or "").strip().replace("\\", "/")
    if not raw or raw.startswith("/") or ".." in raw.split("/"):
        return None
    return raw


def _parse_pack_sections(text: str) -> dict[str, str]:
    """Split a staged markdown file into kind → body."""
    matches = list(_PACK_SECTION_RE.finditer(text))
    if not matches:
        return {}
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        kind = _safe_pack_kind(m.group(1))
        if not kind:
            continue
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[kind] = text[start:end].strip("\n")
        if out[kind]:
            out[kind] += "\n"
    return out


def _parse_pack_index(parsed: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    labels_raw = parsed.get("kindLabels") or {}
    labels = (
        {str(k): str(v) for k, v in labels_raw.items()}
        if isinstance(labels_raw, dict)
        else {}
    )
    items_raw = parsed.get("items") or []
    items = (
        [x for x in items_raw if isinstance(x, dict)]
        if isinstance(items_raw, list)
        else []
    )
    return labels, items


def _attach_bodies_from_dir(
    root: Path, items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Load bodies from ``item.file`` section files."""
    section_cache: dict[str, dict[str, str]] = {}
    out: list[dict[str, Any]] = []

    def sections_for(rel: str) -> dict[str, str]:
        if rel in section_cache:
            return section_cache[rel]
        path = root / rel
        parsed: dict[str, str] = {}
        if path.is_file():
            try:
                parsed = _parse_pack_sections(path.read_text(encoding="utf-8"))
            except Exception:
                parsed = {}
        section_cache[rel] = parsed
        return parsed

    for item in items:
        kind = _safe_pack_kind(item.get("kind"))
        if not kind:
            continue
        body = ""
        rel = _safe_seed_relpath(str(item.get("file") or ""))
        if rel:
            body = sections_for(rel).get(kind) or ""
        merged = dict(item)
        merged["kind"] = kind
        merged["body"] = body
        out.append(merged)
    return out


def _load_prompt_packs_seed() -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Load ``design_prompt_packs/_index.json`` + staged markdown bodies."""
    root = resolve_seed_dir("design_prompt_packs")
    index_path = root / "_index.json"
    if index_path.is_file():
        try:
            parsed = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            labels, items = _parse_pack_index(parsed)
            return labels, _attach_bodies_from_dir(root, items)

    return {}, []


KIND_LABELS, _SEED = _load_prompt_packs_seed()

_SEED_BY_KIND: dict[str, dict[str, Any]] = {
    str(item.get("kind") or "").strip(): item
    for item in _SEED
    if str(item.get("kind") or "").strip()
}


def db_prompt_body(key: str) -> str:
    """Enabled body from ``design_prompt_pack``. No seed fallback."""
    kind = str(key or "").strip()
    if not kind:
        return ""
    with Session(engine) as session:
        body = crud.get_design_prompt_pack_body(session=session, kind=kind)
        if body:
            return body
        return ""


def seed_prompt_body(key: str) -> str:
    """Local bootstrap only — use when DB has no non-empty body for this key."""
    item = _SEED_BY_KIND.get(str(key or "").strip())
    if not item:
        return ""
    return str(item.get("body") or "").strip()


def resolve_prompt_body(key: str, *, rules: dict[str, str] | None = None) -> str:
    """DB / rules first; local seed only if both empty. Raw body (no variable fill)."""
    k = str(key or "").strip()
    if not k:
        return ""
    if rules is not None:
        from app.services.design.prompts.rules_text import _rule_text

        got = _rule_text(rules, k).strip()
        if got:
            return got
    got = db_prompt_body(k)
    if got:
        return got
    return seed_prompt_body(k)


def render_prompt_body(
    key: str,
    *,
    rules: dict[str, str] | None = None,
    **variables: Any,
) -> str:
    """Admin/DB pack → LangChain ``PromptTemplate`` render (all kinds).

    Data source stays ``design_prompt_pack`` / seed / rules; LC only fills
    ``{placeholders}``. Packs without variables still pass through LC.
    """
    from app.services.design.prompts.rules_text import render_prompt_template

    body = resolve_prompt_body(key, rules=rules)
    if not body:
        return ""
    return render_prompt_template(body, **variables)


def _csv_has(csv: str, token: str) -> bool:
    """True only when csv lists token, or explicitly lists ``all``. Empty csv → False."""
    parts = {p.strip().lower() for p in str(csv or "").split(",") if p.strip()}
    if not parts:
        return False
    if "all" in parts:
        return True
    return bool(token) and token.strip().lower() in parts


# Methodology packs migrated to design_skill (need_skills).
_NEED_PROMPT_KINDS = frozenset()

PACK_TYPE_NEED = "need"
PACK_TYPE_SYSTEM = "system"
# Short UI/injection snippets (headers, empty states) — not stage system prompts.
PACK_TYPE_TEMPLATE = "template"
_PACK_TYPES = frozenset({PACK_TYPE_NEED, PACK_TYPE_SYSTEM, PACK_TYPE_TEMPLATE})

# Graph / product stages — Admin filter + seed ``usedBy``.
PROMPT_PACK_STAGES = (
    "bootstrap",
    "memory",
    "intent",
    "decide",
    "paint",
    "apply",
    "observe",
    "settle",
    "orchestrator",
    "resources",
    "precheck",
    "persona",
)
_PROMPT_PACK_STAGES = frozenset(PROMPT_PACK_STAGES)


def normalize_used_by(raw: Any) -> list[str]:
    """CSV / list → ordered unique stage codes."""
    parts: list[str] = []
    if isinstance(raw, (list, tuple)):
        parts = [str(x or "").strip().lower() for x in raw]
    else:
        parts = [
            p.strip().lower()
            for p in str(raw or "").replace(";", ",").split(",")
            if p.strip()
        ]
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if p not in _PROMPT_PACK_STAGES or p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def used_by_csv(raw: Any) -> str:
    return ",".join(normalize_used_by(raw))


def normalize_pack_type(raw: Any, *, kind: str = "") -> str:
    t = str(raw or "").strip().lower()
    if t in _PACK_TYPES:
        return t
    try:
        from app.services.design.prompts.system_prompt_store import is_system_prompt_key

        if is_system_prompt_key(kind):
            return PACK_TYPE_SYSTEM
    except Exception:
        pass
    if str(kind or "").strip().lower() in _NEED_PROMPT_KINDS:
        return PACK_TYPE_NEED
    return PACK_TYPE_NEED if not t else PACK_TYPE_NEED


# Retired scene-category packs (classification never covers all cases).
_OBSOLETE_SCENE_KINDS = frozenset(
    {
        "website",
        "mobile",
        "poster",
        "image",
        "drawing",
        "ecommerce",
        "detail_page",
        "rollup",
        "banner",
        "social",
        "leaflet",
        "card",
        # Retired knowledge / aesthetics packs (removed from seed).
        "agent.prompt.pending_knowledge",
        "agent.prompt.knowledge_details_header",
        "agent.prompt.knowledge_catalog_header",
        "agent.prompt.knowledge_catalog_empty",
        "agent.prompt.knowledge_when_line",
        "agent.prompt.prompt_packs_retired_catalog",
        "agent.prompt.pending_aesthetics",
    }
)


def is_need_prompt_kind(kind: str) -> bool:
    return str(kind or "").strip().lower() in _NEED_PROMPT_KINDS


def is_need_pack(row: dict[str, Any]) -> bool:
    """Need pack is determined by pack ``type`` code."""
    t = str(row.get("pack_type") or "").strip().lower()
    return t == PACK_TYPE_NEED


def _pub(r: Any) -> dict[str, Any]:
    def _get(key: str, default: Any = None) -> Any:
        if hasattr(r, key):
            return getattr(r, key)
        try:
            return r[key]
        except Exception:
            return default

    kind = str(_get("kind") or "")
    raw_type = str(_get("pack_type") or "")
    pack_type = normalize_pack_type(raw_type, kind=kind)
    raw_used = str(_get("used_by") or "")
    used_by = normalize_used_by(raw_used)
    updated = _get("updated_at")
    return {
        "id": int(_get("id") or 0),
        "kind": kind,
        "type": pack_type,
        "title": str(_get("title") or ""),
        "body": str(_get("body") or ""),
        "whenToUse": str(_get("when_to_use") or ""),
        "scenes": str(_get("scenes") or ""),
        "usedBy": used_by,
        "sortOrder": int(_get("sort_order") or 0),
        "enabled": bool(int(_get("enabled") or 0)),
        "updatedAt": int(float(updated) * 1000) if updated else None,
    }


def _prune_prompt_packs_to_seed(session: Session, *, now: float) -> None:
    """Drop obsolete scene packs; leave system keys alone."""
    del now
    from app.models import DesignPromptPack

    drop_kinds = set(_OBSOLETE_SCENE_KINDS)
    if drop_kinds:
        crud.delete_design_prompt_packs_by_kinds(session=session, kinds=drop_kinds)

    seed_by_kind = {
        str(item.get("kind") or "").strip(): item
        for item in _SEED
        if str(item.get("kind") or "").strip() in _NEED_PROMPT_KINDS
    }
    for kind, item in seed_by_kind.items():
        rows = crud.list_design_prompt_packs_by_kind(session=session, kind=kind)
        seed_title = str(item.get("title") or KIND_LABELS.get(kind, kind))
        if not rows:
            pack_type = normalize_pack_type(item.get("type"), kind=kind)
            t = time.time()
            session.add(
                DesignPromptPack(
                    kind=kind,
                    pack_type=pack_type,
                    title=seed_title,
                    body=str(item.get("body") or ""),
                    when_to_use=str(item.get("when_to_use") or ""),
                    scenes=str(item.get("scenes") or ""),
                    sort_order=int(item.get("sort_order") or 0),
                    enabled=1,
                    created_at=t,
                    updated_at=t,
                )
            )
            continue
        # Keep one row; ensure pack_type = need for these kinds.
        keep_id: int | None = None
        for row in rows:
            if str(row.title or "") == seed_title:
                keep_id = int(row.id or 0)
                break
        if keep_id is None:
            keep = max(rows, key=lambda r: len(str(r.body or "")))
            keep_id = int(keep.id or 0)
        for row in rows:
            rid = int(row.id or 0)
            if rid != keep_id:
                session.delete(row)
            elif rid == keep_id:
                row.pack_type = PACK_TYPE_NEED
                session.add(row)




def _sync_system_prompts_into_packs(session: Session, *, now: float) -> None:
    """One-way migrate design_system_prompt → packs (kind = prompt_key). Skip existing kinds."""
    from app.models import DesignPromptPack

    try:
        rows = crud.list_all_design_system_prompts(session=session)
    except Exception:
        return
    existing = crud.list_design_prompt_pack_kinds(session=session)
    for row in rows:
        key = str(row.prompt_key or "").strip()
        if not key or key in existing:
            continue
        title = str(row.label or "").strip() or key
        body = str(row.body or "")
        when = str(row.description or "").strip()
        sort_order = int(row.sort_order or 0)
        enabled = 1 if int(row.enabled or 0) else 0
        session.add(
            DesignPromptPack(
                kind=key,
                pack_type=PACK_TYPE_SYSTEM,
                title=title,
                body=body,
                when_to_use=when,
                scenes="",
                sort_order=sort_order,
                enabled=enabled,
                created_at=now,
                updated_at=now,
            )
        )
        existing.add(key)


def _norm_pack_text(value: str) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _apply_seed_fields_to_row(row: Any, seed_item: dict[str, Any], *, kind: str, now: float) -> bool:
    """Sync pack row fields from seed; return True when anything changed."""
    changed = False
    want_type = normalize_pack_type(seed_item.get("type"), kind=kind)
    if str(row.pack_type or "").strip().lower() != want_type:
        row.pack_type = want_type
        changed = True
    want_title = (
        str(seed_item.get("title") or KIND_LABELS.get(kind, kind)).strip() or kind
    )
    if str(row.title or "").strip() != want_title:
        row.title = want_title
        changed = True
    want_when = str(seed_item.get("when_to_use") or "")
    if _norm_pack_text(row.when_to_use or "") != _norm_pack_text(want_when):
        row.when_to_use = want_when
        changed = True
    want_scenes = str(seed_item.get("scenes") or "") or ""
    if str(row.scenes or "").strip() != want_scenes:
        row.scenes = want_scenes
        changed = True
    want_used = used_by_csv(seed_item.get("usedBy"))
    if str(row.used_by or "").strip() != want_used:
        row.used_by = want_used
        changed = True
    want_sort = int(seed_item.get("sort_order") or 0)
    if int(row.sort_order or 0) != want_sort:
        row.sort_order = want_sort
        changed = True
    seed_body = str(seed_item.get("body") or "")
    if _norm_pack_text(row.body or "") != _norm_pack_text(seed_body):
        row.body = seed_body
        changed = True
    if changed:
        row.updated_at = now
    return changed


def ensure_design_prompt_packs() -> None:
    """Upsert packs from ``seeds/design_prompt_packs/`` and prune junk.

    Git seed is source of truth for body / title / when / scenes / used_by / pack_type /
    sort_order. Admin UI edits are overwritten on the next ensure (API boot).
    """
    global _PACKS_READY
    now = time.time()
    with _PACKS_LOCK:
        from app.models import DesignPromptPack
        from app.services.db import init_schema
        from app.services.design.admin.schema import ensure_design_tables_boot

        # Cold unit tests may hit this before FastAPI lifespan — create tables first.
        init_schema()
        ensure_design_tables_boot()

        with Session(engine) as session:
            _prune_prompt_packs_to_seed(session, now=now)
            _sync_system_prompts_into_packs(session, now=now)
            existing_kinds = crud.list_design_prompt_pack_kinds(session=session)
            for item in _SEED:
                kind = str(item.get("kind") or "").strip()
                if not kind or kind in existing_kinds:
                    continue
                title = str(item.get("title") or KIND_LABELS.get(kind, kind)).strip() or kind
                pack_type = normalize_pack_type(item.get("type"), kind=kind)
                used_by = used_by_csv(item.get("usedBy"))
                session.add(
                    DesignPromptPack(
                        kind=kind,
                        pack_type=pack_type,
                        title=title,
                        body=str(item.get("body") or ""),
                        when_to_use=str(item.get("when_to_use") or ""),
                        scenes=str(item.get("scenes") or ""),
                        used_by=used_by,
                        sort_order=int(item.get("sort_order") or 0),
                        enabled=1,
                        created_at=now,
                        updated_at=now,
                    )
                )
                existing_kinds.add(kind)
            # Seed wins: keep DB rows aligned with staged md + _index.
            for row in crud.list_all_design_prompt_packs(session=session):
                kind = str(row.kind or "")
                seed_item = _SEED_BY_KIND.get(kind)
                if not seed_item:
                    continue
                if _apply_seed_fields_to_row(row, seed_item, kind=kind, now=now):
                    session.add(row)
            session.commit()
        _PACKS_READY = True


def list_prompt_pack_bodies_for_system(*, ensure: bool = True) -> dict[str, str]:
    """Packs whose kind is a system prompt key → body (Admin 系统提示词 / pack table)."""
    if ensure:
        ensure_design_prompt_packs()
    from app.services.design.prompts.system_prompt_store import is_system_prompt_key

    with Session(engine) as session:
        rows = crud.list_enabled_design_prompt_pack_bodies(session=session)
    out: dict[str, str] = {}
    for kind, body in rows:
        if not is_system_prompt_key(kind):
            continue
        out[kind] = body
    return out
