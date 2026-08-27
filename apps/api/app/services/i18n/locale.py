"""Resolve client locale from HTTP headers or explicit params."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.services.design.runtime.host.prompts import normalize_locale


def locale_from_accept_language(raw: str | None, *, default: str = "zh-CN") -> str:
    """Parse the first ``Accept-Language`` tag."""
    text = str(raw or "").strip()
    if not text:
        return normalize_locale(None, default=default)
    first = text.split(",")[0].split(";")[0].strip()
    return normalize_locale(first, default=default)


def locale_from_request(request) -> str:
    """Best-effort locale for REST handlers (``Accept-Language``)."""
    headers = getattr(request, "headers", None)
    if headers is None:
        return "zh-CN"
    accept = headers.get("accept-language") or headers.get("Accept-Language")
    return locale_from_accept_language(accept)


def get_request_locale(request: Request) -> str:
    """FastAPI dependency: resolve locale from ``Accept-Language``."""
    return locale_from_request(request)


LocaleDep = Annotated[str, Depends(get_request_locale)]
