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
import uuid
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
        default_model = str(_row_get(r, "default_model") or "doubao")
    except Exception:
        default_model = "doubao"
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
        SOURCE_FILE,
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
    default_model = str(payload.get("defaultModel") or "doubao")
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

def _load_json_seed(name: str, default: Any) -> Any:
    """Load seed JSON from apps/api/seeds/."""
    from app.core.config import resolve_seed_file

    path = resolve_seed_file(name)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        _log.exception("load seed %s failed", name)
        return default


def _load_default_agent_flow_graph() -> dict[str, Any]:
    return {"version": 1, "nodes": [], "edges": []}

    parsed = _load_json_seed("agent_flow_default_graph.json", {})
    return parsed if isinstance(parsed, dict) else {}


def _load_default_agent_phase_map() -> dict[str, str]:
    return {}

    return {str(k): str(v) for k, v in parsed.items()}


def _load_default_agent_flow_node_templates() -> list[dict[str, Any]]:
    return []



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
    return {str(k): str(v) for k, v in descriptions.items()}


def _global_rule_value(rule_key: str) -> str:
    """Fetch one rule value without loading the full rules table (prompts are large)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_stage_rules()
    with Session(engine) as session:
        val = crud.get_design_global_rule_value(session=session, rule_key=rule_key)
    return str(val or "").strip()


def list_agent_flow_node_templates() -> list[dict[str, Any]]:
    """Admin 节点调色板模板：优先读全局规则，否则返回种子默认。"""
    raw = _global_rule_value(_AGENT_FLOW_NODE_TEMPLATES_KEY)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                out: list[dict[str, Any]] = []
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    key = str(item.get("key") or "").strip()
                    kind = str(item.get("kind") or "").strip()
                    label = str(item.get("label") or "").strip()
                    if not key or not kind or not label:
                        continue
                    out.append(
                        {
                            "key": key,
                            "label": label,
                            "kind": kind,
                            "category": str(item.get("category") or "basic"),
                            "description": str(item.get("description") or ""),
                            "capability": str(item.get("capability") or "") or None,
                            "phaseKey": str(item.get("phaseKey") or "") or None,
                            "promptKey": str(item.get("promptKey") or "") or None,
                            "configRef": str(item.get("configRef") or "") or None,
                            "preview": str(item.get("preview") or "") or None,
                            "pickerTab": str(item.get("pickerTab") or "nodes") or "nodes",
                        }
                    )
                if out:
                    return out
        except Exception:
            _log.exception("parse agent flow node templates failed")
    return json.loads(json.dumps(_load_default_agent_flow_node_templates(), ensure_ascii=False))


def _load_default_action_contracts() -> dict[str, Any]:
    return {"phases": {}, "kinds": {}}



def _normalize_action_contract_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label") or "").strip()
    runtime = str(raw.get("runtime") or "").strip()
    rule = str(raw.get("rule") or "").strip()
    if not label or not rule:
        return None
    out: dict[str, Any] = {"label": label, "runtime": runtime, "rule": rule}
    bindings = raw.get("bindings")
    if isinstance(bindings, list):
        cleaned: list[dict[str, Any]] = []
        for b in bindings:
            if not isinstance(b, dict):
                continue
            field = str(b.get("field") or "").strip()
            if not field:
                continue
            item: dict[str, Any] = {
                "field": field,
                "label": str(b.get("label") or field),
            }
            if b.get("required") is True:
                item["required"] = True
            prefer = str(b.get("prefer") or "").strip()
            if prefer:
                item["prefer"] = prefer
            cleaned.append(item)
        if cleaned:
            out["bindings"] = cleaned
    preset = raw.get("injectPreset")
    if isinstance(preset, dict) and preset:
        out["injectPreset"] = preset
    return out


def _ingest_contract_map(src: Any) -> dict[str, Any]:
    """Normalize a phases/kinds dict of action-contract items."""
    out: dict[str, Any] = {}
    if not isinstance(src, dict):
        return out
    for k, v in src.items():
        item = _normalize_action_contract_item(v)
        if item:
            out[str(k)] = item
    return out


def get_agent_flow_action_contracts() -> dict[str, Any]:
    """Phase/kind action contracts for flow designer (not edge-condition dict)."""
    raw = _global_rule_value(_AGENT_FLOW_ACTION_CONTRACTS_KEY)
    phases: dict[str, Any] = {}
    kinds: dict[str, Any] = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                phases = _ingest_contract_map(parsed.get("phases"))
                kinds = _ingest_contract_map(parsed.get("kinds"))
        except Exception:
            _log.exception("parse agent flow action contracts failed")
    if not phases and not kinds:
        seeded = _load_default_action_contracts()
        phases = _ingest_contract_map(
            seeded.get("phases") if isinstance(seeded, dict) else {}
        )
        kinds = _ingest_contract_map(
            seeded.get("kinds") if isinstance(seeded, dict) else {}
        )
    return {"phases": phases, "kinds": kinds}


def upsert_agent_flow_action_contracts(
    *,
    phases: dict[str, Any] | None = None,
    kinds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Replace flow action contracts (full document write)."""
    ensure_stage_rules()
    next_phases: dict[str, Any] = {}
    next_kinds: dict[str, Any] = {}
    if isinstance(phases, dict):
        for k, v in phases.items():
            key = str(k or "").strip()
            if not key:
                continue
            item = _normalize_action_contract_item(v)
            if item:
                next_phases[key] = item
    if isinstance(kinds, dict):
        for k, v in kinds.items():
            key = str(k or "").strip()
            if not key:
                continue
            item = _normalize_action_contract_item(v)
            if item:
                next_kinds[key] = item
    payload = {"phases": next_phases, "kinds": next_kinds}
    upsert_global_rule(
        rule_key=_AGENT_FLOW_ACTION_CONTRACTS_KEY,
        rule_value=json.dumps(payload, ensure_ascii=False),
        description="流程阶段/节点动作契约（Inspector 绑定与 inject 预设）",
        enabled=True,
    )
    return get_agent_flow_action_contracts()


def get_agent_flow_config() -> dict[str, Any]:
    """Fetch Admin editable agent flow graph + phase map from global rules."""
    ensure_stage_rules()
    rules = {r["ruleKey"]: r["ruleValue"] for r in list_global_rules()}
    graph_raw = str(rules.get(_AGENT_FLOW_RULE_KEY) or "").strip()
    phase_raw = str(rules.get(_AGENT_FLOW_PHASE_MAP_KEY) or "").strip()
    graph: dict[str, Any]
    phase_map: dict[str, str]
    try:
        parsed = json.loads(graph_raw) if graph_raw else {}
        graph = parsed if isinstance(parsed, dict) else {}
    except Exception:
        graph = {}
    try:
        parsed = json.loads(phase_raw) if phase_raw else {}
        phase_map = (
            {str(k): str(v) for k, v in parsed.items()}
            if isinstance(parsed, dict)
            else {}
        )
    except Exception:
        phase_map = {}
    if not graph:
        graph = _load_default_agent_flow_graph()
    if not phase_map:
        phase_map = dict(_load_default_agent_phase_map())
    graph, _changed = _normalize_agent_flow_graph(graph)
    if "start" not in phase_map:
        phase_map = {**phase_map, "start": "start"}
    if "end" not in phase_map:
        phase_map = {**phase_map, "end": "end"}
    return {"graph": graph, "phaseMap": phase_map}


def upsert_agent_flow_config(*, graph: dict[str, Any], phase_map: dict[str, str]) -> dict[str, Any]:
    """Persist Admin flow definition into design_global_rule."""
    ensure_stage_rules()
    if not isinstance(graph, dict):
        raise ValueError("graph must be object")
    if not isinstance(phase_map, dict):
        raise ValueError("phaseMap must be object")
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("graph must include nodes[] and edges[]")
    cleaned_phase_map = {
        str(k).strip(): str(v).strip()
        for k, v in phase_map.items()
        if str(k).strip() and str(v).strip()
    }
    upsert_global_rule(
        rule_key=_AGENT_FLOW_RULE_KEY,
        rule_value=json.dumps(graph, ensure_ascii=False),
        description="Agent 默认流程图（Admin 流程设计）",
    )
    upsert_global_rule(
        rule_key=_AGENT_FLOW_PHASE_MAP_KEY,
        rule_value=json.dumps(cleaned_phase_map, ensure_ascii=False),
        description="execution_log.phase 到流程节点映射",
    )
    # Keep catalog default flow in sync.
    try:
        item = get_agent_flow("default")
        if item:
            update_agent_flow(
                "default",
                name=str(item.get("name") or "默认 Agent 流程"),
                description=str(item.get("description") or ""),
                graph=graph,
                phase_map=cleaned_phase_map,
            )
    except Exception:
        pass
    return {"graph": graph, "phaseMap": cleaned_phase_map}


_AGENT_FLOWS_CATALOG_KEY = "agent.flows.catalog_json"


def _new_flow_id() -> str:
    return f"flow_{uuid.uuid4().hex[:12]}"


def _empty_graph() -> dict[str, Any]:
    return {"version": 1, "nodes": [], "edges": []}


def _normalize_agent_flow_graph(graph: dict[str, Any] | None) -> tuple[dict[str, Any], bool]:
    """Ensure start exists and orphan error exit is wired. Returns (graph, changed)."""
    raw = graph if isinstance(graph, dict) else _empty_graph()
    nodes = [n for n in (raw.get("nodes") or []) if isinstance(n, dict) and n.get("id")]
    edges = [e for e in (raw.get("edges") or []) if isinstance(e, dict)]
    if not nodes:
        return {"version": int(raw.get("version") or 1), "nodes": [], "edges": []}, False

    changed = False
    ids = {str(n.get("id")) for n in nodes}
    has_start = any(
        str(n.get("kind") or "").lower() == "start" or str(n.get("id")) == "start" for n in nodes
    )

    if not has_start:
        # Prefer linking into existing route entry; else first node without inbound.
        inbound = {str(e.get("target") or "") for e in edges}
        target = (
            "memory"
            if "memory" in ids
            else "route"
            if "route" in ids
            else next(
                (str(n.get("id")) for n in nodes if str(n.get("id")) not in inbound),
                str(nodes[0].get("id")),
            )
        )
        anchor = next((n for n in nodes if str(n.get("id")) == target), nodes[0])
        start_node = {
            "id": "start",
            "label": "",
            "description": "流程入口",
            "kind": "start",
            "capability": "control",
            "phaseKey": "start",
            "x": float(anchor.get("x") or 0) - 320,
            "y": float(anchor.get("y") or 0),
        }
        # Avoid id clash if somehow present without kind=start.
        if "start" in ids:
            start_node["id"] = "flow_start"
        nodes = [start_node, *nodes]
        edges = [
            {
                "id": "e_start",
                "source": str(start_node["id"]),
                "target": target,
                "label": "",
            },
            *edges,
        ]
        changed = True
        ids.add(str(start_node["id"]))

    # Wire orphan error exit: needs inbound + outbound to end when possible.
    if "error" in ids:
        has_in = any(str(e.get("target") or "") == "error" for e in edges)
        has_out = any(str(e.get("source") or "") == "error" for e in edges)
        edge_ids = {str(e.get("id") or "") for e in edges}
        if not has_in:
            src = "reflect" if "reflect" in ids else ("thought" if "thought" in ids else None)
            if src:
                eid = "e_to_error"
                n = 0
                while eid in edge_ids:
                    n += 1
                    eid = f"e_to_error_{n}"
                edges.append(
                    {
                        "id": eid,
                        "source": src,
                        "target": "error",
                        "label": "",
                        "condition": "fatal",
                        "priority": 10,
                        "isDefault": False,
                    }
                )
                edge_ids.add(eid)
                changed = True
        if not has_out and "end" in ids:
            eid = "e_error_end"
            n = 0
            while eid in edge_ids:
                n += 1
                eid = f"e_error_end_{n}"
            edges.append(
                {
                    "id": eid,
                    "source": "error",
                    "target": "end",
                    "label": "",
                    "condition": "fail_end",
                    "priority": 10,
                    "isDefault": True,
                }
            )
            changed = True

    # Expand parallel gateway → 并行 + 工具 + 汇聚.
    edge_ids = {str(e.get("id") or "") for e in edges}
    if "thought" in ids and (
        "parallel" in ids
        or "resource_join" in ids
        or "tool_details" in ids
    ):
        thought_n = next(n for n in nodes if str(n.get("id")) == "thought")
        tx = float(thought_n.get("x") or 1720)
        ty = float(thought_n.get("y") or 400)

        def _ensure_node(spec: dict[str, Any]) -> None:
            nonlocal changed
            nid = str(spec["id"])
            hit = next((n for n in nodes if str(n.get("id") or "") == nid), None)
            if hit is None:
                nodes.append(dict(spec))
                ids.add(nid)
                changed = True
                return
            for k, v in spec.items():
                if k in {"x", "y"}:
                    continue
                if hit.get(k) != v and (k not in hit or hit.get(k) in (None, "", [])):
                    hit[k] = v
                    changed = True
            if str(hit.get("kind") or "") == "resource" and nid == "parallel":
                hit["kind"] = "parallel"
                changed = True
            if nid == "parallel" and not str(hit.get("phaseKey") or "").strip():
                hit["phaseKey"] = "parallel"
                hit["kind"] = "parallel"
                hit["label"] = hit.get("label") or "并行网关"
                changed = True

        _ensure_node(
            {
                "id": "parallel",
                "label": "并行网关",
                "description": "分叉拉取工具详情；运行时 gather 后汇聚",
                "kind": "parallel",
                "capability": "control",
                "phaseKey": "parallel",
                "x": tx + 280,
                "y": ty,
            }
        )
        _ensure_node(
            {
                "id": "tool_details",
                "label": "工具详情",
                "description": "按需注入画布工具说明",
                "kind": "tool",
                "capability": "canvas_tools",
                "phaseKey": "tool_details",
                "configRef": "canvas_tools",
                "inject": {"mode": "details", "source": "canvas_tools"},
                "x": tx + 520,
                "y": ty + 160,
            }
        )
        _ensure_node(
            {
                "id": "resource_join",
                "label": "汇聚",
                "description": "等待分支完成后按 mode 回到思考",
                "kind": "join",
                "capability": "control",
                "phaseKey": "resource_join",
                "joinMode": "and",
                "x": tx + 760,
                "y": ty,
            }
        )

        edge_ids = {str(e.get("id") or "") for e in edges}

        def _ensure_edge(
            eid: str,
            source: str,
            target: str,
            condition: str,
            *,
            priority: int,
            is_default: bool = False,
        ) -> None:
            nonlocal edges, edge_ids, changed
            for e in edges:
                if str(e.get("source") or "") != source:
                    continue
                if condition and str(e.get("condition") or "") != condition:
                    continue
                if not condition and str(e.get("target") or "") != target:
                    continue
                if str(e.get("target") or "") != target:
                    e["target"] = target
                    changed = True
                e["condition"] = condition
                e["priority"] = priority
                e["isDefault"] = is_default
                return
            name = eid
            n = 0
            while name in edge_ids:
                n += 1
                name = f"{eid}_{n}"
            edges.append(
                {
                    "id": name,
                    "source": source,
                    "target": target,
                    "label": "",
                    "condition": condition,
                    "priority": priority,
                    "isDefault": is_default,
                }
            )
            edge_ids.add(name)
            changed = True

        _ensure_edge("e6_tools", "thought", "parallel", "need_tools&no_ops", priority=10)
        if "ask_thought" in ids:
            _ensure_edge(
                "e_ask_res_tools",
                "ask_thought",
                "parallel",
                "need_tools&no_ops",
                priority=7,
            )

        _ensure_edge(
            "e_par_tools",
            "parallel",
            "tool_details",
            "need_tools",
            priority=12,
            is_default=False,
        )
        _ensure_edge("e_tools_join", "tool_details", "resource_join", "", priority=10, is_default=True)

        # Scene / pack「提示词」nodes: wire into main path parallel → prompt_* → join.
        par_n = next((n for n in nodes if str(n.get("id") or "") == "parallel"), None)
        px = float((par_n or {}).get("x") or (tx + 280))
        py = float((par_n or {}).get("y") or ty)
        scene_prompts = [
            n
            for n in nodes
            if str(n.get("kind") or "").lower() == "prompt"
            and not str(n.get("promptKey") or "").strip().startswith("agent.prompt.")
            and str(n.get("id") or "") not in {"prompt_react", "prompt_plan", "prompt_ask"}
        ]
        scene_prompts.sort(key=lambda n: (float(n.get("y") or 0), str(n.get("id") or "")))
        for i, pn in enumerate(scene_prompts):
            pid = str(pn.get("id") or "")
            if not pid:
                continue
            lane_cond = ""
            has_in = any(
                str(e.get("source") or "") == "parallel" and str(e.get("target") or "") == pid
                for e in edges
            )
            if not has_in:
                pn["x"] = px + 240
                pn["y"] = py - 200 + i * 110
                changed = True
            _ensure_edge(
                f"e_par_{pid}",
                "parallel",
                pid,
                lane_cond,
                priority=20 + i,
                is_default=False,
            )
            _ensure_edge(f"e_{pid}_join", pid, "resource_join", "", priority=10, is_default=True)

        # System prompt nodes feed the LLM phases (not edited on the LLM card).
        sys_prompt_targets = {
            "prompt_react": "thought",
            "prompt_plan": "plan",
            "prompt_ask": "ask_thought",
        }
        for spid, target in sys_prompt_targets.items():
            if spid not in ids or target not in ids:
                continue
            sn = next(n for n in nodes if str(n.get("id") or "") == spid)
            tgt = next(n for n in nodes if str(n.get("id") or "") == target)
            has_bind = any(
                str(e.get("source") or "") == spid and str(e.get("target") or "") == target
                for e in edges
            )
            if not has_bind:
                sn["x"] = float(tgt.get("x") or 0)
                sn["y"] = float(tgt.get("y") or 0) - 160
                changed = True
            _ensure_edge(f"e_{spid}_to_{target}", spid, target, "prompt_bind", priority=99, is_default=False)

        # After fetch, ready → join (live exclusive path when lanes don't match).
        _ensure_edge("e_par_join", "parallel", "resource_join", "ready", priority=5, is_default=True)

        _ensure_edge(
            "e_join_agent",
            "resource_join",
            "thought",
            "mode=agent",
            priority=10,
            is_default=True,
        )
        if "ask_thought" in ids:
            _ensure_edge(
                "e_join_ask",
                "resource_join",
                "ask_thought",
                "mode=ask",
                priority=5,
                is_default=False,
            )

    # Also wire orphan prompt nodes when parallel/join already exist (draft without re-expand).
    if "parallel" in ids and "resource_join" in ids:
        edge_ids = {str(e.get("id") or "") for e in edges}
        par_n = next((n for n in nodes if str(n.get("id") or "") == "parallel"), None)
        px = float((par_n or {}).get("x") or 2000)
        py = float((par_n or {}).get("y") or 400)

        def _ensure_prompt_edge(
            eid: str,
            source: str,
            target: str,
            condition: str,
            *,
            priority: int,
            is_default: bool = False,
        ) -> None:
            nonlocal edges, edge_ids, changed
            for e in edges:
                if str(e.get("source") or "") == source and str(e.get("target") or "") == target:
                    if str(e.get("condition") or "") != condition:
                        e["condition"] = condition
                        changed = True
                    return
            name = eid
            n = 0
            while name in edge_ids:
                n += 1
                name = f"{eid}_{n}"
            edges.append(
                {
                    "id": name,
                    "source": source,
                    "target": target,
                    "label": "",
                    "condition": condition,
                    "priority": priority,
                    "isDefault": is_default,
                }
            )
            edge_ids.add(name)
            changed = True

        scene_prompts = [
            n
            for n in nodes
            if str(n.get("kind") or "").lower() == "prompt"
            and not str(n.get("promptKey") or "").strip().startswith("agent.prompt.")
            and str(n.get("id") or "") not in {"prompt_react", "prompt_plan", "prompt_ask"}
        ]
        scene_prompts.sort(key=lambda n: (float(n.get("y") or 0), str(n.get("id") or "")))
        for i, pn in enumerate(scene_prompts):
            pid = str(pn.get("id") or "")
            if not pid:
                continue
            has_in = any(
                str(e.get("source") or "") == "parallel" and str(e.get("target") or "") == pid
                for e in edges
            )
            has_out = any(
                str(e.get("source") or "") == pid and str(e.get("target") or "") == "resource_join"
                for e in edges
            )
            if not has_in or not has_out:
                pn["x"] = px + 240
                pn["y"] = py - 200 + i * 110
                changed = True
            if not has_in:
                _ensure_prompt_edge(
                    f"e_par_{pid}", "parallel", pid, "", priority=20 + i
                )
            if not has_out:
                _ensure_prompt_edge(
                    f"e_{pid}_join", pid, "resource_join", "", priority=10, is_default=True
                )

    # Edge condition 规范: wire field stores dict ``code`` only.
    # Display names stay on the frontend (dict label lookup by code).
    from app.services.design.admin.dict_store import resolve_edge_condition

    for e in edges:
        cond_raw = str(e.get("condition") or "").strip()
        code = resolve_edge_condition(cond_raw) if cond_raw else ""
        if code != cond_raw:
            e["condition"] = code
            changed = True
        elif "condition" not in e:
            e["condition"] = ""
            changed = True
        if "priority" not in e:
            e["priority"] = 100
            changed = True
        if "isDefault" not in e:
            e["isDefault"] = False
            changed = True
    for n in nodes:
        if str(n.get("kind") or "").lower() != "join":
            continue
        if str(n.get("joinMode") or "").lower() not in {"and", "or"}:
            n["joinMode"] = "and"
            changed = True

    # Seed inject bindings for known phases when missing.
    try:
        from app.services.design.runtime.flow_runtime import default_inject_for_node, normalize_inject

        for n in nodes:
            existing = n.get("inject")
            if isinstance(existing, dict) and existing:
                cleaned = normalize_inject(existing)
                if cleaned != existing:
                    n["inject"] = cleaned
                    changed = True
            else:
                seeded = default_inject_for_node(n)
                if seeded:
                    n["inject"] = seeded
                    changed = True
    except Exception:
        pass

    # Ask/Agent share: intent_classify → model_route (lanes) → thought.
    ids = {str(n.get("id")) for n in nodes}
    if "memory" in ids and "model_route" in ids:
        mem_n = next(n for n in nodes if str(n.get("id")) == "memory")
        if "mode_fork" not in ids:
            nodes.append(
                {
                    "id": "mode_fork",
                    "label": "",
                    "description": "",
                    "kind": "if_else",
                    "capability": "control",
                    "phaseKey": "mode_fork",
                    "x": float(mem_n.get("x") or 520) + 240,
                    "y": float(mem_n.get("y") or 400),
                }
            )
            ids.add("mode_fork")
            changed = True
        if "ask_thought" not in ids:
            nodes.append(
                {
                    "id": "ask_thought",
                    "label": "",
                    "description": "",
                    "kind": "ask",
                    "capability": "prompt",
                    "phaseKey": "ask_thought",
                    "promptKey": "agent.prompt.ask_system",
                    "inject": {"mode": "none", "specs": ["agent.prompt.ask_system"]},
                    "x": float(mem_n.get("x") or 520) + 480,
                    "y": float(mem_n.get("y") or 400) + 240,
                }
            )
            ids.add("ask_thought")
            changed = True
        if "intent_classify" not in ids:
            mr_n = next(n for n in nodes if str(n.get("id")) == "model_route")
            nodes.append(
                {
                    "id": "intent_classify",
                    "label": "意图识别",
                    "description": "小模型判定意图；闲聊直接结束，设计任务再进模型路由",
                    "kind": "classifier",
                    "capability": "control",
                    "phaseKey": "intent_classify",
                    "promptKey": "agent.prompt.intent_classify",
                    "inject": {
                        "mode": "none",
                        "specs": ["agent.prompt.intent_classify"],
                    },
                    "x": float(mr_n.get("x") or 1440) - 240,
                    "y": float(mr_n.get("y") or 400),
                }
            )
            ids.add("intent_classify")
            changed = True

        def _has_edge(src: str, tgt: str, cond: str = "") -> bool:
            for e in edges:
                if str(e.get("source") or "") != src or str(e.get("target") or "") != tgt:
                    continue
                if cond and str(e.get("condition") or "") != cond:
                    continue
                return True
            return False

        def _add_edge(
            eid: str,
            src: str,
            tgt: str,
            *,
            condition: str = "",
            priority: int = 10,
            is_default: bool = False,
        ) -> None:
            nonlocal changed
            # Same edge id: repair wire fields by id (never by mutable label).
            for e in edges:
                if str(e.get("id") or "") != eid:
                    continue
                if (
                    str(e.get("source") or "") != src
                    or str(e.get("target") or "") != tgt
                    or str(e.get("condition") or "") != condition
                    or int(e.get("priority") or 0) != priority
                    or bool(e.get("isDefault")) != is_default
                ):
                    e["source"] = src
                    e["target"] = tgt
                    e["condition"] = condition
                    e["priority"] = priority
                    e["isDefault"] = is_default
                    changed = True
                return
            if _has_edge(src, tgt, condition):
                return
            edges.append(
                {
                    "id": eid,
                    "source": src,
                    "target": tgt,
                    "label": "",
                    "condition": condition,
                    "priority": priority,
                    "isDefault": is_default,
                }
            )
            changed = True

        if "memory_ask" in ids:
            nodes[:] = [n for n in nodes if str(n.get("id")) != "memory_ask"]
            edges[:] = [
                e
                for e in edges
                if str(e.get("source") or "") != "memory_ask"
                and str(e.get("target") or "") != "memory_ask"
            ]
            ids.discard("memory_ask")
            changed = True

        before = len(edges)
        edges[:] = [
            e
            for e in edges
            if not (
                str(e.get("source") or "") == "mode_fork"
                and str(e.get("target") or "") == "memory"
            )
        ]
        if len(edges) != before:
            changed = True

        _add_edge("e_mem_fork", "memory", "mode_fork", is_default=True)

        # Repair mode_fork outs: identify by edge id / target, write dict codes
        # (mode=ask / short_plan_on / mode=agent). Never match on Chinese labels.
        def _fix_mode_fork_edge(
            e: dict[str, Any],
            *,
            condition: str,
            priority: int,
            is_default: bool,
        ) -> None:
            nonlocal changed
            if (
                str(e.get("condition") or "") != condition
                or bool(e.get("isDefault")) != is_default
                or int(e.get("priority") or 0) != priority
            ):
                e["condition"] = condition
                e["priority"] = priority
                e["isDefault"] = is_default
                changed = True

        has_mode_ask = False
        has_mode_agent = False
        has_mode_plan = False
        for e in edges:
            if str(e.get("source") or "") != "mode_fork":
                continue
            tgt = str(e.get("target") or "")
            eid = str(e.get("id") or "")
            # Ask must enter intent_classify (then model_route), never skip to ask_thought.
            if tgt == "ask_thought" or eid == "e_mode_ask" or (
                str(e.get("condition") or "") == "mode=ask"
                and tgt in {"ask_thought", "model_route", "intent_classify"}
            ):
                e["id"] = eid or "e_mode_ask"
                e["target"] = "intent_classify"
                _fix_mode_fork_edge(
                    e, condition="mode=ask", priority=5, is_default=False
                )
                has_mode_ask = True
            elif tgt == "plan" or eid == "e_mode_agent_plan":
                e["target"] = "plan"
                _fix_mode_fork_edge(
                    e, condition="short_plan_on", priority=10, is_default=False
                )
                has_mode_plan = True
            elif tgt in {"model_route", "intent_classify"} or eid == "e_mode_agent":
                # Keep Agent default separate from Ask→lane edge.
                if str(e.get("condition") or "") == "mode=ask":
                    continue
                e["target"] = "intent_classify"
                _fix_mode_fork_edge(
                    e, condition="mode=agent", priority=20, is_default=True
                )
                has_mode_agent = True

        if not has_mode_ask:
            _add_edge(
                "e_mode_ask",
                "mode_fork",
                "intent_classify",
                condition="mode=ask",
                priority=5,
            )
        if not has_mode_plan and "plan" in ids:
            _add_edge(
                "e_mode_agent_plan",
                "mode_fork",
                "plan",
                condition="short_plan_on",
                priority=10,
            )
        if not has_mode_agent:
            _add_edge(
                "e_mode_agent",
                "mode_fork",
                "intent_classify",
                condition="mode=agent",
                priority=20,
                is_default=True,
            )
        # Plan → intent_classify (not straight to model_route).
        for e in edges:
            if str(e.get("source") or "") != "plan":
                continue
            if str(e.get("target") or "") != "model_route":
                continue
            e["target"] = "intent_classify"
            changed = True
        _add_edge(
            "e_intent_chat",
            "intent_classify",
            "end",
            condition="intent=chat",
            priority=5,
        )
        _add_edge(
            "e_intent_continue",
            "intent_classify",
            "model_route",
            condition="",
            priority=20,
            is_default=True,
        )
        # Drop passthrough「任务分流」— Ask/Agent 分线 already owns branching.
        if "route" in ids and "memory" in ids:
            route_outs = [e for e in edges if str(e.get("source") or "") == "route"]
            only_to_mem = (not route_outs) or all(
                str(e.get("target") or "") == "memory" for e in route_outs
            )
            if only_to_mem:
                for e in edges:
                    if str(e.get("target") or "") == "route":
                        e["target"] = "memory"
                        changed = True
                before_r = len(edges)
                edges[:] = [e for e in edges if str(e.get("source") or "") != "route"]
                if len(edges) != before_r:
                    changed = True
                before_n = len(nodes)
                nodes[:] = [n for n in nodes if str(n.get("id")) != "route"]
                if len(nodes) != before_n:
                    changed = True
                ids.discard("route")
        # Ask 兜底续跑 Agent 主思考：勿再进 model_route（mode=ask 会绕回 ask_thought）。
        for e in edges:
            if str(e.get("source") or "") != "ask_thought":
                continue
            if str(e.get("target") or "") != "model_route":
                continue
            cond = str(e.get("condition") or "").strip()
            if cond:
                continue
            e["target"] = "thought"
            changed = True
        _add_edge(
            "e_ask_enough",
            "ask_thought",
            "thought",
            condition="",
            priority=20,
            is_default=True,
        )
        if "clarify" in ids:
            _add_edge(
                "e_ask_slot",
                "ask_thought",
                "clarify",
                condition="slot_missing",
                priority=5,
            )
            _add_edge(
                "e_ask_intent",
                "ask_thought",
                "clarify",
                condition="intent=ask&no_ops",
                priority=6,
            )
            _add_edge(
                "e_ask_obs_retry",
                "observe",
                "clarify",
                condition="mode=ask&op_failed",
                priority=15,
            )
            _add_edge(
                "e_ask_propose",
                "ask_thought",
                "action",
                condition="mode=ask&ops_valid",
                priority=10,
            )
        # Drop hydrate / dual_sample nodes; action owns hydrate.
        _drop_phases = {"hydrate", "dual_sample"}
        if ids & _drop_phases:
            for e in edges:
                if str(e.get("target") or "") in _drop_phases:
                    e["target"] = "action"
                    changed = True
                if str(e.get("source") or "") in _drop_phases:
                    e["source"] = "action" if "action" in ids else e.get("source")
                    if str(e.get("condition") or "") in ("ops_valid", ""):
                        e["condition"] = "ops_valid" if str(e.get("source")) != "action" else "wait_scene"
                    changed = True
            nodes[:] = [n for n in nodes if str(n.get("id") or "") not in _drop_phases]
            ids -= _drop_phases
            changed = True
        # hydrate→action rewires left action→action self-loops with empty
        # conditions; unconditional pick then infinite-loops after tool_ops.
        before_self = len(edges)
        edges[:] = [
            e
            for e in edges
            if not (
                str(e.get("source") or "").strip()
                and str(e.get("source") or "").strip()
                == str(e.get("target") or "").strip()
            )
        ]
        if len(edges) != before_self:
            changed = True
        if "action" in ids and "observe" in ids:
            _add_edge(
                "e24",
                "action",
                "observe",
                condition="wait_scene",
                priority=10,
                is_default=True,
            )
            for e in edges:
                if str(e.get("source") or "") != "action":
                    continue
                if str(e.get("target") or "") != "observe":
                    continue
                if (
                    str(e.get("condition") or "") != "wait_scene"
                    or not bool(e.get("isDefault"))
                    or int(e.get("priority") or 0) > 20
                ):
                    e["condition"] = "wait_scene"
                    e["isDefault"] = True
                    e["priority"] = min(int(e.get("priority") or 10), 10)
                    changed = True
        # Drop duplicate observe→verify / observe→reflect wires that lost their
        # conditions (empty cond becomes unconditional and races scene_ready).
        if "observe" in ids:
            cleaned: list[dict[str, Any]] = []
            seen_obs_targets: set[tuple[str, str]] = set()
            for e in edges:
                src = str(e.get("source") or "")
                tgt = str(e.get("target") or "")
                cond = str(e.get("condition") or "").strip()
                if src == "observe" and tgt == "verify" and not cond:
                    e["condition"] = "scene_ready"
                    e["priority"] = 5
                    e["isDefault"] = False
                    changed = True
                    cond = "scene_ready"
                if src == "observe" and tgt == "reflect" and not cond:
                    e["condition"] = "op_failed"
                    e["priority"] = 20
                    e["isDefault"] = False
                    changed = True
                    cond = "op_failed"
                key = (src, tgt + "|" + cond) if src == "observe" else ("", "")
                if src == "observe" and key in seen_obs_targets:
                    changed = True
                    continue
                if src == "observe":
                    seen_obs_targets.add(key)
                cleaned.append(e)
            if len(cleaned) != len(edges):
                edges[:] = cleaned
                changed = True
        # observe → verify; op_failed still clarify/reflect
        if "observe" in ids:
            if "verify" not in ids:
                nodes.append(
                    {
                        "id": "verify",
                        "label": "",
                        "description": "结构门禁；只写 verify_* flag",
                        "kind": "observe",
                        "capability": "io",
                        "phaseKey": "verify",
                        "x": 2420,
                        "y": 960,
                    }
                )
                ids.add("verify")
                changed = True
            for e in edges:
                if str(e.get("id") or "") == "e_ask_obs_retry" or (
                    str(e.get("source") or "") == "observe"
                    and str(e.get("target") or "") == "clarify"
                    and str(e.get("condition") or "") in ("mode=ask", "mode=ask&op_failed")
                ):
                    e["condition"] = "mode=ask&op_failed"
                    e["priority"] = 15
                    e["isDefault"] = False
                    changed = True
                if str(e.get("source") or "") == "observe" and str(e.get("target") or "") == "end":
                    cond = str(e.get("condition") or "").strip()
                    eid = str(e.get("id") or "")
                    # Ask 确认上屏 / apply_ops：ok → 结束（保留，勿改成校验）
                    if cond == "ok" or eid == "e_observe_ok":
                        e["id"] = eid or "e_observe_ok"
                        e["condition"] = "ok"
                        e["priority"] = 3
                        e["isDefault"] = False
                        changed = True
                    else:
                        # Empty observe→end skips the structure gate; send it through verify.
                        e["target"] = "verify"
                        e["condition"] = "scene_ready"
                        e["priority"] = 5
                        e["isDefault"] = False
                        if not e.get("id"):
                            e["id"] = "e_obs_verify"
                        changed = True
                if (
                    str(e.get("source") or "") == "observe"
                    and str(e.get("target") or "") == "thought"
                    and str(e.get("condition") or "") == "retry"
                ):
                    # retry after success now leaves from verify
                    e["source"] = "verify"
                    if not e.get("id"):
                        e["id"] = "e_verify_retry"
                    changed = True
            _add_edge(
                "e_observe_ok",
                "observe",
                "end",
                condition="ok",
                priority=3,
            )
            _add_edge(
                "e_obs_verify",
                "observe",
                "verify",
                condition="scene_ready",
                priority=5,
            )
            _add_edge("e_verify_ok", "verify", "end", condition="ok", priority=5)
            _add_edge(
                "e_verify_ask",
                "verify",
                "clarify",
                condition="mode=ask&verify_fail",
                priority=10,
            )
            _add_edge(
                "e_verify_reflect",
                "verify",
                "reflect",
                condition="verify_fail&reflect_left",
                priority=15,
            )
            _add_edge(
                "e_verify_clarify",
                "verify",
                "clarify",
                condition="verify_fail&no_reflect",
                priority=20,
            )
            _add_edge(
                "e_verify_retry",
                "verify",
                "thought",
                condition="retry",
                priority=25,
            )
            if "thought" in ids and "validate_fail" in ids:
                _add_edge(
                    "e_patch_broad",
                    "thought",
                    "validate_fail",
                    condition="patch_too_broad",
                    priority=28,
                )
        for e in edges:
            if (
                str(e.get("condition") or "") == "intent=ask"
                and str(e.get("target") or "") == "clarify"
            ):
                e["condition"] = "intent=ask&no_ops"
                changed = True
        _add_edge(
            "e_ask_chat",
            "ask_thought",
            "end",
            condition="intent=chat",
            priority=16,
        )
        _add_edge(
            "e_ask_done",
            "ask_thought",
            "end",
            condition="intent=done",
            priority=17,
        )
        # Agent 主线 thought：闲聊/完成须走到流程图 end（否则 runtime 会 via=settle 跳过「结束」）
        if "thought" in ids and "end" in ids:
            _add_edge(
                "e19b",
                "thought",
                "end",
                condition="intent=chat",
                priority=42,
            )
            _add_edge(
                "e19c",
                "thought",
                "end",
                condition="intent=done",
                priority=43,
            )
        if "action" in ids:
            _add_edge(
                "e_ask_propose",
                "ask_thought",
                "action",
                condition="mode=ask&ops_valid",
                priority=9,
            )

    ids = {str(n.get("id")) for n in nodes}

    if "model_route" in ids and "ask_thought" in ids:
        has_ask_lane = any(
            str(e.get("source") or "") == "model_route"
            and str(e.get("target") or "") == "ask_thought"
            and str(e.get("condition") or "") == "mode=ask"
            for e in edges
        )
        if not has_ask_lane:
            edges.append(
                {
                    "id": "e_route_ask",
                    "source": "model_route",
                    "target": "ask_thought",
                    "label": "",
                    "condition": "mode=ask",
                    "priority": 5,
                    "isDefault": False,
                }
            )
            changed = True

    if "model_route" in ids and "thought" in ids:
        thought_lane = [
            e
            for e in edges
            if str(e.get("source") or "") == "model_route"
            and str(e.get("target") or "") == "thought"
        ]
        if not thought_lane:
            edges.append(
                {
                    "id": "e5",
                    "source": "model_route",
                    "target": "thought",
                    "label": "",
                    "condition": "llm_call",
                    "priority": 10,
                    "isDefault": True,
                }
            )
            changed = True
        else:
            # Wire code must be llm_call (not display text). Missing default → settle.
            for e in thought_lane:
                if str(e.get("condition") or "").strip() == "llm_call" and bool(
                    e.get("isDefault")
                ):
                    continue
                e["condition"] = "llm_call"
                e["isDefault"] = True
                e["priority"] = 10
                changed = True

    # Collapse duplicate edge ids (normalization could append same eid twice).
    seen_eids: set[str] = set()
    deduped_edges: list[dict[str, Any]] = []
    for e in edges:
        eid = str(e.get("id") or "").strip()
        if eid and eid in seen_eids:
            changed = True
            continue
        if eid:
            seen_eids.add(eid)
        deduped_edges.append(e)
    if len(deduped_edges) != len(edges):
            changed = True
    edges = deduped_edges

    if not changed:
        return raw, False
    return {"version": int(raw.get("version") or 1), "nodes": nodes, "edges": edges}, True


def _load_flows_catalog() -> list[dict[str, Any]]:
    raw = _global_rule_value(_AGENT_FLOWS_CATALOG_KEY)
    items: list[dict[str, Any]] = []
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                items = [x for x in parsed if isinstance(x, dict) and x.get("id")]
        except Exception:
            items = []
    if items:
        return items
    # Seed default flow catalog when KV is empty.
    seed = {
        "id": "default",
        "name": "默认 Agent 流程",
        "description": "当前线上 Design Agent 默认执行图（LangGraph runtime）",
        "updatedAt": int(time.time() * 1000),
        "createdAt": int(time.time() * 1000),
        "graph": _load_default_agent_flow_graph(),
        "phaseMap": dict(_load_default_agent_phase_map()),
    }
    _save_flows_catalog([seed])
    return [seed]


def _save_flows_catalog(items: list[dict[str, Any]]) -> None:
    upsert_global_rule(
        rule_key=_AGENT_FLOWS_CATALOG_KEY,
        rule_value=json.dumps(items, ensure_ascii=False),
        description="Agent 流程目录（多流程）",
    )


def list_agent_flows() -> list[dict[str, Any]]:
    items = _load_flows_catalog()
    out: list[dict[str, Any]] = []
    for it in items:
        graph = it.get("graph") if isinstance(it.get("graph"), dict) else {}
        nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
        edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
        out.append(
            {
                "id": str(it.get("id")),
                "name": str(it.get("name") or "未命名流程"),
                "description": str(it.get("description") or ""),
                "nodeCount": len(nodes),
                "edgeCount": len(edges),
                "updatedAt": it.get("updatedAt"),
                "createdAt": it.get("createdAt"),
                "publishedVersion": int(it.get("publishedVersion") or 0) or None,
                "publishedAt": it.get("publishedAt"),
            }
        )
    out.sort(key=lambda x: int(x.get("updatedAt") or 0), reverse=True)
    return out


def _flow_public_view(
    it: dict[str, Any],
    *,
    graph: dict[str, Any],
    phase_map: dict[str, Any],
    include_published_graph: bool = False,
) -> dict[str, Any]:
    versions = it.get("versions") if isinstance(it.get("versions"), list) else []
    out: dict[str, Any] = {
        "id": str(it.get("id")),
        "name": str(it.get("name") or "未命名流程"),
        "description": str(it.get("description") or ""),
        "updatedAt": it.get("updatedAt"),
        "createdAt": it.get("createdAt"),
        "graph": graph,
        "phaseMap": {str(k): str(v) for k, v in phase_map.items()},
        "publishedVersion": int(it.get("publishedVersion") or 0) or None,
        "publishedAt": it.get("publishedAt"),
        "versions": [
            {
                "version": int(v.get("version") or 0),
                "publishedAt": v.get("publishedAt"),
                "name": str(v.get("name") or ""),
                "nodeCount": len((v.get("graph") or {}).get("nodes") or [])
                if isinstance(v.get("graph"), dict)
                else 0,
            }
            for v in versions
            if isinstance(v, dict)
        ][-20:],
    }
    # publishedGraph duplicates draft and can be MBs with prompt bloat — opt-in only.
    if include_published_graph:
        out["publishedGraph"] = (
            it.get("publishedGraph")
            if isinstance(it.get("publishedGraph"), dict)
            else None
        )
        out["publishedPhaseMap"] = (
            {
                str(k): str(v)
                for k, v in (it.get("publishedPhaseMap") or {}).items()
            }
            if isinstance(it.get("publishedPhaseMap"), dict)
            else None
        )
    else:
        out["publishedGraph"] = None
        out["publishedPhaseMap"] = None
    return out


def get_agent_flow(
    flow_id: str,
    *,
    include_published_graph: bool = False,
) -> dict[str, Any] | None:
    fid = (flow_id or "").strip()
    if not fid:
        return None
    items = _load_flows_catalog()
    for idx, it in enumerate(items):
        if str(it.get("id")) != fid:
            continue
        graph = it.get("graph") if isinstance(it.get("graph"), dict) else _empty_graph()
        phase_map = it.get("phaseMap") if isinstance(it.get("phaseMap"), dict) else {}
        # Normalize in-memory for runtime/Admin display only — never persist on GET
        # (would overwrite Admin graph with local template patches).
        graph, _changed = _normalize_agent_flow_graph(graph)
        # First-time: seed published from draft so runtime has a version.
        if not int(it.get("publishedVersion") or 0):
            it = publish_agent_flow(fid, note="auto-seed") or it
            refreshed = None
            for x in _load_flows_catalog():
                if str(x.get("id")) == fid:
                    refreshed = x
                    break
            if refreshed:
                it = refreshed
                graph = it.get("graph") if isinstance(it.get("graph"), dict) else graph
                phase_map = it.get("phaseMap") if isinstance(it.get("phaseMap"), dict) else phase_map
                graph, _ = _normalize_agent_flow_graph(
                    graph if isinstance(graph, dict) else _empty_graph()
                )
        return _flow_public_view(
            it,
            graph=graph,
            phase_map=phase_map,
            include_published_graph=include_published_graph,
        )
    return None


def get_agent_flow_version(flow_id: str, version: int) -> dict[str, Any] | None:
    """Return one published snapshot (graph + phaseMap) by version number."""
    fid = (flow_id or "").strip()
    ver = int(version or 0)
    if not fid or ver <= 0:
        return None
    items = _load_flows_catalog()
    raw = next((x for x in items if str(x.get("id")) == fid), None)
    if not raw:
        return None
    if int(raw.get("publishedVersion") or 0) == ver and isinstance(
        raw.get("publishedGraph"), dict
    ):
        graph, _ = _normalize_agent_flow_graph(raw.get("publishedGraph"))
        return {
            "id": fid,
            "version": ver,
            "publishedAt": raw.get("publishedAt"),
            "name": str(raw.get("name") or f"v{ver}"),
            "graph": graph,
            "phaseMap": {
                str(k): str(v)
                for k, v in (raw.get("publishedPhaseMap") or {}).items()
            },
        }
    history = raw.get("versions") if isinstance(raw.get("versions"), list) else []
    for v in history:
        if not isinstance(v, dict):
            continue
        if int(v.get("version") or 0) != ver:
            continue
        graph = v.get("graph") if isinstance(v.get("graph"), dict) else None
        if not graph:
            return None
        phase_map = v.get("phaseMap") if isinstance(v.get("phaseMap"), dict) else {}
        graph, _ = _normalize_agent_flow_graph(graph)
        return {
            "id": fid,
            "version": ver,
            "publishedAt": v.get("publishedAt"),
            "name": str(v.get("name") or f"v{ver}"),
            "graph": graph,
            "phaseMap": {str(k): str(v2) for k, v2 in phase_map.items()},
        }
    return None


def prompt_bodies_from_agent_flow_nodes(flow_id: str = "default") -> dict[str, str]:
    del flow_id
    return {}


def runtime_settings_from_agent_flow_nodes(flow_id: str = "default") -> dict[str, str]:
    del flow_id
    return {}


def get_published_agent_flow(flow_id: str = "default") -> dict[str, Any] | None:
    """Admin flowchart removed — no published graph."""
    del flow_id
    return None



def publish_agent_flow(flow_id: str, *, note: str = "") -> dict[str, Any] | None:
    """Copy draft graph → published snapshot and append version history."""
    fid = (flow_id or "").strip()
    if not fid:
        raise ValueError("flow_id required")
    items = _load_flows_catalog()
    for it in items:
        if str(it.get("id")) != fid:
            continue
        graph = it.get("graph") if isinstance(it.get("graph"), dict) else _empty_graph()
        phase_map = it.get("phaseMap") if isinstance(it.get("phaseMap"), dict) else {}
        graph, _ = _normalize_agent_flow_graph(graph)
        ver = int(it.get("publishedVersion") or 0) + 1
        now = int(time.time() * 1000)
        snap = {
            "version": ver,
            "publishedAt": now,
            "name": (note or "").strip() or f"v{ver}",
            "graph": graph,
            "phaseMap": {str(k): str(v) for k, v in phase_map.items()},
        }
        history = it.get("versions") if isinstance(it.get("versions"), list) else []
        history = [x for x in history if isinstance(x, dict)]
        history.append(snap)
        it["versions"] = history[-30:]
        it["publishedVersion"] = ver
        it["publishedAt"] = now
        it["publishedGraph"] = graph
        it["publishedPhaseMap"] = snap["phaseMap"]
        it["updatedAt"] = now
        if fid == "default":
            upsert_global_rule(
                rule_key=_AGENT_FLOW_RULE_KEY,
                rule_value=json.dumps(graph, ensure_ascii=False),
                description="Agent 默认流程图（已发布）",
            )
            upsert_global_rule(
                rule_key=_AGENT_FLOW_PHASE_MAP_KEY,
                rule_value=json.dumps(snap["phaseMap"], ensure_ascii=False),
                description="execution_log.phase 到流程节点映射（已发布）",
            )
        _save_flows_catalog(items)
        # Invalidate LangGraph cache if present
        try:
            from app.services.design.runtime.graph.build import invalidate_agent_graph_cache

            invalidate_agent_graph_cache(fid)
        except Exception:
            pass
        return _flow_public_view(it, graph=graph, phase_map=phase_map)
    raise ValueError("flow not found")


def create_agent_flow(
    *,
    name: str,
    description: str = "",
    graph: dict[str, Any] | None = None,
    phase_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    title = (name or "").strip() or "未命名流程"
    now = int(time.time() * 1000)
    item = {
        "id": _new_flow_id(),
        "name": title,
        "description": (description or "").strip(),
        "createdAt": now,
        "updatedAt": now,
        "graph": graph if isinstance(graph, dict) else _empty_graph(),
        "phaseMap": phase_map if isinstance(phase_map, dict) else {},
    }
    items = _load_flows_catalog()
    items.append(item)
    _save_flows_catalog(items)
    return get_agent_flow(str(item["id"])) or item


def update_agent_flow(
    flow_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    graph: dict[str, Any] | None = None,
    phase_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    fid = (flow_id or "").strip()
    items = _load_flows_catalog()
    found = False
    for it in items:
        if str(it.get("id")) != fid:
            continue
        found = True
        if name is not None:
            it["name"] = (name or "").strip() or str(it.get("name") or "未命名流程")
        if description is not None:
            it["description"] = (description or "").strip()
        if graph is not None:
            if not isinstance(graph, dict):
                raise ValueError("graph must be object")
            if not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
                raise ValueError("graph must include nodes[] and edges[]")
            graph, _ = _normalize_agent_flow_graph(graph)
            it["graph"] = graph
        if phase_map is not None:
            if not isinstance(phase_map, dict):
                raise ValueError("phaseMap must be object")
            it["phaseMap"] = {
                str(k).strip(): str(v).strip()
                for k, v in phase_map.items()
                if str(k).strip() and str(v).strip()
            }
        it["updatedAt"] = int(time.time() * 1000)
        # Sync default flow keys when editing default flow.
        if fid == "default" and isinstance(it.get("graph"), dict):
            upsert_global_rule(
                rule_key=_AGENT_FLOW_RULE_KEY,
                rule_value=json.dumps(it["graph"], ensure_ascii=False),
                description="Agent 默认流程图（Admin 流程设计）",
            )
            upsert_global_rule(
                rule_key=_AGENT_FLOW_PHASE_MAP_KEY,
                rule_value=json.dumps(it.get("phaseMap") or {}, ensure_ascii=False),
                description="execution_log.phase 到流程节点映射",
            )
        break
    if not found:
        raise ValueError("flow not found")
    _save_flows_catalog(items)
    item = get_agent_flow(fid)
    if not item:
        raise ValueError("flow not found")
    return item


def delete_agent_flow(flow_id: str) -> bool:
    fid = (flow_id or "").strip()
    if fid == "default":
        raise ValueError("cannot delete default flow")
    items = _load_flows_catalog()
    next_items = [it for it in items if str(it.get("id")) != fid]
    if len(next_items) == len(items):
        return False
    _save_flows_catalog(next_items)
    return True


def _is_start_node(n: dict[str, Any]) -> bool:
    kind = str(n.get("kind") or "").lower()
    return kind in {"start", "input"} or str(n.get("id") or "") == "start"


def _is_end_node(n: dict[str, Any]) -> bool:
    kind = str(n.get("kind") or "").lower()
    return kind in {"end", "output", "error", "observe"}


def test_run_agent_flow(*, flow_id: str, prompt: str = "") -> dict[str, Any]:
    """Dry-run: validate graph connectivity + walk reachable nodes from start.

    Does not call LLMs or mutate canvas — used by Admin「测试运行」.
    Walk uses flow_runtime (parallel fan-out + AND/OR join). Without a schedule
    context, explore_all=True so exclusive branches still surface for validation.
    """
    from app.services.design.runtime.flow_runtime import walk_agent_flow

    item = get_agent_flow(flow_id)
    if not item:
        raise ValueError("flow not found")
    graph = item.get("graph") if isinstance(item.get("graph"), dict) else {}
    nodes = [n for n in (graph.get("nodes") or []) if isinstance(n, dict)]
    edges = [e for e in (graph.get("edges") or []) if isinstance(e, dict)]
    node_by_id = {str(n.get("id") or ""): n for n in nodes if n.get("id")}
    issues: list[dict[str, Any]] = []

    if not nodes:
        issues.append({"level": "error", "code": "empty", "message": "流程没有节点"})

    starts = [n for n in nodes if _is_start_node(n)]
    if nodes and not starts:
        incoming = {str(e.get("target") or "") for e in edges}
        starts = [n for n in nodes if str(n.get("id") or "") not in incoming]
    if nodes and not starts:
        issues.append({"level": "error", "code": "no_start", "message": "缺少开始 / 入口节点"})

    for e in edges:
        eid = str(e.get("id") or "")
        src = str(e.get("source") or "")
        tgt = str(e.get("target") or "")
        if src not in node_by_id or tgt not in node_by_id:
            issues.append(
                {
                    "level": "error",
                    "code": "bad_edge",
                    "message": f"连线 {eid or '(无 id)'} 的 source/target 不存在",
                    "edgeId": eid,
                }
            )

    for n in nodes:
        nid = str(n.get("id") or "")
        kind = str(n.get("kind") or "").lower()
        cap = str(n.get("capability") or "")
        if kind in {"ask", "human"} or (cap == "prompt" and kind == "prompt"):
            has_prompt = bool(str(n.get("promptText") or "").strip() or str(n.get("promptKey") or "").strip())
            if not has_prompt:
                issues.append(
                    {
                        "level": "warning",
                        "code": "missing_prompt",
                        "message": f"节点 {nid} 未配置提示词",
                        "nodeId": nid,
                    }
                )
        if kind in {"classifier", "router"} or cap == "model_route":
            if not str(n.get("routeConfig") or "").strip():
                issues.append(
                    {
                        "level": "warning",
                        "code": "missing_route",
                        "message": f"节点 {nid} 未配置模型路由",
                        "nodeId": nid,
                    }
                )

    outgoing: dict[str, list[dict[str, Any]]] = {}
    incoming: dict[str, list[str]] = {}
    for e in edges:
        src = str(e.get("source") or "")
        tgt = str(e.get("target") or "")
        if src not in node_by_id:
            continue
        outgoing.setdefault(src, []).append(e)
        if tgt in node_by_id:
            incoming.setdefault(tgt, []).append(src)

    for n in nodes:
        nid = str(n.get("id") or "")
        kind = str(n.get("kind") or "").lower()
        if kind == "parallel" and len(outgoing.get(nid) or []) < 2:
            issues.append(
                {
                    "level": "warning",
                    "code": "parallel_outs",
                    "message": f"并行网关 {nid} 建议至少 2 条出边",
                    "nodeId": nid,
                }
            )
        if kind == "join":
            ins = incoming.get(nid) or []
            if len(ins) < 2:
                issues.append(
                    {
                        "level": "warning",
                        "code": "join_ins",
                        "message": f"汇聚 {nid} 建议至少 2 条入边（AND 等待全部到达）",
                        "nodeId": nid,
                    }
                )

    start_ids = [str(s.get("id")) for s in starts if s.get("id")]
    walked = walk_agent_flow(
        nodes=nodes,
        edges=edges,
        start_ids=start_ids,
        explore_all=True,
    )
    steps = walked.get("steps") or []
    visited = set(walked.get("visitedNodeIds") or [])
    for w in walked.get("warnings") or []:
        if isinstance(w, dict):
            issues.append(w)

    ends = [n for n in nodes if _is_end_node(n)]
    end_ids = {str(n.get("id")) for n in ends if n.get("id")}
    if end_ids and not (end_ids & visited):
        issues.append(
            {
                "level": "warning",
                "code": "end_unreachable",
                "message": "从入口无法到达结束 / 输出节点",
            }
        )

    orphan = [str(n.get("id")) for n in nodes if n.get("id") and str(n.get("id")) not in visited]
    if orphan:
        issues.append(
            {
                "level": "warning",
                "code": "orphans",
                "message": f"{len(orphan)} 个节点从入口不可达",
                "nodeIds": orphan[:40],
            }
        )

    has_error = any(i.get("level") == "error" for i in issues)
    return {
        "ok": not has_error and bool(steps),
        "flowId": str(item.get("id") or flow_id),
        "flowName": str(item.get("name") or ""),
        "prompt": (prompt or "").strip(),
        "issues": issues,
        "steps": steps,
        "visitedNodeIds": list(visited),
        "takenEdgeIds": list(walked.get("takenEdgeIds") or []),
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "ranAt": int(time.time() * 1000),
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


def list_flows() -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    with Session(engine) as session:
        rows = crud.list_all_design_execute_flows(session=session)
    out = []
    for r in rows:
        caps = r.step_token_caps
        flags = r.force_validate_flags
        try:
            skill_ids = json.loads(r.skill_ids or "[]")
        except Exception:
            skill_ids = []
        try:
            force_flags = json.loads(flags) if flags else []
        except Exception:
            force_flags = []
        try:
            token_caps = json.loads(caps) if caps else []
        except Exception:
            token_caps = []
        out.append(
            {
                "id": int(r.id or 0),
                "scene": r.scene,
                "skillIds": skill_ids,
                "forceValidateFlags": force_flags,
                "stepTokenCaps": token_caps,
                "failStrategy": r.fail_strategy or "retry_step",
                "enabled": bool(int(r.enabled or 0)),
            }
        )
    return out


def upsert_flow(
    *,
    scene: str,
    skill_ids: list[int],
    fail_strategy: str | None = None,
    enabled: bool | None = None,
    force_validate_flags: list[Any] | None = None,
    step_token_caps: list[Any] | None = None,
) -> dict[str, Any]:
    """Create/update execute flow for a scene. Skill prompts stay in design_skill rows."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_catalog()
    scene_key = (scene or "").strip().lower()
    if scene_key not in ("website", "mobile", "image", "poster", "drawing"):
        raise ValueError("invalid_scene")
    ids = [int(x) for x in (skill_ids or []) if int(x) > 0]
    now = time.time()
    strategy = (fail_strategy or "retry_step").strip() or "retry_step"
    en = 1 if (True if enabled is None else bool(enabled)) else 0
    flags_json = json.dumps(force_validate_flags if force_validate_flags is not None else [])
    caps_json = json.dumps(step_token_caps if step_token_caps is not None else [])
    with Session(engine) as session:
        if ids:
            ids = crud.filter_existing_design_skill_ids(session=session, skill_ids=ids)
        payload_ids = json.dumps(ids)
        row = crud.upsert_design_execute_flow(
            session=session,
            scene=scene_key,
            skill_ids_json=payload_ids,
            force_validate_flags=flags_json,
            step_token_caps=caps_json,
            fail_strategy=strategy,
            enabled=en,
            now=now,
        )
        fid = int(row.id or 0)
    for item in list_flows():
        if int(item["id"]) == fid or item["scene"] == scene_key:
            return item
    return {
        "id": fid,
        "scene": scene_key,
        "skillIds": ids,
        "forceValidateFlags": force_validate_flags or [],
        "stepTokenCaps": step_token_caps or [],
        "failStrategy": strategy,
        "enabled": bool(en),
    }


def _is_fail_status(status: str) -> bool:
    return (status or "").strip().lower() in ("failed", "error")


def _is_ok_status(status: str) -> bool:
    return (status or "").strip().lower() in ("done", "success", "completed", "succeeded")


def _parse_skill_ids_from_actual(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    out: list[int] = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("skill_id") is not None:
                try:
                    out.append(int(item["skill_id"]))
                except Exception:
                    pass
    return out


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

    from app import crud
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
            merged_defaults[_AGENT_FLOW_RULE_KEY] = json.dumps(
                _load_default_agent_flow_graph(), ensure_ascii=False
            )
            merged_defaults[_AGENT_FLOW_PHASE_MAP_KEY] = json.dumps(
                _load_default_agent_phase_map(), ensure_ascii=False
            )
            merged_defaults[_AGENT_FLOW_NODE_TEMPLATES_KEY] = json.dumps(
                _load_default_agent_flow_node_templates(), ensure_ascii=False
            )
            merged_defaults[_AGENT_FLOW_ACTION_CONTRACTS_KEY] = json.dumps(
                _load_default_action_contracts(), ensure_ascii=False
            )
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

