"""Security primitives: AES-GCM secrets, log redaction, rate limits, BYOK store.

Shared domain module (auth / me / middleware / skills) — not a one-off helper dump.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import logging
import re
import secrets
import threading
import time
from typing import Any
from urllib.parse import urlparse

from app.core.config import settings
from app.services.db import init_schema

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# AES-256-GCM
# ---------------------------------------------------------------------------


def _aes_key_bytes() -> bytes:
    raw = (getattr(settings, "byok_aes_key", None) or "").strip()
    if not raw:
        raw = (getattr(settings, "card_key_salt", None) or "").strip()
    if not raw:
        _log.warning(
            "BYOK_AES_KEY unset — using insecure dev fallback; set BYOK_AES_KEY before deploy"
        )
        raw = "dev-insecure-byok-aes-key"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    """Encrypt UTF-8 secret → urlsafe base64(nonce || ciphertext||tag)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    text = str(plaintext or "")
    if not text:
        return ""
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_aes_key_bytes()).encrypt(nonce, text.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode("ascii")


def decrypt_secret(blob: str) -> str:
    """Decrypt blob from ``encrypt_secret``. Empty / corrupt → ''."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    raw = str(blob or "").strip()
    if not raw:
        return ""
    try:
        data = base64.urlsafe_b64decode(raw.encode("ascii"))
        if len(data) < 13:
            return ""
        nonce, ct = data[:12], data[12:]
        pt = AESGCM(_aes_key_bytes()).decrypt(nonce, ct, None)
        return pt.decode("utf-8")
    except Exception:
        _log.debug("decrypt_secret failed", exc_info=True)
        return ""


def api_key_hint(plaintext: str) -> str:
    s = str(plaintext or "").strip()
    if len(s) <= 4:
        return "****" if s else ""
    return f"…{s[-4:]}"


# ---------------------------------------------------------------------------
# Log redaction — never print API keys / bearer tokens
# ---------------------------------------------------------------------------

_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)bearer\s+[a-z0-9\-._~+/]+=*"),
    re.compile(r"\bsk-[a-zA-Z0-9]{8,}\b"),
    re.compile(r"\bsk-or-v1-[a-zA-Z0-9]{8,}\b"),
    re.compile(r"\bsk-ant-[a-zA-Z0-9]{8,}\b"),
    re.compile(
        r"(?i)(api[_-]?key|authorization|access[_-]?token|secret|password)\s*[=:]\s*['\"]?[^\s'\"&,;]+"
    ),
)


def redact_secrets(text: str) -> str:
    out = str(text or "")
    if not out:
        return out
    for pat in _SECRET_PATTERNS:
        out = pat.sub("***REDACTED***", out)
    return out


class RedactingFilter(logging.Filter):
    """Attach to root / uvicorn loggers so secrets never hit stdout."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact_secrets(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {
                        k: redact_secrets(v) if isinstance(v, str) else v
                        for k, v in record.args.items()
                    }
                elif isinstance(record.args, tuple):
                    record.args = tuple(
                        redact_secrets(a) if isinstance(a, str) else a for a in record.args
                    )
        except Exception:
            pass
        return True


def install_log_redaction() -> None:
    filt = RedactingFilter()
    root = logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for f in root.filters):
        root.addFilter(filt)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
        log = logging.getLogger(name)
        if not any(isinstance(f, RedactingFilter) for f in log.filters):
            log.addFilter(filt)


# ---------------------------------------------------------------------------
# Rate limit (Redis if available, else process-local)
# ---------------------------------------------------------------------------

_RL_LOCK = threading.Lock()
_RL_BUCKETS: dict[str, list[float]] = {}


def _rl_bucket_path(path: str) -> str:
    """Normalize paths so chunked part uploads share one high-capacity bucket."""
    p = str(path or "").split("?")[0]
    if "/uploads/jobs/" in p and "/parts/" in p:
        return "/api/v1/uploads/jobs/parts"
    return p[:80]


def _rl_limit_for_path(path: str) -> int:
    p = str(path or "")
    win = int(getattr(settings, "rate_limit_window_sec", 60) or 60)
    del win  # window used by caller
    if p.startswith("/api/v1/auth"):
        return int(getattr(settings, "rate_limit_auth_per_window", 30) or 0)
    if p.startswith("/api/v1/design"):
        return int(getattr(settings, "rate_limit_design_per_window", 20) or 0)
    if p.startswith("/api/v1/chat"):
        return int(getattr(settings, "rate_limit_chat_per_window", 40) or 0)
    if "/uploads/jobs/" in p and "/parts/" in p:
        return int(getattr(settings, "rate_limit_upload_parts_per_window", 600) or 0)
    if p.startswith("/api/v1/uploads") or p.startswith("/api/v1/import"):
        return int(getattr(settings, "rate_limit_upload_per_window", 40) or 0)
    if p.startswith("/api/v1/projects"):
        return int(getattr(settings, "rate_limit_projects_per_window", 240) or 0)
    if p.startswith("/api/v1/me/byok"):
        return int(getattr(settings, "rate_limit_auth_per_window", 30) or 0)
    return int(getattr(settings, "rate_limit_default_per_window", 120) or 0)


def _client_ip(headers: dict[str, str], client_host: str | None) -> str:
    xff = (headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or "").strip()
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (client_host or "unknown")[:64]


def _rl_redis_incr(key: str, window: int) -> int | None:
    try:
        import redis

        url = (settings.redis_url or "").strip()
        if not url:
            return None
        r = redis.Redis.from_url(url, socket_connect_timeout=0.4, socket_timeout=0.4)
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, max(1, window))
        n, _ = pipe.execute()
        return int(n or 0)
    except Exception:
        return None


def _rl_memory_incr(key: str, window: int) -> int:
    now = time.monotonic()
    cutoff = now - max(1, window)
    with _RL_LOCK:
        bucket = _RL_BUCKETS.get(key) or []
        bucket = [t for t in bucket if t >= cutoff]
        bucket.append(now)
        _RL_BUCKETS[key] = bucket
        # Cap map size
        if len(_RL_BUCKETS) > 20_000:
            stale = [k for k, v in _RL_BUCKETS.items() if not v or v[-1] < cutoff]
            for k in stale[:5000]:
                _RL_BUCKETS.pop(k, None)
        return len(bucket)


def check_rate_limit(*, path: str, identity: str) -> tuple[bool, int]:
    """Return (allowed, limit). limit 0 means disabled for this path."""
    if not bool(getattr(settings, "rate_limit_enabled", True)):
        return True, 0
    limit = _rl_limit_for_path(path)
    if limit <= 0:
        return True, 0
    window = max(1, int(getattr(settings, "rate_limit_window_sec", 60) or 60))
    bucket = _rl_bucket_path(path)
    key = f"rl:{bucket}:{identity[:80]}"
    n = _rl_redis_incr(key, window)
    if n is None:
        n = _rl_memory_incr(key, window)
    return n <= limit, limit


# ---------------------------------------------------------------------------
# SSRF / URL injection guards (BYOK baseUrl, skill logos)
# ---------------------------------------------------------------------------

_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata.google",
    }
)


def is_public_http_url(url: str) -> bool:
    """True if url is http(s) and host is not obviously private / metadata."""
    raw = str(url or "").strip()
    try:
        parsed = urlparse(raw)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").strip().lower()
    if not host or host in _BLOCKED_HOSTS or host.endswith(".local"):
        return False
    try:
        ip = ipaddress.ip_address(host)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            return False
    except ValueError:
        pass
    return True


# ---------------------------------------------------------------------------
# BYOK store (AES ciphertext at rest)
# ---------------------------------------------------------------------------

_BYOK_READY = False


def ensure_byok_table() -> None:
    global _BYOK_READY
    if _BYOK_READY:
        return
    init_schema()
    _BYOK_READY = True


def _byok_field(row: Any, key: str, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, key):
        return getattr(row, key)
    try:
        return row[key]
    except Exception:
        return default


def _byok_pub(row: Any, *, include_key: bool = False) -> dict[str, Any]:
    item = {
        "id": str(_byok_field(row, "id") or ""),
        "name": str(_byok_field(row, "name") or ""),
        "website": str(_byok_field(row, "website") or ""),
        "baseUrl": str(_byok_field(row, "base_url") or ""),
        "apiModel": str(_byok_field(row, "api_model") or ""),
        "modelKind": str(_byok_field(row, "model_kind") or "text"),
        "apiKeyHint": str(_byok_field(row, "api_key_hint") or ""),
        "hasApiKey": bool(str(_byok_field(row, "api_key_cipher") or "").strip()),
        "createdAt": float(_byok_field(row, "created_at") or 0),
        "updatedAt": float(_byok_field(row, "updated_at") or 0),
    }
    if include_key:
        # Only for trusted server-side LLM proxy paths — never for list APIs.
        item["apiKey"] = decrypt_secret(str(_byok_field(row, "api_key_cipher") or ""))
    return item


def list_byok_providers(user_id: str) -> list[dict[str, Any]]:
    ensure_byok_table()
    uid = str(user_id or "").strip()
    if not uid:
        return []
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        rows = crud.list_byok_providers_for_user(session=session, user_id=uid)
    return [_byok_pub(r) for r in rows]


def upsert_byok_provider(
    user_id: str,
    *,
    provider_id: str | None,
    name: str,
    website: str,
    base_url: str,
    model_kind: str,
    api_key: str | None,
    api_model: str = "",
) -> dict[str, Any]:
    ensure_byok_table()
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user required")
    n = str(name or "").strip()[:128]
    url = str(base_url or "").strip().rstrip("/")
    am = str(api_model or "").strip()[:128]
    kind = str(model_kind or "text").strip().lower()
    if kind not in ("text", "vision", "image", "video", "audio", "platform"):
        kind = "text"
    if not n:
        raise ValueError("name required")
    # Platform credentials unlock many catalog models — apiModel is a sentinel.
    if kind == "platform":
        am = am or "*"
    if not am:
        raise ValueError("apiModel required")
    if not is_public_http_url(url):
        raise ValueError("baseUrl must be a public http(s) URL")
    pid = str(provider_id or "").strip() or f"prov_{secrets.token_hex(8)}"
    now = time.time()

    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import UserByokProvider
    from app.services.llm.byok_presets import platform_byok_row_id

    parent_platform = parse_platform_model_row_id(pid)

    with Session(engine) as session:
        existing = crud.get_byok_provider(
            session=session, user_id=uid, provider_id=pid
        )
        key_plain = str(api_key or "").strip() if api_key is not None else None
        if existing is None:
            cipher = ""
            hint = ""
            if key_plain:
                cipher = encrypt_secret(key_plain)
                hint = api_key_hint(key_plain)
            elif parent_platform:
                # Inherit the aggregator key — user only adds a model id.
                parent = crud.get_byok_provider(
                    session=session,
                    user_id=uid,
                    provider_id=platform_byok_row_id(parent_platform),
                )
                if not parent or not str(parent.api_key_cipher or "").strip():
                    raise ValueError("save the platform API key first")
                cipher = str(parent.api_key_cipher)
                hint = str(parent.api_key_hint or "")
            else:
                raise ValueError("apiKey required")
            row = UserByokProvider(
                id=pid,
                user_id=uid,
                name=n,
                website=str(website or "").strip()[:512],
                base_url=url,
                api_model=am,
                model_kind=kind,
                api_key_cipher=cipher,
                api_key_hint=hint,
                created_at=now,
                updated_at=now,
            )
        else:
            cipher = str(existing.api_key_cipher or "")
            hint = str(existing.api_key_hint or "")
            if key_plain:
                cipher = encrypt_secret(key_plain)
                hint = api_key_hint(key_plain)
            existing.name = n
            existing.website = str(website or "").strip()[:512]
            existing.base_url = url
            existing.api_model = am
            existing.model_kind = kind
            existing.api_key_cipher = cipher
            existing.api_key_hint = hint
            existing.updated_at = now
            row = existing
        row = crud.upsert_byok_provider_row(session=session, row=row)
    return _byok_pub(row)

def delete_byok_provider(user_id: str, provider_id: str) -> bool:
    ensure_byok_table()
    uid = str(user_id or "").strip()
    pid = str(provider_id or "").strip()
    if not uid or not pid:
        return False
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        return crud.delete_byok_provider_row(
            session=session, user_id=uid, provider_id=pid
        )


def parse_byok_model_ref(model_string: str | None) -> str | None:
    """Return provider id from ``custom:<id>`` / ``byok:<id>``, else None."""
    raw = str(model_string or "").strip()
    low = raw.lower()
    for prefix in ("custom:", "byok:"):
        if low.startswith(prefix):
            pid = raw[len(prefix) :].strip()
            return pid or None
    return None


def parse_platform_model_row_id(provider_id: str | None) -> str | None:
    """Return catalog provider from ``pm:<provider>:<suffix>`` model rows."""
    raw = str(provider_id or "").strip()
    if not raw.lower().startswith("pm:"):
        return None
    rest = raw[3:]
    idx = rest.find(":")
    if idx <= 0:
        return None
    provider = rest[:idx].strip().lower()
    suffix = rest[idx + 1 :].strip()
    return provider if provider and suffix else None


def get_byok_provider_row(user_id: str, provider_id: str) -> dict[str, Any] | None:
    """Return public fields + decrypted apiKey for server-side LLM proxy only.

    Platform-linked model rows (``pm:<provider>:…``) always resolve the API key
    from the parent ``platform:<provider>`` credential so key updates apply.
    """
    ensure_byok_table()
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.llm.byok_presets import platform_byok_row_id

    uid = str(user_id or "").strip()
    pid = str(provider_id or "").strip()
    with Session(engine) as session:
        row = crud.get_byok_provider(session=session, user_id=uid, provider_id=pid)
    if not row:
        return None
    pub = _byok_pub(row, include_key=True)
    parent_provider = parse_platform_model_row_id(pid)
    if parent_provider:
        parent_key = get_platform_byok_api_key(uid, parent_provider)
        if parent_key:
            pub["apiKey"] = parent_key
            # Keep base URL aligned with the platform credential when present.
            parent_row_id = platform_byok_row_id(parent_provider)
            with Session(engine) as session:
                parent = crud.get_byok_provider(
                    session=session, user_id=uid, provider_id=parent_row_id
                )
            if parent and str(parent.base_url or "").strip():
                pub["baseUrl"] = str(parent.base_url).rstrip("/")
    return pub


def get_byok_api_key(user_id: str, provider_id: str) -> str | None:
    """Server-side decrypt for LLM proxy. Never expose via list APIs."""
    row = get_byok_provider_row(user_id, provider_id)
    if not row:
        return None
    key = str(row.get("apiKey") or "").strip()
    return key or None


def list_user_platform_byok(user_id: str) -> set[str]:
    """Catalog providers the user has a platform-level API key for."""
    from app.services.llm.byok_presets import parse_platform_byok_id

    out: set[str] = set()
    for row in list_byok_providers(user_id):
        pid = str(row.get("id") or "")
        provider = parse_platform_byok_id(pid)
        if provider:
            out.add(provider)
            continue
        # Also treat modelKind=platform as a platform credential.
        if str(row.get("modelKind") or "").lower() == "platform":
            # Infer from baseUrl when id is not platform:*.
            base = str(row.get("baseUrl") or "").lower()
            if "openrouter" in base:
                out.add("openrouter")
            elif "volces.com" in base or "volcengine" in base:
                out.add("doubao")
    return out


def get_platform_byok_api_key(user_id: str, provider: str) -> str | None:
    """Decrypt the user's platform key for ``openrouter`` / ``doubao`` / …"""
    from app.services.llm.byok_presets import platform_byok_row_id

    prov = str(provider or "").strip().lower()
    if not prov or not user_id:
        return None
    row_id = platform_byok_row_id(prov)
    # Read parent cipher directly — avoid recurse through get_byok_provider_row.
    ensure_byok_table()
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        row = crud.get_byok_provider(
            session=session, user_id=str(user_id).strip(), provider_id=row_id
        )
    if row:
        key = decrypt_secret(str(row.api_key_cipher or ""))
        if key:
            return key
    # Fallback: any platform-kind row whose baseUrl matches this provider.
    for item in list_byok_providers(user_id):
        if str(item.get("modelKind") or "").lower() != "platform":
            continue
        base = str(item.get("baseUrl") or "").lower()
        match = (prov == "openrouter" and "openrouter" in base) or (
            prov == "doubao" and ("volces.com" in base or "volcengine" in base)
        )
        if match:
            with Session(engine) as session:
                prow = crud.get_byok_provider(
                    session=session,
                    user_id=str(user_id).strip(),
                    provider_id=str(item.get("id") or ""),
                )
            if prow:
                key = decrypt_secret(str(prow.api_key_cipher or ""))
                if key:
                    return key
    return None
