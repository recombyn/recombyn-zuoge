"""End-user skill picker / manage / zip import."""
from __future__ import annotations

import io
import json
import logging
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app import crud
from app.core import db as core_db

from .constants import (
    NS_CORE,
    NS_EXT,
    NS_USER,
    SOURCE_ADMIN,
    _MAX_USER_SKILL_ZIP_BYTES,
    _MAX_USER_SKILL_ZIP_UNCOMPRESSED,
    _ZIP_LOGO_EXTS,
)
from .ensure import ensure_design_skills
from .keys import (
    _normalize_source,
    _slug_local_key,
    qualify_skill_key,
    split_namespace_key,
)
from .pack_io import (
    _locale_pick,
    _parse_pack_version,
    _read_json_file,
    _skill_md_path,
)
from .runtime import (
    _load_user_skill_prefs,
    _pub,
    _row_get,
    invalidate_skill_key_cache,
    list_runtime_skills,
    resolve_storage_skill_key,
)
from .schema import validate_skill_meta

logger = logging.getLogger(__name__)


def _picker_card(row: dict[str, Any], *, user_id: str) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    owner = str(row.get("ownerUserId") or "").strip() or None
    return {
        "id": int(row.get("id") or 0),
        "skillKey": row.get("skillKey"),
        "qualifiedKey": row.get("qualifiedKey"),
        "name": str(row.get("name") or ""),
        "description": str(row.get("description") or ""),
        "whenToUse": str(row.get("whenToUse") or ""),
        "logo": row.get("logo"),
        "namespace": row.get("namespace"),
        "source": row.get("source"),
        "ownerUserId": owner,
        "category": str(row.get("category") or ""),
        "mine": bool(owner and uid and owner == uid),
        "triggers": list(row.get("triggers") or []),
        "enabled": bool(row.get("enabled")),
    }

def list_skills_for_picker(
    *, user_id: str, scene: str = ""
) -> list[dict[str, Any]]:
    """Slim catalog for `/` picker + Skills tab (bodies omitted)."""
    uid = str(user_id or "").strip()
    if not uid:
        return []
    rows = list_runtime_skills(scene=scene, user_id=uid, enabled_only=True)
    return [_picker_card(r, user_id=uid) for r in rows]

def list_skills_for_manage(
    *, user_id: str, scene: str = ""
) -> list[dict[str, Any]]:
    """Toolbox list: mine (all) + official; includes user-disabled with enabled=false."""
    uid = str(user_id or "").strip()
    if not uid:
        return []
    prefs = _load_user_skill_prefs(uid)
    # Globally enabled rows + this user's mine (even if row.enabled=0).
    runtime_on = list_runtime_skills(scene=scene, user_id=uid, enabled_only=False)
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in runtime_on:
        sid = int(item.get("id") or 0)
        key = str(item.get("skillKey") or "").strip()
        owner = str(item.get("ownerUserId") or "").strip() or None
        mine = bool(owner and owner == uid)
        globally_on = bool(item.get("enabled"))
        if not mine and not globally_on:
            continue
        if sid and sid in seen:
            continue
        if sid:
            seen.add(sid)
        card = _picker_card(item, user_id=uid)
        # Preview body for toolbox (mine + official).
        card["promptPositive"] = str(item.get("promptPositive") or "")
        card["promptNegative"] = str(item.get("promptNegative") or "")
        if mine:
            # Own row.enabled is authoritative; pref can still force off.
            card["enabled"] = globally_on and prefs.get(key.lower(), True)
        else:
            card["enabled"] = prefs.get(key.lower(), True)
        out.append(card)
    mine_cards = [c for c in out if c.get("mine")]
    official_cards = [c for c in out if not c.get("mine")]
    return mine_cards + official_cards

def list_my_skills(*, user_id: str) -> list[dict[str, Any]]:
    """User-owned skills for management (includes disabled; includes body)."""
    uid = str(user_id or "").strip()
    if not uid:
        return []
    ensure_design_skills()
    prefs = _load_user_skill_prefs(uid)
    with Session(core_db.engine) as session:
        rows = crud.list_design_skills_by_owner(
            session=session, owner_user_id=uid, namespace=NS_USER
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        item = _pub(r)
        card = _picker_card(item, user_id=uid)
        key = str(item.get("skillKey") or "").strip().lower()
        card["enabled"] = bool(item.get("enabled")) and prefs.get(key, True)
        card["promptPositive"] = str(item.get("promptPositive") or "")
        card["promptNegative"] = str(item.get("promptNegative") or "")
        out.append(card)
    return out

def set_user_skill_enabled(
    *, user_id: str, skill_id: int, enabled: bool
) -> dict[str, Any]:
    """Toggle a skill for this user. Own skills update row; others use prefs."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    sid = int(skill_id or 0)
    if sid <= 0:
        raise ValueError("skill_id required")
    ensure_design_skills()
    with Session(core_db.engine) as session:
        row = crud.get_design_skill(session=session, item_id=sid)
        if not row:
            raise ValueError("skill not found")
        item = _pub(row)
        key = str(item.get("skillKey") or "").strip()
        if not key:
            raise ValueError("skill_key missing")
        owner = str(item.get("ownerUserId") or "").strip() or None
        mine = bool(owner and owner == uid)
        ns = str(item.get("namespace") or "")
        # Non-owners can only toggle non-user-namespace (official/core/ext) skills.
        if not mine:
            if ns == NS_USER and owner:
                raise ValueError("not_skill_owner")
            if not bool(item.get("enabled")):
                raise ValueError("skill_disabled_globally")
        if mine:
            crud.update_design_skill_enabled(
                session=session,
                item_id=sid,
                owner_user_id=uid,
                enabled=1 if enabled else 0,
                commit=False,
            )
        crud.upsert_user_skill_pref(
            session=session,
            user_id=uid,
            skill_key=key,
            enabled=1 if enabled else 0,
            commit=False,
        )
        session.commit()
        saved = crud.get_design_skill(session=session, item_id=sid)
    invalidate_skill_key_cache()
    if not saved:
        raise RuntimeError("toggle skill failed")
    card = _picker_card(_pub(saved), user_id=uid)
    card["enabled"] = bool(enabled)
    if mine:
        pub = _pub(saved)
        card["promptPositive"] = str(pub.get("promptPositive") or "")
        card["promptNegative"] = str(pub.get("promptNegative") or "")
    return card

def resolve_accessible_skill_keys(
    *,
    user_id: str,
    refs: list[Any] | None,
    scene: str = "",
    max_n: int = 8,
) -> list[str]:
    """Map chip refs (skillKey / id / qualified) → storage keys visible to user."""
    uid = str(user_id or "").strip()
    if not uid or not refs:
        return []
    runtime = list_runtime_skills(scene=scene, user_id=uid, enabled_only=True)
    by_key = {
        str(r.get("skillKey") or "").strip().lower(): str(r.get("skillKey") or "").strip()
        for r in runtime
        if str(r.get("skillKey") or "").strip()
    }
    by_id = {
        int(r.get("id") or 0): str(r.get("skillKey") or "").strip()
        for r in runtime
        if int(r.get("id") or 0) > 0 and str(r.get("skillKey") or "").strip()
    }
    out: list[str] = []
    seen: set[str] = set()
    for raw in refs:
        if len(out) >= max_n:
            break
        s = str(raw or "").strip()
        if not s:
            continue
        if s.lower().startswith("skill:"):
            s = s[6:].strip()
        storage = ""
        if s.isdigit():
            storage = by_id.get(int(s)) or ""
        if not storage:
            hit = resolve_storage_skill_key(s, scene=scene)
            if hit and hit.lower() in by_key:
                storage = by_key[hit.lower()]
        if not storage:
            low = s.lower()
            if low in by_key:
                storage = by_key[low]
        if not storage:
            continue
        low = storage.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(storage)
    return out

def upsert_end_user_skill(*, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Create/update a user-owned skill (namespace=user, source=admin)."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name required")
    prompt_positive = str(payload.get("promptPositive") or "").strip()
    if not prompt_positive:
        raise ValueError("promptPositive required")
    prompt_negative = str(payload.get("promptNegative") or "").strip()
    when_to_use = str(payload.get("whenToUse") or "").strip()
    description = str(payload.get("description") or "").strip()
    logo = str(payload.get("logo") or "").strip() or None
    category = str(payload.get("category") or "custom").strip() or "custom"
    enabled = 1 if payload.get("enabled", True) else 0
    sid_raw = payload.get("id")
    sid = int(sid_raw) if sid_raw not in (None, "", 0, "0") else None

    triggers_raw = payload.get("triggers")
    if isinstance(triggers_raw, list):
        triggers_json = json.dumps(triggers_raw, ensure_ascii=False)
    elif isinstance(triggers_raw, str) and triggers_raw.strip():
        triggers_json = triggers_raw.strip()
    else:
        # Auto trigger from name tokens for `/` search.
        triggers_json = json.dumps(
            [{"type": "keyword", "value": name}],
            ensure_ascii=False,
        )

    ensure_design_skills()
    with Session(core_db.engine) as session:
        if sid:
            row = crud.get_design_skill(session=session, item_id=sid)
            if not row:
                raise ValueError("skill not found")
            owner = str(_row_get(row, "owner_user_id") or "").strip()
            if owner != uid:
                raise ValueError("not_skill_owner")
            skill_key = str(_row_get(row, "skill_key") or "").strip()
            try:
                cur_ver = int(_row_get(row, "version") or 1)
            except Exception:
                cur_ver = 1
            next_ver = cur_ver + 1
            meta_errs = validate_skill_meta(
                {
                    "skill_key": skill_key,
                    "name": name,
                    "prompt_positive": prompt_positive,
                    "allowed_resources": ["tools"],
                    "namespace": NS_USER,
                },
                source=SOURCE_ADMIN,
            )
            if meta_errs:
                raise ValueError("; ".join(meta_errs))
            saved = crud.update_end_user_design_skill(
                session=session,
                item_id=sid,
                owner_user_id=uid,
                name=name,
                category=category,
                prompt_positive=prompt_positive,
                prompt_negative=prompt_negative or None,
                when_to_use=when_to_use or None,
                description=description or None,
                logo=logo,
                triggers_json=triggers_json,
                version=next_ver,
                enabled=enabled,
            )
        else:
            raw_key = str(payload.get("skillKey") or "").strip()
            if raw_key:
                _, local = split_namespace_key(raw_key)
                local = local or raw_key
            else:
                local = f"{_slug_local_key(name)}-{uid[:8]}"
            skill_key = qualify_skill_key(NS_USER, local)
            meta_errs = validate_skill_meta(
                {
                    "skill_key": skill_key,
                    "name": name,
                    "prompt_positive": prompt_positive,
                    "allowed_resources": ["tools"],
                    "namespace": NS_USER,
                },
                source=SOURCE_ADMIN,
            )
            if meta_errs:
                raise ValueError("; ".join(meta_errs))
            exists = crud.get_design_skill_by_key(
                session=session, skill_key=skill_key
            )
            if exists:
                raise ValueError(f"skill_key_taken:{skill_key}")
            saved = crud.insert_end_user_design_skill(
                session=session,
                skill_key=skill_key,
                name=name,
                category=category,
                prompt_positive=prompt_positive,
                prompt_negative=prompt_negative or None,
                when_to_use=when_to_use or None,
                triggers_json=triggers_json,
                source=SOURCE_ADMIN,
                namespace=NS_USER,
                owner_user_id=uid,
                description=description or None,
                logo=logo,
                enabled=enabled,
            )
    invalidate_skill_key_cache()
    if not saved:
        raise RuntimeError("upsert skill failed")
    item = _pub(saved)
    card = _picker_card(item, user_id=uid)
    card["promptPositive"] = str(item.get("promptPositive") or "")
    card["promptNegative"] = str(item.get("promptNegative") or "")
    return card

def delete_end_user_skill(*, user_id: str, skill_id: int) -> bool:
    uid = str(user_id or "").strip()
    if not uid:
        return False
    with Session(core_db.engine) as session:
        row = crud.get_design_skill(session=session, item_id=int(skill_id))
        if not row:
            return False
        owner = str(_row_get(row, "owner_user_id") or "").strip()
        if owner != uid:
            raise ValueError("not_skill_owner")
        src = _normalize_source(_row_get(row, "source"), default=SOURCE_ADMIN)
        if src != SOURCE_ADMIN:
            raise ValueError("cannot_delete_system_skill")
        ok = crud.delete_owned_design_skill(
            session=session, item_id=int(skill_id), owner_user_id=uid
        )
    if ok:
        invalidate_skill_key_cache()
    return ok

def _zip_check(cid: str, ok: bool, label: str, detail: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": cid, "ok": ok, "label": label}
    if detail:
        out["detail"] = detail
    return out

def _import_result(
    *,
    status: str,
    file_name: str,
    checks: list[dict[str, Any]],
    errors: list[str] | None = None,
    item: dict[str, Any] | None = None,
    existing: dict[str, Any] | None = None,
    scan_ok: bool | None = None,
) -> dict[str, Any]:
    ok = bool(scan_ok) if scan_ok is not None else status in ("ok", "exists")
    return {
        "status": status,
        "fileName": file_name,
        "scan": {"ok": ok, "checks": checks, "errors": list(errors or [])},
        "item": item,
        "existing": existing,
    }

def _zip_entry_allowed(rel: str) -> bool:
    """Whitelist pack files inside a user-uploaded skill zip."""
    name = Path(rel.replace("\\", "/")).name.lower()
    if name in ("_meta.json", "skill.md"):
        return True
    if name in (
        "license",
        "license.txt",
        "license.md",
        "licence",
        "licence.txt",
        "schema.json",
        "handler.py",
        "handler.py.example",
        "plugin.json",
        "plugin.sig",
        "readme.md",
    ):
        return True
    if name.startswith(".") or name.startswith("__macosx"):
        return False
    return name.endswith(_ZIP_LOGO_EXTS)

def _safe_zip_relpath(name: str) -> str | None:
    raw = str(name or "").replace("\\", "/").strip()
    if not raw or raw.endswith("/"):
        return None
    if raw.startswith("/") or re.match(r"^[a-zA-Z]:", raw):
        return None
    parts = [p for p in raw.split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        return None
    if parts[0].lower() == "__macosx":
        return None
    return "/".join(parts)

def _resolve_extracted_pack_dir(dest: Path, written: list[str]) -> Path:
    tops = {p.split("/", 1)[0] for p in written}
    if len(tops) != 1:
        return dest
    candidate = dest / next(iter(tops))
    return candidate if candidate.is_dir() else dest

def _write_zip_member(
    zf: zipfile.ZipFile, info: zipfile.ZipInfo, dest: Path, *, total: int
) -> tuple[str | None, int, dict[str, Any] | None]:
    """Write one zip file entry. Returns (rel, new_total, fail_check)."""
    if info.is_dir():
        return None, total, None
    rel = _safe_zip_relpath(info.filename)
    if not rel:
        return None, total, _zip_check("path", False, "unsafe_path", info.filename)
    if not _zip_entry_allowed(rel):
        return None, total, _zip_check("files", False, "disallowed_file", rel)
    nxt = total + int(info.file_size or 0)
    if nxt > _MAX_USER_SKILL_ZIP_UNCOMPRESSED:
        return None, total, _zip_check("uncompressed", False, "uncompressed_too_large")
    target = dest / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(info, "r") as src, target.open("wb") as out:
        shutil.copyfileobj(src, out)
    return rel, nxt, None

def _extract_user_skill_zip(raw: bytes, dest: Path) -> tuple[Path | None, list[dict[str, Any]]]:
    """Safely extract a skill pack zip → (pack_dir, scan_checks)."""
    checks: list[dict[str, Any]] = []
    if len(raw) > _MAX_USER_SKILL_ZIP_BYTES:
        checks.append(
            _zip_check("size", False, "zip_too_large", f"max {_MAX_USER_SKILL_ZIP_BYTES} bytes")
        )
        return None, checks
    checks.append(_zip_check("size", True, "zip_size_ok"))

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        checks.append(_zip_check("format", False, "not_a_zip"))
        return None, checks

    written: list[str] = []
    total = 0
    with zf:
        checks.append(_zip_check("format", True, "zip_format_ok"))
        for info in zf.infolist():
            rel, total, fail = _write_zip_member(zf, info, dest, total=total)
            if fail:
                checks.append(fail)
                return None, checks
            if rel:
                written.append(rel)

    if not written:
        checks.append(_zip_check("files", False, "empty_zip"))
        return None, checks
    checks.append(_zip_check("path", True, "paths_ok"))

    pack_dir = _resolve_extracted_pack_dir(dest, written)
    has_meta = (pack_dir / "_meta.json").is_file()
    skill_md = _skill_md_path(pack_dir)
    has_body = skill_md is not None
    checks.append(
        _zip_check(
            "meta",
            has_meta,
            "meta_present" if has_meta else "meta_missing",
        )
    )
    checks.append(
        _zip_check("skill_md", has_body, "skill_md_present" if has_body else "skill_md_missing")
    )
    if not has_meta or not has_body:
        return None, checks
    return pack_dir, checks

def _read_pack_meta(pack_dir: Path) -> dict[str, Any] | None:
    p = pack_dir / "_meta.json"
    if not p.is_file():
        return None
    return _read_json_file(p)

def _read_pack_skill_md(pack_dir: Path) -> tuple[str | None, str | None]:
    """Return (body, error_label)."""
    skill_md = _skill_md_path(pack_dir)
    if not skill_md:
        return None, "skill_md_missing"
    try:
        body = skill_md.read_text(encoding="utf-8").strip()
    except Exception:
        return None, "skill_md_unreadable"
    if not body:
        return None, "prompt_positive_required"
    return body, None

def _pack_display_fields(meta: dict[str, Any], *, local: str) -> tuple[str, str, str]:
    locales = meta.get("locales") if isinstance(meta.get("locales"), dict) else {}
    loc = _locale_pick(locales) if locales else {}
    display = str(
        loc.get("displayName")
        or meta.get("displayName")
        or local
    ).strip() or local
    description = str(loc.get("description") or meta.get("description") or "").strip()
    when = str(meta.get("when_to_use") or "").strip()
    return display, description, when

def _pack_logo_url(meta: dict[str, Any]) -> str | None:
    logo_raw = str(meta.get("logo") or "").strip()
    if logo_raw.startswith(("http://", "https://", "data:")):
        return logo_raw
    return None

def _parse_user_skill_pack_dir(
    pack_dir: Path,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Parse pack dir → upsert payload (user namespace) + validation errors."""
    meta = _read_pack_meta(pack_dir)
    if not meta:
        return None, ["meta_invalid"]
    body, body_err = _read_pack_skill_md(pack_dir)
    if body_err or not body:
        return None, [body_err or "prompt_positive_required"]

    folder = pack_dir.name
    key_raw = str(meta.get("skill_key") or folder).strip()
    ns_prefix, local = split_namespace_key(key_raw)
    local = _slug_local_key((local or key_raw or folder).strip().lower() or folder)
    errs: list[str] = []
    if ns_prefix in (NS_CORE, NS_EXT):
        errs.append(f"user_skill_cannot_use_{ns_prefix}_namespace")

    skill_key = qualify_skill_key(NS_USER, local)
    display, description, when = _pack_display_fields(meta, local=local)
    pack_label, _ver = _parse_pack_version(
        meta.get("version") or 1
    )
    errs.extend(
        validate_skill_meta(
            {
                "skill_key": skill_key,
                "name": display,
                "prompt_positive": body,
                "allowed_resources": ["tools"],
                "namespace": NS_USER,
                "input_schema": meta.get("input_schema"),
                "output_schema": meta.get("output_schema"),
            },
            source=SOURCE_ADMIN,
        )
    )
    if errs:
        return None, errs

    neg = str(meta.get("prompt_negative") or "").strip()
    return {
        "skillKey": skill_key,
        "name": display,
        "description": description or None,
        "whenToUse": when or None,
        "promptPositive": body,
        "promptNegative": neg or None,
        "category": str(meta.get("category") or "custom").strip() or "custom",
        "logo": _pack_logo_url(meta),
        "packVersion": pack_label,
        "triggers": meta.get("triggers") or [{"type": "keyword", "value": display}],
        "enabled": True,
    }, []

def _conflict_card(row: Any, *, mine: bool) -> dict[str, Any]:
    pub = _pub(row)
    return {
        "id": int(pub.get("id") or 0),
        "name": str(pub.get("name") or ""),
        "skillKey": pub.get("skillKey"),
        "packVersion": pub.get("packVersion") or str(pub.get("version") or "1"),
        "updatedAt": float(_row_get(row, "updated_at") or 0) or None,
        "useCount": 0,
        "mine": mine,
    }

def _fetch_owned_skill_by_key(session: Session, *, uid: str, key: str) -> Any | None:
    if not key:
        return None
    return crud.get_owned_design_skill_by_key(
        session=session, owner_user_id=uid, skill_key=key
    )

def _fetch_owned_skill_by_name(session: Session, *, uid: str, name_l: str) -> Any | None:
    if not name_l:
        return None
    return crud.get_owned_design_skill_by_name_lower(
        session=session, owner_user_id=uid, name_lower=name_l
    )

def _fetch_foreign_skill_by_key(session: Session, *, uid: str, key: str) -> Any | None:
    if not key:
        return None
    other = crud.get_design_skill_by_key(session=session, skill_key=key)
    if not other:
        return None
    owner = str(_row_get(other, "owner_user_id") or "").strip()
    if not owner or owner == uid:
        return None
    return other

def _find_owned_skill_conflict(
    *, user_id: str, skill_key: str, name: str
) -> dict[str, Any] | None:
    """Existing mine skill with same key/name, or foreign key collision."""
    uid = str(user_id or "").strip()
    key = str(skill_key or "").strip()
    name_l = str(name or "").strip().lower()
    ensure_design_skills()
    with Session(core_db.engine) as session:
        row = _fetch_owned_skill_by_key(session, uid=uid, key=key)
        if not row:
            row = _fetch_owned_skill_by_name(session, uid=uid, name_l=name_l)
        if row:
            return _conflict_card(row, mine=True)
        foreign = _fetch_foreign_skill_by_key(session, uid=uid, key=key)
        if foreign:
            return _conflict_card(foreign, mine=False)
    return None

def _apply_pack_version(*, uid: str, skill_id: int, pack_ver: str | None) -> None:
    if not pack_ver or skill_id <= 0:
        return
    try:
        with Session(core_db.engine) as session:
            crud.update_design_skill_pack_version(
                session=session,
                item_id=skill_id,
                owner_user_id=uid,
                pack_version=pack_ver,
            )
    except Exception:
        logger.exception("pack_version update failed")

def import_end_user_skill_zip(
    *,
    user_id: str,
    filename: str,
    raw: bytes,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Import a skill pack zip / ``.recombyn-plugin`` for the signed-in user."""
    from app.services.design.plugins.pack_install import (
        install_recombyn_plugin,
        looks_like_recombyn_plugin,
    )

    uid = str(user_id or "").strip()
    fname = str(filename or "skill.zip").strip() or "skill.zip"
    checks: list[dict[str, Any]] = []

    if looks_like_recombyn_plugin(fname, raw):
        return install_recombyn_plugin(
            user_id=uid, filename=fname, raw=raw, overwrite=overwrite
        )

    if not fname.lower().endswith(".zip"):
        checks.append(_zip_check("ext", False, "need_zip"))
        return _import_result(
            status="rejected", file_name=fname, checks=checks, errors=["need_zip"], scan_ok=False
        )
    checks.append(_zip_check("ext", True, "zip_extension"))

    if not raw:
        checks.append(_zip_check("empty", False, "empty_file"))
        return _import_result(
            status="rejected", file_name=fname, checks=checks, errors=["empty_file"], scan_ok=False
        )

    tmp = Path(tempfile.mkdtemp(prefix="skill-zip-"))
    try:
        pack_dir, extract_checks = _extract_user_skill_zip(raw, tmp)
        checks.extend(extract_checks)
        if not pack_dir:
            errs = [c["label"] for c in extract_checks if not c.get("ok")]
            return _import_result(
                status="rejected", file_name=fname, checks=checks, errors=errs, scan_ok=False
            )

        payload, parse_errs = _parse_user_skill_pack_dir(pack_dir)
        if parse_errs or not payload:
            checks.append(_zip_check("meta_valid", False, "meta_invalid"))
            return _import_result(
                status="rejected",
                file_name=fname,
                checks=checks,
                errors=parse_errs or ["meta_invalid"],
                scan_ok=False,
            )
        checks.append(_zip_check("meta_valid", True, "meta_ok"))

        conflict = _find_owned_skill_conflict(
            user_id=uid,
            skill_key=str(payload.get("skillKey") or ""),
            name=str(payload.get("name") or ""),
        )
        if conflict and not conflict.get("mine"):
            checks.append(_zip_check("ownership", False, "skill_key_taken_other"))
            return _import_result(
                status="rejected",
                file_name=fname,
                checks=checks,
                errors=["skill_key_taken_other"],
                existing=conflict,
                scan_ok=False,
            )
        if conflict and conflict.get("mine") and not overwrite:
            return _import_result(
                status="exists",
                file_name=fname,
                checks=checks,
                existing=conflict,
                scan_ok=True,
            )
        if conflict and conflict.get("mine"):
            payload["id"] = int(conflict["id"])

        pack_ver = str(payload.pop("packVersion", "") or "").strip() or None
        item = upsert_end_user_skill(user_id=uid, payload=payload)
        _apply_pack_version(uid=uid, skill_id=int(item.get("id") or 0), pack_ver=pack_ver)
        if pack_ver:
            item["packVersion"] = pack_ver
        return _import_result(
            status="ok", file_name=fname, checks=checks, item=item, scan_ok=True
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
