"""Region gate for OpenRouter (CN networks)."""

from __future__ import annotations


def test_openrouter_blocked_for_cn(monkeypatch):
    from app.services import geoip

    monkeypatch.setattr(geoip, "openrouter_block_countries", lambda: {"CN"})
    assert geoip.openrouter_allowed_for_country("CN") is False
    assert geoip.openrouter_allowed_for_country("US") is True
    assert geoip.openrouter_allowed_for_country(None) is True


def test_filter_catalog_drops_openrouter_in_cn(monkeypatch):
    from app.services import geoip

    monkeypatch.setattr(geoip, "openrouter_block_countries", lambda: {"CN"})
    models = [
        {"id": "doubao-seed-2-1-turbo", "provider": "doubao"},
        {"id": "or-gpt-5-6-luna", "provider": "openrouter"},
        {"id": "or-gpt-image-2", "provider": "openrouter"},
    ]
    kept = geoip.filter_catalog_models_for_region(models, country="CN")
    assert [m["id"] for m in kept] == ["doubao-seed-2-1-turbo"]


def test_sanitize_rules_replaces_openrouter_lanes(monkeypatch):
    from app.services.design.runtime.models_route import sanitize_rules_for_openrouter_region

    monkeypatch.setenv("CLIENT_COUNTRY_OVERRIDE", "")
    platform = {
        "precheck.model_threshold": (
            "fast->doubao-seed-2-1-turbo;standard->deepseek-v4-flash;"
            "reasoning->deepseek-v4-pro;vision->doubao-seed-2-1-turbo;"
            "image->doubao-seedream-5-0-lite"
        ),
        "precheck.vision_model": "doubao-seed-2-1-turbo",
        "assets.image_default_model": "doubao-seedream-5-0-lite",
    }
    merged = {
        **platform,
        "precheck.model_threshold": (
            "fast->doubao-seed-2-1-turbo;standard->or-gpt-5-6-luna;"
            "reasoning->or-gemini-3-flash-preview;vision->or-gemini-3-flash-preview;"
            "image->or-gpt-image-2"
        ),
        "precheck.vision_model": "or-gemini-3-flash-preview",
        "assets.image_default_model": "or-gpt-image-2",
    }
    out = sanitize_rules_for_openrouter_region(
        merged, platform_rules=platform, country="CN"
    )
    assert "or-" not in out["precheck.model_threshold"]
    assert out["precheck.vision_model"] == "doubao-seed-2-1-turbo"
    assert out["assets.image_default_model"] == "doubao-seedream-5-0-lite"


def test_sanitize_rules_keeps_openrouter_outside_cn():
    from app.services.design.runtime.models_route import sanitize_rules_for_openrouter_region

    platform = {
        "precheck.model_threshold": "fast->doubao-seed-2-1-turbo;standard->deepseek-v4-flash",
    }
    merged = {
        "precheck.model_threshold": "fast->doubao-seed-2-1-turbo;standard->or-gpt-5-6-luna",
        "precheck.vision_model": "or-gemini-3-flash-preview",
    }
    out = sanitize_rules_for_openrouter_region(
        merged, platform_rules=platform, country="US"
    )
    assert "or-gpt-5-6-luna" in out["precheck.model_threshold"]
    assert out["precheck.vision_model"] == "or-gemini-3-flash-preview"
