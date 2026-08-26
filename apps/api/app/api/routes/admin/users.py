"""Admin routes — users."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import AdminUser, audit_admin_mutation, require_permission
from app.api.routes.admin.common import *  # noqa: F403
from app.api.routes.admin.common import _require_card_key_ops_password
from app.services.auth import SessionUser

router = APIRouter()

@router.get("/me")
def admin_me(admin: AdminUser) -> dict[str, Any]:
    ensure_super_admin_role()
    return {
        "user": {
            "id": admin.id,
            "email": admin.email,
            "name": admin.name,
            "avatar": admin.avatar,
            "role": getattr(admin, "role", None) or ("admin" if is_admin_user(admin) else "user"),
            "status": getattr(admin, "status", None) or "active",
        }
    }

@router.get("/users")
def admin_list_users(
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    return list_users(page=page, page_size=pageSize, q=q, role=role, status=status)

@router.get("/users/{user_id}")
def admin_get_user(
    _admin: AdminUser,
    user_id: str,
) -> dict[str, Any]:
    item = get_user(user_id)
    if not item:
        raise HTTPException(status_code=404, detail="User not found")
    return {"item": item}

@router.patch("/users/{user_id}")
def admin_patch_user(
    request: Request,
    user_id: str,
    body: UserPatchIn,
    admin: SessionUser = Depends(require_permission("admin:users:write")),
) -> dict[str, Any]:
    try:
        item = update_user(
            user_id,
            role=body.role,
            status=body.status,
            name=body.name,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    if not item:
        raise HTTPException(status_code=404, detail="User not found")
    audit_admin_mutation(
        actor=admin,
        action="users.patch",
        resource="user",
        resource_id=user_id,
        trace_id=getattr(request.state, "trace_id", None),
    )
    return {"item": item}

@router.post("/users/{user_id}/adjust-credits")
def admin_adjust_credits(
    _admin: AdminUser,
    user_id: str,
    body: AdjustCreditsIn,
) -> dict[str, Any]:
    try:
        result = adjust_credits(user_id, body.amount, detail=body.detail)
    except ValueError as err:
        msg = str(err)
        if msg == "insufficient_credits":
            raise HTTPException(status_code=400, detail="Insufficient credits") from err
        raise HTTPException(status_code=400, detail=msg) from err
    return result

@router.get("/users/{user_id}/ledger")
def admin_user_ledger(
    _admin: AdminUser,
    user_id: str,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    kind: str = "all",
) -> dict[str, Any]:
    return user_ledger(user_id, page=page, page_size=pageSize, kind=kind)

@router.get("/card-keys")
def admin_list_card_keys(
    _admin: AdminUser,
    status: str | None = None,
) -> dict[str, Any]:
    return {"keys": list_card_keys(status=status)}

@router.post("/card-keys/generate")
def admin_generate_card_keys(
    _admin: AdminUser,
    body: GenerateCardKeysIn,
) -> dict[str, Any]:
    _require_card_key_ops_password(body.password)
    try:
        keys = generate_card_keys(
            count=body.count,
            credits=body.credits,
            expires_days=body.expiresDays,
            kind=body.kind,
            plan_id=body.planId,
        )
    except ValueError as err:
        detail = str(err)
        status = 503 if "CARD_KEY_SALT" in detail else 400
        raise HTTPException(status_code=status, detail=detail) from err
    first = keys[0] if keys else {}
    return {
        "count": len(keys),
        "kind": first.get("kind") or body.kind,
        "planId": first.get("planId") or body.planId,
        "credits": first.get("credits") if keys else body.credits,
        "expiresDays": body.expiresDays,
        "keys": keys,
    }

@router.post("/card-keys/revoke")
def admin_revoke_card_keys(
    _admin: AdminUser,
    body: RevokeCardKeysIn,
) -> dict[str, Any]:
    return revoke_card_keys(body.ids)

@router.get("/notices")
def admin_list_notices(
    _admin: AdminUser,
    kind: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    return {"items": list_notices_admin(kind=kind, status=status)}

@router.post("/notices")
def admin_upsert_notice(
    _admin: AdminUser,
    body: NoticeIn,
) -> dict[str, Any]:
    try:
        item = upsert_notice(
            notice_id=body.id,
            kind=body.kind,
            title=body.title,
            body=body.body,
            status=body.status,
            published_at=body.publishedAt,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"item": item}

@router.get("/notices/{notice_id}")
def admin_get_notice(
    _admin: AdminUser,
    notice_id: str,
) -> dict[str, Any]:
    item = get_notice(notice_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return {"item": item}

@router.delete("/notices/{notice_id}")
def admin_delete_notice(
    _admin: AdminUser,
    notice_id: str,
) -> dict[str, Any]:
    if not delete_notice(notice_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

