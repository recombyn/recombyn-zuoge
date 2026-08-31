"""Unit tests for img_layers → tool_ops mapping."""

from __future__ import annotations

from app.services.design.img_layers.to_tool_ops import layers_to_tool_ops


def test_layers_to_tool_ops_frame_then_text_and_image():
    ops = layers_to_tool_ops(
        [
            {
                "type": "image",
                "src": "data:image/png;base64,xx",
                "x": 0,
                "y": 0,
                "width": 100,
                "height": 200,
                "name": "背景",
            },
            {
                "type": "text",
                "text": "Hello",
                "x": 10,
                "y": 20,
                "width": 80,
                "height": 24,
                "fontSize": 20,
                "fill": "#111111",
                "name": "标题",
            },
        ],
        canvas_w=100,
        canvas_h=200,
        src_w=100,
        src_h=200,
    )
    assert ops[0]["name"] == "create_frame"
    assert ops[0]["args"]["width"] == 100
    assert ops[1]["name"] == "create_image"
    assert ops[1]["args"]["src"].startswith("data:")
    assert ops[2]["name"] == "create_text"
    assert ops[2]["args"]["text"] == "Hello"
    assert ops[2]["args"]["fill"] == "#111111"


def test_layers_to_tool_ops_scales_geometry():
    ops = layers_to_tool_ops(
        [
            {
                "type": "image",
                "src": "https://example.com/a.png",
                "x": 50,
                "y": 100,
                "width": 50,
                "height": 100,
                "name": "主体",
            }
        ],
        canvas_w=200,
        canvas_h=400,
        src_w=100,
        src_h=200,
    )
    img = ops[1]["args"]
    assert img["x"] == 100.0
    assert img["y"] == 200.0
    assert img["width"] == 100.0
    assert img["height"] == 200.0
