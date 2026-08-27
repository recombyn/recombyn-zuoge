"""Admin routes — fonts."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, Query,  UploadFile

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

router = APIRouter()

_FONT_KNOWN: dict[str, tuple[int, str]] = {
    "family required": (400, "font_family_required"),
    "font name already exists": (400, "font_name_exists"),
}


@router.get("/fonts")
def admin_list_fonts(
    _admin: AdminUser,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=200, ge=1, le=500),
) -> dict[str, Any]:
    from app.services import fonts_store

    return fonts_store.list_fonts(page=page, page_size=pageSize)


@router.post("/fonts")
def admin_upsert_font(
    locale: LocaleDep,
    _admin: AdminUser,
    body: AdminFontUpsertIn,
) -> dict[str, Any]:
    from app.services import fonts_store

    family = (body.family or "").strip()
    if not family:
        raise http_error(400, "font_family_required", locale)
    incoming = _normalize_admin_faces(
        family,
        body.faces,
        url=body.url,
        weight=body.weight,
        format=body.format,
    )
    existing = fonts_store.get_font_by_family(family)
    if body.merge and existing:
        children = _admin_merge_faces(existing.get("children"), incoming) if incoming else (
            existing.get("children") if isinstance(existing.get("children"), list) else []
        )
    else:
        children = incoming
    if not children:
        raise http_error(400, "font_face_url_required", locale)
    try:
        item = fonts_store.upsert_font(
            family=family,
            display_name=body.displayName or (existing or {}).get("displayName") or family,
            children=children,
            sort_order=body.sortOrder,
        )
    except ValueError as err:
        raise value_error_http(err, locale, known=_FONT_KNOWN) from err
    return {"item": item}


@router.post("/fonts/upload")
async def admin_fonts_upload(
    locale: LocaleDep,
    admin: AdminUser,
    file: UploadFile = File(..., description="ttf / otf / woff / woff2"),
    family: str | None = Form(default=None),
    displayName: str | None = Form(default=None),
    weight: int = Form(default=400),
) -> dict[str, Any]:
    """Upload a font file and register/merge as a catalog face."""
    return await admin_upload_font_file(
        admin,
        file=file,
        family=family,
        displayName=displayName,
        weight=weight,
        locale=locale,
    )


@router.delete("/fonts/{family}")
def admin_delete_font(
    locale: LocaleDep,
    _admin: AdminUser,
    family: str,
) -> dict[str, Any]:
    from app.services import fonts_store
    import urllib.parse

    fam = urllib.parse.unquote(family).strip()
    if not fam:
        raise http_error(400, "font_family_required", locale)
    ok = fonts_store.delete_font(fam)
    if not ok:
        raise http_error(404, "not_found", locale)
    return {"ok": True}


@router.delete("/fonts/{family}/faces/{weight}")
def admin_delete_font_face(
    locale: LocaleDep,
    _admin: AdminUser,
    family: str,
    weight: int,
) -> dict[str, Any]:
    from app.services import fonts_store
    import urllib.parse

    fam = urllib.parse.unquote(family).strip()
    existing = fonts_store.get_font_by_family(fam)
    if not existing:
        raise http_error(404, "font_not_found", locale)
    children = [
        c
        for c in (existing.get("children") or [])
        if isinstance(c, dict) and int(c.get("weight") or 400) != int(weight)
    ]
    if not children:
        fonts_store.delete_font(fam)
        return {"ok": True, "deletedFamily": True}
    item = fonts_store.upsert_font(
        family=fam,
        display_name=existing.get("displayName") or fam,
        children=children,
        sort_order=existing.get("sortOrder"),
    )
    return {"ok": True, "item": item}
