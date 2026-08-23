# -*- coding: utf-8 -*-
"""Security: AES BYOK, redaction, rate limit, skill ACL."""
from __future__ import annotations

from app.services.security import (
    api_key_hint,
    check_rate_limit,
    decrypt_secret,
    encrypt_secret,
    is_public_http_url,
    redact_secrets,
)


def test_aes_roundtrip(monkeypatch):
    monkeypatch.setenv("BYOK_AES_KEY", "unit-test-byok-aes-key-please-change")
    from app.core.config import settings

    monkeypatch.setattr(settings, "byok_aes_key", "unit-test-byok-aes-key-please-change")
    plain = "sk-test-secret-key-123456"
    blob = encrypt_secret(plain)
    assert blob
    assert plain not in blob
    assert decrypt_secret(blob) == plain
    assert api_key_hint(plain).endswith("3456") or "…" in api_key_hint(plain)


def test_redact_secrets():
    msg = "calling provider api_key=sk-abcdefghijklmnop Authorization: Bearer tokensecret"
    out = redact_secrets(msg)
    assert "sk-abcdefghijklmnop" not in out
    assert "tokensecret" not in out
    assert "REDACTED" in out or "***" in out


def test_public_http_url():
    assert is_public_http_url("https://api.openai.com/v1")
    assert not is_public_http_url("http://127.0.0.1/secret")
    assert not is_public_http_url("http://localhost:8000")
    assert not is_public_http_url("ftp://example.com")


def test_byok_endpoint_resolve(monkeypatch, tmp_path):
    from app.core.config import settings
    from app.services import security as sec
    from app.services.llm import (
        get_llm_endpoint,
        reset_byok_user_id,
        set_byok_user_id,
    )

    monkeypatch.setattr(settings, "byok_aes_key", "unit-test-byok-endpoint-key-xx")
    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "sqlite_db_path", str(tmp_path / "byok.db"))
    sec._BYOK_READY = False

    item = sec.upsert_byok_provider(
        "user_u1",
        provider_id="prov_x",
        name="DMX",
        website="",
        base_url="https://api.example.com/v1",
        model_kind="text",
        api_key="sk-secret-byok-key",
        api_model="gpt-4o-mini",
    )
    assert "apiKey" not in item or not item.get("apiKey")
    assert item["apiModel"] == "gpt-4o-mini"

    tok = set_byok_user_id("user_u1")
    try:
        ep = get_llm_endpoint("custom:prov_x")
        assert ep.provider == "byok"
        assert ep.model_id == "gpt-4o-mini"
        assert ep.base_url.endswith("/v1")
        assert ep.api_key == "sk-secret-byok-key"
    finally:
        reset_byok_user_id(tok)

    # Without user context → error
    try:
        get_llm_endpoint("custom:prov_x")
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass


def test_rate_limit_trips(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_window_sec", 60)
    monkeypatch.setattr(settings, "rate_limit_design_per_window", 3)
    monkeypatch.setattr(settings, "redis_url", "")
    identity = "unit-rl-test-byok-continue"
    path = "/api/v1/design/run"
    assert check_rate_limit(path=path, identity=identity)[0]
    assert check_rate_limit(path=path, identity=identity)[0]
    assert check_rate_limit(path=path, identity=identity)[0]
    ok, limit = check_rate_limit(path=path, identity=identity)
    assert not ok
    assert limit == 3
