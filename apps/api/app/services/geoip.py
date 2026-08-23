"""Client country lookup for region-gated providers (e.g. OpenRouter on CN networks).

Resolution order:
1. ``CLIENT_COUNTRY_OVERRIDE`` (tests / forced region)
2. Edge headers: ``CF-IPCountry``, ``CloudFront-Viewer-Country``, ``X-Appengine-Country``
3. GeoLite2-Country.mmdb via ``GEOLITE2_COUNTRY_DB`` (optional ``geoip2`` package)

Fail-open: missing DB / lookup errors → country unknown → OpenRouter allowed
(unless override forces a blocked country).
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

_HEADER_COUNTRY_KEYS = (
    "cf-ipcountry",
    "cloudfront-viewer-country",
    "x-appengine-country",
    "x-country-code",
)


def _settings() -> Any:
    from app.core.config import settings

    return settings


def is_openrouter_model_ref(model_ref: str | None) -> bool:
    mid = str(model_ref or "").strip().lower()
    if not mid:
        return False
    if mid.startswith("or-") or mid.startswith("openrouter/"):
        return True
    try:
        from app.services.llm.catalog_store import get_model

        row = get_model(str(model_ref or "").strip())
        if isinstance(row, dict) and str(row.get("provider") or "").lower() == "openrouter":
            return True
    except Exception:
        pass
    return False


def openrouter_block_countries() -> set[str]:
    raw = str(getattr(_settings(), "openrouter_block_countries", "CN") or "CN")
    return {p.strip().upper() for p in raw.split(",") if p.strip()}


def openrouter_allowed_for_country(country: str | None) -> bool:
    """False when country is in the block list (typically mainland CN)."""
    code = str(country or "").strip().upper()
    if not code or code in ("XX", "T1", "UNKNOWN"):
        return True
    return code not in openrouter_block_countries()


def client_ip_from_request(request: Any) -> str:
    if request is None:
        return ""
    headers = getattr(request, "headers", None)
    if headers is not None:
        forwarded = str(headers.get("x-forwarded-for") or "").strip()
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = str(headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client is not None else None
    return str(host or "").strip()


def country_from_headers(request: Any) -> str | None:
    if request is None:
        return None
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    for key in _HEADER_COUNTRY_KEYS:
        raw = str(headers.get(key) or "").strip().upper()
        if raw and raw not in ("XX", "T1"):
            return raw[:8]
    return None


@lru_cache(maxsize=1)
def _geoip_reader() -> Any | None:
    path = str(getattr(_settings(), "geolite2_country_db", "") or "").strip()
    if not path:
        return None
    try:
        from pathlib import Path

        p = Path(path)
        if not p.is_file():
            logger.warning("geolite2_country_db missing: %s", path)
            return None
        import geoip2.database

        return geoip2.database.Reader(str(p))
    except ImportError:
        logger.warning("geoip2 not installed — GeoLite2 lookup disabled")
        return None
    except Exception as err:  # noqa: BLE001
        logger.warning("geolite2 open failed: %s", err)
        return None


def lookup_country_for_ip(ip: str) -> str | None:
    addr = str(ip or "").strip()
    if not addr or addr in ("127.0.0.1", "::1", "localhost"):
        return None
    reader = _geoip_reader()
    if reader is None:
        return None
    try:
        resp = reader.country(addr)
        code = str(getattr(getattr(resp, "country", None), "iso_code", None) or "").strip().upper()
        return code or None
    except Exception:
        return None


def resolve_client_country(request: Any = None) -> str | None:
    override = str(getattr(_settings(), "client_country_override", "") or "").strip().upper()
    if override:
        return override
    from_hdr = country_from_headers(request)
    if from_hdr:
        return from_hdr
    return lookup_country_for_ip(client_ip_from_request(request))


def openrouter_allowed_for_request(request: Any = None) -> bool:
    return openrouter_allowed_for_country(resolve_client_country(request))


def filter_catalog_models_for_region(
    models: list[dict[str, Any]],
    *,
    country: str | None,
) -> list[dict[str, Any]]:
    if openrouter_allowed_for_country(country):
        return models
    out: list[dict[str, Any]] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        provider = str(m.get("provider") or "").strip().lower()
        mid = str(m.get("id") or "").strip()
        if provider == "openrouter" or is_openrouter_model_ref(mid):
            continue
        out.append(m)
    return out
