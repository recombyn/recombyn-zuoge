"""Shared PlazaError → localized HTTP mapping."""
from __future__ import annotations

from fastapi import HTTPException

from app.services.i18n.errors import service_error_http
from app.services.plaza.store import PlazaError

# service PlazaError.code → (http status, catalog error code)
PLAZA_STATUS: dict[str, tuple[int, str]] = {
    "not_found": (404, "submission_not_found"),
    "already_pending": (409, "plaza_already_pending"),
    "already_published": (409, "plaza_already_published"),
    "document_too_large": (413, "upload_too_large"),
    "invalid_project": (400, "invalid_project"),
    "invalid_document": (400, "invalid_document"),
    "cover_required": (400, "cover_required"),
    "cover_aspect_invalid": (400, "cover_aspect_invalid"),
    "artboard_required": (400, "artboard_required"),
}


def plaza_http(err: PlazaError, locale: str | None = None) -> HTTPException:
    status, code = PLAZA_STATUS.get(err.code, (400, "request_failed"))
    return service_error_http(code, locale, status=status, message=err.message)
