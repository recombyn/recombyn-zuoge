"""Cover tile picker — must see shapes inside artboard frames."""

from app.services.projects import _cov_pick_nodes


def _frame_doc_with_rect():
    return {
        "pageChildren": ["frame1"],
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "key": "entry", "children": ["frame1"]},
            "frame1": {
                "id": "frame1",
                "key": "frame",
                "width": 1080,
                "height": 1920,
                "children": ["rect1"],
            },
            "rect1": {
                "id": "rect1",
                "key": "shape",
                "width": 400,
                "height": 300,
                "attrs": {"fill-color": "#e11d48", "shapeType": "rect"},
            },
        },
    }


def test_cov_pick_nodes_finds_shape_inside_frame():
    picked = _cov_pick_nodes(_frame_doc_with_rect())
    assert len(picked) == 1
    assert picked[0]["id"] == "rect1"


def test_cov_pick_nodes_empty_when_only_blank_frame():
    doc = {
        "pageChildren": ["frame1"],
        "deltaSetLike": {
            "ROOT": {"id": "ROOT", "key": "entry", "children": ["frame1"]},
            "frame1": {
                "id": "frame1",
                "key": "frame",
                "width": 1080,
                "height": 1920,
                "children": [],
            },
        },
    }
    assert _cov_pick_nodes(doc) == []


def test_build_auto_cover_key_stable_when_document_unchanged():
    from app.services.projects import (
        _build_auto_cover_key,
        _encode_thumb_entries,
        _parse_thumb_entries,
    )

    doc = _frame_doc_with_rect()
    first = _build_auto_cover_key("u1", "p1", doc, None)
    assert first
    second = _build_auto_cover_key("u1", "p1", doc, first)
    assert second == first
    assert _encode_thumb_entries(_parse_thumb_entries(first)) == first
