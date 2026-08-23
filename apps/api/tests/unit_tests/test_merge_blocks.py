from app.services.vision.merge_blocks import merge_text_blocks


def test_merge_text_blocks_joins_same_line():
    blocks = [
        {"type": "text", "page": 0, "text": "Hello", "x": 10, "y": 20, "width": 40, "height": 14, "font_size": 12},
        {"type": "text", "page": 0, "text": "World", "x": 55, "y": 21, "width": 45, "height": 14, "font_size": 12},
        {"type": "text", "page": 0, "text": "Next", "x": 10, "y": 50, "width": 40, "height": 14, "font_size": 12},
        {"type": "image", "page": 0, "x": 0, "y": 80, "width": 100, "height": 40, "src": "data:image/png;base64,xx"},
    ]
    merged = merge_text_blocks(blocks)
    texts = [b for b in merged if b.get("type") == "text"]
    assert len(texts) == 2
    assert texts[0]["text"] == "Hello World"
    assert texts[0]["merged_count"] == 2
    assert any(b.get("type") == "image" for b in merged)


def test_merge_respects_pages():
    blocks = [
        {"type": "text", "page": 0, "text": "A", "x": 0, "y": 0, "width": 10, "height": 12},
        {"type": "text", "page": 1, "text": "B", "x": 0, "y": 0, "width": 10, "height": 12},
    ]
    merged = merge_text_blocks(blocks)
    assert len(merged) == 2
    assert {b["page"] for b in merged} == {0, 1}
