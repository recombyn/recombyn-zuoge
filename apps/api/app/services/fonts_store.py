"""Font catalog store — seeded from apps/api/seeds/fonts_seed.json."""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema


def _slug(family: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", (family or "").strip()).strip("_").lower()
    return (s or "font")[:48]


def _row_to_item(row: Any) -> dict[str, Any]:
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

    return {
        "family": _get("family"),
        "displayName": _get("display_name"),
        "children": children,
        "id": _get("id"),
        "sortOrder": int(_get("sort_order") or 0),
    }


def list_fonts(
    *,
    page: int = 1,
    page_size: int = 100,
) -> dict[str, Any]:
    init_schema()
    page_n = max(1, int(page or 1))
    page_size_n = max(1, min(int(page_size or 100), 500))
    offset = (page_n - 1) * page_size_n
    with Session(engine) as session:
        total = crud.count_fonts(session=session)
        rows = crud.list_fonts_page(
            session=session, offset=offset, limit=page_size_n
        )
    items = [_row_to_item(r) for r in rows]
    return {
        "items": items,
        "page": page_n,
        "pageSize": page_size_n,
        "total": total,
        "hasMore": offset + len(items) < total,
    }


def get_font_by_family(family: str) -> dict[str, Any] | None:
    init_schema()
    key = (family or "").strip()
    if not key:
        return None
    with Session(engine) as session:
        row = crud.get_font_by_family(session=session, family=key)
    return _row_to_item(row) if row else None


def upsert_font(
    *,
    family: str,
    display_name: str | None = None,
    children: list[dict[str, Any]] | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    """Insert or replace a font family row (matched by ``family``)."""
    init_schema()
    fam = (family or "").strip()
    if not fam:
        raise ValueError("family required")
    display = (display_name or fam).strip() or fam
    faces = children if isinstance(children, list) else []
    # Keep only faces that declare a file URL (weight UI depends on real files).
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
        normalized.append(
            {
                "family": face_family,
                "displayName": label,
                "weight": weight_n,
                "url": url,
                **({"format": fmt} if fmt else {}),
            }
        )
    faces_json = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    now = time.time()
    with Session(engine) as session:
        row = crud.upsert_font_row(
            session=session,
            family=fam,
            display_name=display,
            faces_json=faces_json,
            sort_order=sort_order,
            new_id=f"font_{uuid.uuid4().hex[:10]}_{_slug(fam)}",
            created_at=now,
        )
    return _row_to_item(row)


def delete_font(family: str) -> bool:
    init_schema()
    fam = (family or "").strip()
    if not fam:
        return False
    with Session(engine) as session:
        return crud.delete_font_by_family(session=session, family=fam)


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
