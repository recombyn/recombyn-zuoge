"""Audio / TTS generation via OpenRouter ``POST /audio/speech``."""

from __future__ import annotations

import logging
from typing import Any

from app.services.llm import (
    _api_key_for,
    build_async_openai_client,
    list_audio_models,
    openai_binary_post,
)

logger = logging.getLogger(__name__)

_DEFAULT_AUDIO_MODEL = "google/gemini-3.1-flash-tts-preview"
_DEFAULT_VOICE_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("google/gemini", "Zephyr"),
    ("hexgrad/kokoro", "af_bella"),
    ("openai/", "alloy"),
    ("x-ai/grok", "Ara"),
    ("microsoft/mai", "Andrew"),
    ("minimax/", "female-chengshu"),
    ("fish-audio/", "default"),
)
_DEFAULT_VOICE = "Zephyr"


def _admin_audio_default() -> str:
    try:
        from app.services.design.readpath.catalog import get_global_rules

        return (get_global_rules().get("assets.audio_default_model") or "").strip()
    except Exception:
        return ""


def resolve_audio_model(model: str | None = None) -> str:
    mid = (model or _admin_audio_default() or "").strip()
    known = {m["id"]: m for m in list_audio_models()}
    if mid in known:
        return mid
    if mid:
        return mid
    if known:
        preferred = next(
            (m["id"] for m in known.values() if "gemini" in str(m.get("id") or "").lower()),
            None,
        )
        return preferred or next(iter(known))
    return "or-gemini-3-1-flash-tts"


def _api_model_id(catalog_id: str) -> str:
    for m in list_audio_models():
        if m["id"] == catalog_id:
            return str(m.get("apiModel") or m["id"])
    return catalog_id or _DEFAULT_AUDIO_MODEL


def default_voice_for_api_model(api_model: str) -> str:
    low = str(api_model or "").strip().lower()
    for prefix, voice in _DEFAULT_VOICE_BY_PREFIX:
        if low.startswith(prefix):
            return voice
    return _DEFAULT_VOICE


async def generate_audio(
    *,
    prompt: str,
    model: str | None = None,
    voice: str | None = None,
    response_format: str | None = "mp3",
    speed: float | None = None,
) -> dict[str, Any]:
    """
    Text-to-speech via OpenRouter Audio Speech API.

    Returns ``{ bytes, model, voice, mime }`` for asset persistence.
    """
    text = (prompt or "").strip()
    if not text:
        raise ValueError("empty prompt")

    catalog_id = resolve_audio_model(model)
    api_model = _api_model_id(catalog_id)
    api_key = _api_key_for("openrouter")
    if not api_key:
        raise RuntimeError(
            "No OpenRouter API key configured. Set OPENROUTER_API_KEY in apps/api/.env"
        )

    fmt = (response_format or "mp3").strip().lower() or "mp3"
    if fmt not in ("mp3", "pcm", "wav"):
        fmt = "mp3"
    voice_id = (voice or "").strip() or default_voice_for_api_model(api_model)

    body: dict[str, Any] = {
        "model": api_model,
        "input": text,
        "voice": voice_id,
        "response_format": fmt,
    }
    if speed is not None:
        try:
            s = float(speed)
            if 0.25 <= s <= 4.0:
                body["speed"] = s
        except (TypeError, ValueError):
            pass

    client, _endpoint = build_async_openai_client(
        provider="openrouter",
        api_model=api_model,
        timeout=180.0,
    )
    default_ct = "audio/mpeg" if fmt == "mp3" else f"audio/{fmt}"
    audio_bytes, ctype = await openai_binary_post(
        client,
        "/audio/speech",
        body,
        default_content_type=default_ct,
    )
    mime = ctype if ctype.startswith("audio/") else default_ct
    return {
        "bytes": audio_bytes,
        "model": catalog_id,
        "voice": voice_id,
        "mime": mime,
    }
