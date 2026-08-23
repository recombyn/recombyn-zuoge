"""Chat streaming via LangChain ChatOpenAI (OpenAI-style providers)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Literal

from app.services.llm import (
    build_chat_model,
    build_user_message_content,
    content_text_from_chunk,
    get_llm_endpoint,
    llm_error_detail,
    thinking_text_from_chunk,
    to_lc_messages,
)

StreamKind = Literal["thinking", "token"]


def _model_supports_thinking(model_id: str | None) -> bool:
    mid = (model_id or "").strip().lower()
    return bool(mid) and ("reasoner" in mid or mid.endswith("-r1"))


def _thinking_extra_body(endpoint: Any, *, use_thinking: bool) -> dict[str, Any] | None:
    """DeepSeek / Ark thinking knob (top-level via ChatOpenAI extra_body)."""
    if not use_thinking:
        return None
    mid = str(getattr(endpoint, "model_id", "") or "").lower()
    provider = str(getattr(endpoint, "provider", "") or "").lower()
    if provider == "deepseek" and "reasoner" not in mid:
        return {"thinking": {"type": "enabled"}}
    return None


async def stream_chat(
    *,
    message: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
    thinking: bool | None = None,
    images: list[str] | None = None,
) -> AsyncIterator[tuple[StreamKind, str]]:
    """
    Stream assistant tokens via LangChain.

    Usage is recorded only by LangChain callbacks on ``build_chat_model``.
    """
    endpoint = get_llm_endpoint(model)
    history_msgs: list[dict[str, Any]] = []
    for item in history or []:
        role = (item.get("role") or "").strip()
        content = (item.get("content") or "").strip()
        if role in ("user", "assistant", "system") and content:
            history_msgs.append({"role": role, "content": content})
    history_msgs.append(
        {"role": "user", "content": build_user_message_content(message, images)}
    )

    use_thinking = (
        thinking if thinking is not None else _model_supports_thinking(endpoint.model_id)
    )
    extra = _thinking_extra_body(endpoint, use_thinking=use_thinking)
    llm = build_chat_model(
        endpoint=endpoint,
        streaming=True,
        stream_usage=True,
        extra_body=extra,
        source="chat",
        catalog_model_id=model or endpoint.model_id,
    )
    lc_messages = to_lc_messages(history_msgs)

    try:
        async for chunk in llm.astream(lc_messages):
            thought = thinking_text_from_chunk(chunk)
            if thought:
                yield ("thinking", thought)
            text = content_text_from_chunk(chunk)
            if text:
                yield ("token", text)
    except Exception as err:
        detail = llm_error_detail(err)
        if "InvalidEndpointOrModel" in detail or "404" in detail:
            raise RuntimeError(
                "Ark model/endpoint not found. Use the catalog's dated api_model "
                "(e.g. deepseek-v4-flash-260425), or activate the model in Volcengine Ark. "
                f"Detail: {detail}"
            ) from err
        raise
