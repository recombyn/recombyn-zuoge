"""Unit tests for design skill_store — pluggable source + triggers + files."""

from __future__ import annotations

from app.services.design.prompts.skill_store import (
    NS_CORE,
    NS_EXT,
    NS_USER,
    SOURCE_ADMIN,
    _apply_mutex,
    _load_file_skills,
    _rule_matches,
    ensure_design_skills,
    filter_need_resources_by_skill_acl,
    filter_ops_by_skill_allowlist,
    format_skills_catalog,
    format_skills_details,
    normalize_need_skills,
    parse_need_skills_with_pins,
    parse_skill_pin,
    qualify_skill_key,
    reload_skills_if_disk_changed,
    reset_skills_ready_for_tests,
    resolve_storage_skill_key,
    resolve_triggered_skill_keys,
    skill_resource_allowlist,
    split_namespace_key,
    validate_against_schema,
    validate_skill_meta,
)
from app import crud


def setup_function() -> None:
    reset_skills_ready_for_tests()
    ensure_design_skills(force=True)





def test_skills_catalog_and_details_roundtrip():
    catalog = format_skills_catalog(scene="website")
    assert "need_skills" in catalog
    assert "poster_craft" in catalog
    assert "image_gen" in catalog
    details = format_skills_details(
        keys=["poster_craft", "image_gen"],
        scene="website",
    )
    assert "skill: poster_craft" in details
    assert "preferred_tools" in details


def test_rule_matches_min_prompt_chars():
    assert _rule_matches(
        {"intent_in": ["create"], "min_prompt_chars": 24},
        empty_canvas=False,
        has_images=False,
        intent="create",
        prompt_chars=30,
    )
    assert not _rule_matches(
        {"intent_in": ["create"], "min_prompt_chars": 24},
        empty_canvas=False,
        has_images=False,
        intent="create",
        prompt_chars=10,
    )


def test_rule_matches_prompt_includes_any():
    rule = {
        "intent_in": ["create"],
        "prompt_includes_any": ["海报", "poster"],
    }
    assert _rule_matches(
        rule,
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="帮我做一张海报",
    )
    assert not _rule_matches(
        rule,
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="画一个登录页",
    )


def test_resolve_triggered_poster_keyword():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="做一张活动海报",
    )
    assert "poster_craft" in keys
    keys2 = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="随便画点什么",
    )
    assert "poster_craft" not in keys2


def test_resolve_triggered_empty_canvas_create():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=True,
        has_images=False,
        intent="create",
    )
    assert "image_gen" in keys


def test_resolve_triggered_long_create_prompt():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=False,
        has_images=False,
        intent="create",
        prompt_chars=40,
    )
    assert "image_gen" in keys


def test_resolve_triggered_images_create():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=False,
        has_images=True,
        intent="create",
    )
    # Look-at-image is Decide (attachments + design_brief), not a skill trigger.
    assert "vision_extract" not in keys


def test_resolve_triggered_skips_chat():
    assert (
        resolve_triggered_skill_keys(
            scene="website",
            empty_canvas=True,
            has_images=False,
            intent="chat",
        )
        == []
    )


def test_edit_line_spacing_does_not_auto_trigger_typography():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=False,
        has_images=False,
        intent="edit",
        prompt="把标题行距改成 8px",
        stage="paint",
    )
    assert "typography" not in keys


def test_festival_poster_prompt_triggers_poster_craft():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="做一张音乐节海报",
        stage="plan",
    )
    assert "poster_craft" in keys
    review_keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=True,
        has_images=False,
        intent="create",
        prompt="做一张音乐节海报",
        stage="review",
    )
    assert "poster_craft" not in review_keys


def test_canvas_op_does_not_auto_trigger_surface_skills():
    keys = resolve_triggered_skill_keys(
        scene="website",
        empty_canvas=False,
        has_images=False,
        intent="create",
        prompt="做一张音乐节海报",
        classified_intent="canvas_op",
        stage="paint",
    )
    assert keys == []


def test_scope_filters_skill_details_by_stage():
    paint = format_skills_details(
        keys=["polish", "poster_craft"], scene="website", stage="paint"
    )
    assert "skill: poster_craft" in paint
    assert "skill: polish" not in paint
    review = format_skills_details(
        keys=["polish", "poster_craft"], scene="website", stage="review", role="review"
    )
    assert "skill: polish" in review
    assert "skill: poster_craft" not in review


def test_typography_requires_design_brief_context():
    without_brief = format_skills_details(
        keys=["typography"],
        scene="website",
        stage="paint",
        has_design_brief=False,
    )
    assert "skill: typography" not in without_brief
    with_brief = format_skills_details(
        keys=["typography"],
        scene="website",
        stage="paint",
        has_design_brief=True,
    )
    assert "skill: typography" in with_brief


def test_mutex_keeps_highest_weight():
    rows = [
        {"skillKey": "a", "mutexGroup": "g", "sortWeight": 10},
        {"skillKey": "b", "mutexGroup": "g", "sortWeight": 5},
        {"skillKey": "c", "mutexGroup": None, "sortWeight": 1},
    ]
    out = _apply_mutex(rows)
    assert [r["skillKey"] for r in out] == ["a", "c"]


def test_filter_ops_allowlist():
    ops = [
        {"name": "create_shape", "args": {}},
        {"name": "explode_canvas", "args": {}},
        {"name": "align_nodes", "args": {}},
    ]
    kept, errs = filter_ops_by_skill_allowlist(
        ops, skill_keys=["poster_craft"], scene="website"
    )
    names = [o["name"] for o in kept]
    assert "create_shape" in names
    assert "align_nodes" in names
    assert "explode_canvas" not in names
    assert any("explode_canvas" in e for e in errs)


def test_filter_ops_ui_plus_image_gen_keeps_ui_tools():
    """mobile_app_ui (no allowed_ops) + image_gen must not strip create_text/shape."""
    from app.services.design.prompts.skill_store import filter_ops_by_skill_output_schema

    ops = [
        {"name": "create_text", "args": {}},
        {"name": "create_shape", "args": {}},
        {"name": "create_image", "args": {}},
        {"name": "explode_canvas", "args": {}},
    ]
    # Schema gate alone: undeclared UI skill → do not tighten.
    kept_schema, errs_schema = filter_ops_by_skill_output_schema(
        ops, skill_keys=["mobile_app_ui", "image_gen"], scene="website"
    )
    assert errs_schema == []
    assert {o["name"] for o in kept_schema} == {
        "create_text",
        "create_shape",
        "create_image",
        "explode_canvas",
    }
    # Full allowlist path: preferred_tools union still blocks explode; UI ops stay.
    kept, errs = filter_ops_by_skill_allowlist(
        ops, skill_keys=["mobile_app_ui", "image_gen"], scene="website"
    )
    names = {o["name"] for o in kept}
    assert "create_text" in names
    assert "create_shape" in names
    assert "create_image" in names
    assert "explode_canvas" not in names
    assert any("explode_canvas" in e for e in errs)


def test_filter_ops_image_gen_alone_still_narrow():
    """Solo image_gen may keep its narrow output_schema allowlist."""
    from app.services.design.prompts.skill_store import filter_ops_by_skill_output_schema

    ops = [
        {"name": "create_text", "args": {}},
        {"name": "create_image", "args": {}},
        {"name": "create_frame", "args": {}},
    ]
    kept, errs = filter_ops_by_skill_output_schema(
        ops, skill_keys=["image_gen"], scene="website"
    )
    names = {o["name"] for o in kept}
    assert "create_image" in names
    assert "create_frame" in names
    assert "create_text" not in names
    assert any("create_text" in e for e in errs)


def test_filter_ops_two_schemas_union():
    """When every skill declares allowed_ops, enforce the union."""
    from app.services.design.prompts.skill_store import filter_ops_by_skill_output_schema

    ops = [
        {"name": "create_text", "args": {}},
        {"name": "create_image", "args": {}},
        {"name": "create_icon", "args": {}},
        {"name": "explode_canvas", "args": {}},
    ]
    kept, errs = filter_ops_by_skill_output_schema(
        ops, skill_keys=["dashboard_ui", "image_gen"], scene="website"
    )
    names = {o["name"] for o in kept}
    assert "create_text" in names  # from dashboard_ui
    assert "create_image" in names  # both
    assert "create_icon" in names  # from dashboard_ui
    assert "explode_canvas" not in names
    assert any("explode_canvas" in e for e in errs)


def test_file_skill_loader_returns_list():
    """Loader scans public + private ``design_skills`` packs."""
    files = _load_file_skills()
    assert isinstance(files, list)


def test_parse_pack_version_semver():
    from app.services.design.prompts.skill_store import _parse_pack_version

    label, n = _parse_pack_version("1.0.0")
    assert label == "1.0.0"
    assert n == 1_000_000


def test_source_constants():
    assert SOURCE_ADMIN == "admin"


def test_namespace_split_and_qualify(monkeypatch):
    assert split_namespace_key("core.sample_key") == (NS_CORE, "sample_key")
    assert split_namespace_key("user:my_brand") == (NS_USER, "my_brand")
    assert qualify_skill_key(NS_CORE, "sample_key") == "sample_key"
    assert qualify_skill_key(NS_USER, "my_brand") == "user.my_brand"
    assert resolve_storage_skill_key("poster_craft") == "poster_craft"
    # Patch the runtime module binding (resolve_storage_skill_key calls it in-file).
    from app.services.design.prompts.skill_store import runtime as skill_runtime

    monkeypatch.setattr(
        skill_runtime,
        "list_runtime_skills",
        lambda **_kwargs: [
            {
                "skillKey": "example_brand",
                "namespace": NS_EXT,
                "_localKey": "example_brand",
            }
        ],
    )
    assert resolve_storage_skill_key("ext.example_brand") == "example_brand"
    assert resolve_storage_skill_key("ext.missing_pack") is None


def test_skill_pin_and_parse_need_skills():
    assert parse_skill_pin("poster_craft@2") == ("poster_craft", 2, None)
    keys, pins, args, errs = parse_need_skills_with_pins(
        [
            "poster_craft@2",
            {"key": "brush_ops", "version": 1, "args": {}},
        ]
    )
    assert "poster_craft" in keys
    assert "brush_ops" in keys
    assert pins.get("poster_craft") == 2
    assert errs == []


def test_validate_skill_meta_admin_ok_when_seed_empty():
    """Bare keys are not core-reserved (no JSON skill seed)."""
    errs = validate_skill_meta(
        {
            "skill_key": "poster_craft",
            "name": "x",
            "prompt_positive": "body",
        },
        source=SOURCE_ADMIN,
    )
    assert not any("core_key_reserved" in e for e in errs)


def test_validate_against_schema_required():
    schema = {
        "type": "object",
        "required": ["theme"],
        "properties": {"theme": {"type": "string"}},
    }
    assert validate_against_schema(schema, {}) == ["missing_required:theme"]
    assert validate_against_schema(schema, {"theme": "dark"}) == []


def test_custom_skill_acl_platform_open():
    assert skill_resource_allowlist(["poster_craft"], scene="website") is None
    assert filter_need_resources_by_skill_acl(
        skill_keys=["poster_craft"],
        scene="website",
    ) == []


def test_hot_reload_signature_stable():
    reload_skills_if_disk_changed()
    assert reload_skills_if_disk_changed() is False


def test_file_pack_sync_overwrites_body_from_disk():
    """SOURCE_FILE skills follow disk packs on ensure (file wins)."""
    from sqlmodel import Session

    from app.core import db as core_db
    from app.services.design.prompts.skill_store.constants import SOURCE_FILE

    with Session(core_db.engine) as session:
        row = crud.get_design_skill_by_key(session=session, skill_key="poster_craft")
        assert row is not None
        assert str(row.source or "") == SOURCE_FILE
        before = str(row.prompt_positive or "")
        assert "Poster" in before or "poster" in before.lower()
        row.prompt_positive = "OPS_CUSTOM_BODY_SHOULD_BE_OVERWRITTEN"
        session.add(row)
        session.commit()

    reset_skills_ready_for_tests()
    ensure_design_skills(force=True)

    with Session(core_db.engine) as session:
        row = crud.get_design_skill_by_key(session=session, skill_key="poster_craft")
        assert row is not None
        assert str(row.source or "") == SOURCE_FILE
        got = str(row.prompt_positive or "")
        assert got != "OPS_CUSTOM_BODY_SHOULD_BE_OVERWRITTEN"
        assert "Workflow" in got or "Layer order" in got or "poster" in got.lower()



def test_load_pack_dir_requires_meta_json(tmp_path):
    from app.services.design.prompts.skill_store import _load_pack_dir

    pack = tmp_path / "demo-skill"
    pack.mkdir()
    (pack / "SKILL.md").write_text("# Body\nKeep this prompt.\n", encoding="utf-8")
    assert _load_pack_dir(pack) is None

    (pack / "_meta.json").write_text(
        '{"skill_key":"demo-skill","when_to_use":"demo","preferred_tools":["create_frame"]}',
        encoding="utf-8",
    )
    item = _load_pack_dir(pack)
    assert item is not None
    assert item["skill_key"] == "demo-skill"
    assert item["prompt_positive"].startswith("# Body")


def test_oss_ext_packs_present():
    keys = {str(x.get("skill_key") or "") for x in _load_file_skills()}
    for key in (
        "garden_style",
        "awesome_design_md",
        "shadcn_ui",
        "banner_ad",
        "icon_set",
        "type_specimen",
        "long_scroll",
        "festival_poster",
    ):
        assert key in keys
    assert "ui_ux_pro_max" not in keys
    assert "vision_extract" not in keys
    assert "canvas_edit" not in keys
    assert "frontend_ui" not in keys
    assert "example_ext" not in keys


def test_normalize_pack_meta_keeps_skill_key():
    from app.services.design.prompts.skill_store.pack_io import _normalize_pack_meta

    meta = _normalize_pack_meta(
        {
            "skill_key": "my_plugin",
            "triggers": [
                {
                    "intent_in": ["create", "edit"],
                    "prompt_includes_any": ["中秋海报", "holiday poster"],
                }
            ],
            "author": "ops",
            "allowed_resources": ["tools"],
            "enabled": True,
        },
        folder="my_plugin",
    )
    assert meta is not None
    assert meta["skill_key"] == "my_plugin"
    assert meta["triggers"][0]["prompt_includes_any"] == ["中秋海报", "holiday poster"]
    assert meta["allowed_resources"] == ["tools"]
    assert meta["_author"] == "ops"


def test_normalize_pack_meta_disabled():
    from app.services.design.prompts.skill_store.pack_io import _normalize_pack_meta

    assert (
        _normalize_pack_meta(
            {"id": "x", "enabled": False, "triggers": []},
            folder="x",
        )
        is None
    )


def test_plugin_style_pack_loads(tmp_path, monkeypatch):
    from app.services.design.prompts.skill_store import pack_io

    root = tmp_path / "plugins_skills"
    pack = root / "kw_poster"
    pack.mkdir(parents=True)
    (pack / "_meta.json").write_text(
        '{"skill_key":"kw_poster","name":"kw_poster",'
        '"triggers":[{"intent_in":["create","edit"],"prompt_includes_any":["春节海报"]}],'
        '"preferred_tools":["create_frame","create_text"],"version":"1.0.0"}',
        encoding="utf-8",
    )
    (pack / "SKILL.md").write_text("# KW poster\n\nCreate a festive board.\n", encoding="utf-8")

    monkeypatch.setattr(pack_io, "_file_skills_dirs", lambda: [root])
    items = pack_io._load_file_skills()
    by_key = {str(x.get("skill_key")): x for x in items}
    assert "kw_poster" in by_key
    triggers = by_key["kw_poster"].get("triggers") or []
    assert triggers and "春节海报" in triggers[0].get("prompt_includes_any", [])


def test_schema_json_merges_into_pack(tmp_path):
    from app.services.design.prompts.skill_store.pack_io import _load_pack_dir

    pack = tmp_path / "schema_pack"
    pack.mkdir()
    (pack / "_meta.json").write_text(
        '{"skill_key":"schema_pack","name":"schema_pack",'
        '"preferred_tools":["create_frame"],"version":"1.0.0"}',
        encoding="utf-8",
    )
    (pack / "SKILL.md").write_text("# Schema pack\n\nBody.\n", encoding="utf-8")
    (pack / "schema.json").write_text(
        '{"input_schema":{"type":"object","properties":{"festival":{"type":"string"}},'
        '"required":["festival"]},'
        '"output_schema":{"type":"object","allowed_ops":["create_frame","create_text"]}}',
        encoding="utf-8",
    )
    item = _load_pack_dir(pack)
    assert item is not None
    assert item["input_schema"]["required"] == ["festival"]
    assert "create_frame" in item["output_schema"]["allowed_ops"]


def test_pack_icon_svg_inlines_as_data_url(tmp_path):
    from app.services.design.prompts.skill_store.pack_io import _load_pack_dir

    pack = tmp_path / "icon_pack"
    (pack / "assets").mkdir(parents=True)
    (pack / "_meta.json").write_text(
        '{"skill_key":"icon_pack","name":"icon_pack",'
        '"preferred_tools":["create_frame"],"version":"1.0.0"}',
        encoding="utf-8",
    )
    (pack / "SKILL.md").write_text("# Icon pack\n\nBody.\n", encoding="utf-8")
    (pack / "assets" / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" fill="#123"/></svg>',
        encoding="utf-8",
    )
    item = _load_pack_dir(pack)
    assert item is not None
    logo = str(item.get("logo") or "")
    assert logo.startswith("data:image/svg+xml,")
    assert "64" in logo


def test_built_in_skills_have_icons():
    items = {str(x.get("skill_key")): x for x in _load_file_skills()}
    for key in (
        "poster_craft",
        "banner_ad",
        "image_gen",
        "garden_style",
        "festival_poster",
    ):
        logo = str((items.get(key) or {}).get("logo") or "")
        assert logo.startswith("data:image/"), f"{key} missing icon logo"


def test_festival_poster_pack_has_schema():
    items = {str(x.get("skill_key")): x for x in _load_file_skills()}
    fp = items.get("festival_poster")
    assert fp is not None
    assert isinstance(fp.get("input_schema"), dict)
    assert "festival" in (fp["input_schema"].get("properties") or {})


def test_resolve_triggered_festival_keyword():
    keys = resolve_triggered_skill_keys(
        prompt="帮我生成一张中秋红色海报",
        intent="create",
        empty_canvas=True,
        has_images=False,
    )
    assert "festival_poster" in keys
