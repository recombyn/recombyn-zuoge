"""LangChain text-model adapter (no live provider calls)."""

from __future__ import annotations

from app.services.llm import (
    content_text_from_chunk,
    thinking_text_from_chunk,
    to_lc_messages,
    usage_blob_from_chunk,
)


def test_to_lc_messages_roles_and_tools():
    msgs = to_lc_messages(
        [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "foo", "arguments": '{"a":1}'},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
            {"role": "assistant", "content": "done"},
        ]
    )
    assert [type(m).__name__ for m in msgs] == [
        "SystemMessage",
        "HumanMessage",
        "AIMessage",
        "ToolMessage",
        "AIMessage",
    ]
    assert msgs[2].tool_calls[0]["name"] == "foo"
    assert msgs[2].tool_calls[0]["args"] == {"a": 1}
    assert msgs[3].tool_call_id == "call_1"


def test_multimodal_user_content_uses_langchain_blocks():
    from langchain_core.messages import HumanMessage, convert_to_openai_messages
    from app.services.llm import build_user_message_content, openai_user_content, to_lc_messages

    plain = build_user_message_content("hello", None)
    assert plain == "hello"

    blocks = build_user_message_content(
        "see",
        ["https://example.com/a.png", "data:image/png;base64,abc"],
    )
    assert isinstance(blocks, list)
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"] == "see"
    assert blocks[1]["type"] == "image"
    assert blocks[1].get("url") == "https://example.com/a.png"
    assert blocks[2]["type"] == "image"
    assert blocks[2].get("base64") == "abc"
    assert blocks[2].get("mime_type") == "image/png"

    msgs = to_lc_messages([{"role": "user", "content": blocks}])
    assert isinstance(msgs[0], HumanMessage)
    wire = convert_to_openai_messages(msgs)
    assert wire[0]["content"][1]["type"] == "image_url"
    assert wire[0]["content"][1]["image_url"]["url"] == "https://example.com/a.png"
    assert wire[0]["content"][2]["image_url"]["url"].startswith("data:image/png;base64,")

    openai_parts = openai_user_content("x", ["https://example.com/b.png"])
    assert isinstance(openai_parts, list)
    assert openai_parts[0] == {"type": "text", "text": "x"}
    assert openai_parts[1]["type"] == "image_url"


def test_thinking_and_usage_helpers():
    class _Chunk:
        def __init__(self):
            self.content = "hello"
            self.additional_kwargs = {"reasoning_content": "think…"}
            self.usage_metadata = {
                "input_tokens": 3,
                "output_tokens": 5,
                "total_tokens": 8,
            }

    chunk = _Chunk()
    assert thinking_text_from_chunk(chunk) == "think…"
    assert content_text_from_chunk(chunk) == "hello"
    assert usage_blob_from_chunk(chunk) == {
        "prompt_tokens": 3,
        "completion_tokens": 5,
        "total_tokens": 8,
    }


def test_patched_chat_preserves_reasoning_delta():
    from app.services.llm import LlmEndpoint, _patched_chat_openai_cls
    from langchain_core.messages import AIMessageChunk

    cls = _patched_chat_openai_cls()
    llm = cls(
        model="deepseek-chat",
        api_key="sk-test",
        base_url="https://example.invalid/v1",
        max_retries=0,
    )
    # Attach endpoint like build_chat_model would.
    llm._recombyn_endpoint = LlmEndpoint(
        base_url="https://example.invalid/v1",
        api_key="sk-test",
        model_id="deepseek-chat",
        provider="deepseek",
    )
    gen = llm._convert_chunk_to_generation_chunk(
        {
            "id": "req_1",
            "choices": [
                {
                    "delta": {
                        "role": "assistant",
                        "content": "",
                        "reasoning_content": "step1",
                    }
                }
            ],
        },
        AIMessageChunk,
        None,
    )
    assert gen is not None
    assert gen.message.additional_kwargs.get("reasoning_content") == "step1"
    assert gen.message.response_metadata.get("provider_request_id") == "req_1"


def test_build_chat_model_uses_init_chat_model():
    from app.services.llm import LlmEndpoint, build_chat_model, _patched_chat_openai_cls

    ep = LlmEndpoint(
        base_url="https://example.invalid/v1",
        api_key="sk-test",
        model_id="deepseek-chat",
        provider="deepseek",
    )
    llm = build_chat_model(
        endpoint=ep,
        streaming=False,
        with_usage_callback=False,
        catalog_model_id="deepseek",
    )
    # RunnableBinding when callbacks on; bare model when with_usage_callback=False
    bare = getattr(llm, "bound", llm)
    assert isinstance(bare, _patched_chat_openai_cls())
    assert getattr(bare, "_recombyn_catalog_id", None) == "deepseek"
