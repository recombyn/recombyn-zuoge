"""Fonts catalog (register / upload / list). AI font generation retired."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.api.deps import CurrentUser
from pydantic import BaseModel, Field

from app.services import fonts_store
from app.services.storage import put_bytes

router = APIRouter(prefix="/fonts", tags=["fonts"])






@router.get("")
def list_fonts_endpoint(
    page: int = 1,
    pageSize: int = 100,
) -> dict[str, Any]:
    return fonts_store.list_fonts(page=page, page_size=pageSize)


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
    current_user: CurrentUser,
    body: FontRegisterIn,
) -> dict[str, Any]:
    """Add/update a catalog font from URLs (auth required). Merges by weight."""
    family = (body.family or "").strip()
    if not family:
        raise HTTPException(status_code=400, detail="family required")

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
        raise HTTPException(status_code=400, detail="Provide faces[] or url")

    if not faces:
        raise HTTPException(status_code=400, detail="No valid face URLs")

    existing = fonts_store.get_font_by_family(family)
    merged = _merge_faces(
        existing.get("children") if existing else None,
        faces,
    )
    try:
        item = fonts_store.upsert_font(
            family=family,
            display_name=body.displayName or (existing or {}).get("displayName") or family,
            children=merged,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"item": item}


@router.post("/upload")
async def upload_font_file(
    current_user: CurrentUser,
    file: UploadFile = File(..., description="ttf / otf / woff / woff2"),
    family: str | None = Form(default=None),
    displayName: str | None = Form(default=None),
    weight: int = Form(default=400),
) -> dict[str, Any]:
    """Upload a font file, store it, and register as a catalog face."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="font file too large (max 20MB)")

    name = (file.filename or "font.ttf").strip()
    lower = name.lower()
    if not lower.endswith((".ttf", ".otf", ".woff", ".woff2")):
        raise HTTPException(status_code=400, detail="Only ttf/otf/woff/woff2 supported")

    if lower.endswith(".woff2"):
        mime, fmt, ext = "font/woff2", "woff2", "woff2"
    elif lower.endswith(".woff"):
        mime, fmt, ext = "font/woff", "woff", "woff"
    elif lower.endswith(".otf"):
        mime, fmt, ext = "font/otf", "opentype", "otf"
    else:
        mime, fmt, ext = "font/ttf", "truetype", "ttf"

    stem = Path(name).stem.strip() or "CustomFont"
    fam = (family or stem).strip() or "CustomFont"
    label = (displayName or "Regular").strip() or "Regular"
    try:
        weight_n = int(weight)
    except (TypeError, ValueError):
        weight_n = 400
    weight_n = max(100, min(900, weight_n))

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
    }
    existing = fonts_store.get_font_by_family(fam)
    merged = _merge_faces(
        existing.get("children") if existing else None,
        [new_face],
    )
    item = fonts_store.upsert_font(
        family=fam,
        display_name=(existing or {}).get("displayName") or fam,
        children=merged,
    )

    return {
        "url": url,
        "key": object_key,
        "mime": mime,
        "format": fmt,
        "family": fam,
        "weight": weight_n,
        "item": item,
    }


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name).strip("_")[:64] or "font"


def _public_font_url(object_key: str) -> str:
    from app.core.config import settings as _settings

    base = (_settings.s3_public_base_url or "").rstrip("/")
    if _settings.s3_enabled and base:
        return f"{base}/{object_key}"
    return f"/api/v1/uploads/files/{object_key}"
