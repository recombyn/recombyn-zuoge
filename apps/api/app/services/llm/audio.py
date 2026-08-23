"""Audio / TTS generation via OpenRouter ``POST /audio/speech``."""

from __future__ import annotations

import logging
from typing import Any

from app.services.llm import (
    _api_key_for,
    build_async_openai_client,
    list_audio_models,
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


async def _post_speech_bytes(
    client: Any,
    body: dict[str, Any],
) -> tuple[bytes, str]:
    """POST /audio/speech → (audio_bytes, content_type)."""
    raw = await client.with_raw_response.post(
        "/audio/speech",
        body=dict(body),
        cast_to=object,
    )
    http_resp = getattr(raw, "http_response", None)
    if http_resp is None:
        raise RuntimeError("OpenRouter speech returned no HTTP response")
    status = int(getattr(http_resp, "status_code", 0) or 0)
    content = getattr(http_resp, "content", None) or b""
    if status >= 400:
        detail = ""
        try:
            detail = http_resp.text
        except Exception:
            detail = str(content[:400])
        raise RuntimeError(f"OpenRouter speech failed ({status}): {detail[:500]}")
    if not content:
        raise RuntimeError("OpenRouter speech returned empty audio")
    ctype = ""
    headers = getattr(http_resp, "headers", None)
    if headers is not None:
        try:
            ctype = str(headers.get("content-type") or "").split(";")[0].strip()
        except Exception:
            ctype = ""
    if not ctype or "json" in ctype or "text/" in ctype:
        # Some errors arrive as JSON with 200 — surface them.
        if content[:1] in (b"{", b"["):
            raise RuntimeError(f"OpenRouter speech returned JSON: {content[:400]!r}")
        ctype = "audio/mpeg"
    return bytes(content), ctype


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

    Returns ``{ audios: [url], model, voice, mime?, bytes? }`` where ``audios``
    may be data URLs until the route rehosts to assets.
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
    try:
        audio_bytes, ctype = await _post_speech_bytes(client, body)
    except Exception as err:  # noqa: BLE001
        raise RuntimeError(f"OpenRouter audio speech failed: {err}") from err

    import base64

    mime = ctype if ctype.startswith("audio/") else (
        "audio/mpeg" if fmt == "mp3" else f"audio/{fmt}"
    )
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    return {
        "audios": [data_url],
        "model": catalog_id,
        "voice": voice_id,
        "mime": mime,
        "bytes": audio_bytes,
    }
