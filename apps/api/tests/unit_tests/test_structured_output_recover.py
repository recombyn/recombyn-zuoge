"""Structured output: validate tool calls and build model re-ask feedback."""

from __future__ import annotations

from types import SimpleNamespace

from pydantic import BaseModel, Field

from app.services.llm.agent import (
    _parse_ai_message_to_schema,
    _structured_output_methods,
    _structured_reask_feedback,
)


class _RouteStub(BaseModel):
    lane: str = Field(description="lane")
    needs_image_gen: bool = False
    rationale: str = ""


def test_methods_prefer_tool_reask():
    assert _structured_output_methods("doubao-seed-2-1-turbo")[0] == "tool_reask"
    assert _structured_output_methods("deepseek-reasoner") == ("tool_reask",)


def test_parse_valid_tool_call():
    ai = SimpleNamespace(
        content="",
        tool_calls=[
            {
                "name": "_RouteStub",
                "id": "call_1",
                "args": {
                    "lane": "standard",
                    "needs_image_gen": False,
                    "rationale": "ok",
                },
            }
        ],
    )
    parsed, err = _parse_ai_message_to_schema(_RouteStub, ai)
    assert err is None
    assert isinstance(parsed, _RouteStub)
    assert parsed.lane == "standard"


def test_parse_missing_tool_call_errors():
    ai = SimpleNamespace(content="I pick fast", tool_calls=[])
    parsed, err = _parse_ai_message_to_schema(_RouteStub, ai)
    assert parsed is None
    assert err and "missing tool call" in err


def test_parse_invalid_args_errors():
    ai = SimpleNamespace(
        content="",
        tool_calls=[
            {
                "name": "_RouteStub",
                "id": "call_1",
                "args": {"lane": 123, "needs_image_gen": "no"},
            }
        ],
    )
    parsed, err = _parse_ai_message_to_schema(_RouteStub, ai)
    assert parsed is None
    assert err and "schema validation failed" in err


def test_feedback_uses_tool_message_when_tool_called():
    ai = SimpleNamespace(
        content="",
        tool_calls=[
            {
                "name": "_RouteStub",
                "id": "call_9",
                "args": {"lane": "nope"},
            }
        ],
    )
    msgs = _structured_reask_feedback(_RouteStub, ai, "schema validation failed")
    assert len(msgs) == 1
    assert msgs[0].tool_call_id == "call_9"
    assert "Structured output error" in msgs[0].content


def test_feedback_uses_human_message_when_no_tool_call():
    ai = SimpleNamespace(content="plain", tool_calls=[])
    msgs = _structured_reask_feedback(_RouteStub, ai, "missing tool call")
    assert len(msgs) == 1
    assert "MUST call the tool" in msgs[0].content
