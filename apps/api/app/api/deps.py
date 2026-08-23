"""FastAPI dependencies: DB session, current user, admin."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.auth import SessionUser, get_session
from app.services.auth.admin import is_admin_user

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/email/login",
)
optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/email/login",
    auto_error=False,
)


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]
OptionalTokenDep = Annotated[str | None, Depends(optional_oauth2)]


def get_current_user(session: SessionDep, token: TokenDep) -> SessionUser:
    user = get_session(token, db=session)
    if not user:
        # 401 (not 403): axios / App treat this as session death and clear local auth.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_status = (getattr(user, "status", None) or "active").strip().lower()
    if user_status == "disabled":
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


def get_current_user_optional(
    session: SessionDep,
    token: OptionalTokenDep,
) -> SessionUser | None:
    if not token:
        return None
    return get_session(token, db=session)


CurrentUser = Annotated[SessionUser, Depends(get_current_user)]
OptionalUser = Annotated[SessionUser | None, Depends(get_current_user_optional)]


def get_current_active_superuser(current_user: CurrentUser) -> SessionUser:
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    return current_user


AdminUser = Annotated[SessionUser, Depends(get_current_active_superuser)]

# Resource×action permissions (Phase 3+). Coarse roles still gate today;
# helpers encode the matrix so org_role can plug in later without a mega rbac module.
Permission = str  # e.g. "admin:users:write", "project:write", "plaza:moderate"

_ADMIN_PERMISSIONS: frozenset[str] = frozenset(
    {
        "admin:users:read",
        "admin:users:write",
        "admin:plaza:moderate",
        "admin:catalog:write",
        "admin:design:write",
        "admin:fonts:write",
        "admin:content:read",
        "admin:notices:write",
        "admin:metrics:read",
    }
)


def user_has_permission(user: SessionUser, permission: Permission) -> bool:
    """Deny-by-default permission check beside coarse admin role."""
    if not permission:
        return False
    if is_admin_user(user):
        return permission in _ADMIN_PERMISSIONS or permission.startswith("admin:")
    # End-user surface (extend when org roles land).
    if permission in {"project:write", "project:read", "upload:write", "wallet:read"}:
        return True
    return False


def require_permission(permission: Permission):
    """FastAPI dependency factory: `Depends(require_permission('admin:users:write'))`."""

    def _dep(current_user: CurrentUser) -> SessionUser:
        if not user_has_permission(current_user, permission):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "permission_denied",
                    "permission": permission,
                },
            )
        return current_user

    return _dep


def audit_admin_mutation(
    *,
    actor: SessionUser,
    action: str,
    resource: str,
    resource_id: str | None = None,
    trace_id: str | None = None,
) -> None:
    """Structured audit line for admin writes (ADR 0007 correlation)."""
    import logging

    logging.getLogger("recombyn.audit").info(
        "admin_audit action=%s resource=%s resource_id=%s actor=%s trace_id=%s",
        action,
        resource,
        resource_id or "",
        getattr(actor, "id", ""),
        trace_id or "",
        extra={
            "event": "admin_audit",
            "user_id": getattr(actor, "id", None),
            "trace_id": trace_id,
            "action": action,
            "resource": resource,
        },
    )


_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


async def audit_admin_writes(
    request: Request,
    response: Response,
    admin: AdminUser,
):
    """Router-level dependency: audit successful admin mutating requests."""
    yield
    if request.method not in _WRITE_METHODS:
        return
    if int(getattr(response, "status_code", 500) or 500) >= 400:
        return
    path = request.url.path or ""
    # /api/v1/admin/users/xyz → resource hint
    parts = [p for p in path.split("/") if p]
    resource = "admin"
    resource_id = None
    if "admin" in parts:
        i = parts.index("admin")
        if i + 1 < len(parts):
            resource = parts[i + 1]
        if i + 2 < len(parts):
            resource_id = parts[i + 2]
    audit_admin_mutation(
        actor=admin,
        action=f"{request.method} {path}",
        resource=resource,
        resource_id=resource_id,
        trace_id=getattr(request.state, "trace_id", None),
    )


# ----- Org roles (skeleton) -----

OrgRole = str  # owner | admin | member

_ORG_ROLE_RANK: dict[str, int] = {
    "member": 1,
    "admin": 2,
    "owner": 3,
}


def org_role_at_least(have: str | None, need: OrgRole) -> bool:
    return _ORG_ROLE_RANK.get(str(have or "").lower(), 0) >= _ORG_ROLE_RANK.get(
        str(need).lower(), 99
    )


def user_has_org_permission(
    *,
    user: SessionUser,
    org_id: str,
    permission: Permission,
    member_role: str | None,
) -> bool:
    """Org-scoped check. Platform admins still bypass. member_role from org_members."""
    if is_admin_user(user):
        return True
    if not org_id or not member_role:
        return False
    role = str(member_role).lower()
    if permission.startswith("org:") and role in _ORG_ROLE_RANK:
        # org:project:write needs member+; org:members:write needs admin+
        if permission in {"org:project:read", "org:project:write", "org:billing:read"}:
            return org_role_at_least(role, "member")
        if permission in {"org:members:write", "org:settings:write", "org:billing:write"}:
            return org_role_at_least(role, "admin")
        return org_role_at_least(role, "owner")
    return False


def require_org_permission(permission: Permission):
    """Depends factory — resolves org membership then checks permission."""

    def _dep(
        current_user: CurrentUser,
        org_id: str,
    ) -> SessionUser:
        from app.services.auth.orgs import get_org_member_role

        if not org_id:
            raise HTTPException(status_code=400, detail="org_id required")
        role = get_org_member_role(org_id=org_id, user_id=current_user.id)
        if not user_has_org_permission(
            user=current_user,
            org_id=org_id,
            permission=permission,
            member_role=role,
        ):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "org_permission_denied",
                    "permission": permission,
                    "org_id": org_id,
                },
            )
        return current_user

    # Bind path/query org_id via explicit signature name expected by FastAPI.
    _dep.__name__ = f"require_org_{permission.replace(':', '_')}"
    return _dep

