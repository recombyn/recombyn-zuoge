"""Runtime catalog, allowlists, triggers, and row parsers."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core import db as core_db

from . import constants as _c
from .constants import (
    MAX_SKILL_DETAIL_CHARS,
    NS_CORE,
    NS_EXT,
    NS_USER,
    SOURCE_ADMIN,
    SOURCE_FILE,
    _ALWAYS_ALLOW_OPS,
    _DISK_SIGNATURE,
    _INTERNAL_RESOURCE_KINDS,
    _RUNTIME_SKILL_INDEX,
    _RUNTIME_SKILL_KEYS,
    _SKILL_CATEGORY_BUDGET,
    _SKILL_CATEGORY_ORDER,
    _SKILL_GRAPH,
    _SKILLS_READY,
    _SOURCE_TO_NS,
)
from .keys import (
    _normalize_namespace,
    _normalize_source,
    parse_skill_pin,
    qualify_skill_key,
    skill_kind_for_namespace,
    split_namespace_key,
)
from .pack_io import _SEED_BY_KEY
from .schema import _parse_json_object, validate_against_schema

logger = logging.getLogger(__name__)


def runtime_skill_keys() -> frozenset[str]:
    if _c._RUNTIME_SKILL_KEYS is not None:
        return _c._RUNTIME_SKILL_KEYS
    keys = {str(k).strip() for k in _SEED_BY_KEY if str(k).strip()}
    try:
        with Session(core_db.engine) as session:
            rows = crud.list_design_skill_keys_enabled(session=session)
            for k, _ns_raw in rows:
                k = str(k or "").strip()
                if not k:
                    continue
                keys.add(k)
    except Exception:
        pass
    _c._RUNTIME_SKILL_KEYS = frozenset(keys)
    return _c._RUNTIME_SKILL_KEYS


def invalidate_skill_key_cache() -> None:
    _c._RUNTIME_SKILL_KEYS = None
    _c._RUNTIME_SKILL_INDEX = None


def reset_skills_ready_for_tests() -> None:
    """Test helper: force ensure_design_skills to run again."""
    from .ensure import stop_skills_hot_reload

    stop_skills_hot_reload()
    _c._SKILLS_READY = False
    _c._RUNTIME_SKILL_KEYS = None
    _c._RUNTIME_SKILL_INDEX = None
    _c._DISK_SIGNATURE = None


def _csv_has(csv: str, token: str) -> bool:
    """True only when csv lists token, or explicitly lists ``all``. Empty csv → False."""
    parts = {p.strip().lower() for p in str(csv or "").split(",") if p.strip()}
    if not parts:
        return False
    if "all" in parts:
        return True
    return bool(token) and token.strip().lower() in parts

def _row_get(r: Any, key: str, default: Any = None) -> Any:
    try:
        if hasattr(r, "keys") and key in r.keys():
            return r[key]
    except Exception:
        pass
    if isinstance(r, dict):
        return r.get(key, default)
    if hasattr(r, key):
        try:
            return getattr(r, key)
        except Exception:
            return default
    return default

def _parse_preferred_tools(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()][:24]
    s = str(raw or "").strip()
    if not s:
        return []
    try:
        val = json.loads(s)
        if isinstance(val, list):
            return [str(x).strip() for x in val if str(x).strip()][:24]
    except Exception:
        pass
    return [p.strip() for p in s.replace("；", ",").split(",") if p.strip()][:24]

def _parse_allowed_resources(raw: Any) -> list[str] | None:
    """None = unspecified; list may be empty (= deny all internal resources)."""
    if raw is None:
        return None
    if isinstance(raw, list):
        out = []
        for x in raw:
            k = str(x or "").strip().lower()
            if k in _INTERNAL_RESOURCE_KINDS and k not in out:
                out.append(k)
        return out
    s = str(raw or "").strip()
    if not s:
        return []
    try:
        val = json.loads(s)
        if isinstance(val, list):
            return _parse_allowed_resources(val)
    except Exception:
        pass
    parts = [p.strip().lower() for p in s.replace("；", ",").split(",") if p.strip()]
    return [p for p in parts if p in _INTERNAL_RESOURCE_KINDS]

def _parse_triggers(raw: Any) -> list[dict[str, Any]]:
    if raw is None or raw is False:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    s = str(raw or "").strip()
    if not s:
        return []
    try:
        val = json.loads(s)
    except Exception:
        return []
    if isinstance(val, dict):
        return [val]
    if isinstance(val, list):
        return [x for x in val if isinstance(x, dict)]
    return []

def _load_user_skill_prefs(user_id: str) -> dict[str, bool]:
    """skill_key(lower) → enabled for this user (missing = default on)."""
    from .ensure import ensure_design_skills

    uid = str(user_id or "").strip()
    if not uid:
        return {}
    ensure_design_skills()
    with Session(core_db.engine) as session:
        rows = crud.list_user_skill_prefs(session=session, user_id=uid)
    out: dict[str, bool] = {}
    for r in rows:
        key = str(_row_get(r, "skill_key") or "").strip().lower()
        if not key:
            continue
        out[key] = bool(int(_row_get(r, "enabled") or 0))
    return out

def _pub(r: Any) -> dict[str, Any]:
    key = str(_row_get(r, "skill_key") or "").strip()
    preferred = _parse_preferred_tools(_row_get(r, "preferred_tools"))
    triggers = _parse_triggers(_row_get(r, "triggers"))
    source = _normalize_source(_row_get(r, "source"), default=SOURCE_ADMIN)
    namespace = _normalize_namespace(_row_get(r, "namespace"), source=source)
    allowed_resources = _parse_allowed_resources(_row_get(r, "allowed_resources"))
    input_schema = _parse_json_object(_row_get(r, "input_schema"))
    output_schema = _parse_json_object(_row_get(r, "output_schema"))
    locales_raw = _row_get(r, "locales")
    locales: dict[str, Any] = {}
    if isinstance(locales_raw, dict):
        locales = locales_raw
    elif locales_raw:
        try:
            val = json.loads(str(locales_raw))
            if isinstance(val, dict):
                locales = val
        except Exception:
            locales = {}
    ns_prefix, local = split_namespace_key(key)
    qualified = key if ns_prefix else f"{namespace}.{key}" if key else ""
    return {
        "id": int(_row_get(r, "id") or 0),
        "skillKey": key or None,
        "qualifiedKey": qualified or None,
        "name": str(_row_get(r, "name") or ""),
        "description": str(_row_get(r, "description") or ""),
        "category": str(_row_get(r, "category") or ""),
        "whenToUse": str(_row_get(r, "when_to_use") or ""),
        "promptPositive": str(_row_get(r, "prompt_positive") or ""),
        "promptNegative": str(_row_get(r, "prompt_negative") or ""),
        "preferredTools": preferred,
        "allowedResources": allowed_resources,
        "inputSchema": input_schema,
        "outputSchema": output_schema,
        "triggers": triggers,
        "mutexGroup": str(_row_get(r, "mutex_group") or "").strip() or None,
        "extends": list((_SKILL_GRAPH.get(key.lower()) or {}).get("extends") or []),
        "contextMode": str(
            (_SKILL_GRAPH.get(key.lower()) or {}).get("context_mode") or "full"
        ),
        "version": int(_row_get(r, "version") or 1),
        "packVersion": str(_row_get(r, "pack_version") or "").strip() or None,
        "logo": str(_row_get(r, "logo") or "").strip() or None,
        "locales": locales,
        "source": source,
        "namespace": namespace,
        "skillKind": skill_kind_for_namespace(namespace),
        "ownerUserId": str(_row_get(r, "owner_user_id") or "").strip() or None,
        "sortWeight": int(_row_get(r, "sort_weight") or 0),
        "scenes": str(_row_get(r, "scenes") or ""),
        "enabled": bool(int(_row_get(r, "enabled") or 0)),
        "_localKey": local or key,
    }

def list_runtime_skills(
    *,
    scene: str = "",
    enabled_only: bool = True,
    user_id: str | None = None,
    namespaces: list[str] | tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    from .ensure import ensure_design_skills

    ensure_design_skills()
    scene_l = str(scene or "").strip().lower()
    uid = str(user_id or "").strip() or None
    prefs = _load_user_skill_prefs(uid) if uid else {}
    allow_ns: set[str] | None = None
    if namespaces is not None:
        allow_ns = {
            str(x).strip().lower()
            for x in namespaces
            if str(x or "").strip()
        }
        if not allow_ns:
            allow_ns = None
    with Session(core_db.engine) as session:
        rows = crud.list_design_skills_runtime(
            session=session, enabled_only=enabled_only
        )
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        item = _pub(r)
        key = str(item.get("skillKey") or "").strip()
        if not key or key in seen:
            continue
        ns = str(item.get("namespace") or NS_USER)
        if allow_ns is not None and ns not in allow_ns:
            continue
        owner = str(item.get("ownerUserId") or "").strip() or None
        # User-owned extension skills are isolated to that user.
        if ns == NS_USER and owner and uid and owner != uid:
            continue
        if ns == NS_USER and owner and not uid:
            continue
        if not _csv_has(str(item.get("scenes") or ""), scene_l):
            continue
        # Per-user off switch (official + others); missing pref = on.
        if enabled_only and prefs and prefs.get(key.lower()) is False:
            continue
        seen.add(key)
        out.append(item)
    return out

def resolve_storage_skill_key(raw: str, *, scene: str = "") -> str | None:
    """Map bare / namespaced refs onto the storage skill_key."""
    base, _, _ = parse_skill_pin(raw)
    s = base.strip().lower()
    if not s:
        return None
    ns, local = split_namespace_key(s)
    rows = list_runtime_skills(scene=scene, enabled_only=True)
    by_key = {str(r.get("skillKey") or "").strip().lower(): r for r in rows}

    def _match(want_ns: str | None, want_local: str) -> str | None:
        # Exact storage key
        if want_local in by_key and (
            want_ns is None or str(by_key[want_local].get("namespace")) == want_ns
        ):
            return want_local
        qualified = f"{want_ns}.{want_local}" if want_ns else ""
        if qualified and qualified in by_key:
            return qualified
        for k, row in by_key.items():
            row_ns = str(row.get("namespace") or "")
            row_local = str(row.get("_localKey") or k).lower()
            if want_ns and row_ns != want_ns:
                continue
            if row_local == want_local or k == want_local or k.endswith(f".{want_local}"):
                return k
        return None

    if ns:
        hit = _match(ns, local)
        if hit:
            return hit
        return None
    # Bare: prefer core → ext → user
    for prefer in (NS_CORE, NS_EXT, NS_USER):
        hit = _match(prefer, local)
        if hit:
            return hit
    if local in by_key:
        return local
    return None

def _apply_mutex(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep highest sortWeight per mutex_group (rows already weight-desc)."""
    seen_g: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        g = str(r.get("mutexGroup") or "").strip().lower()
        if g:
            if g in seen_g:
                continue
            seen_g.add(g)
        out.append(r)
    return out

def format_skills_catalog(
    *,
    scene: str = "",
    user_id: str | None = None,
    namespaces: list[str] | tuple[str, ...] | None = None,
) -> str:
    rows = list_runtime_skills(scene=scene, user_id=user_id, namespaces=namespaces)
    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    header = render_prompt_body("agent.prompt.skill_catalog_header").strip()
    lines = [header] if header else []
    for r in rows:
        key = str(r.get("skillKey") or "").strip()
        if not key:
            continue
        name = str(r.get("name") or key).strip()
        when = str(r.get("whenToUse") or "").strip()
        ver = int(r.get("version") or 1)
        ns = str(r.get("namespace") or NS_USER)
        kind = str(r.get("skillKind") or skill_kind_for_namespace(ns))
        line = f"- `{key}` [{ns}/{kind}] v{ver} — {name}"
        if when:
            line += f"（{when[:80]}）"
        lines.append(line)
        if len(lines) >= 16:
            break
    if len(lines) <= (1 if header else 0):
        empty = render_prompt_body("agent.prompt.skill_catalog_empty").strip()
        if empty:
            lines.append(empty)
    return "\n".join(lines)

def _load_skill_revision_snapshot(
    *,
    skill_key: str,
    version: int | None = None,
    pack_version: str | None = None,
) -> dict[str, Any] | None:
    key = str(skill_key or "").strip()
    if not key:
        return None
    try:
        with Session(core_db.engine) as session:
            raw = crud.get_design_skill_revision_snapshot(
                session=session,
                skill_key=key,
                version=version,
                pack_version=pack_version,
            )
        if not raw:
            return None
        snap = _parse_json_object(raw)
        return snap
    except Exception:
        return None


def _pin_is_numeric(pin: Any) -> bool:
    return isinstance(pin, int) or str(pin).isdigit()


def _apply_skill_pin(
    row: dict[str, Any],
    *,
    storage: str,
    pin: Any,
    errs: list[str],
) -> dict[str, Any] | None:
    """Merge pinned revision into row. Returns None when pin miss should skip the skill."""
    if pin is None:
        return row
    numeric = _pin_is_numeric(pin)
    snap = _load_skill_revision_snapshot(
        skill_key=storage,
        version=int(pin) if numeric else None,
        pack_version=None if numeric else str(pin),
    )
    if snap:
        return {**row, **snap, "skillKey": storage}
    # Pin miss: refuse silent upgrade to a different revision.
    cur = int(row.get("version") or 0)
    if numeric:
        if int(pin) != cur:
            errs.append(f"skill_version_missing:{storage}@{pin}")
            return None
        return row
    if str(row.get("packVersion") or "") != str(pin):
        errs.append(f"skill_pack_version_missing:{storage}@{pin}")
        return None
    return row


def save_skill_revision(session: Session, *, skill_id: int, item: dict[str, Any]) -> None:
    """Persist a version snapshot (best-effort; never breaks upsert)."""
    try:
        key = str(item.get("skillKey") or "").strip()
        if not key:
            return
        ver = int(item.get("version") or 1)
        snap = {
            k: item.get(k)
            for k in (
                "skillKey",
                "name",
                "description",
                "category",
                "whenToUse",
                "promptPositive",
                "promptNegative",
                "preferredTools",
                "allowedResources",
                "inputSchema",
                "outputSchema",
                "triggers",
                "mutexGroup",
                "version",
                "packVersion",
                "namespace",
                "source",
                "scenes",
                "sortWeight",
            )
        }
        crud.insert_design_skill_revision(
            session=session,
            skill_id=int(skill_id),
            skill_key=key,
            namespace=str(item.get("namespace") or NS_USER),
            version=ver,
            pack_version=str(item.get("packVersion") or "")
            or None,
            snapshot=json.dumps(snap, ensure_ascii=False),
            source=str(item.get("source") or SOURCE_ADMIN),
            created_at=time.time(),
            commit=False,
        )
    except Exception:
        logger.debug("skill revision save failed", exc_info=True)

def expand_skill_extends(
    keys: list[str],
    *,
    scene: str = "",
    max_depth: int = 6,
) -> list[str]:
    """Resolve surface → extends: dedupe, BFS, category-stable order.

    Order: foundation → brand → craft → surface → qa.
    Decide still picks one surface; Host expands Core without dumping every body.
    """
    wanted = [str(k).strip() for k in (keys or []) if str(k).strip()]
    if not wanted or any(k in ("*", "all") for k in wanted):
        return wanted

    # Soft cycle guard during expand (hard fail happens at pack load).
    path_stack: list[str] = []
    ordered: list[str] = []
    seen: set[str] = set()
    queue: list[tuple[str, int]] = []

    for raw in wanted:
        base, _pin_i, _pin_p = parse_skill_pin(raw)
        storage = resolve_storage_skill_key(base, scene=scene) or base
        storage_l = str(storage).strip().lower()
        if not storage_l or storage_l in seen:
            continue
        seen.add(storage_l)
        ordered.append(storage_l)
        queue.append((storage_l, 0))

    while queue:
        key, depth = queue.pop(0)
        if depth >= max_depth:
            continue
        if key in path_stack:
            continue
        path_stack.append(key)
        graph = _SKILL_GRAPH.get(key) or {}
        for dep in list(graph.get("extends") or []):
            dep_l = str(dep or "").strip().lower()
            if not dep_l:
                continue
            resolved = resolve_storage_skill_key(dep_l, scene=scene) or dep_l
            resolved_l = str(resolved).strip().lower()
            if not resolved_l or resolved_l in seen:
                continue
            if resolved_l in path_stack:
                continue
            seen.add(resolved_l)
            ordered.append(resolved_l)
            queue.append((resolved_l, depth + 1))
        path_stack.pop()

    def sort_key(skill_key: str) -> tuple[int, str]:
        cat = str((_SKILL_GRAPH.get(skill_key) or {}).get("category") or "agent").lower()
        return (_SKILL_CATEGORY_ORDER.get(cat, 50), skill_key)

    return sorted(ordered, key=sort_key)


def _skill_graph_for_row(row: dict[str, Any]) -> dict[str, Any]:
    key = str(row.get("skillKey") or row.get("skill_key") or "").strip().lower()
    return dict(_SKILL_GRAPH.get(key) or {})


def _skill_scope(row: dict[str, Any]) -> frozenset[str]:
    graph = _skill_graph_for_row(row)
    raw = graph.get("scope") if graph.get("scope") is not None else row.get("scope")
    if isinstance(raw, str):
        parts = [p.strip().lower() for p in raw.replace(",", " ").split() if p.strip()]
    elif isinstance(raw, list):
        parts = [str(x).strip().lower() for x in raw if str(x).strip()]
    else:
        parts = []
    allowed = {p for p in parts if p in ("plan", "paint", "review")}
    if not allowed:
        return frozenset({"plan", "paint", "review"})
    return frozenset(allowed)


def _skill_in_stage(row: dict[str, Any], stage: str) -> bool:
    want = str(stage or "").strip().lower()
    if not want:
        return True
    return want in _skill_scope(row)


def _required_context_ready(
    row: dict[str, Any], *, has_design_brief: bool
) -> bool:
    graph = _skill_graph_for_row(row)
    required = graph.get("required_context") or []
    if not isinstance(required, list):
        return True
    if "design_brief" in {str(x).strip().lower() for x in required} and not has_design_brief:
        return False
    return True


def _skill_body_for_context(row: dict[str, Any], *, role: str = "paint") -> str:
    """Pick full / rules / review body to avoid qa prompt bloat."""
    key = str(row.get("skillKey") or "").strip().lower()
    graph = _SKILL_GRAPH.get(key) or {}
    category = str(row.get("category") or graph.get("category") or "agent").lower()
    mode = str(row.get("contextMode") or "full").lower()
    body = str(row.get("promptPositive") or "").strip()
    rules = str(graph.get("rules_excerpt") or "").strip()
    review_docs = str(graph.get("review_docs") or "").strip()

    if role == "review":
        if category == "qa" and review_docs:
            return review_docs[:2000]
        if category == "qa" and rules:
            return rules
        return body

    # paint path — compress qa / rules-mode skills
    if category == "qa" or mode in ("rules", "compact"):
        return rules or body[:700]
    if mode == "review":
        return rules or body[:700]
    return body


def _skill_available_for_context(
    row: dict[str, Any], *, role: str, stage: str = ""
) -> bool:
    """Skip review-only context_mode on paint; honor _meta.json scope."""
    mode = str(row.get("contextMode") or "full").lower()
    if role == "paint" and mode == "review":
        return False
    if stage and not _skill_in_stage(row, stage):
        return False
    return True


def format_skills_details(
    *,
    keys: list[str],
    scene: str = "",
    max_chars: int = MAX_SKILL_DETAIL_CHARS,
    user_id: str | None = None,
    version_pins: dict[str, int | str] | None = None,
    input_args: dict[str, Any] | None = None,
    role: str = "paint",
    stage: str = "",
    has_design_brief: bool = True,
) -> str:
    text, _errs = format_skills_details_checked(
        keys=keys,
        scene=scene,
        max_chars=max_chars,
        user_id=user_id,
        version_pins=version_pins,
        input_args=input_args,
        role=role,
        stage=stage,
        has_design_brief=has_design_brief,
    )
    return text

def format_skills_details_checked(
    *,
    keys: list[str],
    scene: str = "",
    max_chars: int = MAX_SKILL_DETAIL_CHARS,
    user_id: str | None = None,
    version_pins: dict[str, int | str] | None = None,
    input_args: dict[str, Any] | None = None,
    role: str = "paint",
    stage: str = "",
    has_design_brief: bool = True,
) -> tuple[str, list[str]]:
    """Return (details_markdown, validation_errors).

    Expands ``extends``, dedupes, sorts by category, and applies per-category
    char budgets so Core qa skills do not dump full review curricula into Paint.
    """
    wanted_raw = [str(k).strip() for k in (keys or []) if str(k).strip()]
    if not wanted_raw:
        return "", []
    load_all = any(k in ("*", "all") for k in wanted_raw)
    expanded = wanted_raw if load_all else expand_skill_extends(wanted_raw, scene=scene)
    pins = version_pins or {}
    args_by_key = input_args or {}
    errs: list[str] = []
    resolved: list[dict[str, Any]] = []
    runtime = list_runtime_skills(scene=scene, user_id=user_id)
    by_key = {str(r.get("skillKey") or "").strip().lower(): r for r in runtime}

    if load_all:
        resolved = list(runtime)
    else:
        for storage in expanded:
            row = dict(by_key.get(storage) or {})
            if not row:
                # Extends target missing — soft-skip (surface may still paint).
                if storage not in {str(k).strip().lower() for k in wanted_raw}:
                    continue
                errs.append(f"skill_unavailable:{storage}")
                continue
            pin = pins.get(storage)
            pinned = _apply_skill_pin(row, storage=storage, pin=pin, errs=errs)
            if pinned is None:
                continue
            row = pinned
            schema = row.get("inputSchema") if isinstance(row.get("inputSchema"), dict) else None
            if schema and storage in {
                (resolve_storage_skill_key(parse_skill_pin(k)[0], scene=scene) or k).lower()
                for k in wanted_raw
                if k not in ("*", "all")
            }:
                arg_errs = validate_against_schema(schema, args_by_key.get(storage) or {})
                if arg_errs:
                    errs.append(f"skill_input_invalid:{storage}:" + ",".join(arg_errs[:6]))
                    continue
            resolved.append(row)

    rows = _apply_mutex(resolved)

    wanted_norm = {
        str(k).strip().lower()
        for k in wanted_raw
        if str(k).strip() and k not in ("*", "all")
    }

    def row_sort_key(r: dict[str, Any]) -> tuple[int, int, str]:
        key = str(r.get("skillKey") or "").strip().lower()
        cat = str(r.get("category") or (_SKILL_GRAPH.get(key) or {}).get("category") or "agent")
        # Explicit need_skills first so extends deps cannot starve the requested pack.
        explicit = 0 if key in wanted_norm else 1
        return (explicit, _SKILL_CATEGORY_ORDER.get(str(cat).lower(), 50), key)

    rows = sorted(rows, key=row_sort_key)

    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    header = render_prompt_body("agent.prompt.skill_details_header").strip()
    parts: list[str] = [header] if header else []
    total = len(parts[0]) if parts else 0
    used = 0
    for r in rows:
        key = str(r.get("skillKey") or "").strip().lower()
        if not key:
            continue
        name = str(r.get("name") or key)
        when = str(r.get("whenToUse") or "").strip()
        cat = str(r.get("category") or "agent").strip().lower() or "agent"
        if not _skill_available_for_context(r, role=role, stage=stage):
            continue
        if not _required_context_ready(r, has_design_brief=has_design_brief):
            continue
        body = _skill_body_for_context(r, role=role)
        graph = _skill_graph_for_row(r)
        cap = int(graph.get("max_prompt_chars") or 0)
        budget = int(_SKILL_CATEGORY_BUDGET.get(cat, 1200))
        if cap > 0:
            budget = min(budget, cap)
        if len(body) > budget:
            body = body[: budget - 1].rstrip() + "…"
        neg = str(r.get("promptNegative") or "").strip()
        tools = r.get("preferredTools") or []
        ver = int(r.get("version") or 1)
        ns = str(r.get("namespace") or NS_USER)
        head = f"## skill: {key} — {name} (v{ver}, ns={ns}, cat={cat})"
        if when:
            head += f"\nwhen: {when}"
        action_hint = _preferred_tools_as_actions(tools)
        if action_hint:
            head += "\ncanvas_actions: " + action_hint
        out_schema = r.get("outputSchema") if isinstance(r.get("outputSchema"), dict) else None
        if out_schema and isinstance(out_schema.get("allowed_ops"), list):
            allowed_actions = _preferred_tools_as_actions(out_schema.get("allowed_ops") or [])
            if allowed_actions:
                head += "\noutput_actions: " + allowed_actions
        block = f"{head}\n{body}".strip()
        if neg and cat != "qa":
            block += f"\n\nforbid: {neg}"
        elif neg and cat == "qa":
            # qa skills already carry forbid list in rules excerpt
            block += f"\n\nforbid: {neg[:400]}"
        if total + len(block) + 2 > max_chars and used > 0:
            trunc = render_prompt_body("agent.prompt.skill_details_truncated").strip()
            if trunc:
                parts.append(trunc)
            break
        parts.append(block)
        total += len(block) + 2
        used += 1
        if load_all and used >= 12:
            break
    if used == 0:
        return "", errs
    return "\n\n".join(parts), errs

def _normalize_loaded_skill_keys(
    skill_keys: list[str], *, scene: str = ""
) -> set[str]:
    """Map need_skills refs (bare / namespaced) → storage skill_keys."""
    raw = {str(k).strip().lower() for k in skill_keys if str(k).strip()}
    if not raw:
        return set()
    out: set[str] = set()
    for k in raw:
        hit = resolve_storage_skill_key(k, scene=scene)
        out.add((hit or k).lower())
    return out

def _iter_skills_for_keys(
    skill_keys: list[str], *, scene: str = ""
):
    keys = _normalize_loaded_skill_keys(skill_keys, scene=scene)
    if not keys:
        return
    for r in list_runtime_skills(scene=scene):
        key = str(r.get("skillKey") or "").strip().lower()
        if key in keys:
            yield r

_OP_TO_ACTION = {
    "create_image": "新增图片",
    "create_text": "新增文字",
    "create_shape": "新增形状",
    "create_frame": "新建画板",
    "create_svg": "新增矢量图",
    "create_icon": "新增图标",
    "create_lottie": "新增动效",
    "update_node": "修改图层",
    "move_nodes": "移动图层",
    "resize_nodes": "缩放图层",
    "delete_nodes": "删除图层",
    "delete_frame": "删除画板",
}


def _preferred_tools_as_actions(tools: Any) -> str:
    """Map preferred_tools / allowed_ops ids → natural canvas actions for SKILL_DETAILS."""
    if not isinstance(tools, (list, tuple)):
        return ""
    seen: set[str] = set()
    out: list[str] = []
    for raw in tools:
        key = str(raw or "").strip()
        if not key:
            continue
        label = _OP_TO_ACTION.get(key) or _OP_TO_ACTION.get(key.lower())
        if not label:
            # Skip unknown op ids — do not leak them into craft text.
            continue
        if label in seen:
            continue
        seen.add(label)
        out.append(label)
    return "、".join(out)


def preferred_tools_allowlist(
    skill_keys: list[str], *, scene: str = ""
) -> set[str] | None:
    """Union of preferred_tools for loaded skills.

    None = no restriction (only platform seed/file skills with empty prefs).
    Custom admin skills without preferred_tools → hard-restrict to layout ops.
    """
    if not _normalize_loaded_skill_keys(skill_keys, scene=scene):
        return None
    allow: set[str] = set()
    any_pref = False
    any_custom_unscoped = False
    only_custom = True
    for r in _iter_skills_for_keys(skill_keys, scene=scene):
        source = str(r.get("source") or "").strip().lower()
        ns = str(r.get("namespace") or _SOURCE_TO_NS.get(source, NS_USER))
        if source == SOURCE_FILE or ns in (NS_CORE, NS_EXT):
            only_custom = False
        prefs = r.get("preferredTools") or []
        if prefs:
            any_pref = True
            allow.update(str(t).strip() for t in prefs if str(t).strip())
        elif source == SOURCE_ADMIN or ns == NS_USER:
            any_custom_unscoped = True
    if any_pref:
        allow |= _ALWAYS_ALLOW_OPS
        return allow
    if only_custom or any_custom_unscoped:
        # Custom skills must not inherit unrestricted canvas tool surface.
        return set(_ALWAYS_ALLOW_OPS)
    return None

def skill_resource_allowlist(
    skill_keys: list[str], *, scene: str = ""
) -> set[str] | None:
    """Which internal need_* resources loaded skills may unlock.

    None = unrestricted (platform-only skills without explicit ACL).
    set() = deny tools / prompts.
    Any user-extension skill in the load set → never unrestricted.
    """
    if not _normalize_loaded_skill_keys(skill_keys, scene=scene):
        return None
    allowed: set[str] = set()
    saw_custom = False
    saw_platform_open = False
    for r in _iter_skills_for_keys(skill_keys, scene=scene):
        source = str(r.get("source") or "").strip().lower()
        ns = str(r.get("namespace") or _SOURCE_TO_NS.get(source, NS_USER))
        res = r.get("allowedResources")
        if isinstance(res, list):
            allowed.update(str(x).strip().lower() for x in res if str(x).strip())
            if source == SOURCE_ADMIN or ns == NS_USER:
                saw_custom = True
            continue
        if source == SOURCE_FILE or ns in (NS_CORE, NS_EXT):
            saw_platform_open = True
        elif source == SOURCE_ADMIN or ns == NS_USER:
            saw_custom = True
    # Hard isolation: user-extension skills never inherit unrestricted surface.
    if saw_custom:
        if not allowed:
            return {"tools"}
        return allowed | {"tools"}
    if saw_platform_open:
        return None
    return None

def filter_ops_by_skill_output_schema(
    ops: list[dict[str, Any]],
    *,
    skill_keys: list[str],
    scene: str = "",
) -> tuple[list[dict[str, Any]], list[str]]:
    """Enforce union of output_schema.allowed_ops when declared by loaded skills."""
    if not _normalize_loaded_skill_keys(skill_keys, scene=scene):
        return list(ops or []), []
    allowed_ops: set[str] = set()
    any_schema = False
    for r in _iter_skills_for_keys(skill_keys, scene=scene):
        schema = r.get("outputSchema") if isinstance(r.get("outputSchema"), dict) else None
        if not schema:
            continue
        ops_list = schema.get("allowed_ops")
        if isinstance(ops_list, list) and ops_list:
            any_schema = True
            allowed_ops.update(str(x).strip() for x in ops_list if str(x).strip())
    if not any_schema:
        return list(ops or []), []
    allowed_ops |= _ALWAYS_ALLOW_OPS
    kept: list[dict[str, Any]] = []
    from app.services.design.ops.tool_ops_contract import format_op_error

    errs: list[str] = []
    for op in ops or []:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if not name or name in allowed_ops:
            kept.append(op)
            continue
        errs.append(
            format_op_error(
                "op_not_in_skill_output_schema",
                fix="omit this op or load a skill that allows it",
                detail=f"name={name}",
            )
        )
    return kept, errs

def filter_need_resources_by_skill_acl(
    *,
    skill_keys: list[str],
    scene: str,
) -> list[str]:
    """No-op — domain content is skills/prompts only."""
    _ = (skill_keys, scene)
    return []


def filter_ops_by_skill_allowlist(
    ops: list[dict[str, Any]],
    *,
    skill_keys: list[str],
    scene: str = "",
) -> tuple[list[dict[str, Any]], list[str]]:
    """Enforce preferred_tools / custom-skill hard allowlist + output_schema."""
    from app.services.design.ops.tool_ops_contract import format_op_error

    allow = preferred_tools_allowlist(skill_keys, scene=scene)
    kept: list[dict[str, Any]] = []
    errs: list[str] = []
    if allow is None:
        kept = list(ops or [])
    else:
        for op in ops or []:
            if not isinstance(op, dict):
                continue
            name = str(op.get("name") or "").strip()
            if not name or name in allow:
                kept.append(op)
                continue
            errs.append(
                format_op_error(
                    "op_not_in_skill_allowlist",
                    fix="omit this op or use a preferred_tools skill",
                    detail=f"name={name}",
                )
            )
    kept2, errs2 = filter_ops_by_skill_output_schema(kept, skill_keys=skill_keys, scene=scene)
    return kept2, errs + errs2

def parse_need_skills_with_pins(
    raw: Any, *, max_n: int = 8, scene: str = ""
) -> tuple[list[str], dict[str, int | str], dict[str, Any], list[str]]:
    """Parse need_skills → (storage_keys, version_pins, input_args, errors)."""
    errs: list[str] = []
    if raw is None or raw is False:
        return [], {}, {}, []
    if raw is True:
        return ["*"], {}, {}, []
    items: list[Any]
    if isinstance(raw, str):
        s = raw.strip()
        if s.lower() in ("1", "true", "yes", "all", "*"):
            return ["*"], {}, {}, []
        items = [p.strip() for p in s.replace("；", ",").split(",")]
    elif isinstance(raw, list):
        items = raw
    else:
        return [], {}, {}, ["need_skills_invalid_type"]

    out: list[str] = []
    pins: dict[str, int | str] = {}
    args: dict[str, Any] = {}
    seen: set[str] = set()
    known = runtime_skill_keys()

    for item in items:
        pin_i: int | None = None
        pin_p: str | None = None
        arg_obj: Any = None
        if isinstance(item, dict):
            key_raw = str(item.get("key") or "").strip()
            if "version" in item and item.get("version") is not None:
                try:
                    pin_i = int(item.get("version"))
                except (TypeError, ValueError):
                    pin_p = str(item.get("version"))
            if item.get("packVersion"):
                pin_p = str(item.get("packVersion"))
            if "args" in item:
                arg_obj = item.get("args")
        else:
            key_raw = str(item or "").strip()
        if not key_raw:
            continue
        base, from_at_i, from_at_p = parse_skill_pin(key_raw)
        if pin_i is None and from_at_i is not None:
            pin_i = from_at_i
        if pin_p is None and from_at_p is not None:
            pin_p = from_at_p
        key = base.strip().lower()
        if not key or key in seen:
            continue
        if key in ("all", "*"):
            return ["*"], {}, {}, errs
        storage = resolve_storage_skill_key(key, scene=scene) or key
        if known and storage not in known:
            errs.append(f"skill_unknown:{key_raw}")
            continue
        if storage in seen:
            continue
        seen.add(storage)
        out.append(storage)
        if pin_i is not None:
            pins[storage] = pin_i
        elif pin_p is not None:
            pins[storage] = pin_p
        if arg_obj is not None:
            args[storage] = arg_obj
        if len(out) >= max_n:
            break
    return out, pins, args, errs

def normalize_need_skills(raw: Any, *, max_n: int = 8) -> list[str]:
    keys, _pins, _args, _errs = parse_need_skills_with_pins(raw, max_n=max_n)
    return keys


# Negation markers: "不要做成海报风" must not auto-trigger poster_craft / garden_style.
_PROMPT_NEG_MARKERS: tuple[str, ...] = (
    "不要",
    "别",
    "勿",
    "非",
    "不是",
    "避免",
    "禁止",
    "无需",
    "不用",
    "别做",
    "don't",
    "do not",
    "not a",
    "no ",
    "never ",
    "avoid ",
    "without ",
)


def _needle_positively_present(prompt_l: str, needle: str) -> bool:
    """True if needle appears at least once outside a short negation window."""
    n = str(needle or "").strip().lower()
    p = str(prompt_l or "")
    if not n or not p:
        return False
    start = 0
    while True:
        i = p.find(n, start)
        if i < 0:
            return False
        left = p[max(0, i - 12) : i]
        if not any(m in left for m in _PROMPT_NEG_MARKERS):
            return True
        start = i + max(1, len(n))


def _rule_matches(
    rule: dict[str, Any],
    *,
    empty_canvas: bool,
    has_images: bool,
    intent: str,
    prompt_chars: int = 0,
    prompt: str = "",
) -> bool:
    if not isinstance(rule, dict) or not rule:
        return False
    intent_l = str(intent or "").strip().lower()
    prompt_l = str(prompt or "").lower()

    if "empty_canvas" in rule and bool(rule.get("empty_canvas")) != bool(empty_canvas):
        return False
    if "has_images" in rule and bool(rule.get("has_images")) != bool(has_images):
        return False
    if "min_prompt_chars" in rule:
        try:
            need = int(rule.get("min_prompt_chars") or 0)
        except (TypeError, ValueError):
            need = 0
        if int(prompt_chars or 0) < need:
            return False

    raw_intents = rule.get("intent_in")
    if raw_intents is not None:
        if isinstance(raw_intents, str):
            want = {p.strip().lower() for p in raw_intents.split(",") if p.strip()}
        elif isinstance(raw_intents, list):
            want = {str(x).strip().lower() for x in raw_intents if str(x).strip()}
        else:
            want = set()
        if want and intent_l not in want:
            return False
        if want and not intent_l:
            return False

    raw_includes = rule.get("prompt_includes_any")
    if raw_includes is not None:
        if isinstance(raw_includes, str):
            needles = [p.strip().lower() for p in raw_includes.split(",") if p.strip()]
        elif isinstance(raw_includes, list):
            needles = [str(x).strip().lower() for x in raw_includes if str(x).strip()]
        else:
            needles = []
        # Skip needles that appear only inside negation ("不要做成海报风" ≠ poster).
        if needles and not any(_needle_positively_present(prompt_l, n) for n in needles):
            return False
        if needles and not prompt_l:
            return False

    keys = set(rule.keys()) & {
        "empty_canvas",
        "has_images",
        "intent_in",
        "min_prompt_chars",
        "prompt_includes_any",
    }
    return bool(keys)


def resolve_triggered_skill_keys(
    *,
    scene: str = "",
    empty_canvas: bool = False,
    has_images: bool = False,
    intent: str = "",
    prompt_chars: int = 0,
    prompt: str = "",
    already_loaded: list[str] | None = None,
    max_n: int = 6,
    stage: str = "",
    classified_intent: str = "",
    has_design_brief: bool = True,
) -> list[str]:
    loaded = {str(x).strip().lower() for x in (already_loaded or []) if str(x).strip()}
    matched: list[dict[str, Any]] = []
    prompt_text = str(prompt or "")
    if not prompt_chars and prompt_text:
        prompt_chars = len(prompt_text.strip())
    classified = str(classified_intent or intent or "").strip().lower()
    skip_auto_craft = classified in ("canvas_op", "chat")
    effective_max = min(max_n, 3) if has_images else max_n
    for row in list_runtime_skills(scene=scene):
        key = str(row.get("skillKey") or "").strip().lower()
        if not key or key in loaded:
            continue
        if skip_auto_craft:
            continue
        if not _skill_in_stage(row, stage):
            continue
        if not _required_context_ready(row, has_design_brief=has_design_brief):
            continue
        rules = row.get("triggers") or []
        if not rules:
            continue
        if any(
            _rule_matches(
                rule,
                empty_canvas=empty_canvas,
                has_images=has_images,
                intent=intent,
                prompt_chars=prompt_chars,
                prompt=prompt_text,
            )
            for rule in rules
        ):
            matched.append(row)
    matched = _apply_mutex(matched)
    out: list[str] = []
    for row in matched:
        key = str(row.get("skillKey") or "").strip().lower()
        if not key or key in loaded:
            continue
        out.append(key)
        loaded.add(key)
        if len(out) >= effective_max:
            break
    return out
