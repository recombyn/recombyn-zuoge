"""Design dictionary CRUD."""
from __future__ import annotations
import json
import threading
import time
from typing import Any

from sqlalchemy import or_
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import DesignDict

# Catalog of dict types lives as rows under this reserved dict_type.
TYPE_CATALOG = "__types__"

_DICTS_READY = False
_DICTS_LOCK = threading.RLock()
# Bump when seeds/design_dicts_seed.json gains rows (also stored as seed.rev).
_DICT_SEED_REV = 29
_seeded_rev = 0
# Label lookup cache (resolve_edge_condition is identity — no per-edge DB).
_EDGE_COND_LABELS: dict[str, str] | None = None
_EDGE_COND_LABELS_LOCK = threading.Lock()


def _invalidate_edge_condition_label_cache() -> None:
    global _EDGE_COND_LABELS
    with _EDGE_COND_LABELS_LOCK:
        _EDGE_COND_LABELS = None


def _dicts_data_path():
    from app.core.config import resolve_seed_file

    return resolve_seed_file("design_dicts_seed.json")


def _load_dicts_seed() -> dict:
    path = _dicts_data_path()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _dict_type_defaults() -> list[tuple[str, str, int]]:
    seed = _load_dicts_seed()
    out: list[tuple[str, str, int]] = []
    for row in seed.get("types") or []:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        label = str(row.get("label") or "").strip()
        if not code or not label:
            continue
        try:
            sort_order = int(row.get("sortOrder") or 0)
        except Exception:
            sort_order = 0
        out.append((code, label, sort_order))
    return out


def _dict_item_defaults() -> list[tuple[str, str, str, int]]:
    seed = _load_dicts_seed()
    out: list[tuple[str, str, str, int]] = []
    for row in seed.get("items") or []:
        if not isinstance(row, dict):
            continue
        dict_type = str(row.get("dictType") or "").strip()
        code = str(row.get("code") or "").strip()
        label = str(row.get("label") or "").strip()
        if not dict_type or not code or not label:
            continue
        try:
            sort_order = int(row.get("sortOrder") or 0)
        except Exception:
            sort_order = 0
        out.append((dict_type, code, label, sort_order))
    return out


def _dict_description_defaults() -> dict[tuple[str, str], str]:
    seed = _load_dicts_seed()
    raw = seed.get("descriptions") or {}
    out: dict[tuple[str, str], str] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        key = str(k or "")
        if "|" not in key:
            continue
        typ, code = key.split("|", 1)
        typ, code = typ.strip(), code.strip()
        if typ and code:
            out[(typ, code)] = str(v or "")
    return out


# Compatibility aliases (loaded from JSON; prefer _dict_*_defaults() at runtime).
DICT_TYPE_DEFAULTS = _dict_type_defaults()
DICT_DEFAULTS = _dict_item_defaults()
DICT_DESCRIPTION_DEFAULTS = _dict_description_defaults()


def resolve_edge_condition(raw: str) -> str:
    """Normalize edge condition to dict ``code`` / predicate string.

    Identity strip only: never reverse-maps mutable display ``label`` → code,
    and never hits MySQL (Admin GET / normalize used to N+1 list_dicts per edge).
    """
    return str(raw or "").strip()


def edge_condition_label(code: str) -> str:
    """Display name for a flow_edge_condition code (empty if unknown)."""
    global _EDGE_COND_LABELS
    key = str(code or "").strip()
    if not key:
        return ""
    labels = _EDGE_COND_LABELS
    if labels is None:
        with _EDGE_COND_LABELS_LOCK:
            labels = _EDGE_COND_LABELS
            if labels is None:
                labels = {}
                try:
                    items = list_dicts(dict_type="flow_edge_condition", enabled=True)
                    for i in items:
                        c = str(i.get("code") or "").strip()
                        if c:
                            labels[c] = str(i.get("label") or "").strip()
                except Exception:
                    pass
                if not labels:
                    for typ, c, label, _ord in _dict_item_defaults():
                        if typ == "flow_edge_condition" and str(c).strip():
                            labels[str(c).strip()] = str(label).strip()
                _EDGE_COND_LABELS = labels
    return str(labels.get(key) or "")


def _norm_type_code(raw: str) -> str:
    return str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")


def _pub_dict(r: Any) -> dict[str, Any]:
    if hasattr(r, "model_dump"):
        desc = str(getattr(r, "description", None) or "").strip()
        return {
            "id": int(r.id or 0),
            "dictType": r.dict_type,
            "code": r.code,
            "label": r.label,
            "description": desc,
            "sortOrder": int(r.sort_order or 0),
            "enabled": bool(int(r.enabled or 0)),
            "updatedAt": int(float(r.updated_at) * 1000) if r.updated_at else None,
        }
    keys = r.keys() if hasattr(r, "keys") else ()
    desc = ""
    if "description" in keys:
        desc = str(r["description"] or "").strip()
    return {
        "id": int(r["id"]),
        "dictType": r["dict_type"],
        "code": r["code"],
        "label": r["label"],
        "description": desc,
        "sortOrder": int(r["sort_order"] or 0),
        "enabled": bool(int(r["enabled"] or 0)),
        "updatedAt": int(float(r["updated_at"]) * 1000) if r["updated_at"] else None,
    }


def _pub_type(r: Any) -> dict[str, Any]:
    if hasattr(r, "model_dump"):
        return {
            "id": int(r.id or 0),
            "code": r.code,
            "label": r.label,
            "sortOrder": int(r.sort_order or 0),
            "enabled": bool(int(r.enabled or 0)),
            "updatedAt": int(float(r.updated_at) * 1000) if r.updated_at else None,
        }
    return {
        "id": int(r["id"]),
        "code": r["code"],
        "label": r["label"],
        "sortOrder": int(r["sort_order"] or 0),
        "enabled": bool(int(r["enabled"] or 0)),
        "updatedAt": int(float(r["updated_at"]) * 1000) if r["updated_at"] else None,
    }


def _seed_dict_rows(session: Session, *, now: float) -> None:
    """Insert missing default dict items / types (idempotent). Never overwrite labels.

    One SELECT of existing rows — avoid per-seed-item roundtrips on remote MySQL.
    """
    # Flow-designer / unused dict families — wipe types + items (seed keeps scene only).
    _retired_types = (
        "precheck_signal",
        "flow_ask_slot",
        "flow_ask_never",
        "flow_prompt_key",
        "flow_inject_substitute",
        "flow_edge_condition",
        "flow_phase",
        "flow_config_ref",
        "flow_capability",
        "flow_inject_mode",
        "flow_inject_source",
        "flow_inject_validate",
        "flow_action_rule",
        "flow_assign_rule",
        "flow_binding_field",
        "flow_node_kind",
        "flow_node_block",
        "skill_category",
        "output_format",
        "task_tier",
        "precheck_block",
        "library_kind",
        "button_type",
    )
    for retired in _retired_types:
        session.execute(delete(DesignDict).where(DesignDict.dict_type == retired))
        session.execute(
            delete(DesignDict)
            .where(DesignDict.dict_type == TYPE_CATALOG)
            .where(DesignDict.code == retired)
        )
    # Drop retired scene codes (product scenes are website/mobile/image/poster/drawing).
    for code in ("ui", "illustration", "ecommerce", "detail_page", "banner", "social"):
        session.execute(
            delete(DesignDict)
            .where(DesignDict.dict_type == "scene")
            .where(DesignDict.code == code)
        )
    # Heal live scenes wrongly marked「已废弃」/ disabled in Admin.
    for code, label in (
        ("all", "All scenes"),
        ("website", "Website"),
        ("mobile", "Mobile"),
        ("image", "Image"),
        ("poster", "Poster"),
        ("drawing", "Drawing"),
    ):
        rows = list(
            session.exec(
                select(DesignDict)
                .where(DesignDict.dict_type == "scene")
                .where(DesignDict.code == code)
                .where(
                    or_(
                        DesignDict.enabled == 0,
                        col(DesignDict.label).like("%废弃%"),
                    )
                )
            ).all()
        )
        for row in rows:
            row.label = label
            row.enabled = 1
            row.updated_at = now
            session.add(row)

    # Prefer live seed load so rev bumps apply without process restart races.
    type_defaults = _dict_type_defaults()
    item_defaults = _dict_item_defaults()
    descs = _dict_description_defaults()

    # On seed rev bump: re-sync labels/sort for product enums (Admin display may have
    # been garbled by encoding; seed is source of truth for these type codes).
    try:
        seed_rev = int((_load_dicts_seed().get("rev") or 0))
    except Exception:
        seed_rev = 0
    force_label_sync = seed_rev > _seeded_rev

    existing_rows = list(session.exec(select(DesignDict)).all())
    by_key: dict[tuple[str, str], DesignDict] = {}
    for row in existing_rows:
        by_key[(str(row.dict_type), str(row.code))] = row

    for dict_type, code, label, sort_order in item_defaults:
        desc = descs.get((dict_type, code), "")
        row = by_key.get((dict_type, code))
        if row:
            old_label = str(row.label or "")
            try:
                old_sort = int(row.sort_order or 0)
            except Exception:
                old_sort = 0
            # Rev bump: restore seed labels (fixes encoding garble / drift).
            if force_label_sync and (old_label != label or old_sort != sort_order):
                row.label = label
                row.sort_order = sort_order
                row.enabled = 1
                row.updated_at = now
                session.add(row)
            # Fill empty description from seed once; never overwrite Admin edits.
            if desc and not str(row.description or "").strip():
                row.description = desc
                row.updated_at = now
                session.add(row)
            continue
        session.add(
            DesignDict(
                dict_type=dict_type,
                code=code,
                label=label,
                description=desc or None,
                sort_order=sort_order,
                enabled=1,
                created_at=now,
                updated_at=now,
            )
        )
    for code, label, sort_order in type_defaults:
        row = by_key.get((TYPE_CATALOG, code))
        if row:
            # Keep type catalog names aligned with product UI (seed is source for type labels).
            old_label = str(row.label or "")
            try:
                old_sort = int(row.sort_order or 0)
            except Exception:
                old_sort = 0
            if old_label != label or old_sort != sort_order:
                row.label = label
                row.sort_order = sort_order
                row.updated_at = now
                session.add(row)
            continue
        session.add(
            DesignDict(
                dict_type=TYPE_CATALOG,
                code=code,
                label=label,
                description=None,
                sort_order=sort_order,
                enabled=1,
                created_at=now,
                updated_at=now,
            )
        )

    # Rev bump: drop obsolete enum codes (e.g. retired prompt_pack_kind need packs).
    # Include every product type from seed even when its item list is empty.
    if force_label_sync:
        allowed_by_type: dict[str, set[str]] = {
            str(code): set() for code, _label, _sort in type_defaults if str(code) != TYPE_CATALOG
        }
        for dict_type, code, _label, _sort in item_defaults:
            allowed_by_type.setdefault(str(dict_type), set()).add(str(code))
        for dict_type, allowed in allowed_by_type.items():
            if not allowed:
                session.execute(
                    delete(DesignDict).where(DesignDict.dict_type == dict_type)
                )
                continue
            session.execute(
                delete(DesignDict)
                .where(DesignDict.dict_type == dict_type)
                .where(col(DesignDict.code).not_in(sorted(allowed)))
            )

    # Drop orphan type-catalog rows not in seed.
    allowed_types = {str(code) for code, _label, _sort in type_defaults}
    if allowed_types:
        session.execute(
            delete(DesignDict)
            .where(DesignDict.dict_type == TYPE_CATALOG)
            .where(col(DesignDict.code).not_in(sorted(allowed_types)))
        )
        # Drop any leftover item rows outside allowed types (manual orphans).
        session.execute(
            delete(DesignDict)
            .where(DesignDict.dict_type != TYPE_CATALOG)
            .where(col(DesignDict.dict_type).not_in(sorted(allowed_types)))
        )
    else:
        session.execute(
            delete(DesignDict).where(DesignDict.dict_type != TYPE_CATALOG)
        )


def ensure_design_dicts() -> None:
    """Seed dict rows only — avoid init_schema()/full catalog (slow on remote MySQL)."""
    global _DICTS_READY, _seeded_rev
    if _DICTS_READY and _seeded_rev >= _DICT_SEED_REV:
        return
    with _DICTS_LOCK:
        if _DICTS_READY and _seeded_rev >= _DICT_SEED_REV:
            return
        now = time.time()
        from app.services.design.admin.schema import ensure_design_tables_boot

        ensure_design_tables_boot()
        with Session(engine) as session:
            _seed_dict_rows(session, now=now)
            session.commit()
        try:
            rev = int((_load_dicts_seed().get("rev") or _DICT_SEED_REV))
        except Exception:
            rev = _DICT_SEED_REV
        _seeded_rev = max(_DICT_SEED_REV, rev)
        _DICTS_READY = True
        _invalidate_edge_condition_label_cache()


def list_dicts(*, dict_type: str | None = None, enabled: bool | None = True) -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_dicts()
    with Session(engine) as session:
        rows = crud.list_design_dicts(
            session=session,
            dict_type=dict_type,
            enabled=enabled,
            exclude_type=TYPE_CATALOG,
        )
    return [_pub_dict(r) for r in rows]


def list_dict_types(*, enabled: bool | None = None) -> list[dict[str, Any]]:
    """Dictionary categories for the left tree."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_dicts()
    with Session(engine) as session:
        rows = crud.list_design_dicts(
            session=session,
            dict_type=TYPE_CATALOG,
            enabled=enabled,
            exclude_type=None,
        )
    return [_pub_type(r) for r in rows]


def upsert_dict_type(payload: dict[str, Any]) -> dict[str, Any]:
    """Create/update a dict type. Renaming `code` migrates all item rows."""
    from sqlmodel import Session, select

    from app import crud
    from app.core.db import engine
    from app.models import DesignDict

    ensure_design_dicts()
    code = _norm_type_code(str(payload.get("code") or ""))
    label = str(payload.get("label") or "").strip()
    if not code or not label:
        raise ValueError("code, label required")
    if code == TYPE_CATALOG or code.startswith("__"):
        raise ValueError("reserved type code")
    sort_order = int(payload.get("sortOrder") or 0)
    enabled = 1 if payload.get("enabled", True) else 0
    item_id = payload.get("id")
    now = time.time()
    with Session(engine) as session:
        if item_id:
            prev = session.exec(
                select(DesignDict)
                .where(DesignDict.id == int(item_id))
                .where(DesignDict.dict_type == TYPE_CATALOG)
            ).first()
            if not prev:
                raise ValueError("type not found")
            old_code = str(prev.code)
            if code != old_code:
                clash = crud.get_design_dict_by_type_code(
                    session=session, dict_type=TYPE_CATALOG, code=code
                )
                if clash and clash.id != int(item_id):
                    raise ValueError("type code already exists")
                for item in session.exec(
                    select(DesignDict).where(DesignDict.dict_type == old_code)
                ).all():
                    item.dict_type = code
                    item.updated_at = now
                    session.add(item)
            prev.code = code
            prev.label = label
            prev.sort_order = sort_order
            prev.enabled = enabled
            prev.updated_at = now
            session.add(prev)
            session.commit()
            session.refresh(prev)
            row = prev
        else:
            existing = crud.get_design_dict_by_type_code(
                session=session, dict_type=TYPE_CATALOG, code=code
            )
            if existing:
                existing.label = label
                existing.sort_order = sort_order
                existing.enabled = enabled
                existing.updated_at = now
                session.add(existing)
                session.commit()
                session.refresh(existing)
                row = existing
            else:
                row = DesignDict(
                    dict_type=TYPE_CATALOG,
                    code=code,
                    label=label,
                    sort_order=sort_order,
                    enabled=enabled,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
    return _pub_type(row)


def delete_dict_type(type_id: int) -> bool:
    """Remove a type catalog row and soft-disable all its items."""
    from sqlmodel import Session, select

    from app.core.db import engine
    from app.models import DesignDict

    ensure_design_dicts()
    now = time.time()
    with Session(engine) as session:
        row = session.exec(
            select(DesignDict)
            .where(DesignDict.id == int(type_id))
            .where(DesignDict.dict_type == TYPE_CATALOG)
        ).first()
        if not row:
            return False
        code = str(row.code)
        for item in session.exec(
            select(DesignDict).where(DesignDict.dict_type == code)
        ).all():
            item.enabled = 0
            item.updated_at = now
            session.add(item)
        session.delete(row)
        session.commit()
    return True


def upsert_dict(payload: dict[str, Any]) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import DesignDict

    ensure_design_dicts()
    dict_type = _norm_type_code(str(payload.get("dictType") or ""))
    # Keep condition keys like intent=chat / mode=ask&has_ops intact.
    code = str(payload.get("code") or "").strip()
    label = str(payload.get("label") or "").strip()
    description = str(payload.get("description") or "").strip()
    if not dict_type or not code or not label:
        raise ValueError("dictType, code, label required")
    if dict_type == TYPE_CATALOG or dict_type.startswith("__"):
        raise ValueError("reserved dictType")
    sort_order = int(payload.get("sortOrder") or 0)
    enabled = 1 if payload.get("enabled", True) else 0
    item_id = payload.get("id")
    now = time.time()
    with Session(engine) as session:
        if item_id:
            row = crud.get_design_dict(session=session, item_id=int(item_id))
            if not row:
                raise ValueError("dict not found")
            row.dict_type = dict_type
            row.code = code
            row.label = label
            row.description = description or None
            row.sort_order = sort_order
            row.enabled = enabled
            row.updated_at = now
            session.add(row)
            session.commit()
            session.refresh(row)
        else:
            existing = crud.get_design_dict_by_type_code(
                session=session, dict_type=dict_type, code=code
            )
            if existing:
                existing.label = label
                existing.description = description or None
                existing.sort_order = sort_order
                existing.enabled = enabled
                existing.updated_at = now
                session.add(existing)
                session.commit()
                session.refresh(existing)
                row = existing
            else:
                row = DesignDict(
                    dict_type=dict_type,
                    code=code,
                    label=label,
                    description=description or None,
                    sort_order=sort_order,
                    enabled=enabled,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
    _invalidate_edge_condition_label_cache()
    return _pub_dict(row)


def soft_delete_dict(item_id: int) -> bool:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_dicts()
    with Session(engine) as session:
        row = crud.get_design_dict(session=session, item_id=int(item_id))
        if not row or str(row.dict_type) == TYPE_CATALOG:
            return False
        row.enabled = 0
        row.updated_at = time.time()
        session.add(row)
        session.commit()
    _invalidate_edge_condition_label_cache()
    return True


def hard_delete_dict(item_id: int) -> bool:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_design_dicts()
    with Session(engine) as session:
        row = crud.get_design_dict(session=session, item_id=int(item_id))
        if not row or str(row.dict_type) == TYPE_CATALOG:
            return False
        session.delete(row)
        session.commit()
    _invalidate_edge_condition_label_cache()
    return True
