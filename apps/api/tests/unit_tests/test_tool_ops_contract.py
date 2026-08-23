"""Unit tests for tool_ops_contract."""

from __future__ import annotations

from app.services.design.ops.tool_ops_contract import (
    TOOL_OPS_SCHEMA_VERSION,
    extract_and_validate_tool_ops,
    normalize_agent_tool_ops,
    validation_failure_reason,
)


def test_schema_version():
    assert TOOL_OPS_SCHEMA_VERSION.startswith("2026-")


def test_valid_update_node():
    raw = '{"tool_ops":[{"name":"update_node","args":{"nodeId":"n1","cornerRadius":8}}]}'
    ops, errs = extract_and_validate_tool_ops(
        raw,
        scene_nodes=[{"id": "n1", "type": "rect", "w": 100, "h": 100}],
    )
    assert not errs
    assert len(ops) == 1
    assert ops[0]["name"] == "update_node"
    assert ops[0]["args"]["nodeId"] == "n1"
    assert ops[0].get("op_id")


def test_rejects_unknown_tool():
    raw = '{"tool_ops":[{"name":"explode_canvas","args":{}}]}'
    ops, errs = extract_and_validate_tool_ops(raw)
    assert not ops
    assert any("tool_not_allowed" in e for e in errs)


def test_rejects_unknown_node_id():
    raw = '{"tool_ops":[{"name":"update_node","args":{"nodeId":"ghost","fill":"#f00"}}]}'
    ops, errs = extract_and_validate_tool_ops(
        raw,
        scene_nodes=[{"id": "n1"}],
    )
    assert not ops
    assert any("code=update_node_unknown_id" in e for e in errs)


def test_dedupe_by_op_id():
    raw_ops = [
        {"name": "update_node", "op_id": "same-id", "args": {"nodeId": "n1", "fill": "#111"}},
        {"name": "update_node", "op_id": "same-id", "args": {"nodeId": "n1", "fill": "#222"}},
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "n1"}],
    )
    assert not errs
    assert len(ops) == 1


def test_delete_nodes_uses_nodeIds():
    raw_ops = [
        {"name": "delete_nodes", "args": {"nodeIds": ["n1"]}},
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "n1", "type": "rect"}],
    )
    assert not errs
    assert len(ops) == 1
    assert ops[0]["name"] == "delete_nodes"
    assert ops[0]["args"]["nodeIds"] == ["n1"]


def test_delete_plus_create_rejected_prefer_update_shape():
    """Morph via delete+create is invalid — tell model to use update_node (no silent rewrite)."""
    raw_ops = [
        {"name": "delete_nodes", "args": {"nodeIds": ["green1"]}},
        {
            "name": "create_shape",
            "args": {
                "shapeType": "ellipse",
                "x": 10,
                "y": 20,
                "width": 100,
                "height": 100,
                "fill": "#00FF00",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "green1", "type": "rect", "w": 120, "h": 100}],
    )
    assert not ops
    assert any("code=prefer_update_node_shapeType" in e for e in errs)
    assert any("fix=" in e and "green1" in e for e in errs)
    assert any("ellipse" in e for e in errs)


def test_create_text_matching_scene_rejected_prefer_update():
    raw_ops = [
        {
            "name": "create_text",
            "args": {"text": "Hello", "x": 10, "y": 20, "fontSize": 24},
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "t1", "type": "text", "text": "Hello"}],
    )
    assert not ops
    assert any("code=prefer_update_node" in e for e in errs)
    assert any("t1" in e for e in errs)


def test_design_create_allows_create_text_matching_ambient():
    """New design may recreate similar labels; do not force-edit the old board."""
    raw_ops = [
        {
            "name": "create_text",
            "args": {"text": "登录", "x": 24, "y": 400, "fontSize": 16},
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "t1", "type": "text", "text": "登录"}],
        paint_lane="create",
        classified_intent="design",
    )
    assert len(ops) == 1
    assert ops[0]["name"] == "create_text"
    assert not any("prefer_update_node" in e for e in errs)


def test_design_create_rejects_update_ambient_nodes():
    ops, errs = normalize_agent_tool_ops(
        [{"name": "update_node", "args": {"nodeId": "t1", "text": "Bloom"}}],
        scene_nodes=[{"id": "t1", "type": "text", "text": "欢迎回来"}],
        paint_lane="create",
        classified_intent="design",
    )
    assert not ops
    assert any("code=new_design_leave_ambient" in e for e in errs)


def test_design_create_rejects_create_onto_ambient_frame():
    ops, errs = normalize_agent_tool_ops(
        [
            {
                "name": "create_image",
                "args": {
                    "frameId": "ab_old",
                    "x": 0,
                    "y": 0,
                    "width": 100,
                    "height": 100,
                    "genPrompt": "hero",
                },
            }
        ],
        scene_frames=[{"id": "ab_old", "w": 1080, "h": 1920}],
        paint_lane="create",
        classified_intent="design",
    )
    assert not ops
    assert any("code=new_design_leave_ambient" in e for e in errs)


def test_auto_size_requires_create_frame_before_content():
    from app.services.design.ops.tool_ops_contract import (
        _require_create_frame_for_auto_new_design,
    )

    errs = _require_create_frame_for_auto_new_design(
        [
            {
                "name": "create_image",
                "args": {"x": 0, "y": 0, "width": 100, "height": 100, "genPrompt": "x"},
            }
        ],
        canvas_size="auto",
        host_plate_ready=False,
    )
    assert any("code=auto_size_create_frame_first" in e for e in errs)

    ok = _require_create_frame_for_auto_new_design(
        [
            {"name": "create_frame", "args": {"width": 1080, "height": 1920}},
            {
                "name": "create_image",
                "args": {"x": 0, "y": 0, "width": 100, "height": 100, "genPrompt": "x"},
            },
        ],
        canvas_size="auto",
        host_plate_ready=False,
    )
    assert ok == []


def test_update_node_missing_nodeId_not_invented():
    """Do not bind fill-only update_node onto the largest plate."""
    raw_ops = [
        {"name": "update_node", "args": {"fill": "#ff0000"}},
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "bg", "type": "rect", "w": 400, "h": 400}],
    )
    assert not ops
    assert any("code=update_node_missing_nodeId" in e for e in errs)


def test_format_op_error_shape():
    from app.services.design.ops.tool_ops_contract import format_op_error

    s = format_op_error("demo", fix="do X", detail="why")
    assert s == "code=demo; fix=do X; detail=why"


def test_rejects_unknown_tool_uses_code_format():
    raw = '{"tool_ops":[{"name":"explode_canvas","args":{}}]}'
    ops, errs = extract_and_validate_tool_ops(raw)
    assert not ops
    assert any("code=tool_not_allowed" in e for e in errs)


def test_update_node_accepts_shape_type():
    raw = '{"tool_ops":[{"name":"update_node","args":{"nodeId":"n1","shapeType":"circle"}}]}'
    ops, errs = extract_and_validate_tool_ops(
        raw,
        scene_nodes=[{"id": "n1", "type": "rect", "w": 100, "h": 100}],
    )
    assert not errs
    assert ops[0]["args"]["shapeType"] == "circle"


def test_create_shape_next_to_images_is_not_rewritten_to_update():
    """Large create_shape must not rewrite onto image nodes (looks like no-op)."""
    raw_ops = [
        {
            "name": "create_shape",
            "args": {
                "shapeType": "rect",
                "x": 0,
                "y": 164,
                "width": 312,
                "height": 200,
                "fill": "#e0e0e0",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[
            {"id": "img1", "type": "image", "w": 148, "h": 148},
            {"id": "img2", "type": "image", "w": 148, "h": 148},
        ],
    )
    assert not errs
    assert len(ops) == 1
    assert ops[0]["name"] == "create_shape"
    assert ops[0]["args"]["fill"] == "#e0e0e0"


def test_create_shape_stays_create_even_if_similar_to_existing_plate():
    """Add-rect must not be rewritten into update_node on the largest shape."""
    raw_ops = [
        {
            "name": "create_shape",
            "args": {
                "shapeType": "rect",
                "width": 400,
                "height": 400,
                "fill": "#ff0000",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "bg", "type": "rect", "w": 400, "h": 400}],
    )
    assert not errs
    assert len(ops) == 1
    assert ops[0]["name"] == "create_shape"
    assert ops[0]["args"]["fill"] == "#ff0000"


def test_rejects_css_linear_gradient_fill_on_create_shape():
    raw_ops = [
        {
            "name": "create_shape",
            "args": {
                "shapeType": "rect",
                "x": 0,
                "y": 0,
                "width": 1080,
                "height": 1920,
                "fill": "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)",
                "name": "vignette",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(raw_ops)
    assert not ops
    assert any("create_shape_css_gradient_fill" in e for e in errs)
    assert any("fillType=linear" in e for e in errs)


def test_accepts_native_linear_fillType_on_create_shape():
    raw_ops = [
        {
            "name": "create_shape",
            "args": {
                "shapeType": "rect",
                "x": 0,
                "y": 0,
                "width": 1080,
                "height": 1920,
                "fillType": "linear",
                "fill": "rgba(0,0,0,0)",
                "fillEnd": "rgba(0,0,0,0.35)",
                "gradientAngle": 90,
                "name": "vignette",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(raw_ops)
    assert not errs
    assert len(ops) == 1
    assert ops[0]["args"]["fillType"] == "linear"


def test_rejects_css_gradient_fill_on_update_node():
    raw_ops = [
        {
            "name": "update_node",
            "args": {
                "nodeId": "n1",
                "fill": "radial-gradient(circle, #000 0%, transparent 70%)",
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(
        raw_ops,
        scene_nodes=[{"id": "n1", "type": "rect"}],
    )
    assert not ops
    assert any("update_node_css_gradient_fill" in e for e in errs)


def test_rejects_emoji_as_icon_create_text():
    raw_ops = [
        {
            "name": "create_text",
            "args": {"id": "e1", "text": "🔋", "x": 10, "y": 10, "fontSize": 24},
        },
    ]
    ops, errs = normalize_agent_tool_ops(raw_ops)
    assert not ops
    assert any("create_text_emoji_as_icon" in e for e in errs)


def test_allows_create_text_with_emoji_in_long_copy():
    raw_ops = [
        {
            "name": "create_text",
            "args": {
                "id": "t1",
                "text": "Summer festival 🎉 starts Friday — grab tickets",
                "x": 10,
                "y": 10,
                "fontSize": 18,
            },
        },
    ]
    ops, errs = normalize_agent_tool_ops(raw_ops)
    assert not errs
    assert len(ops) == 1


def test_assess_tool_ops_result_rejects_sparse_dashboard():
    from app.services.design.ops.tool_ops_contract import assess_tool_ops_result

    ok, reason = assess_tool_ops_result(
        [{"name": "create_shape", "args": {"fill": "#eee", "x": 0, "y": 0, "w": 100, "h": 100}}],
        intent="create",
        scene="website",
        skill_keys=["dashboard_ui"],
    )
    assert not ok
    assert "too_few_elements" in reason


def test_assess_tool_ops_result_allows_single_create_without_craft_skills():
    from app.services.design.ops.tool_ops_contract import assess_tool_ops_result

    ok, reason = assess_tool_ops_result(
        [{"name": "create_text", "args": {"id": "t1", "text": "Hi", "x": 0, "y": 0}}],
        intent="create",
        scene="website",
        skill_keys=[],
    )
    assert ok, reason


def test_assess_tool_ops_result_create_on_empty_scene_uses_projected_ops():
    """Empty pre-apply scene must not yield scene_too_thin:0 when ops are dense."""
    from app.services.design.ops.tool_ops_contract import assess_tool_ops_result

    ops = [
        {
            "name": "create_shape",
            "args": {"id": f"s{i}", "fill": "#eee", "x": i * 10, "y": 0, "w": 40, "h": 40},
        }
        for i in range(8)
    ]
    ok, reason = assess_tool_ops_result(
        ops,
        intent="create",
        scene="website",
        nodes=[],  # blank canvas before apply
        skill_keys=["poster_craft"],
    )
    assert ok, reason
    assert reason == "ok"


def test_assess_tool_ops_result_scene_too_thin_when_projected_still_empty():
    from app.services.design.ops.tool_ops_contract import assess_tool_ops_result

    # create_frame alone counts as a create but does not project a node id.
    ok, reason = assess_tool_ops_result(
        [{"name": "create_frame", "args": {"width": 1080, "height": 1920}}],
        intent="create",
        scene="website",
        nodes=[],
        rules={"validate.min_creates": "1", "validate.require_nodes": "1"},
    )
    assert not ok
    assert "scene_too_thin" in reason
