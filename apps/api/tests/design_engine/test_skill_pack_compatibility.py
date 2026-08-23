"""PR0 — Skill pack V3 must remain loadable."""
from __future__ import annotations

from app.services.design.prompts.skill_store.pack_io import _load_file_skills
from app.services.design.prompts.skill_store.runtime import expand_skill_extends


def test_surface_and_v3_packs_load():
    items = _load_file_skills()
    by_key = {str(i.get("skill_key") or ""): i for i in items}
    # Surface skills still present
    for key in ("poster_craft", "landing_page", "dashboard_ui", "image_gen"):
        assert key in by_key, f"missing surface skill {key}"
        assert str(by_key[key].get("prompt_positive") or "").strip()
    # V3 cores present (PR20 catalog)
    for key in (
        "design_brief",
        "visual_direction",
        "design_system",
        "composition",
        "typography",
        "color",
        "imagery",
        "layout",
        "anti_ai_slop",
        "design_review",
        "polish",
        "responsive",
    ):
        assert key in by_key, f"missing core skill {key}"
        assert str(by_key[key].get("prompt_positive") or "").strip(), key


def test_v3_catalog_crafts_load_via_foundation_extends():
    items = _load_file_skills()
    by_key = {str(i.get("skill_key") or ""): i for i in items}
    assert "typography" in list(by_key["design_system"].get("extends") or [])
    assert "color" in list(by_key["design_system"].get("extends") or [])
    assert "layout" in list(by_key["composition"].get("extends") or [])
    assert "imagery" in list(by_key["visual_direction"].get("extends") or [])
    for key in ("typography", "color", "imagery", "layout"):
        assert by_key[key].get("category") == "craft"
    poster = expand_skill_extends(["poster_craft"])
    for key in ("typography", "color", "imagery", "layout"):
        assert key in poster, key
    landing = expand_skill_extends(["landing_page"])
    for key in ("typography", "color", "imagery", "layout", "responsive"):
        assert key in landing, key
    image = expand_skill_extends(["image_gen"])
    assert "imagery" in image
    assert "layout" in image


def test_poster_extends_expands_without_breaking_mutex_surface():
    _load_file_skills()
    keys = expand_skill_extends(["poster_craft"])
    assert "poster_craft" in keys
    assert "design_brief" in keys
    # Only one surface in the expanded set
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["poster_craft"]


def test_landing_page_v3_pack_and_mutex():
    items = _load_file_skills()
    by_key = {str(i.get("skill_key") or ""): i for i in items}
    landing = by_key["landing_page"]
    assert str(landing.get("pack_version") or "") == "3.0.0"
    assert landing.get("category") == "surface"
    assert "responsive" in list(landing.get("extends") or [])
    body = str(landing.get("prompt_positive") or "")
    assert "SaaS" in body and "AI" in body
    assert "3 cards" in body
    assert "Hero" in body
    refs = str(landing.get("_references") or "")
    assert "three_card_layout" in refs or "3 cards" in refs
    assert by_key["responsive"].get("category") == "craft"
    keys = expand_skill_extends(["landing_page"])
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["landing_page"]


def test_dashboard_ui_v3_pack_and_mutex():
    items = _load_file_skills()
    by_key = {str(i.get("skill_key") or ""): i for i in items}
    dash = by_key["dashboard_ui"]
    assert str(dash.get("pack_version") or "") == "3.0.0"
    assert dash.get("category") == "surface"
    assert "responsive" in list(dash.get("extends") or [])
    body = str(dash.get("prompt_positive") or "")
    assert "Primary Task" in body or "PRIMARY TASK" in body
    assert "KPI Card" in body
    refs = str(dash.get("_references") or "")
    assert "KPI" in refs
    keys = expand_skill_extends(["dashboard_ui"])
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["dashboard_ui"]


def test_image_gen_v3_pack_helper_not_surface():
    items = _load_file_skills()
    by_key = {str(i.get("skill_key") or ""): i for i in items}
    img = by_key["image_gen"]
    assert str(img.get("pack_version") or "") == "3.2.0"
    assert img.get("category") == "craft"
    assert img.get("mutex_group") == "image"
    for core in ("design_brief", "visual_direction", "composition", "anti_ai_slop"):
        assert core in list(img.get("extends") or [])
    body = str(img.get("prompt_positive") or "")
    assert "baked" in body.lower() or "Baked" in body
    assert "MATERIAL" in body and "LIGHTING" in body
    refs = str(img.get("_references") or "")
    assert "pretty" in refs.lower() or "baked" in refs.lower()
    keys = expand_skill_extends(["poster_craft", "image_gen"])
    assert "image_gen" in keys
    assert "poster_craft" in keys
    surfaces = [
        k
        for k in keys
        if k
        in {
            "poster_craft",
            "landing_page",
            "dashboard_ui",
            "banner_ad",
            "mobile_app_ui",
            "ecommerce_surface",
            "long_scroll",
            "resume_layout",
        }
    ]
    assert surfaces == ["poster_craft"]
