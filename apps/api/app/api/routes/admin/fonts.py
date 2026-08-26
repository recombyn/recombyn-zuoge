"""Admin routes — fonts."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403

router = APIRouter()

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
    _admin: AdminUser,
    body: AdminFontUpsertIn,
) -> dict[str, Any]:
    from app.services import fonts_store

    family = (body.family or "").strip()
    if not family:
        raise HTTPException(status_code=400, detail="family required")
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
        raise HTTPException(status_code=400, detail="At least one face with url is required")
    try:
        item = fonts_store.upsert_font(
            family=family,
            display_name=body.displayName or (existing or {}).get("displayName") or family,
            children=children,
            sort_order=body.sortOrder,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"item": item}


@router.post("/fonts/upload")
async def admin_fonts_upload(
    admin: AdminUser,
    file: UploadFile = File(..., description="ttf / otf / woff / woff2"),
    family: str | None = Form(default=None),
    displayName: str | None = Form(default=None),
    weight: int = Form(default=400),
) -> dict[str, Any]:
    """Upload a font file and register/merge as a catalog face."""
    return await admin_upload_font_file(
        admin, file=file, family=family, displayName=displayName, weight=weight
    )


@router.delete("/fonts/{family}")
def admin_delete_font(
    _admin: AdminUser,
    family: str,
) -> dict[str, Any]:
    from app.services import fonts_store
    import urllib.parse

    fam = urllib.parse.unquote(family).strip()
    if not fam:
        raise HTTPException(status_code=400, detail="family required")
    ok = fonts_store.delete_font(fam)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.delete("/fonts/{family}/faces/{weight}")
def admin_delete_font_face(
    _admin: AdminUser,
    family: str,
    weight: int,
) -> dict[str, Any]:
    from app.services import fonts_store
    import urllib.parse

    fam = urllib.parse.unquote(family).strip()
    existing = fonts_store.get_font_by_family(fam)
    if not existing:
        raise HTTPException(status_code=404, detail="Family not found")
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

