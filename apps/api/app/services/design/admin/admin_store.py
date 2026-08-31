"""Admin CRUD for design pipeline catalog (skills / rules / flows).

Private to admin — open-source builds omit this module + recombyn-admin.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from typing import Any

from app.repositories import design_tasks
from app.services.design.readpath.catalog import ensure_design_catalog, get_skill

_log = logging.getLogger("design.admin_store")
_STAGE_RULES_LOCK = threading.Lock()
_STAGE_RULES_READY = False


def _pub_skill(r: Any) -> dict[str, Any]:
    """Admin skill row → API dict (runtime fields from skill_store._pub + admin extras)."""
    from app.services.design.prompts.skill_store import _pub, _row_get

    base = _pub(r)
    base.pop("_localKey", None)
    try:
        default_model = str(_row_get(r, "default_model") or "").strip()
    except Exception:
        default_model = ""
    try:
        max_retries = int(_row_get(r, "max_retries") or 2)
    except Exception:
        max_retries = 2
    try:
        output_format = str(_row_get(r, "output_format") or "json")
    except Exception:
        output_format = "json"
    try:
        allow_override = bool(int(_row_get(r, "allow_user_model_override") or 0))
    except Exception:
        allow_override = False
    try:
        updated_raw = _row_get(r, "updated_at")
        updated_at = int(float(updated_raw) * 1000) if updated_raw else None
    except Exception:
        updated_at = None
    base.update(
        {
            "defaultModel": default_model,
            "maxRetries": max_retries,
            "outputFormat": output_format,
            "allowUserModelOverride": allow_override,
            "updatedAt": updated_at,
        }
    )
    return base


def list_admin_skills(
    *,
    q: str | None = None,
    enabled: bool | None = None,
    source: str | None = None,
) -> list[dict[str, Any]]:
    """List skills for Admin UI (seed + file + admin). Optional ``source`` filter."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    with Session(engine) as session:
        rows = crud.list_admin_design_skills(
            session=session, q=q, enabled=enabled, source=source
        )
    return [_pub_skill(r) for r in rows]


def upsert_skill(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_design_catalog()
    now = time.time()
    sid = payload.get("id")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name required")
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.prompts.skill_store import (
        NS_CORE,
        NS_EXT,
        NS_USER,
        SOURCE_ADMIN,
        _CORE_RESERVED_KEYS,
        qualify_skill_key,
        save_skill_revision,
        split_namespace_key,
        validate_skill_io_schema,
        validate_skill_meta,
    )

    item: dict[str, Any] | None = None
    skill_key = payload.get("skillKey")
    skill_key = str(skill_key).strip() if skill_key else None
    category = str(payload.get("category") or "layout").strip() or "layout"
    prompt_positive = str(payload.get("promptPositive") or "")
    prompt_negative = payload.get("promptNegative")
    when_to_use = str(payload.get("whenToUse") or "").strip()
    preferred_raw = payload.get("preferredTools")
    if isinstance(preferred_raw, list):
        preferred_tools = json.dumps(
            [str(x).strip() for x in preferred_raw if str(x).strip()],
            ensure_ascii=False,
        )
    elif preferred_raw is not None:
        preferred_tools = str(preferred_raw).strip()
    else:
        preferred_tools = None
    resources_raw = payload.get("allowedResources")
    if isinstance(resources_raw, list):
        allowed_resources = json.dumps(
            [str(x).strip().lower() for x in resources_raw if str(x).strip()],
            ensure_ascii=False,
        )
    elif resources_raw is not None:
        allowed_resources = str(resources_raw).strip()
    else:
        # Custom admin skills default: tools only.
        allowed_resources = json.dumps(["tools"], ensure_ascii=False)
    in_schema_obj, in_errs = validate_skill_io_schema(
        payload.get("inputSchema"), field="input_schema"
    )
    out_schema_obj, out_errs = validate_skill_io_schema(
        payload.get("outputSchema"), field="output_schema"
    )
    if in_errs or out_errs:
        raise ValueError("; ".join(in_errs + out_errs))
    input_schema = json.dumps(in_schema_obj, ensure_ascii=False) if in_schema_obj else None
    output_schema = json.dumps(out_schema_obj, ensure_ascii=False) if out_schema_obj else None
    owner_user_id = str(payload.get("ownerUserId") or "").strip() or None
    triggers_raw = payload.get("triggers")
    if isinstance(triggers_raw, (list, dict)):
        triggers_json = json.dumps(triggers_raw, ensure_ascii=False)
    elif triggers_raw is not None:
        triggers_json = str(triggers_raw).strip()
    else:
        triggers_json = None
    mutex_group = str(payload.get("mutexGroup") or "").strip()
    try:
        version = int(payload.get("version") or 0)
    except (TypeError, ValueError):
        version = 0
    sort_weight = int(payload.get("sortWeight") or 0)
    scenes = str(payload.get("scenes") or "all").strip() or "all"
    default_model = str(payload.get("defaultModel") or "").strip()
    max_retries = int(payload.get("maxRetries") or 2)
    enabled = 1 if payload.get("enabled", True) else 0
    output_format = str(payload.get("outputFormat") or "json")
    allow_override = 1 if payload.get("allowUserModelOverride") else 0
    description = str(payload.get("description") or "").strip()
    logo = str(payload.get("logo") or "").strip() or None
    pack_version = str(payload.get("packVersion") or "").strip() or None
    locales_raw = payload.get("locales")
    if isinstance(locales_raw, dict):
        locales_json = json.dumps(locales_raw, ensure_ascii=False)
    elif isinstance(locales_raw, str) and locales_raw.strip():
        locales_json = locales_raw.strip()
    else:
        locales_json = None

    with Session(engine) as session:
        if sid:
            # Bump version on admin edit unless explicitly set higher.
            cur = crud.get_design_skill(session=session, item_id=int(sid))
            if not cur:
                raise ValueError("skill not found")
            existing_source = str(cur.source or "").strip().lower() or SOURCE_ADMIN
            existing_key = str(cur.skill_key or "").strip()
            existing_ns = str(cur.namespace or "").strip().lower()
            # Editing seed/file: keep source + key + namespace (ops can customize body).
            # Seed sync is insert-only, so these edits are not reclaimed.
            if existing_source != SOURCE_ADMIN:
                source = existing_source
                skill_key = existing_key or skill_key
                namespace = existing_ns or NS_EXT
                meta_source = existing_source
            else:
                source = SOURCE_ADMIN
                namespace = NS_USER
                if skill_key:
                    ns_prefix, local = split_namespace_key(skill_key)
                    if ns_prefix == NS_CORE or local in _CORE_RESERVED_KEYS:
                        raise ValueError(f"core skill key reserved: {local or skill_key}")
                    if ns_prefix == NS_EXT:
                        raise ValueError("user skill cannot use ext namespace")
                    skill_key = qualify_skill_key(NS_USER, local or skill_key)
                elif existing_key:
                    skill_key = existing_key
                meta_source = SOURCE_ADMIN
            meta_errs = validate_skill_meta(
                {
                    "skill_key": skill_key or existing_key or f"user.{name}",
                    "name": name,
                    "prompt_positive": prompt_positive,
                    "preferred_tools": preferred_raw,
                    "allowed_resources": resources_raw if resources_raw is not None else ["tools"],
                    "input_schema": in_schema_obj,
                    "output_schema": out_schema_obj,
                    "namespace": namespace,
                },
                source=meta_source,
            )
            if meta_errs:
                if "prompt_positive_required" in meta_errs and not prompt_positive:
                    raise ValueError("; ".join(meta_errs))
                if any(e for e in meta_errs if e != "prompt_positive_required"):
                    raise ValueError("; ".join(meta_errs))
            try:
                cur_ver = int(cur.version or 0)
            except Exception:
                cur_ver = 0
            next_ver = version if version > cur_ver else cur_ver + 1
            fields: dict[str, Any] = {
                "name": name,
                "category": category,
                "prompt_positive": prompt_positive,
                "prompt_negative": prompt_negative,
                "namespace": namespace,
                "version": next_ver,
                "source": source,
                "sort_weight": sort_weight,
                "scenes": scenes,
                "default_model": default_model,
                "max_retries": max_retries,
                "enabled": enabled,
                "output_format": output_format,
                "allow_user_model_override": allow_override,
            }
            if skill_key:
                fields["skill_key"] = skill_key
            if when_to_use:
                fields["when_to_use"] = when_to_use
            if preferred_tools is not None:
                fields["preferred_tools"] = preferred_tools
            if allowed_resources is not None:
                fields["allowed_resources"] = allowed_resources
            if input_schema is not None:
                fields["input_schema"] = input_schema
            if output_schema is not None:
                fields["output_schema"] = output_schema
            if owner_user_id is not None:
                fields["owner_user_id"] = owner_user_id
            if triggers_json is not None:
                fields["triggers"] = triggers_json
            if mutex_group:
                fields["mutex_group"] = mutex_group
            if pack_version is not None:
                fields["pack_version"] = pack_version
            if description:
                fields["description"] = description
            if logo is not None:
                fields["logo"] = logo
            if locales_json is not None:
                fields["locales"] = locales_json
            crud.update_admin_design_skill(
                session=session,
                skill_id=int(sid),
                fields=fields,
                updated_at=now,
            )
            item = get_skill(int(sid))
            if item:
                try:
                    save_skill_revision(
                        session, skill_id=int(sid), item=_pub_skill(item)
                    )
                    session.commit()
                except Exception:
                    pass
        else:
            # New rows are always ops skills (user.* / admin).
            source = SOURCE_ADMIN
            namespace = NS_USER
            if not skill_key:
                raise ValueError("skillKey required")
            ns_prefix, local = split_namespace_key(skill_key)
            if ns_prefix == NS_CORE or local in _CORE_RESERVED_KEYS:
                raise ValueError(f"core skill key reserved: {local or skill_key}")
            if ns_prefix == NS_EXT:
                raise ValueError("user skill cannot use ext namespace")
            skill_key = qualify_skill_key(NS_USER, local or skill_key)
            meta_errs = validate_skill_meta(
                {
                    "skill_key": skill_key,
                    "name": name,
                    "prompt_positive": prompt_positive,
                    "preferred_tools": preferred_raw,
                    "allowed_resources": resources_raw if resources_raw is not None else ["tools"],
                    "input_schema": in_schema_obj,
                    "output_schema": out_schema_obj,
                    "namespace": namespace,
                },
                source=SOURCE_ADMIN,
            )
            if meta_errs:
                raise ValueError("; ".join(meta_errs))
            from app.models import DesignSkill

            row = crud.insert_admin_design_skill(
                session=session,
                row=DesignSkill(
                    skill_key=skill_key,
                    name=name,
                    category=category,
                    prompt_positive=prompt_positive,
                    prompt_negative=prompt_negative,
                    when_to_use=when_to_use,
                    preferred_tools=preferred_tools or "[]",
                    allowed_resources=allowed_resources,
                    input_schema=input_schema,
                    output_schema=output_schema,
                    namespace=namespace,
                    owner_user_id=owner_user_id,
                    triggers=triggers_json or "[]",
                    mutex_group=mutex_group or None,
                    version=max(version, 1),
                    source=source,
                    pack_version=pack_version,
                    description=description or None,
                    logo=logo,
                    locales=locales_json or "{}",
                    sort_weight=sort_weight,
                    scenes=scenes,
                    default_model=default_model,
                    max_retries=max_retries,
                    enabled=enabled,
                    output_format=output_format,
                    allow_user_model_override=allow_override,
                    created_at=now,
                    updated_at=now,
                ),
            )
            new_id = int(row.id or 0)
            item = get_skill(new_id)
            if item:
                try:
                    save_skill_revision(
                        session, skill_id=new_id, item=_pub_skill(item)
                    )
                    session.commit()
                except Exception:
                    pass
        try:
            from app.services.design.prompts.skill_store import invalidate_skill_key_cache

            invalidate_skill_key_cache()
        except Exception:
            pass
        if not item:
            raise RuntimeError("upsert skill failed")
        return _pub_skill(item)


def soft_delete_skill(skill_id: int) -> bool:
    """Remove skill row from Admin list (hard delete). Seed/file rows are protected."""
    ensure_design_catalog()
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.prompts.skill_store import SOURCE_FILE

    with Session(engine) as session:
        row = crud.get_design_skill(session=session, item_id=int(skill_id))
        if not row:
            return False
        src = str(row.source or "").strip().lower()
        if src == SOURCE_FILE:
            raise ValueError("cannot delete seed/file skill via admin")
        session.delete(row)
        session.commit()
        return True


def _rule_row_out(r: Any) -> dict[str, Any]:
    def _get(name: str, default: Any = None) -> Any:
        if hasattr(r, name):
            val = getattr(r, name)
            return default if val is None else val
        try:
            if name not in r.keys():
                return default
        except Exception:
            return default
        val = r[name]
        return default if val is None else val

    desc = str(_get("description") or "")
    enabled = 1
    try:
        raw_en = _get("enabled")
        if raw_en is not None:
            enabled = 1 if int(raw_en) else 0
    except Exception:
        enabled = 1
    updated_at = _get("updated_at")
    return {
        "id": int(_get("id") or 0),
        "ruleKey": _get("rule_key"),
        "ruleValue": _get("rule_value"),
        "description": desc,
        "enabled": bool(enabled),
        "updatedAt": int(float(updated_at) * 1000) if updated_at else None,
    }


def list_global_rules() -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    ensure_stage_rules()
    with Session(engine) as session:
        rows = crud.list_all_design_global_rules(session=session)
    # Hide internal/ops markers from Admin table (still in DB when needed).
    hide_exact = frozenset(
        {
            "content_pack_version",
            "optimize.last_auto_at",
        }
    )
    return [
        _rule_row_out(r)
        for r in rows
        if str(getattr(r, "rule_key", None) or "") not in hide_exact
    ]


def upsert_global_rule(
    *,
    rule_key: str,
    rule_value: str,
    description: str | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    ensure_design_catalog()
    key = (rule_key or "").strip()
    if not key:
        raise ValueError("ruleKey required")
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.prompts.system_prompt_store import (
        ensure_system_prompts,
        is_system_prompt_key,
        upsert_system_prompt,
    )

    if is_system_prompt_key(key):
        ensure_system_prompts()
        item = upsert_system_prompt(
            key=key,
            body=rule_value if rule_value is not None else "",
            description=description,
            enabled=enabled,
        )
        return {
            "id": 0,
            "ruleKey": item["key"],
            "ruleValue": item.get("body") or "",
            "description": item.get("description") or "",
            "enabled": bool(item.get("enabled", True)),
            "updatedAt": int(float(item.get("updatedAt") or 0) * 1000) or None,
        }
    val = rule_value if rule_value is not None else ""
    now = time.time()
    with Session(engine) as session:
        existing = crud.get_design_global_rule(session=session, rule_key=key)
        if existing:
            next_desc = (
                str(description)
                if description is not None
                else str(existing.description or "")
            )
            if enabled is None:
                try:
                    next_en = 1 if int(existing.enabled) else 0
                except Exception:
                    next_en = 1
            else:
                next_en = 1 if enabled else 0
        else:
            next_desc = str(description or "")
            next_en = 1 if (enabled is None or enabled) else 0
        row = crud.upsert_design_global_rule(
            session=session,
            rule_key=key,
            rule_value=val,
            description=next_desc,
            enabled=next_en,
            updated_at=now,
        )
    return _rule_row_out(row)


_AGENT_FLOW_RULE_KEY = "agent.flow.default_graph_json"
_AGENT_FLOW_PHASE_MAP_KEY = "agent.flow.phase_map_json"
_AGENT_FLOW_NODE_TEMPLATES_KEY = "agent.flow.node_templates_json"
_AGENT_FLOW_ACTION_CONTRACTS_KEY = "agent.flow.action_contracts_json"
# Flow designer removed — stop seeding; purge on content resync.
OBSOLETE_AGENT_FLOW_RULE_KEYS: tuple[str, ...] = (
    _AGENT_FLOW_RULE_KEY,
    _AGENT_FLOW_PHASE_MAP_KEY,
    _AGENT_FLOW_NODE_TEMPLATES_KEY,
    _AGENT_FLOW_ACTION_CONTRACTS_KEY,
    "agent.flows.catalog_json",
)


def _load_json_seed(name: str, default: Any) -> Any:
    """Load seed JSON from apps/api/seeds/."""
    from app.core.config import resolve_seed_file

    path = resolve_seed_file(name)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        _log.exception("load seed %s failed", name)
        return default


def _load_stage_rule_defaults() -> dict[str, str]:
    """Seed default values for design_global_rule (INSERT-only bootstrap)."""
    parsed = _load_json_seed("stage_rule_defaults.json", {})
    if not isinstance(parsed, dict):
        return {}
    defaults = parsed.get("defaults")
    if not isinstance(defaults, dict):
        return {}
    return {str(k): str(v) for k, v in defaults.items()}


def _load_stage_rule_descriptions() -> dict[str, str]:
    """Admin「用途」column labels; fill empty only."""
    parsed = _load_json_seed("stage_rule_defaults.json", {})
    if not isinstance(parsed, dict):
        return {}
    descriptions = parsed.get("descriptions")
    if not isinstance(descriptions, dict):
        return {}
    return {
        str(k): str(v)
        for k, v in descriptions.items()
        if str(k) not in OBSOLETE_AGENT_FLOW_RULE_KEYS
    }

def list_canvas_tools_admin() -> list[dict[str, Any]]:
    """All canvas tool rows (including disabled) for Admin."""
    ensure_design_catalog()
    from app.services.design.ops.tool_ops_contract import list_canvas_tools

    return list_canvas_tools(enabled_only=False)


def upsert_canvas_tool(
    *,
    op_key: str,
    label: str = "",
    model_hint: str = "",
    kind: str = "node",
    enabled: bool = True,
    sort_order: int = 0,
    args_schema: str = "",
) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    key = (op_key or "").strip()
    if not key:
        raise ValueError("opKey required")
    if not re.match(r"^[a-z][a-z0-9_]*$", key):
        raise ValueError("opKey must be snake_case letters/digits")
    kind_s = (kind or "node").strip()[:32] or "node"
    schema_s = (args_schema or "").strip()
    if schema_s:
        try:
            parsed = json.loads(schema_s)
            if not isinstance(parsed, (dict, list)):
                raise ValueError("argsSchema must be JSON object/array")
            schema_s = json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError as e:
            raise ValueError(f"argsSchema invalid JSON: {e}") from e
    now = time.time()
    with Session(engine) as session:
        row = crud.upsert_design_canvas_tool(
            session=session,
            op_key=key,
            kind=kind_s,
            label=(label or "").strip()[:128],
            model_hint=model_hint or "",
            args_schema=schema_s or None,
            enabled=1 if enabled else 0,
            sort_order=int(sort_order),
            now=now,
        )
    return {
        "opKey": row.op_key,
        "kind": str(row.kind or "node"),
        "label": row.label or "",
        "modelHint": row.model_hint or "",
        "argsSchema": str(row.args_schema or ""),
        "enabled": int(row.enabled or 0) == 1,
        "sortOrder": int(row.sort_order or 0),
        "updatedAt": int(float(row.updated_at) * 1000) if row.updated_at else None,
    }


def _is_fail_status(status: str) -> bool:
    return (status or "").strip().lower() in ("failed", "error")


def _is_ok_status(status: str) -> bool:
    return (status or "").strip().lower() in ("done", "success", "completed", "succeeded")


def _bucket_inc(
    buckets: dict[str, dict[str, int]],
    key: str,
    *,
    failed: bool,
    ok: bool,
    tokens: int,
) -> None:
    b = buckets.setdefault(key, {"tasks": 0, "failed": 0, "succeeded": 0, "tokens": 0})
    b["tasks"] += 1
    b["tokens"] += tokens
    if failed:
        b["failed"] += 1
    elif ok:
        b["succeeded"] += 1


def _bucket_rows(buckets: dict[str, dict[str, int]], *, key_name: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key, s in sorted(buckets.items(), key=lambda x: -x[1]["tasks"]):
        n = max(1, s["tasks"])
        out.append(
            {
                key_name: key,
                "tasks": s["tasks"],
                "failed": s["failed"],
                "succeeded": s["succeeded"],
                "tokens": s["tokens"],
                "failRate": round(s["failed"] / n, 4),
            }
        )
    return out


def _parse_task_meta(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _skills_from_meta(exec_log: dict[str, Any]) -> list[str]:
    raw = exec_log.get("skills_loaded") or []
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except Exception:
            raw = [raw]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for sk in raw:
        key = str(sk or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _error_blobs(exec_log: dict[str, Any]) -> list[str]:
    blobs: list[str] = []
    for err in exec_log.get("errors") or []:
        s = str(err or "").strip()
        if s:
            blobs.append(s)
    for step in exec_log.get("steps") or []:
        if not isinstance(step, dict):
            continue
        for key in ("error", "reason", "summary"):
            s = str(step.get(key) or "").strip()
            if s:
                blobs.append(s)
    note = str(exec_log.get("reflect_note") or "").strip()
    if note:
        blobs.append(note)
    return blobs


def _is_paint_timeout_blob(text: str) -> bool:
    low = text.lower()
    if "paint" not in low and "paint_ops" not in low:
        return False
    return "timed out" in low or "timeout" in low


def _accumulate_resilience(resilience: dict[str, int], exec_log: dict[str, Any]) -> None:
    """Count paint/observe failure signals from one task's execution_log."""
    blobs = _error_blobs(exec_log)
    path = [
        str(p or "").strip().lower()
        for p in (exec_log.get("path") or [])
        if str(p or "").strip()
    ]
    hit = False

    paint_to = sum(1 for b in blobs if _is_paint_timeout_blob(b))
    if paint_to:
        resilience["paintTimeouts"] += paint_to
        hit = True

    if any("retries_exhausted" in b.lower() for b in blobs):
        resilience["retriesExhausted"] += 1
        hit = True

    reflect_n = sum(1 for p in path if p == "reflect")
    if reflect_n == 0:
        for step in exec_log.get("steps") or []:
            if isinstance(step, dict) and str(step.get("phase") or "").lower() == "reflect":
                reflect_n += 1
    if reflect_n:
        resilience["reflectRounds"] += reflect_n
        hit = True

    if any("scene_feedback_timeout" in b.lower() for b in blobs):
        resilience["sceneTimeouts"] += 1
        hit = True

    if any("op_apply_failed" in b.lower() for b in blobs):
        resilience["opApplyFails"] += 1
        hit = True

    if hit:
        resilience["tasksWithResilienceSignal"] += 1


def skill_metrics_summary() -> dict[str, Any]:
    """Aggregate design_task: all-time totals + last-500 window breakdowns."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    with Session(engine) as session:
        total_n = crud.count_design_tasks(session=session)
        failed_n = crud.count_design_tasks_by_status(
            session=session, statuses=["failed", "error"]
        )
        ok_n = crud.count_design_tasks_by_status(
            session=session,
            statuses=["done", "success", "completed", "succeeded"],
        )
        token_sum = crud.sum_design_task_total_tokens(session=session)
        credit_sum = crud.sum_design_task_charged_credits(session=session)
        rows = crud.list_recent_design_tasks(session=session, limit=500)

    scene_stats: dict[str, dict[str, int]] = {}
    route_stats: dict[str, dict[str, int]] = {}
    intent_stats: dict[str, dict[str, int]] = {}
    skill_stats: dict[str, dict[str, int]] = {}
    painted_n = 0
    window_failed = 0
    window_ok = 0
    window_tokens = 0
    rounds_sum = 0
    rounds_n = 0
    ops_sum = 0
    ops_n = 0
    dual_n = 0
    memory_n = 0
    with_meta_n = 0
    resilience = {
        "paintTimeouts": 0,
        "retriesExhausted": 0,
        "reflectRounds": 0,
        "sceneTimeouts": 0,
        "opApplyFails": 0,
        "tasksWithResilienceSignal": 0,
    }
    recent: list[dict[str, Any]] = []

    for r in rows:
        sc = str(r.scene or "unknown").strip().lower() or "unknown"
        st = str(r.status or "")
        tok = int(r.total_tokens or 0)
        window_tokens += tok
        failed_b = _is_fail_status(st)
        ok_b = _is_ok_status(st)
        if failed_b:
            window_failed += 1
        elif ok_b:
            window_ok += 1
        _bucket_inc(scene_stats, sc, failed=failed_b, ok=ok_b, tokens=tok)

        meta = _parse_task_meta(r.meta_json)
        decision = meta.get("decision_log") if isinstance(meta.get("decision_log"), dict) else {}
        exec_log = meta.get("execution_log") if isinstance(meta.get("execution_log"), dict) else {}

        route_raw = str(decision.get("route") or "").strip().lower() or (
            "error" if failed_b else "unknown"
        )
        route_m = re.match(r"^(agent_graph(?:_ask|_chat)?)(?::v\d+)?$", route_raw)
        route = route_m.group(1) if route_m else route_raw
        intent = str(decision.get("intent") or "").strip().lower() or "unknown"
        _bucket_inc(route_stats, route, failed=failed_b, ok=ok_b, tokens=tok)
        _bucket_inc(intent_stats, intent, failed=failed_b, ok=ok_b, tokens=tok)

        painted = bool(exec_log.get("painted"))
        ops_count = int(exec_log.get("ops_count") or 0)
        round_i = int(exec_log.get("round") or 0)
        skills_used = _skills_from_meta(exec_log)
        if meta:
            with_meta_n += 1
        if painted:
            painted_n += 1
        if round_i > 0:
            rounds_sum += round_i
            rounds_n += 1
        if ops_count > 0 or painted:
            ops_sum += ops_count
            ops_n += 1
        if exec_log.get("dual_picked"):
            dual_n += 1
        if decision.get("memory_injected"):
            memory_n += 1
        for sk_key in skills_used:
            _bucket_inc(skill_stats, sk_key, failed=failed_b, ok=ok_b, tokens=tok)

        _accumulate_resilience(resilience, exec_log)

        if len(recent) < 50:
            recent.append(
                {
                    "id": r.id,
                    "scene": r.scene,
                    "status": r.status,
                    "route": route if route != "unknown" else None,
                    "intent": intent if intent != "unknown" else None,
                    "painted": painted,
                    "opsCount": ops_count,
                    "skills": skills_used[:8],
                    "tokens": tok,
                    "credits": int(r.charged_credits or 0),
                    "error": r.error_message,
                    "createdAt": int(float(r.created_at) * 1000) if r.created_at else None,
                }
            )

    window_n = len(rows)
    window_den = max(1, window_n)
    meta_n = max(1, with_meta_n)
    return {
        "totals": {
            "tasks": total_n,
            "failed": failed_n,
            "succeeded": ok_n,
            "tokens": token_sum,
            "credits": credit_sum,
        },
        "window": {
            "size": window_n,
            "failed": window_failed,
            "succeeded": window_ok,
            "tokens": window_tokens,
            "painted": painted_n,
            "paintedRate": round(painted_n / window_den, 4) if window_n else 0,
            "failRate": round(window_failed / window_den, 4) if window_n else 0,
        },
        "quality": {
            "window": window_n,
            "avgRounds": round(rounds_sum / max(1, rounds_n), 2) if rounds_n else 0,
            "avgOps": round(ops_sum / max(1, ops_n), 2) if ops_n else 0,
            "avgTokens": round(window_tokens / window_den, 1) if window_n else 0,
            "dualPickedRate": round(dual_n / meta_n, 4) if with_meta_n else 0,
            "memoryInjectedRate": round(memory_n / meta_n, 4) if with_meta_n else 0,
        },
        "resilience": {
            **resilience,
            "rate": round(
                resilience["tasksWithResilienceSignal"] / window_den, 4
            )
            if window_n
            else 0,
        },
        "byRoute": _bucket_rows(route_stats, key_name="route"),
        "byIntent": _bucket_rows(intent_stats, key_name="intent"),
        "byScene": _bucket_rows(scene_stats, key_name="scene"),
        "bySkill": _bucket_rows(skill_stats, key_name="skill"),
        "recent": recent,
    }


def _parse_flow_version(raw: Any) -> int | None:
    try:
        n = int(raw)
        if n > 0:
            return n
    except (TypeError, ValueError):
        pass
    return None


def list_decision_logs(
    *,
    page: int = 1,
    page_size: int = 50,
    route: str | None = None,
    intent: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """Admin list: light fields only (no full meta_json / LLM IO blobs)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

    if not catalog_ready():
        ensure_design_catalog()
    page = max(1, int(page or 1))
    page_size = max(1, min(100, int(page_size or 50)))

    with Session(engine) as session:
        rows, total = crud.list_decision_log_page(
            session=session,
            page=page,
            page_size=page_size,
            route=route,
            intent=intent,
            status=status,
            q=q,
        )

    def _cell(r: Any, name: str) -> Any:
        try:
            return r[name]
        except Exception:
            return getattr(r, name, None)

    items: list[dict[str, Any]] = []
    for r in rows:
        route_v = _json_scalar(_cell(r, "dl_route"))
        control_v = _json_scalar(_cell(r, "control"))
        meta_flow = _json_scalar(_cell(r, "flow_id"))
        skills = _skills_from_meta(
            {"skills_loaded": _json_scalar(_cell(r, "el_skills"))},
        )
        created_at = _cell(r, "created_at")
        updated_at = _cell(r, "updated_at")
        items.append(
            {
                "taskId": _cell(r, "id"),
                "traceId": _json_scalar(_cell(r, "dl_trace")),
                "userId": _cell(r, "user_id"),
                "scene": _cell(r, "scene"),
                "status": _cell(r, "status"),
                "route": route_v,
                "intent": _json_scalar(_cell(r, "dl_intent")),
                "prompt": _cell(r, "prompt"),
                "decisionLog": None,
                "executionLog": None,
                "control": control_v,
                "flowId": meta_flow,
                "flowVersion": _parse_flow_version(_cell(r, "flow_version")),
                "opsCount": _json_int(_cell(r, "ops_count")),
                "totalTokens": _json_int(_cell(r, "total_tokens")),
                "durationMs": _json_int(_cell(r, "total_duration_ms")),
                "painted": _json_bool(_cell(r, "painted")),
                "taskTier": _json_scalar(_cell(r, "task_tier")),
                "visionUsed": _json_bool(_cell(r, "vision_used")),
                "model": _json_scalar(_cell(r, "model")),
                "skills": skills,
                "error": _cell(r, "error_message"),
                "createdAt": int(float(created_at) * 1000) if created_at else None,
                "updatedAt": int(float(updated_at) * 1000) if updated_at else None,
            }
        )

    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
    }



def get_decision_log(task_id: str) -> dict[str, Any] | None:
    """Full decision/execution payload for one task (detail drawer)."""
    from sqlmodel import Session

    from app.core.db import engine
    from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

    if not catalog_ready():
        ensure_design_catalog()
    tid = str(task_id or "").strip()
    if not tid:
        return None
    with Session(engine) as session:
        r = design_tasks.get_design_task(session=session, task_id=tid)
    if r is None:
        return None
    meta_raw = r.meta_json
    meta: dict[str, Any] = {}
    if isinstance(meta_raw, str) and meta_raw.strip():
        try:
            parsed = json.loads(meta_raw)
            if isinstance(parsed, dict):
                meta = parsed
        except Exception:
            meta = {}
    decision = meta.get("decision_log")
    if not isinstance(decision, dict):
        return None
    exec_log = meta.get("execution_log")
    if not isinstance(exec_log, dict):
        exec_log = {}
    langfuse = meta.get("langfuse") if isinstance(meta.get("langfuse"), dict) else {}
    try:
        from app.core.config import settings
        from app.services.llm.agent import langfuse_console_url, langfuse_enabled

        key_on = langfuse_enabled()
        host = (settings.langfuse_base_url or "https://cloud.langfuse.com").strip().rstrip("/")
        lf_tid = str(langfuse.get("traceId") or "").strip()
        if not langfuse.get("consoleUrl"):
            langfuse = {
                "enabled": key_on,
                "host": host,
                "projectId": (settings.langfuse_project_id or "").strip() or None,
                "consoleUrl": langfuse_console_url(task_id=tid, trace_id=lf_tid or None),
                "taskId": tid,
                "traceId": lf_tid or None,
                "hint": "在 Langfuse 用 metadata.task_id 搜索本任务",
            }
        else:
            langfuse = {
                **langfuse,
                "enabled": bool(langfuse.get("enabled", key_on)),
                "host": langfuse.get("host") or host,
            }
    except Exception:
        pass
    duration_ms = exec_log.get("total_duration_ms")
    if duration_ms is None and r.created_at and r.updated_at:
        try:
            duration_ms = max(
                0, int((float(r.updated_at) - float(r.created_at)) * 1000)
            )
        except Exception:
            duration_ms = None
    model_calls: list[dict[str, Any]] = []
    try:
        from app.services.llm.usage_log import list_model_usage_for_task

        model_calls = list_model_usage_for_task(tid, limit=40)
    except Exception:
        model_calls = []
    path = exec_log.get("path")
    if not isinstance(path, list) or not path:
        path = [
            str(s.get("phase") or "").strip()
            for s in list(exec_log.get("steps") or [])
            if isinstance(s, dict) and str(s.get("phase") or "").strip()
        ]
    return {
        "taskId": r.id,
        "traceId": decision.get("trace_id"),
        "userId": r.user_id,
        "scene": r.scene,
        "status": r.status,
        "route": decision.get("route"),
        "intent": decision.get("intent"),
        "prompt": r.prompt,
        "decisionLog": decision,
        "executionLog": exec_log or None,
        "langfuse": langfuse or None,
        "control": meta.get("control"),
        "flowId": meta.get("flow_id"),
        "flowVersion": _parse_flow_version(meta.get("flow_version")),
        "opsCount": exec_log.get("ops_count"),
        "totalTokens": exec_log.get("total_tokens"),
        "durationMs": duration_ms,
        "path": path,
        "modelCalls": model_calls,
        "painted": exec_log.get("painted"),
        "taskTier": exec_log.get("task_tier"),
        "visionUsed": exec_log.get("vision_used"),
        "model": exec_log.get("model"),
        "skills": _skills_from_meta(exec_log),
        "error": r.error_message,
        "createdAt": int(float(r.created_at) * 1000) if r.created_at else None,
        "updatedAt": int(float(r.updated_at) * 1000) if r.updated_at else None,
    }


def clear_decision_logs() -> dict[str, Any]:
    """Strip decision_log / execution_log from all design_task.meta_json (fresh 运行复盘)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

    if not catalog_ready():
        ensure_design_catalog()
    cleared = 0
    scanned = 0
    with Session(engine) as session:
        rows = crud.list_design_tasks_with_meta(session=session)
        for r in rows:
            scanned += 1
            raw = r.meta_json
            if not isinstance(raw, str) or not raw.strip():
                continue
            try:
                meta = json.loads(raw)
            except Exception:
                continue
            if not isinstance(meta, dict):
                continue
            if "decision_log" not in meta and "execution_log" not in meta:
                continue
            meta.pop("decision_log", None)
            meta.pop("execution_log", None)
            crud.update_design_task_meta_json(
                session=session,
                task_id=str(r.id),
                meta_json=json.dumps(meta, ensure_ascii=False),
                updated_at=time.time(),
            )
            cleared += 1
        session.commit()
    return {"ok": True, "scanned": scanned, "cleared": cleared}


def _json_scalar(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="ignore")
    if isinstance(raw, str):
        s = raw.strip()
        if not s or s.lower() == "null":
            return None
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            try:
                return json.loads(s)
            except Exception:
                return s.strip("\"'")
        return s
    return raw


def _json_int(raw: Any) -> int | None:
    v = _json_scalar(raw)
    if v is None or v is False:
        return None
    try:
        return int(v)
    except Exception:
        return None


def _json_bool(raw: Any) -> bool | None:
    v = _json_scalar(raw)
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return None


STAGE_RULE_DEFAULTS: dict[str, str] = _load_stage_rule_defaults()
STAGE_RULE_DESCRIPTIONS: dict[str, str] = _load_stage_rule_descriptions()


def ensure_stage_rules() -> None:
    """Insert missing ``design_global_rule`` keys from seed. Never overwrite DB values."""
    global _STAGE_RULES_READY
    if _STAGE_RULES_READY:
        return
    ensure_design_catalog()
    # system prompts are seeded inside ensure_design_catalog; do not call again here
    # (avoids import/lock cycles during bootstrap).
    with _STAGE_RULES_LOCK:
        if _STAGE_RULES_READY:
            return
        from sqlmodel import Session

        from app import crud
        from app.core.db import engine

        with Session(engine) as session:
            # INSERT-only for missing keys. Existing Admin values are never touched.
            merged_defaults = dict(STAGE_RULE_DEFAULTS)
            for obsolete in OBSOLETE_AGENT_FLOW_RULE_KEYS:
                merged_defaults.pop(obsolete, None)
            now = time.time()
            existing = crud.list_design_global_rule_keys(session=session)
            from app.services.design.prompts.system_prompt_store import is_system_prompt_key

            for key, val in merged_defaults.items():
                if key in existing:
                    continue
                # Prompt bodies live in design_system_prompt — do not re-seed into KV.
                if is_system_prompt_key(key):
                    continue
                desc = STAGE_RULE_DESCRIPTIONS.get(key, "")
                crud.insert_design_global_rule_if_missing(
                    session=session,
                    rule_key=key,
                    rule_value=val,
                    description=desc,
                    updated_at=now,
                )
            _STAGE_RULES_READY = True
            # Markers only (no force-overwrite of Admin prompt / route text).
            for marker_key, marker_desc in (
                ("agent.prompt.pe_structure_v1", "提示词结构种子标记（不覆盖已有值）"),
                ("precheck.platform_domestic_v1", "国内路由种子标记（不覆盖已有值）"),
            ):
                try:
                    crud.insert_design_global_rule_if_missing(
                        session=session,
                        rule_key=marker_key,
                        rule_value="1",
                        description=marker_desc,
                        updated_at=now,
                    )
                except Exception:
                    pass
            # Always fill empty purpose from known map (never overwrite admin edits).
            try:
                crud.fill_empty_design_global_rule_descriptions(
                    session=session, descriptions=STAGE_RULE_DESCRIPTIONS
                )
            except Exception:
                pass
            session.commit()



def suggest_skill_optimize(skill_id: int) -> dict[str, Any]:
    """Heuristic suggestion from Skill + task metrics. Does not write config."""
    ensure_stage_rules()
    skill = get_skill(int(skill_id))
    if not skill:
        raise ValueError("skill not found")
    pub = _pub_skill(skill)
    flags: list[str] = []
    patch: dict[str, Any] = {}
    reasons: list[str] = []

    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        fail_n = crud.count_design_tasks_by_status(
            session=session, statuses=["failed", "error"]
        )
        total_n = crud.count_design_tasks(session=session)
        token_n = crud.sum_design_task_total_tokens(session=session)
    fail_rate = (fail_n / total_n) if total_n else 0.0

    if fail_rate > 0.2:
        flags.append("high_fail_rate")
        if pub["defaultModel"] != "deepseek":
            patch["defaultModel"] = "deepseek"
            reasons.append("switch model to deepseek for harder steps")
        if int(pub["maxRetries"]) < 3:
            patch["maxRetries"] = min(3, int(pub["maxRetries"]) + 1)
            reasons.append("bump maxRetries")
        if int(pub["sortWeight"]) > 10:
            patch["sortWeight"] = max(0, int(pub["sortWeight"]) - 10)
            reasons.append("lower priority while unstable")

    if token_n > 500000:
        flags.append("high_token_cost")
        if pub["defaultModel"] == "deepseek":
            patch["defaultModel"] = "doubao"
            reasons.append("prefer cheaper model when cost is high")
        if "all" in str(pub["scenes"]).split(","):
            patch["scenes"] = str(pub["category"] or "")
            reasons.append("narrow scenes away from all")

    if not pub["enabled"]:
        flags.append("disabled")
        reasons.append("skill is disabled; enable only after review")

    if not patch:
        reasons.append("metrics look stable; optional tighten retries unchanged")
        patch["maxRetries"] = int(pub["maxRetries"])

    return {
        "skillId": int(skill_id),
        "rationale": "; ".join(reasons) if reasons else "no change",
        "patch": patch,
        "flags": flags,
    }


def _fp(kind: str, target_key: str, patch: dict[str, Any]) -> str:
    raw = json.dumps({"k": kind, "t": target_key, "p": patch}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _pub_optimize_patch(r: Any) -> dict[str, Any]:
    def _get(name: str, default: Any = None) -> Any:
        if hasattr(r, name):
            val = getattr(r, name)
            return default if val is None else val
        try:
            if name not in r.keys():
                return default
        except Exception:
            return default
        val = r[name]
        return default if val is None else val

    try:
        patch = json.loads(_get("patch_json") or "{}")
    except Exception:
        patch = {}
    try:
        flags = json.loads(_get("flags_json") or "[]")
    except Exception:
        flags = []
    created_at = _get("created_at")
    updated_at = _get("updated_at")
    applied_at = _get("applied_at")
    return {
        "id": int(_get("id") or 0),
        "kind": _get("kind"),
        "targetKey": _get("target_key"),
        "patch": patch if isinstance(patch, dict) else {},
        "rationale": _get("rationale") or "",
        "flags": flags if isinstance(flags, list) else [],
        "status": _get("status") or "pending",
        "fingerprint": _get("fingerprint"),
        "createdAt": int(float(created_at) * 1000) if created_at else None,
        "updatedAt": int(float(updated_at) * 1000) if updated_at else None,
        "appliedAt": int(float(applied_at) * 1000) if applied_at else None,
    }


def list_optimize_patches(*, status: str | None = "pending") -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    with Session(engine) as session:
        rows = crud.list_optimize_patches(session=session, status=status, limit=100)
    return [_pub_optimize_patch(r) for r in rows]


def _insert_pending_patch(
    *,
    kind: str,
    target_key: str,
    patch: dict[str, Any],
    rationale: str,
    flags: list[str],
) -> dict[str, Any] | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import DesignOptimizePatch

    if not patch:
        return None
    fp = _fp(kind, target_key, patch)
    now = time.time()
    with Session(engine) as session:
        if crud.find_pending_optimize_patch_by_fingerprint(
            session=session, fingerprint=fp
        ):
            return None
        row = crud.insert_optimize_patch(
            session=session,
            row=DesignOptimizePatch(
                kind=kind,
                target_key=target_key,
                patch_json=json.dumps(patch, ensure_ascii=False),
                rationale=rationale,
                flags_json=json.dumps(flags, ensure_ascii=False),
                status="pending",
                fingerprint=fp,
                created_at=now,
                updated_at=now,
                applied_at=None,
            ),
        )
    return _pub_optimize_patch(row) if row else None


def generate_usage_optimize_patches(*, source: str = "manual") -> dict[str, Any]:
    """Mine design_task metrics -> pending patches (never auto-applies)."""
    ensure_stage_rules()
    metrics = skill_metrics_summary()
    totals = metrics.get("totals") or {}
    tasks = int(totals.get("tasks") or 0)
    failed = int(totals.get("failed") or 0)
    tokens = int(totals.get("tokens") or 0)
    fail_rate = (failed / tasks) if tasks else 0.0
    created: list[dict[str, Any]] = []
    skipped = 0
    by_scene = list(metrics.get("byScene") or [])
    by_skill = list(metrics.get("bySkill") or [])

    if tasks < 5:
        return {
            "created": [],
            "skipped": 0,
            "message": "not_enough_tasks",
            "source": source,
            "metrics": {
                "tasks": tasks,
                "failed": failed,
                "failRate": fail_rate,
                "tokens": tokens,
                "byScene": by_scene,
                "bySkill": by_skill,
            },
        }

    rules = {r["ruleKey"]: r["ruleValue"] for r in list_global_rules()}

    # 1) Global high fail -> retry / fallback (still useful)
    if fail_rate >= 0.2:
        import re as _re

        retry_raw = rules.get("precheck.retry_policy") or "max=2,backoff=1.5"
        m = _re.search(r"max\s*=\s*(\d+)", retry_raw, _re.I)
        cur_max = int(m.group(1)) if m else 2
        if cur_max < 3:
            patch = {"ruleKey": "precheck.retry_policy", "ruleValue": f"max={cur_max + 1},backoff=1.5"}
            item = _insert_pending_patch(
                kind="rule",
                target_key="precheck.retry_policy",
                patch=patch,
                rationale=f"[{source}] global fail_rate={fail_rate:.0%} over {tasks} tasks; bump retry max {cur_max}->{cur_max+1}",
                flags=["high_fail_rate", "precheck", source],
            )
            if item:
                created.append(item)
            else:
                skipped += 1

        chain = [x.strip() for x in (rules.get("precheck.fallback_chain") or "").split("|") if x.strip()]
        strong = "deepseek-v4-flash"
        if chain and chain[0] != strong and strong in chain:
            new_chain = [strong] + [x for x in chain if x != strong]
            patch = {"ruleKey": "precheck.fallback_chain", "ruleValue": "|".join(new_chain)}
            item = _insert_pending_patch(
                kind="rule",
                target_key="precheck.fallback_chain",
                patch=patch,
                rationale=f"[{source}] global fail_rate={fail_rate:.0%}; put {strong} first in fallback chain",
                flags=["high_fail_rate", "fallback", source],
            )
            if item:
                created.append(item)
            else:
                skipped += 1

    # 2) Per-skill (runtime skill_key): only skills with enough samples AND elevated failRate
    skill_lookup = {
        str(s.get("skillKey") or "").strip(): s
        for s in list_admin_skills()
        if str(s.get("skillKey") or "").strip()
    }
    for row in by_skill:
        sk_key = str(row.get("skillKey") or "").strip()
        sk = skill_lookup.get(sk_key)
        if not sk or not sk.get("enabled"):
            continue
        sid = int(sk.get("id") or 0)
        sk_tasks = int(row.get("tasks") or 0)
        sk_fail = float(row.get("failRate") or 0)
        if sk_tasks < 3 or sk_fail < 0.25 or sid <= 0:
            continue
        cat = str(sk.get("category") or "")
        sug = suggest_skill_optimize(sid)
        patch = {k: v for k, v in (sug.get("patch") or {}).items() if k in ("defaultModel", "maxRetries", "sortWeight", "scenes")}
        if not patch:
            retries = int(sk.get("maxRetries") or 2)
            if retries < 3:
                patch = {"maxRetries": retries + 1}
            else:
                continue
        item = _insert_pending_patch(
            kind="skill",
            target_key=str(sid),
            patch=patch,
            rationale=(
                f"[{source}] skill={sk_key}/{sk.get('name')} fail_rate={sk_fail:.0%} "
                f"({int(row.get('failed') or 0)}/{sk_tasks}); {sug.get('rationale') or 'per-skill'}"
            ),
            flags=list(sug.get("flags") or []) + [f"skill:{cat}", "per_skill", source],
        )
        if item:
            created.append(item)
        else:
            skipped += 1

    # 3) Per-scene negative tighten
    for row in by_scene:
        sc = str(row.get("scene") or "")
        n = int(row.get("tasks") or 0)
        rate = float(row.get("failRate") or 0)
        if n < 5 or sc in ("unknown", "") or rate < 0.35:
            continue
        rule_key = "negative_global"
        cur = (rules.get(rule_key) or "").strip()
        addon = "Avoid overcrowded composition; keep hierarchy clear; respect safe margins."
        if addon in cur:
            skipped += 1
            continue
        new_val = (cur + " " + addon).strip() if cur else addon
        item = _insert_pending_patch(
            kind="rule",
            target_key=rule_key,
            patch={"ruleKey": rule_key, "ruleValue": new_val},
            rationale=f"[{source}] scene={sc} fail_rate={rate:.0%} ({int(row.get('failed') or 0)}/{n}); tighten negative_global",
            flags=["scene_fail", sc, "per_scene", source],
        )
        if item:
            created.append(item)
        else:
            skipped += 1

    if source == "schedule":
        upsert_global_rule(rule_key="optimize.last_auto_at", rule_value=str(time.time()))

    return {
        "created": created,
        "skipped": skipped,
        "message": "ok",
        "source": source,
        "metrics": {
            "tasks": tasks,
            "failed": failed,
            "failRate": fail_rate,
            "tokens": tokens,
            "byScene": by_scene,
            "bySkill": by_skill,
        },
    }


def start_usage_optimize_scheduler() -> None:
    """Daemon thread: periodically mine usage into pending patches."""
    import logging
    import threading

    log = logging.getLogger("usage-optimize")

    def _loop() -> None:
        # first check shortly after boot
        time.sleep(45)
        while True:
            try:
                ensure_stage_rules()
                rules = {r["ruleKey"]: r["ruleValue"] for r in list_global_rules()}
                enabled = str(rules.get("optimize.schedule_enabled") or "1").strip().lower() not in (
                    "0",
                    "false",
                    "off",
                    "no",
                )
                try:
                    hours = float(rules.get("optimize.schedule_hours") or "24")
                except Exception:
                    hours = 24.0
                hours = max(1.0, min(168.0, hours))
                try:
                    last = float(rules.get("optimize.last_auto_at") or "0")
                except Exception:
                    last = 0.0
                if enabled and (time.time() - last) >= hours * 3600:
                    result = generate_usage_optimize_patches(source="schedule")
                    log.info(
                        "usage optimize schedule: message=%s created=%s",
                        result.get("message"),
                        len(result.get("created") or []),
                    )
            except Exception:
                log.exception("usage optimize schedule failed")
            time.sleep(3600)

    threading.Thread(target=_loop, name="usage-optimize", daemon=True).start()



def apply_optimize_patch(patch_id: int) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    with Session(engine) as session:
        row = crud.get_optimize_patch(session=session, patch_id=int(patch_id))
    if not row:
        raise ValueError("patch not found")
    if (row.status or "") != "pending":
        raise ValueError("patch not pending")
    pub = _pub_optimize_patch(row)
    kind = pub["kind"]
    patch = pub["patch"]
    if kind == "skill":
        skill_id = int(pub["targetKey"])
        skill = get_skill(skill_id)
        if not skill:
            raise ValueError("skill not found")
        body = _pub_skill(skill)
        body.update(patch)
        body["id"] = skill_id
        upsert_skill(body)
    elif kind == "rule":
        rk = str(patch.get("ruleKey") or pub["targetKey"])
        rv = str(patch.get("ruleValue") or "")
        upsert_global_rule(rule_key=rk, rule_value=rv)
    else:
        raise ValueError("unknown patch kind")
    now = time.time()
    with Session(engine) as session:
        row = crud.update_optimize_patch_status(
            session=session,
            patch_id=int(patch_id),
            status="applied",
            updated_at=now,
            applied_at=now,
        )
    return _pub_optimize_patch(row)


def dismiss_optimize_patch(patch_id: int) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    now = time.time()
    with Session(engine) as session:
        row = crud.get_optimize_patch(session=session, patch_id=int(patch_id))
        if not row:
            raise ValueError("patch not found")
        if (row.status or "") != "pending":
            raise ValueError("patch not pending")
        row = crud.update_optimize_patch_status(
            session=session,
            patch_id=int(patch_id),
            status="dismissed",
            updated_at=now,
        )
    return _pub_optimize_patch(row)

