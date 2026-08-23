"""Unit: shared LLM JSON extract helpers."""

from __future__ import annotations

from app.services.design.ops.validate import extract_json, extract_json_object


def test_extract_json_array():
    assert extract_json("[1, 2]") == [1, 2]


def test_extract_json_object_fenced():
    text = 'Sure.\n```json\n{"intent":"ask","reply":"尺寸？"}\n```'
    obj = extract_json_object(text)
    assert obj is not None
    assert obj["intent"] == "ask"
    assert "尺寸" in obj["reply"]


def test_extract_json_object_intent_rescue():
    text = 'noise {"intent":"chat","reply":"hi"} trailing'
    obj = extract_json_object(text)
    assert obj is not None
    assert obj["intent"] == "chat"


def test_extract_json_object_empty():
    assert extract_json_object("") is None
    assert extract_json_object("not json") is None
