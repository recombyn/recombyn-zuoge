"""Platform-level BYOK credentials (one key → many catalog models).

Aggregators like OpenRouter and Volcengine Ark expose many text / image / video
models behind a single API key. Users save a platform credential; the catalog
for that ``provider`` becomes available and ``_api_key_for`` prefers their key.

Admin override: ``design_global_rule`` key ``byok.preset_platforms`` (JSON array)
replaces the curated platform list.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

BYOK_PLATFORM_RULE_KEY = "byok.preset_platforms"

PLATFORM_ID_PREFIX = "platform:"

# Catalog providers we support for platform-level BYOK (matches llm_models.provider).
_DEFAULT_BYOK_PLATFORMS: list[dict[str, Any]] = [
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "website": "https://openrouter.ai",
        "baseUrl": "https://openrouter.ai/api/v1",
        "iconKey": "openai",
        # What our catalog already wires for this provider.
        "kinds": ["text", "image", "video"],
        "hint": "One key unlocks every OpenRouter model in our catalog.",
    },
    {
        "id": "doubao",
        "name": "Volcengine (Doubao / Ark)",
        "website": "https://console.volcengine.com/ark",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "iconKey": "doubao",
        "kinds": ["text", "image"],
        "hint": "One key unlocks every Volcengine / Ark model in our catalog.",
    },
]


def platform_byok_row_id(provider: str) -> str:
    """Stable BYOK vault id for a catalog provider credential."""
    return f"{PLATFORM_ID_PREFIX}{str(provider or '').strip().lower()}"


def parse_platform_byok_id(provider_id: str | None) -> str | None:
    """Return catalog provider from ``platform:<provider>``, else None."""
    raw = str(provider_id or "").strip()
    low = raw.lower()
    if not low.startswith(PLATFORM_ID_PREFIX):
        return None
    provider = raw[len(PLATFORM_ID_PREFIX) :].strip().lower()
    return provider or None


def _sanitize_platform(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pid = str(raw.get("id") or "").strip().lower()
    name = str(raw.get("name") or "").strip()
    base_url = str(raw.get("baseUrl") or "").strip().rstrip("/")
    if not pid or not name or not base_url:
        return None
    kinds_raw = raw.get("kinds") or ["text"]
    kinds: list[str] = []
    for k in kinds_raw if isinstance(kinds_raw, list) else []:
        kk = str(k or "").strip().lower()
        if kk in ("text", "vision", "image", "video") and kk not in kinds:
            kinds.append(kk)
    if not kinds:
        kinds = ["text"]
    out: dict[str, Any] = {
        "id": pid,
        "name": name,
        "baseUrl": base_url,
        "website": str(raw.get("website") or "").strip(),
        "kinds": kinds,
        "rowId": platform_byok_row_id(pid),
    }
    icon = str(raw.get("iconKey") or "").strip()
    if icon:
        out["iconKey"] = icon
    hint = str(raw.get("hint") or "").strip()
    if hint:
        out["hint"] = hint
    return out


def _load_admin_platforms() -> list[dict[str, Any]] | None:
    try:
        from app.services.design.readpath.catalog import get_global_rules

        rules = get_global_rules() or {}
        raw = rules.get(BYOK_PLATFORM_RULE_KEY)
    except Exception:
        return None
    if not raw or not str(raw).strip():
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        logger.warning("byok platform rule is not valid JSON — using defaults")
        return None
    if not isinstance(parsed, list):
        return None
    platforms = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        p = _sanitize_platform(item)
        if p:
            platforms.append(p)
    return platforms or None


def list_byok_platforms() -> list[dict[str, Any]]:
    """Curated aggregator platforms (one key → catalog models for that provider)."""
    override = _load_admin_platforms()
    if override is not None:
        return override
    return [p for p in (_sanitize_platform(x) for x in _DEFAULT_BYOK_PLATFORMS) if p]

