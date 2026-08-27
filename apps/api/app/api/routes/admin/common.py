"""Shared admin route models and helpers."""

from __future__ import annotations

import hmac

from typing import Any, Literal

from fastapi import File, Form, HTTPException, UploadFile

from pydantic import BaseModel, Field

from app.api.deps import AdminUser

from app.core.config import settings






from app.services.plaza.store import PlazaError












def _plaza_http(err: PlazaError) -> HTTPException:
    status = {
        "not_found": 404,
        "already_pending": 409,
        "already_published": 409,
        "document_too_large": 413,
        "invalid_project": 400,
        "invalid_document": 400,
        "cover_required": 400,
        "cover_aspect_invalid": 400,
        "artboard_required": 400,
    }.get(err.code, 400)
    return HTTPException(status_code=status, detail=err.message)

class UserPatchIn(BaseModel):
    role: Literal["user", "admin"] | None = None
    status: Literal["active", "disabled"] | None = None
    name: str | None = Field(default=None, max_length=80)

class AdjustCreditsIn(BaseModel):
    amount: int = Field(..., description="Positive credit, negative debit")
    detail: str = Field(default="admin adjust", max_length=500)

class GenerateCardKeysIn(BaseModel):
    count: int = Field(default=10, ge=1, le=100)
    """credit = unified 积分 top-up; plan = membership + monthly 积分."""
    kind: str = Field(default="credit", max_length=16)
    # Face value in 积分.
    credits: int = Field(default=0, ge=0, le=50_000_000)
    planId: str | None = Field(default=None, max_length=16)
    expiresDays: int = Field(default=365, ge=0, le=3650)
    # Dedicated generate password (CARD_KEY_OPS_PASSWORD), not the login password.
    password: str = Field(..., min_length=1, max_length=128)

def _require_card_key_ops_password(password: str) -> None:
    """Verify the dedicated card-key generate password from env."""
    ops = (settings.card_key_ops_password or "").strip()
    if not ops:
        raise HTTPException(
            status_code=503,
            detail="CARD_KEY_OPS_PASSWORD is not configured",
        )
    pw = (password or "").strip()
    if not pw or not hmac.compare_digest(pw, ops):
        raise HTTPException(status_code=403, detail="Generate password incorrect")

class RevokeCardKeysIn(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=200)

class RejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)

class PlazaVisibilityIn(BaseModel):
    visible: bool

class PlazaCoverIn(BaseModel):
    """Custom list-cover image URL (from /uploads). Empty string clears."""
    url: str | None = Field(default=None, max_length=2000)

class PlazaTitleIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)

class NoticeIn(BaseModel):
    id: str | None = None
    kind: Literal["announcement", "notification"] = "announcement"
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=8000)
    status: Literal["draft", "published"] = "draft"
    publishedAt: float | None = None

class ModelUpsertIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    label: str = Field(..., min_length=1, max_length=255)
    kind: Literal["text", "image"] = "text"
    referenceTypes: list[Literal["text", "vision", "image"]] = Field(
        default_factory=lambda: ["text"],
        description="Route slots this model may fill: text / vision(multimodal) / image.",
    )
    provider: str = Field(default="doubao", max_length=64)
    apiModel: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    iconKey: str | None = Field(default=None, max_length=64)
    iconUrl: str | None = Field(default=None, max_length=2000)
    price: str | None = Field(default=None, max_length=255)
    maxAttachments: int = Field(default=8, ge=0, le=64)
    thinking: bool = False
    enabled: bool = True
    sortOrder: int = Field(default=100, ge=0, le=100000)
    # Doubao Seedream size contract (resolutions / pixel bounds / size tables).
    imageLimits: dict[str, Any] | None = None
    imageLimitPreset: str | None = Field(default=None, max_length=64)
    priceMeta: dict[str, Any] | None = None
    pricingId: str | None = Field(default=None, max_length=128)

class SyncPricesIn(BaseModel):
    provider: Literal["openrouter", "ark"] = "openrouter"
    onlyEmpty: bool = False

class RuntimeSettingIn(BaseModel):
    """Whitelist settings still edited from 推理集群 (not the old rules table UI)."""

    key: str = Field(..., min_length=1, max_length=96)
    value: str = Field(default="")

_RUNTIME_SETTING_KEYS = frozenset(
    {
        "billing.token_markup",
        "agent.react.max_rounds",
        "agent.react.defer_tools",
        "memory.dialogue.recent_turns",
        "memory.dialogue.recent_chars",
        "memory.dialogue.summary_chars",
        "memory.dialogue.facts_max",
        "memory.dialogue.per_turn_chars",
        "precheck.model_threshold",
        "precheck.vision_model",
        "precheck.fallback_chain",
        "precheck.router_model",
        "precheck.user_preset.economy",
        "precheck.user_preset.balanced",
        "precheck.user_preset.quality",
        "assets.image_default_model",
        "byok.preset_platforms",
    }
)

class SystemPromptIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=128)
    body: str = ""
    label: str | None = None
    description: str | None = None
    group: str | None = None
    selectable: bool | None = None
    sortOrder: int | None = None
    enabled: bool | None = None

class CanvasToolIn(BaseModel):
    opKey: str
    kind: str = "node"
    label: str = ""
    modelHint: str = ""
    argsSchema: str = ""
    enabled: bool = True
    sortOrder: int = 0

class DesignDictIn(BaseModel):
    id: int | None = None
    dictType: str = Field(..., min_length=1, max_length=32)
    code: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=128)
    sortOrder: int = 0
    enabled: bool = True

class DesignDictTypeIn(BaseModel):
    id: int | None = None
    code: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=128)
    sortOrder: int = 0
    enabled: bool = True

class DesignSkillIn(BaseModel):
    id: int | None = None
    skillKey: str | None = Field(default=None, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    category: str = Field(default="agent", max_length=32)
    whenToUse: str = ""
    promptPositive: str = ""
    promptNegative: str = ""
    preferredTools: list[str] | str | None = None
    allowedResources: list[str] | str | None = None
    inputSchema: dict[str, Any] | str | None = None
    outputSchema: dict[str, Any] | str | None = None
    namespace: str | None = Field(default="user", max_length=16)
    ownerUserId: str | None = Field(default=None, max_length=64)
    triggers: list[Any] | dict[str, Any] | str | None = None
    mutexGroup: str = Field(default="", max_length=64)
    version: int = 0
    packVersion: str | None = Field(default=None, max_length=32)
    logo: str | None = None
    locales: dict[str, Any] | str | None = None
    scenes: str = Field(default="all", max_length=128)
    sortWeight: int = 0
    enabled: bool = True
    defaultModel: str = "doubao"
    maxRetries: int = 2
    outputFormat: str = "json"
    allowUserModelOverride: bool = False






class AdminFontFaceIn(BaseModel):
    family: str | None = None
    displayName: str = "Regular"
    weight: int = Field(default=400, ge=100, le=900)
    url: str
    format: str | None = None

class AdminFontUpsertIn(BaseModel):
    family: str = Field(..., min_length=1, max_length=255)
    displayName: str | None = Field(default=None, max_length=255)
    sortOrder: int | None = None
    faces: list[AdminFontFaceIn] | None = None
    url: str | None = None
    weight: int | None = Field(default=400, ge=100, le=900)
    format: str | None = None
    merge: bool = Field(
        default=True,
        description="When true, merge faces by weight; when false, replace all faces",
    )

def _admin_merge_faces(
    existing: list[Any] | None,
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
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

def _normalize_admin_faces(
    family: str,
    faces: list[AdminFontFaceIn] | None,
    *,
    url: str | None = None,
    weight: int | None = 400,
    format: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if faces:
        for f in faces:
            u = (f.url or "").strip()
            if not u:
                continue
            weight_n = int(f.weight or 400)
            label = (f.displayName or "Regular").strip() or "Regular"
            face_family = (f.family or "").strip() or (
                family if weight_n == 400 else f"{family} {label}"
            )
            out.append(
                {
                    "family": face_family,
                    "displayName": label,
                    "weight": weight_n,
                    "url": u,
                    **({"format": f.format} if f.format else {}),
                }
            )
    elif url and url.strip():
        weight_n = int(weight or 400)
        label = "Regular" if weight_n == 400 else f"Weight {weight_n}"
        out.append(
            {
                "family": family if weight_n == 400 else f"{family} {label}",
                "displayName": label,
                "weight": weight_n,
                "url": url.strip(),
                **({"format": format} if format else {}),
            }
        )
    return out

async def admin_upload_font_file(
    admin: AdminUser,
    file: UploadFile = File(..., description="ttf / otf / woff / woff2"),
    family: str | None = Form(default=None),
    displayName: str | None = Form(default=None),
    weight: int = Form(default=400),
) -> dict[str, Any]:
    """Upload a font file and register/merge as a catalog face."""
    import re
    import uuid
    from pathlib import Path

    from app.services import fonts_store
    from app.services.storage import put_bytes
    from app.core.config import settings as _settings

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

    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", stem).strip("_")[:64] or "font"
    object_key = f"uploads/{admin.id}/fonts/{uuid.uuid4().hex[:12]}_{safe}.{ext}"
    put_bytes(object_key, raw, content_type=mime)
    base = (_settings.s3_public_base_url or "").rstrip("/")
    if _settings.s3_enabled and base:
        url = f"{base}/{object_key}"
    else:
        url = f"/api/v1/uploads/files/{object_key}"

    face_family = fam if weight_n == 400 else f"{fam} {label}"
    new_face = {
        "family": face_family,
        "displayName": label,
        "weight": weight_n,
        "url": url,
        "format": fmt,
    }
    existing = fonts_store.get_font_by_family(fam)
    merged = _admin_merge_faces(
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

