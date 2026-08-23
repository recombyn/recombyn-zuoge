"""Admin API — /api/v1/admin/* for recombyn-admin."""

from fastapi import APIRouter, Depends

from app.api.deps import audit_admin_writes
from app.api.routes.admin import billing, catalog, content, design, fonts, ops, users

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(audit_admin_writes)],
)
router.include_router(users.router)
router.include_router(content.router)
router.include_router(catalog.router)
router.include_router(billing.router)
router.include_router(design.router)
router.include_router(fonts.router)
router.include_router(ops.router)
