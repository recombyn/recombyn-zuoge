"""OpenRouter binary POST helper (TTS / speech)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest


def test_openai_binary_post_uses_client_post():
    from app.services.llm import openai_binary_post

    http = MagicMock()
    http.status_code = 200
    http.content = b"\xff\xfb\x90"
    http.headers = {"content-type": "audio/mpeg"}
    http.text = ""
    raw = MagicMock()
    raw.http_response = http

    client = MagicMock()
    client.post = AsyncMock(return_value=raw)
    client.with_raw_response = MagicMock()
    client.with_raw_response.post = MagicMock(
        side_effect=AttributeError("'AsyncOpenAIWithRawResponse' object has no attribute 'post'")
    )

    async def _run():
        return await openai_binary_post(
            client,
            "/audio/speech",
            {"model": "google/gemini-3.1-flash-tts-preview", "input": "hi", "voice": "Zephyr"},
            default_content_type="audio/mpeg",
        )

    audio_bytes, ctype = asyncio.run(_run())
    assert audio_bytes == b"\xff\xfb\x90"
    assert ctype == "audio/mpeg"
    client.post.assert_awaited_once()
    client.with_raw_response.post.assert_not_called()


def test_openai_binary_post_rejects_json_error_body():
    from app.services.llm import openai_binary_post

    http = MagicMock()
    http.status_code = 200
    http.content = b'{"error":{"message":"bad voice"}}'
    http.headers = {"content-type": "application/json"}
    http.text = '{"error":{"message":"bad voice"}}'
    raw = MagicMock()
    raw.http_response = http

    client = MagicMock()
    client.post = AsyncMock(return_value=raw)

    async def _run():
        await openai_binary_post(client, "/audio/speech", {"model": "m", "input": "hi", "voice": "x"})

    with pytest.raises(RuntimeError, match="bad voice"):
        asyncio.run(_run())
