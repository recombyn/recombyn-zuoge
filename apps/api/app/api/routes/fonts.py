"""Fonts catalog (register / upload / list). AI font generation retired."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any
from fastapi import APIRouter, File, Form,  UploadFile
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, OptionalUser
from app.services import fonts_store
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep
from app.services.storage import put_bytes

router = APIRouter(prefix="/fonts", tags=["fonts"])

_FONT_EXT = {
    ".woff2": ("font/woff2", "woff2", "woff2"),
    ".woff": ("font/woff", "woff", "woff"),
    ".otf": ("font/otf", "opentype", "otf"),
    ".ttf": ("font/ttf", "truetype", "ttf"),
}


def _font_meta_from_filename(name: str, locale: str | None = None) -> tuple[str, str, str]:
    lower = name.lower()
    for ext, meta in _FONT_EXT.items():
        if lower.endswith(ext):
            return meta
    raise http_error(400, "font_format_unsupported", locale)


def _upload_quota(user_id: str) -> dict[str, int]:
    return {
        "userFontCount": fonts_store.count_user_fonts(user_id),
        "userFontLimit": fonts_store.MAX_USER_FONTS,
    }


def _clamp_weight(weight: int) -> int:
    try:
        weight_n = int(weight)
    except (TypeError, ValueError):
        weight_n = 400
    return max(100, min(900, weight_n))


@router.get("")
def list_fonts_endpoint(
    current_user: OptionalUser,
    page: int = 1,
    pageSize: int = 100,
) -> dict[str, Any]:
    viewer_id = str(current_user.id) if current_user else None
    return fonts_store.list_fonts(
        page=page, page_size=pageSize, viewer_user_id=viewer_id
    )


class FontFaceIn(BaseModel):
    family: str | None = None
    displayName: str = "Regular"
    weight: int = 400
    url: str
    format: str | None = None


class FontRegisterIn(BaseModel):
    """Register a font family via CDN/URL faces (or a single url)."""

    family: str = Field(..., min_length=1, max_length=255)
    displayName: str | None = Field(default=None, max_length=255)
    url: str | None = Field(
        default=None,
        description="Single face URL shorthand (creates Regular 400)",
    )
    format: str | None = None
    weight: int | None = Field(default=400, ge=100, le=900)
    faces: list[FontFaceIn] | None = None


def _merge_faces(
    existing: list[Any] | None,
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep existing faces; replace same-weight entries with incoming."""
    by_weight: dict[int, dict[str, Any]] = {}
    if isinstance(existing, list):
        for c in existing:
            if not isinstance(c, dict):
                continue
            url = str(c.get("url") or "").strip()
            if not url:
                continue
            try:
                w = int(c.get("weight") or 400)
            except (TypeError, ValueError):
                w = 400
            by_weight[w] = c
    for face in incoming:
        try:
            w = int(face.get("weight") or 400)
        except (TypeError, ValueError):
            w = 400
        by_weight[w] = face
    return [by_weight[k] for k in sorted(by_weight.keys())]


@router.post("/register")
def register_font(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: FontRegisterIn,
) -> dict[str, Any]:
    """Add/update a catalog font from URLs (auth required). Merges by weight."""
    family = (body.family or "").strip()
    if not family:
        raise http_error(400, "font_family_required", locale)

    faces: list[dict[str, Any]] = []
    if body.faces:
        for f in body.faces:
            url = (f.url or "").strip()
            if not url:
                continue
            weight_n = int(f.weight or 400)
            label = (f.displayName or "Regular").strip() or "Regular"
            face_family = (f.family or "").strip() or (
                family if weight_n == 400 else f"{family} {label}"
            )
            faces.append(
                {
                    "family": face_family,
                    "displayName": label,
                    "weight": weight_n,
                    "url": url,
                    **({"format": f.format} if f.format else {}),
                }
            )
    elif body.url:
        weight_n = int(body.weight or 400)
        label = "Regular" if weight_n == 400 else f"Weight {weight_n}"
        faces.append(
            {
                "family": family if weight_n == 400 else f"{family} {label}",
                "displayName": label,
                "weight": weight_n,
                "url": body.url.strip(),
                **({"format": body.format} if body.format else {}),
            }
        )
    else:
        raise http_error(400, "font_faces_or_url_required", locale)

    if not faces:
        raise http_error(400, "font_no_valid_urls", locale)

    fam = fonts_store.resolve_upload_family(family, current_user.id)
    try:
        fonts_store.assert_user_can_add_font(current_user.id, fam)
    except ValueError as err:
        raise value_error_http(err, locale) from err

    existing = fonts_store.get_font_by_family(fam)
    merged = _merge_faces(
        existing.get("children") if existing else None,
        faces,
    )
    try:
        item = fonts_store.upsert_font(
            family=fam,
            display_name=body.displayName or (existing or {}).get("displayName") or fam,
            children=merged,
            owner_user_id=current_user.id,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err
    return {"item": item}


@router.post("/upload")
async def upload_font_file(
    locale: LocaleDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="ttf / otf / woff / woff2"),
    family: str | None = Form(default=None),
    displayName: str | None = Form(default=None),
    weight: int = Form(default=400),
) -> dict[str, Any]:
    """Upload a font file, store it, and register as a catalog face."""
    raw = await file.read()
    if not raw:
        raise http_error(400, "empty_file", locale)
    if len(raw) > 20 * 1024 * 1024:
        raise http_error(400, "font_file_too_large", locale)

    name = (file.filename or "font.ttf").strip()
    mime, fmt, ext = _font_meta_from_filename(name, locale)

    stem = Path(name).stem.strip() or "CustomFont"
    requested = (family or stem).strip() or "CustomFont"
    label = (displayName or stem).strip() or stem
    digest = fonts_store.content_hash_bytes(raw)
    try:
        fonts_store.assert_unique_user_font_upload(
            current_user.id,
            display_name=label,
            content_hash=digest,
            requested_family=requested,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err

    fam = fonts_store.resolve_upload_family(requested, current_user.id)
    try:
        fonts_store.assert_user_can_add_font(current_user.id, fam)
    except ValueError as err:
        raise value_error_http(err, locale) from err

    existing_resolved = fonts_store.get_font_by_family(fam)
    if existing_resolved and str(existing_resolved.get("ownerUserId") or "").strip() == str(
        current_user.id
    ).strip():
        raise http_error(400, "font_name_exists", locale)

    weight_n = _clamp_weight(weight)
    object_key = f"uploads/{current_user.id}/fonts/{uuid.uuid4().hex[:12]}_{_safe_name(stem)}.{ext}"
    put_bytes(object_key, raw, content_type=mime)
    url = _public_font_url(object_key)

    face_family = fam if weight_n == 400 else f"{fam} {label}"
    new_face = {
        "family": face_family,
        "displayName": label,
        "weight": weight_n,
        "url": url,
        "format": fmt,
        "contentHash": digest,
    }
    existing = fonts_store.get_font_by_family(fam)
    merged = _merge_faces(existing.get("children") if existing else None, [new_face])
    item = fonts_store.upsert_font(
        family=fam,
        display_name=(existing or {}).get("displayName") or label,
        children=merged,
        owner_user_id=current_user.id,
    )

    return {
        "url": url,
        "key": object_key,
        "mime": mime,
        "format": fmt,
        "family": fam,
        "weight": weight_n,
        "item": item,
        **_upload_quota(current_user.id),
    }


@router.delete("/mine/{family}")
def delete_my_font(
    locale: LocaleDep,
    current_user: CurrentUser,
    family: str,
) -> dict[str, Any]:
    fam = (family or "").strip()
    if not fam:
        raise http_error(400, "font_family_required", locale)
    ok = fonts_store.delete_user_font(user_id=current_user.id, family=fam)
    if not ok:
        raise http_error(404, "font_not_found", locale)
    return {"ok": True, "family": fam, **_upload_quota(current_user.id)}


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name).strip("_")[:64] or "font"


def _public_font_url(object_key: str) -> str:
    from app.core.config import settings as _settings

    base = (_settings.s3_public_base_url or "").rstrip("/")
    if _settings.s3_enabled and base:
        return f"{base}/{object_key}"
    return f"/api/v1/uploads/files/{object_key}"
