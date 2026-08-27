"""Tests for text block partition helpers."""

from __future__ import annotations

from image_layer_pipeline.stages.text_blocks import (
    looks_like_display_text,
    partition_text_blocks,
    should_rasterize_text,
)


def test_low_confidence_rasterized():
    blocks = [
        {"type": "text", "text": "hello", "score": 0.5, "height": 20, "width": 80},
    ]
    editable, raster = partition_text_blocks(blocks, min_confidence=0.72)
    assert not editable
    assert len(raster) == 1


def test_display_headline_rasterized():
    block = {
        "type": "text",
        "text": "HEADLINE",
        "score": 0.85,
        "height": 48,
        "width": 200,
        "font_size": 42,
    }
    assert looks_like_display_text(block)
    assert should_rasterize_text(block, min_confidence=0.72)


def test_display_headline_high_confidence_editable():
    block = {
        "type": "text",
        "text": "HEADLINE",
        "score": 0.95,
        "height": 48,
        "width": 200,
        "font_size": 42,
    }
    assert looks_like_display_text(block)
    assert not should_rasterize_text(block, min_confidence=0.72)


def test_body_text_editable():
    block = {
        "type": "text",
        "text": "正文段落内容",
        "score": 0.95,
        "height": 18,
        "width": 240,
        "font_size": 14,
    }
    editable, raster = partition_text_blocks([block], min_confidence=0.72)
    assert len(editable) == 1
    assert not raster
