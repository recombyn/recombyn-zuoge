"""Font catalog store — seeded from apps/api/seeds/fonts_seed.json."""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema

MAX_USER_FONTS = 10


def _slug(family: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", (family or "").strip()).strip("_").lower()
    return (s or "font")[:48]


def _row_to_item(row: Any, *, viewer_user_id: str | None = None) -> dict[str, Any]:
    faces_raw = row.faces_json if hasattr(row, "faces_json") else row["faces_json"]
    children: list[Any] = []
    try:
        parsed = json.loads(faces_raw or "[]")
        if isinstance(parsed, list):
            children = parsed
    except json.JSONDecodeError:
        children = []

    def _get(key: str) -> Any:
        return getattr(row, key) if hasattr(row, key) else row[key]

    owner_user_id = _get("owner_user_id")
    owner_s = str(owner_user_id).strip() if owner_user_id else ""
    viewer_s = str(viewer_user_id or "").strip()
    upload_needle = f"uploads/{viewer_s}/fonts/" if viewer_s else ""
    orphan_mine = bool(
        viewer_s
        and not owner_s
        and upload_needle
        and any(
            isinstance(face, dict) and upload_needle in str(face.get("url") or "")
            for face in children
        )
    )
    is_mine = bool(viewer_s and ((owner_s and owner_s == viewer_s) or orphan_mine))

    return {
        "family": _get("family"),
        "displayName": _get("display_name"),
        "children": children,
        "id": _get("id"),
        "sortOrder": int(_get("sort_order") or 0),
        "ownerUserId": owner_s or None,
        "isMine": is_mine,
    }


def list_fonts(
    *,
    page: int = 1,
    page_size: int = 100,
    viewer_user_id: str | None = None,
) -> dict[str, Any]:
    init_schema()
    page_n = max(1, int(page or 1))
    page_size_n = max(1, min(int(page_size or 100), 500))
    offset = (page_n - 1) * page_size_n
    with Session(engine) as session:
        total = crud.count_fonts(session=session)
        rows = crud.list_fonts_page(
            session=session,
            offset=offset,
            limit=page_size_n,
            viewer_user_id=viewer_user_id,
        )
    items = [_row_to_item(r, viewer_user_id=viewer_user_id) for r in rows]
    items.sort(key=lambda it: (0 if it.get("isMine") else 1, int(it.get("sortOrder") or 0), str(it.get("family") or "")))
    return {
        "items": items,
        "page": page_n,
        "pageSize": page_size_n,
        "total": total,
        "hasMore": offset + len(items) < total,
        "userFontCount": count_user_fonts(viewer_user_id) if viewer_user_id else 0,
        "userFontLimit": MAX_USER_FONTS,
    }


def count_user_fonts(user_id: str | None) -> int:
    uid = str(user_id or "").strip()
    if not uid:
        return 0
    init_schema()
    with Session(engine) as session:
        return crud.count_fonts_by_owner(session=session, owner_user_id=uid)


def get_font_by_family(family: str) -> dict[str, Any] | None:
    init_schema()
    key = (family or "").strip()
    if not key:
        return None
    with Session(engine) as session:
        row = crud.get_font_by_family(session=session, family=key)
    return _row_to_item(row) if row else None


def content_hash_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _list_user_font_items(user_id: str) -> list[dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return []
    init_schema()
    with Session(engine) as session:
        rows = crud.list_user_font_rows(session=session, owner_user_id=uid)
    return [_row_to_item(r, viewer_user_id=uid) for r in rows]


def _font_name_keys(item: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for key in ("displayName", "family"):
        val = str(item.get(key) or "").strip().lower()
        if val:
            keys.add(val)
    for face in item.get("children") or []:
        if not isinstance(face, dict):
            continue
        for key in ("displayName", "family"):
            val = str(face.get(key) or "").strip().lower()
            if val:
                keys.add(val)
    return keys


def _find_user_font(
    user_id: str,
    *,
    content_hash: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any] | None:
    hash_key = (content_hash or "").strip().lower()
    label = (display_name or "").strip().lower()
    if not hash_key and not label:
        return None
    for item in _list_user_font_items(user_id):
        if label and label in _font_name_keys(item):
            return item
        if not hash_key:
            continue
        for face in item.get("children") or []:
            if not isinstance(face, dict):
                continue
            if str(face.get("contentHash") or "").strip().lower() == hash_key:
                return item
    return None


def find_user_font_by_content_hash(user_id: str, content_hash: str) -> dict[str, Any] | None:
    return _find_user_font(user_id, content_hash=content_hash)


def find_user_font_by_display_name(user_id: str, display_name: str) -> dict[str, Any] | None:
    return _find_user_font(user_id, display_name=display_name)


def assert_unique_user_font_upload(
    user_id: str,
    *,
    display_name: str,
    content_hash: str,
    requested_family: str,
) -> None:
    """Reject duplicate uploads (same file or same display/family name)."""
    uid = str(user_id or "").strip()
    label = (display_name or "").strip()
    fam = (requested_family or "").strip()
    if not uid:
        raise ValueError("login required")
    if find_user_font_by_content_hash(uid, content_hash):
        raise ValueError("font already uploaded")
    if label and find_user_font_by_display_name(uid, label):
        raise ValueError("font name already exists")
    if fam and find_user_font_by_display_name(uid, fam):
        raise ValueError("font name already exists")
    existing = get_font_by_family(fam) if fam else None
    if existing and str(existing.get("ownerUserId") or "").strip() == uid:
        raise ValueError("font name already exists")


def resolve_upload_family(
    family: str,
    owner_user_id: str,
) -> str:
    """Pick a catalog family key for a user upload (avoid clobbering platform/other users)."""
    uid = str(owner_user_id or "").strip()
    fam = (family or "").strip() or "CustomFont"

    existing = get_font_by_family(fam)
    if not existing:
        return fam
    existing_owner = str(existing.get("ownerUserId") or "").strip()
    if existing_owner and existing_owner == uid:
        return fam
    suffix = uuid.uuid4().hex[:6]
    return f"{fam}_{suffix}"


def assert_user_can_add_font(user_id: str, family: str) -> None:
    uid = str(user_id or "").strip()
    fam = (family or "").strip()
    if not uid:
        raise ValueError("login required")
    existing = get_font_by_family(fam)
    if existing and str(existing.get("ownerUserId") or "").strip() == uid:
        return
    if count_user_fonts(uid) >= MAX_USER_FONTS:
        raise ValueError(f"font upload limit reached (max {MAX_USER_FONTS})")


def upsert_font(
    *,
    family: str,
    display_name: str | None = None,
    children: list[dict[str, Any]] | None = None,
    sort_order: int | None = None,
    owner_user_id: str | None = None,
) -> dict[str, Any]:
    """Insert or replace a font family row (matched by ``family``)."""
    init_schema()
    fam = (family or "").strip()
    if not fam:
        raise ValueError("family required")
    display = (display_name or fam).strip() or fam
    faces = children if isinstance(children, list) else []
    normalized: list[dict[str, Any]] = []
    for raw in faces:
        if not isinstance(raw, dict):
            continue
        url = str(raw.get("url") or "").strip()
        if not url:
            continue
        face_family = str(raw.get("family") or fam).strip() or fam
        label = str(raw.get("displayName") or "Regular").strip() or "Regular"
        weight = raw.get("weight")
        try:
            weight_n = int(weight) if weight is not None else 400
        except (TypeError, ValueError):
            weight_n = 400
        fmt = str(raw.get("format") or "").strip() or None
        content_hash = str(raw.get("contentHash") or "").strip() or None
        face: dict[str, Any] = {
            "family": face_family,
            "displayName": label,
            "weight": weight_n,
            "url": url,
        }
        if fmt:
            face["format"] = fmt
        if content_hash:
            face["contentHash"] = content_hash
        normalized.append(face)
    faces_json = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    now = time.time()
    owner = str(owner_user_id).strip() if owner_user_id else None
    with Session(engine) as session:
        row = crud.upsert_font_row(
            session=session,
            family=fam,
            display_name=display,
            faces_json=faces_json,
            sort_order=sort_order,
            new_id=f"font_{uuid.uuid4().hex[:10]}_{_slug(fam)}",
            created_at=now,
            owner_user_id=owner,
        )
    return _row_to_item(row, viewer_user_id=owner)


def delete_font(family: str) -> bool:
    init_schema()
    fam = (family or "").strip()
    if not fam:
        return False
    with Session(engine) as session:
        return crud.delete_font_by_family(session=session, family=fam)


def delete_user_font(*, user_id: str, family: str) -> bool:
    init_schema()
    uid = str(user_id or "").strip()
    fam = (family or "").strip()
    if not uid or not fam:
        return False
    with Session(engine) as session:
        return crud.delete_font_by_family_and_owner(
            session=session, family=fam, owner_user_id=uid
        )


def format_fonts_catalog(*, limit: int = 80) -> str:
    """Short font family list for Agent decide/paint (create_text fontFamily)."""
    try:
        data = list_fonts(page=1, page_size=max(1, min(int(limit or 80), 200)))
    except Exception:
        return ""
    items = [it for it in (data.get("items") or []) if isinstance(it, dict)]
    if not items:
        return ""
    lines = [
        "Available fonts (create_text.fontFamily — pick from this list only):",
        "If the needed style is NOT here (brush calligraphy, 3D/extruded type, "
        "decorative lettering fonts cannot render) → create_image + genPrompt + "
        "letteringText instead of inventing a fontFamily.",
    ]
    for it in items:
        family = str(it.get("family") or "").strip()
        if not family:
            continue
        display = str(it.get("displayName") or "").strip()
        if display and display != family:
            lines.append(f"- `{family}` ({display})")
        else:
            lines.append(f"- `{family}`")
    return "\n".join(lines)
