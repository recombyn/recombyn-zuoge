"""Ensure / sync / hot-reload for design skills."""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core import db as core_db

from . import constants as _c
from .constants import (
    SOURCE_ADMIN,
    SOURCE_FILE,
    _DISK_SIGNATURE,
    _HOT_RELOAD_STOP,
    _HOT_RELOAD_THREAD,
    _PROTECTED_FROM_FILE,
    _SKILLS_LOCK,
    _SKILLS_READY,
)
from .keys import _normalize_namespace, _normalize_source
from .pack_io import (
    _file_skills_dirs,
    _load_file_skills,
    _skill_md_path,
)
from .runtime import (
    _parse_allowed_resources,
    _parse_preferred_tools,
    _parse_triggers,
    _row_get,
    invalidate_skill_key_cache,
    save_skill_revision,
)
from .schema import validate_skill_io_schema, validate_skill_meta

logger = logging.getLogger(__name__)

# System-level capabilities that must not live as loadable skills.
# Bare keys + common user.* aliases — hard-deleted from DB on ensure.
_SYSTEM_SKILL_DENYLIST: frozenset[str] = frozenset(
    {
        "vision_extract",
        "canvas_edit",
        "frontend_ui",
        "ui_ux_pro_max",
        "brief_intake",
        "layout_ops",
        "visual_system",
        "ux_ia",
        "export_ready",
        "user.vision_extract",
        "user.canvas_edit",
        "user.frontend_ui",
        "user.brief_intake",
        "user.layout_ops",
        "user.visual_system",
        "user.ux_ia",
        "user.export_ready",
    }
)


def _denylist_bare_keys() -> frozenset[str]:
    return frozenset(k.split(".", 1)[-1].lower() for k in _SYSTEM_SKILL_DENYLIST)


def _skill_key_is_denied(key: str) -> bool:
    k = str(key or "").strip().lower()
    if not k:
        return False
    if k in _SYSTEM_SKILL_DENYLIST:
        return True
    return k.split(".", 1)[-1] in _denylist_bare_keys()


def _purge_system_skill_denylist(session: Session) -> None:
    """Hard-delete denylisted system-capability skills + revisions + user prefs."""
    from sqlmodel import col, select

    from app.models import DesignSkill, DesignSkillRevision, DesignUserSkillPref

    bare = _denylist_bare_keys()
    rows = list(session.exec(select(DesignSkill)).all())
    deleted_keys: list[str] = []
    deleted_ids: list[int] = []
    for row in rows:
        key = str(_row_get(row, "skill_key") or "").strip()
        if not _skill_key_is_denied(key):
            continue
        sid = int(_row_get(row, "id") or 0)
        if sid:
            deleted_ids.append(sid)
        deleted_keys.append(key)
        session.delete(row)

    if not deleted_keys and not deleted_ids:
        # Still scrub prefs/revisions for bare keys that may linger after a prior disable.
        keys_to_scrub = sorted(_SYSTEM_SKILL_DENYLIST | bare)
    else:
        keys_to_scrub = sorted(
            {k.lower() for k in deleted_keys}
            | {k.split(".", 1)[-1].lower() for k in deleted_keys}
            | set(_SYSTEM_SKILL_DENYLIST)
            | set(bare)
        )

    if deleted_ids:
        for rev in session.exec(
            select(DesignSkillRevision).where(
                col(DesignSkillRevision.skill_id).in_(deleted_ids)
            )
        ).all():
            session.delete(rev)
    if keys_to_scrub:
        for rev in session.exec(
            select(DesignSkillRevision).where(
                col(DesignSkillRevision.skill_key).in_(keys_to_scrub)
            )
        ).all():
            session.delete(rev)
        for pref in session.exec(
            select(DesignUserSkillPref).where(
                col(DesignUserSkillPref.skill_key).in_(keys_to_scrub)
            )
        ).all():
            session.delete(pref)

    for key in deleted_keys:
        logger.info("purged system-capability skill %s (not a playbook)", key)


def _triggers_json(item: dict[str, Any]) -> str:
    return json.dumps(_parse_triggers(item.get("triggers")), ensure_ascii=False)

def _preferred_json(item: dict[str, Any]) -> str:
    preferred = item.get("preferred_tools") or []
    return json.dumps(preferred if isinstance(preferred, list) else [], ensure_ascii=False)

def _allowed_resources_json(item: dict[str, Any], *, source: str) -> str | None:
    raw = item.get("allowed_resources")
    parsed = _parse_allowed_resources(raw)
    if parsed is None:
        if source == SOURCE_ADMIN:
            return json.dumps(["tools"], ensure_ascii=False)
        if source == SOURCE_FILE:
            return json.dumps(
                ["tools"], ensure_ascii=False
            )
        return None
    return json.dumps(parsed, ensure_ascii=False)

def _schema_json(item: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        if k in item and item.get(k) is not None:
            obj, errs = validate_skill_io_schema(item.get(k), field=k)
            if errs or obj is None:
                return None if obj is None else json.dumps(obj, ensure_ascii=False)
            return json.dumps(obj, ensure_ascii=False)
    return None

def _upsert_owned_skill(
    session: Session,
    item: dict[str, Any],
    *,
    source: str,
    now: float,
    skip_sources: frozenset[str],
) -> None:
    from app.models import DesignSkill

    key = str(item.get("skill_key") or "").strip()
    if not key:
        return
    meta_errs = validate_skill_meta({**item, "skill_key": key}, source=source)
    if meta_errs:
        logger.warning("skip skill upsert %s (%s): %s", key, source, ",".join(meta_errs))
        return
    namespace = _normalize_namespace(item.get("namespace"), source=source)
    name = str(item.get("name") or key).strip() or key
    category = str(item.get("category") or "agent").strip() or "agent"
    when = str(item.get("when_to_use") or "").strip()
    pos = str(item.get("prompt_positive") or "")
    neg = str(item.get("prompt_negative") or "")
    scenes = str(item.get("scenes") or "").strip()
    if not scenes:
        logger.warning("skip skill upsert %s (%s): scenes required", key, source)
        return
    sort_weight = int(item.get("sort_weight") or 0)
    mutex = str(item.get("mutex_group") or "").strip()
    version = int(item.get("version") or 1)
    pack_version = str(item.get("pack_version") or version).strip()
    description = str(item.get("description") or "").strip()
    logo = str(item.get("logo") or "").strip()
    locales_obj = item.get("locales") if isinstance(item.get("locales"), dict) else {}
    try:
        locales_json = json.dumps(locales_obj, ensure_ascii=False) if locales_obj else ""
    except Exception:
        locales_json = ""
    preferred_json = _preferred_json(item)
    triggers_json = _triggers_json(item)
    allowed_json = _allowed_resources_json(item, source=source)
    input_schema_json = _schema_json(item, "input_schema")
    output_schema_json = _schema_json(item, "output_schema")
    owner_user_id = str(item.get("owner_user_id") or "").strip() or None

    row = crud.get_design_skill_by_key(session=session, skill_key=key)
    skill_id: int | None = None
    next_ver = version
    if row:
        src = _normalize_source(_row_get(row, "source"), default=source)
        if src in skip_sources:
            return
        try:
            cur_ver = int(_row_get(row, "version") or 0)
        except (TypeError, ValueError):
            cur_ver = 0
        next_ver = (
            max(version, cur_ver + 1)
            if source == SOURCE_FILE
            else max(version, 1)
        )
        skill_id = int(row.id or 0) or None
        row.name = name
        row.category = category
        row.prompt_positive = pos
        row.prompt_negative = neg
        row.when_to_use = when
        row.preferred_tools = preferred_json
        if allowed_json is not None:
            row.allowed_resources = allowed_json
        row.triggers = triggers_json
        row.mutex_group = mutex
        row.version = next_ver
        row.pack_version = pack_version
        row.description = description
        row.logo = logo
        row.locales = locales_json
        row.source = source
        row.namespace = namespace
        if owner_user_id:
            row.owner_user_id = owner_user_id
        if input_schema_json is not None:
            row.input_schema = input_schema_json
        if output_schema_json is not None:
            row.output_schema = output_schema_json
        row.sort_weight = sort_weight
        row.scenes = scenes
        row.enabled = 1
        row.updated_at = now
        session.add(row)
    else:
        default_allowed = allowed_json or json.dumps(
            ["tools"]
            if source != SOURCE_ADMIN
            else ["tools"],
            ensure_ascii=False,
        )
        row = DesignSkill(
            skill_key=key,
            name=name,
            category=category,
            prompt_positive=pos,
            prompt_negative=neg,
            when_to_use=when,
            preferred_tools=preferred_json,
            allowed_resources=default_allowed,
            triggers=triggers_json,
            mutex_group=mutex,
            version=version,
            pack_version=pack_version,
            description=description,
            logo=logo,
            locales=locales_json,
            source=source,
            namespace=namespace,
            owner_user_id=owner_user_id,
            input_schema=input_schema_json,
            output_schema=output_schema_json,
            sort_weight=sort_weight,
            scenes=scenes,
            default_model="doubao",
            max_retries=2,
            enabled=1,
            output_format="json",
            allow_user_model_override=0,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.flush()
        skill_id = int(row.id or 0) or None
        next_ver = version

    if skill_id:
        save_skill_revision(
            session,
            skill_id=skill_id,
            item={
                "skillKey": key,
                "name": name,
                "description": description,
                "category": category,
                "whenToUse": when,
                "promptPositive": pos,
                "promptNegative": neg,
                "preferredTools": json.loads(preferred_json) if preferred_json else [],
                "allowedResources": json.loads(allowed_json) if allowed_json else None,
                "inputSchema": json.loads(input_schema_json) if input_schema_json else None,
                "outputSchema": json.loads(output_schema_json) if output_schema_json else None,
                "triggers": json.loads(triggers_json) if triggers_json else [],
                "mutexGroup": mutex or None,
                "version": next_ver,
                "packVersion": pack_version,
                "namespace": namespace,
                "source": source,
                "scenes": scenes,
                "sortWeight": sort_weight,
            },
        )

def _skills_disk_signature() -> str:
    """Pack fingerprint — meta + SKILL.md + list icon (logo changes must resync)."""
    parts: list[str] = []
    for root in _file_skills_dirs():
        for pack in sorted(p for p in root.iterdir() if p.is_dir()):
            try:
                meta_m = 0
                body_m = 0
                icon_m = 0
                mp = pack / "_meta.json"
                if mp.is_file():
                    meta_m = mp.stat().st_mtime_ns
                sp = _skill_md_path(pack)
                if sp is not None:
                    body_m = sp.stat().st_mtime_ns
                for icon_name in ("icon.png", "icon.webp", "icon.jpg", "icon.svg"):
                    ip = pack / "assets" / icon_name
                    if ip.is_file():
                        icon_m = ip.stat().st_mtime_ns
                        break
                parts.append(f"{root.name}/{pack.name}:{meta_m}:{body_m}:{icon_m}")
            except Exception:
                parts.append(f"{root.name}/{pack.name}:err")
    return "|".join(parts)


def _prune_missing_file_skills(
    session: Session, *, file_keys: set[str]
) -> None:
    """Drop SOURCE_FILE rows whose pack folder is gone from disk."""
    from sqlmodel import select

    from app.models import DesignSkill

    for row in session.exec(select(DesignSkill)).all():
        key = str(_row_get(row, "skill_key") or "").strip()
        src = _normalize_source(_row_get(row, "source"), default=SOURCE_FILE)
        if src != SOURCE_FILE or not key:
            continue
        if key in file_keys:
            continue
        session.delete(row)
        logger.info("pruned missing file skill %s (pack removed from disk)", key)


def ensure_design_skills(*, force: bool = False) -> None:
    """Upsert file-pack skills; never overwrite admin."""
    if _c._SKILLS_READY and not force:
        return
    with _c._SKILLS_LOCK:
        if _c._SKILLS_READY and not force:
            return
        now = time.time()
        from app.services.db import init_schema
        from app.services.design.admin.schema import ensure_design_tables_boot

        init_schema()
        ensure_design_tables_boot()
        file_items = _load_file_skills()
        file_keys = {
            str(it.get("skill_key") or "").strip()
            for it in file_items
            if str(it.get("skill_key") or "").strip()
        }
        with Session(core_db.engine) as session:
            _prune_missing_file_skills(session, file_keys=file_keys)
            _purge_system_skill_denylist(session)
            for item in file_items:
                _upsert_owned_skill(
                    session,
                    item,
                    source=SOURCE_FILE,
                    now=now,
                    skip_sources=_PROTECTED_FROM_FILE,
                )
            session.commit()
        invalidate_skill_key_cache()
        _c._DISK_SIGNATURE = _skills_disk_signature()
        _c._SKILLS_READY = True


def stop_skills_hot_reload() -> None:
    _c._HOT_RELOAD_STOP.set()
    t = _c._HOT_RELOAD_THREAD
    _c._HOT_RELOAD_THREAD = None
    if t and t.is_alive() and t is not threading.current_thread():
        try:
            t.join(timeout=1.5)
        except Exception:
            pass


def start_skills_hot_reload() -> bool:
    """Poll file-pack mtimes and force-resync when they change."""
    try:
        from app.core.config import settings

        enabled = bool(getattr(settings, "design_skills_hot_reload", True))
        interval = float(getattr(settings, "design_skills_hot_reload_interval_sec", 2.0) or 2.0)
    except Exception:
        enabled = True
        interval = 2.0
    if not enabled:
        return False
    interval = max(0.5, min(interval, 60.0))
    stop_skills_hot_reload()
    _c._HOT_RELOAD_STOP.clear()

    def _loop() -> None:
        while not _c._HOT_RELOAD_STOP.wait(interval):
            try:
                sig = _skills_disk_signature()
                prev = _c._DISK_SIGNATURE
                if prev is None:
                    _c._DISK_SIGNATURE = sig
                    continue
                if sig != prev:
                    logger.info("design skills disk change detected — hot reload")
                    ensure_design_skills(force=True)
            except Exception:
                logger.exception("design skills hot reload failed")

    t = threading.Thread(target=_loop, name="design-skills-hot-reload", daemon=True)
    _c._HOT_RELOAD_THREAD = t
    t.start()
    return True


def reload_skills_if_disk_changed() -> bool:
    """One-shot check used by tests / admin; returns True if reloaded."""
    sig = _skills_disk_signature()
    if _c._DISK_SIGNATURE is not None and sig == _c._DISK_SIGNATURE:
        return False
    ensure_design_skills(force=True)
    return True
