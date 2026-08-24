"""Image catalog id → Ark endpoint resolution."""

from __future__ import annotations


def test_resolve_catalog_api_model_lite_seed_fallback():
    from app.services.llm.catalog_store import resolve_catalog_api_model

    assert resolve_catalog_api_model("doubao-seedream-5-0-lite") == (
        "doubao-seedream-5-0-260128"
    )


def test_api_model_id_uses_seed_when_list_image_models_empty(monkeypatch):
    from app.services.llm import image as image_mod

    monkeypatch.setattr(image_mod, "list_image_models", lambda **_: [])

    assert image_mod._api_model_id("doubao-seedream-5-0-lite") == (
        "doubao-seedream-5-0-260128"
    )
