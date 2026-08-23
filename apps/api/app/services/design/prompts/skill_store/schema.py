"""Skill meta / I/O schema validation."""
from __future__ import annotations

import json
from typing import Any

from .constants import NS_CORE, NS_EXT, SOURCE_ADMIN, SOURCE_FILE
from .keys import _normalize_namespace, split_namespace_key


def _parse_json_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or raw is False:
        return None
    if isinstance(raw, dict):
        return raw
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        val = json.loads(s)
    except Exception:
        return None
    return val if isinstance(val, dict) else None

def validate_skill_io_schema(raw: Any, *, field: str) -> tuple[dict[str, Any] | None, list[str]]:
    """Strong-ish check: must be a JSON object (optional draft-like constraints)."""
    errs: list[str] = []
    if raw is None or raw == "" or raw is False:
        return None, errs
    obj = _parse_json_object(raw)
    if obj is None:
        errs.append(f"{field}_invalid_json_object")
        return None, errs
    t = obj.get("type")
    if t is not None and str(t).lower() not in ("object", "array", "string", "number", "boolean"):
        errs.append(f"{field}_unsupported_type:{t}")
    if "properties" in obj and not isinstance(obj.get("properties"), dict):
        errs.append(f"{field}_properties_must_be_object")
    if "required" in obj and not isinstance(obj.get("required"), list):
        errs.append(f"{field}_required_must_be_list")
    if "allowed_ops" in obj and not isinstance(obj.get("allowed_ops"), list):
        errs.append(f"{field}_allowed_ops_must_be_list")
    return obj, errs

def validate_against_schema(schema: dict[str, Any] | None, data: Any) -> list[str]:
    """Minimal JSON-Schema-like validator for skill input args / output contracts."""
    if not schema:
        return []
    errs: list[str] = []
    st = str(schema.get("type") or "object").lower()
    if st == "object":
        if data is None:
            data = {}
        if not isinstance(data, dict):
            return [f"expected_object_got_{type(data).__name__}"]
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        for key in required:
            k = str(key)
            if k not in data:
                errs.append(f"missing_required:{k}")
        for key, sub in props.items():
            if key not in data or not isinstance(sub, dict):
                continue
            errs.extend(
                f"{key}.{e}" for e in validate_against_schema(sub, data.get(key))
            )
        return errs
    if st == "array":
        if not isinstance(data, list):
            return ["expected_array"]
        try:
            mn = int(schema["minItems"]) if "minItems" in schema else None
            mx = int(schema["maxItems"]) if "maxItems" in schema else None
        except (TypeError, ValueError):
            mn = mx = None
        if mn is not None and len(data) < mn:
            errs.append(f"minItems:{mn}")
        if mx is not None and len(data) > mx:
            errs.append(f"maxItems:{mx}")
        return errs
    if st == "string" and not isinstance(data, str):
        return ["expected_string"]
    if st == "number" and not isinstance(data, (int, float)):
        return ["expected_number"]
    if st == "boolean" and not isinstance(data, bool):
        return ["expected_boolean"]
    if "enum" in schema and isinstance(schema.get("enum"), list):
        if data not in schema["enum"]:
            errs.append("enum_mismatch")
    return errs

def validate_skill_meta(item: dict[str, Any], *, source: str) -> list[str]:
    """Validate seed/file/admin skill registration payload before upsert."""
    from .pack_io import _CORE_RESERVED_KEYS
    from .runtime import _parse_allowed_resources

    errs: list[str] = []
    key = str(item.get("skill_key") or "").strip()
    if not key:
        errs.append("skill_key_required")
    name = str(item.get("name") or "").strip()
    if not name:
        errs.append("name_required")
    body = str(item.get("prompt_positive") or "").strip()
    if not body:
        errs.append("prompt_positive_required")
    ns = _normalize_namespace(
        item.get("namespace"), source=source
    )
    ns_prefix, local = split_namespace_key(key)
    if ns_prefix and ns_prefix != ns:
        errs.append(f"namespace_key_mismatch:{ns_prefix}!={ns}")
    local_key = local or key
    if source == SOURCE_ADMIN:
        if local_key in _CORE_RESERVED_KEYS or (
            ns_prefix == NS_CORE or (not ns_prefix and local_key in _CORE_RESERVED_KEYS)
        ):
            errs.append(f"core_key_reserved:{local_key}")
        if ns_prefix == NS_EXT:
            errs.append("user_skill_cannot_use_ext_namespace")
    if source == SOURCE_FILE and local_key in _CORE_RESERVED_KEYS:
        errs.append(f"file_pack_collides_core:{local_key}")
    prefs = item.get("preferred_tools") or []
    if prefs is not None and not isinstance(prefs, (list, str)):
        errs.append("preferred_tools_invalid")
    _, in_errs = validate_skill_io_schema(
        item.get("input_schema"), field="input_schema"
    )
    errs.extend(in_errs)
    _, out_errs = validate_skill_io_schema(
        item.get("output_schema"), field="output_schema"
    )
    errs.extend(out_errs)
    ar = item.get("allowed_resources")
    if ar is not None:
        parsed = _parse_allowed_resources(ar)
        if parsed is None and not isinstance(ar, list) and str(ar).strip():
            # empty list is valid; unparsable non-empty → error
            if _parse_allowed_resources(ar) is None and str(ar).strip() not in ("[]",):
                try:
                    json.loads(str(ar))
                except Exception:
                    errs.append("allowed_resources_invalid")
    return errs
