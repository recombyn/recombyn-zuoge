"""Canvas Action registry — schema (Admin/DB) + FE execute by the same op_key.

Each action has type + hint/schema for the model; apply runs on the client.
This module seeds missing rows into design_canvas_tool (never overwrites non-empty Admin hints).

Seed source: apps/api/seeds/canvas_actions_seed.json
"""

from __future__ import annotations

import json
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.config import resolve_seed_file
from app.core.db import engine

_actions_cache: list[dict[str, Any]] | None = None
_stale_checks_cache: dict[str, dict[str, Any]] | None = None


def _load_seed() -> dict[str, Any]:
    try:
        parsed = json.loads(resolve_seed_file("canvas_actions_seed.json").read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def default_canvas_actions() -> list[dict[str, Any]]:
    """Actions from canvas_actions_seed.json (for ensure/seed into DB)."""
    global _actions_cache
    if _actions_cache is not None:
        return _actions_cache
    seed = _load_seed()
    raw = seed.get("actions")
    out: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            key = str(item.get("op_key") or "").strip()
            if not key:
                continue
            out.append(item)
    _actions_cache = out
    return out


def _stale_schema_checks() -> dict[str, dict[str, Any]]:
    global _stale_checks_cache
    if _stale_checks_cache is not None:
        return _stale_checks_cache
    seed = _load_seed()
    raw = seed.get("staleSchemaChecks")
    out: dict[str, dict[str, Any]] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if not isinstance(v, dict):
                continue
            out[str(k)] = {
                "must_contain": tuple(v.get("must_contain") or ()),
                "stale_if_contains": tuple(v.get("stale_if_contains") or ()),
            }
    _stale_checks_cache = out
    return out


def _schema_is_stale(op_key: str, existing_schema: str, seed_schema: str) -> bool:
    existing = (existing_schema or "").strip()
    if not existing:
        return True
    if existing == seed_schema:
        return False
    check = _stale_schema_checks().get(op_key)
    if not check:
        return False
    for needle in check.get("stale_if_contains") or ():
        if needle in existing:
            return True
    for needle in check.get("must_contain") or ():
        if needle not in existing:
            return True
    return False


def ensure_action_registry(*, force_hints: bool = False) -> int:
    """Insert missing design_canvas_tool rows. Returns number of inserts/updates.

    Never overwrites a non-empty model_hint / label unless force_hints=True.
    """
    now = time.time()
    changed = 0
    with Session(engine) as session:
        for item in default_canvas_actions():
            key = item["op_key"]
            schema_s = json.dumps(item.get("args_schema") or {}, ensure_ascii=False)
            row = crud.get_design_canvas_tool(session=session, op_key=key)
            if not row:
                try:
                    crud.insert_design_canvas_tool(
                        session=session,
                        op_key=key,
                        kind=str(item["kind"]),
                        label=str(item["label"]),
                        model_hint=str(item["model_hint"]),
                        args_schema=schema_s,
                        sort_order=int(item["sort_order"]),
                        created_at=now,
                    )
                except Exception:
                    # Older schema without args_schema — insert without it.
                    crud.insert_design_canvas_tool(
                        session=session,
                        op_key=key,
                        kind=str(item["kind"]),
                        label=str(item["label"]),
                        model_hint=str(item["model_hint"]),
                        args_schema=None,
                        sort_order=int(item["sort_order"]),
                        created_at=now,
                    )
                changed += 1
                continue
            hint = str(row.model_hint or "").strip()
            existing_schema = str(row.args_schema or "").strip()
            # Existing row is Admin-owned: only fill empty columns. Never rewrite
            # kind/label/hint/sort_order when already set (unless force_hints).
            # Seed schema drift (staleSchemaChecks) may refresh args_schema + hint.
            schema_stale = bool(existing_schema) and _schema_is_stale(
                key, existing_schema, schema_s
            )
            if force_hints or schema_stale:
                crud.update_design_canvas_tool_fields(
                    session=session,
                    op_key=key,
                    fields={
                        "kind": item["kind"],
                        "label": item["label"],
                        "model_hint": item["model_hint"],
                        "args_schema": schema_s,
                        "sort_order": int(item["sort_order"]),
                    },
                    updated_at=now,
                )
                changed += 1
                continue
            if not hint and item.get("model_hint"):
                crud.update_design_canvas_tool_fields(
                    session=session,
                    op_key=key,
                    fields={"model_hint": item["model_hint"]},
                    updated_at=now,
                )
                changed += 1
            if not existing_schema:
                try:
                    crud.update_design_canvas_tool_fields(
                        session=session,
                        op_key=key,
                        fields={"args_schema": schema_s},
                        updated_at=now,
                    )
                    changed += 1
                except Exception:
                    pass
        session.commit()
    return changed
