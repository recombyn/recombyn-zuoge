"""OpenAI-style LLM router."""

from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass
from typing import Any, Mapping

from app.core.config import settings


@dataclass(frozen=True)
class LlmEndpoint:
    base_url: str
    api_key: str
    model_id: str
    provider: str


# Request-scoped user for BYOK ``custom:<providerId>`` resolution.
_BYOK_USER_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "byok_user_id", default=None
)


def set_byok_user_id(user_id: str | None) -> contextvars.Token:
    return _BYOK_USER_ID.set(str(user_id).strip() if user_id else None)


def reset_byok_user_id(token: contextvars.Token) -> None:
    _BYOK_USER_ID.reset(token)


def get_byok_user_id() -> str | None:
    return _BYOK_USER_ID.get()


def is_byok_model_ref(model_string: str | None) -> bool:
    from app.services.security import parse_byok_model_ref

    return parse_byok_model_ref(model_string) is not None


def user_byok_platforms(user_id: str | None) -> set[str]:
    """Catalog providers the user has saved a platform-level BYOK key for."""
    if not user_id:
        return set()
    try:
        from app.services.security import list_user_platform_byok

        return list_user_platform_byok(user_id)
    except Exception:
        return set()


def catalog_provider_for_model(model: str | None) -> str | None:
    """Catalog ``provider`` for a model id (doubao / openrouter / …)."""
    mid = (model or "").strip()
    if not mid or is_byok_model_ref(mid):
        return None
    try:
        from app.services.llm.catalog_store import list_catalog

        for kind in ("text", "image", "video", "audio"):
            for m in list_catalog(kind=kind, enabled_only=False):
                if m.get("id") == mid:
                    return str(m.get("provider") or "") or None
    except Exception:
        pass
    for bucket in (list_llm_models(), list_image_models(), list_video_models()):
        for m in bucket:
            if m.get("id") == mid:
                return str(m.get("provider") or "") or None
    return None


def uses_user_platform_byok(user_id: str | None, model: str | None) -> bool:
    """True when this request will hit the user's own aggregator / custom key."""
    if is_byok_model_ref(model):
        return True
    if not user_id:
        return False
    provider = catalog_provider_for_model(model)
    if not provider:
        return False
    return provider in user_byok_platforms(user_id)


# OpenAI-style chat bases (`POST {base}/chat/completions`).
PROVIDER_BASE_URLS: dict[str, str] = {
    "doubao": "https://ark.cn-beijing.volces.com/api/v3",
    "deepseek": "https://api.deepseek.com",
    "openrouter": "https://openrouter.ai/api/v1",
}

def _api_key_for(provider: str) -> str:
    """Per-provider key: user platform BYOK (request-scoped) → env → LLM_API_KEY."""
    uid = get_byok_user_id()
    if uid:
        try:
            from app.services.security import get_platform_byok_api_key

            byok = get_platform_byok_api_key(uid, provider)
            if byok:
                return byok
        except Exception:
            pass
    per = {
        "doubao": settings.doubao_api_key,
        "deepseek": settings.deepseek_api_key,
        "openrouter": settings.openrouter_api_key,
    }
    specific = (per.get(provider) or "").strip()
    if specific:
        return specific
    return (settings.llm_api_key or "").strip()


def _byok_platforms_arg(byok_platforms: set[str] | frozenset[str] | None) -> set[str]:
    return set(byok_platforms or ())


def _provider_unlocked(
    provider: str,
    byok_platforms: set[str],
    *,
    strict: bool = False,
) -> bool:
    """True when env has a key or the user saved a platform BYOK credential.

    ``strict=True``: only count providers with real env keys or user BYOK
    (no cross-provider fallback when listing catalog models).
    """
    p = (provider or "doubao").strip().lower()
    if p in byok_platforms:
        return True
    if p == "openrouter":
        return _has_openrouter_key()
    if p == "deepseek":
        if strict:
            return _has_deepseek_key()
        return _has_deepseek_key() or not _has_doubao_key()
    if p == "doubao":
        if strict:
            return _has_doubao_key()
        return _has_doubao_key() or not _has_deepseek_key()
    return not strict
def _has_doubao_key() -> bool:
    if (settings.doubao_api_key or "").strip():
        return True
    unified = (settings.llm_api_key or "").strip()
    if not unified:
        return False
    provider = (settings.llm_provider or "doubao").strip().lower()
    return provider not in ("deepseek", "openrouter")


def _has_deepseek_key() -> bool:
    if (settings.deepseek_api_key or "").strip():
        return True
    unified = (settings.llm_api_key or "").strip()
    if not unified:
        return False
    return (settings.llm_provider or "").strip().lower() == "deepseek"


def _has_openrouter_key() -> bool:
    if (settings.openrouter_api_key or "").strip():
        return True
    unified = (settings.llm_api_key or "").strip()
    if not unified:
        return False
    return (settings.llm_provider or "").strip().lower() == "openrouter"


def list_llm_models(
    *,
    byok_platforms: set[str] | frozenset[str] | None = None,
    strict: bool = False,
) -> list[dict]:
    """Composer text catalog from ``llm_models`` only (empty table → empty list)."""
    unlocked = _byok_platforms_arg(byok_platforms)
    models: list[dict] = []
    try:
        from app.services.llm.catalog_store import list_catalog
        catalog = list_catalog(kind="text", enabled_only=True)
    except Exception:
        catalog = []

    for m in catalog:
        provider = str(m.get("provider") or "doubao")
        if not _provider_unlocked(provider, unlocked, strict=strict):
            continue
        models.append(
            {
                "id": m["id"],
                "label": m["label"],
                "description": m.get("description"),
                "provider": provider,
                "kind": "text",
                "apiModel": m.get("apiModel") or m["id"],
                "iconKey": m.get("iconKey"),
                "iconUrl": m.get("iconUrl"),
                "price": m.get("price"),
                "maxAttachments": int(m.get("maxAttachments") or 8),
                "thinking": bool(m.get("thinking")),
                "referenceTypes": m.get("referenceTypes") or ["text"],
            }
        )

    seed = (settings.doubao_seed_model or "").strip()
    if seed and _provider_unlocked("doubao", unlocked, strict=strict):
        models.append(
            {
                "id": "doubao-seed",
                "label": "Doubao Seed (custom ep)",
                "provider": "doubao",
                "kind": "text",
                "apiModel": seed,
                "maxAttachments": 8,
                "referenceTypes": ["text"],
            }
        )

    pro = (settings.doubao_pro_model or "").strip()
    if pro and _provider_unlocked("doubao", unlocked, strict=strict):
        models.append(
            {
                "id": "doubao-pro",
                "label": "Doubao Pro (custom ep)",
                "provider": "doubao",
                "kind": "text",
                "apiModel": pro,
                "maxAttachments": 8,
                "referenceTypes": ["text"],
            }
        )

    by_id: dict[str, dict] = {}
    for m in models:
        by_id.setdefault(str(m["id"]), m)
    return list(by_id.values())


def list_image_models(
    *,
    byok_platforms: set[str] | frozenset[str] | None = None,
    strict: bool = False,
) -> list[dict]:
    """Image catalog from ``llm_models`` only (empty table → empty list)."""
    unlocked = _byok_platforms_arg(byok_platforms)
    try:
        from app.services.llm.catalog_store import list_catalog
        catalog = list_catalog(kind="image", enabled_only=True)
    except Exception:
        catalog = []

    models: list[dict] = []
    for m in catalog:
        provider = str(m.get("provider") or "doubao")
        if not _provider_unlocked(provider, unlocked, strict=strict):
            continue
        mid = m["id"]
        models.append(
            {
                "id": mid,
                "label": m["label"],
                "description": m.get("description"),
                "provider": provider,
                "kind": "image",
                "apiModel": m.get("apiModel") or mid,
                "iconKey": m.get("iconKey"),
                "iconUrl": m.get("iconUrl"),
                "price": m.get("price"),
                "priceMeta": m.get("priceMeta"),
                "maxAttachments": int(m.get("maxAttachments") or 14),
                "imageLimits": m.get("imageLimits"),
                "referenceTypes": m.get("referenceTypes") or ["image"],
            }
        )
    return models


def list_video_models(
    *,
    byok_platforms: set[str] | frozenset[str] | None = None,
    strict: bool = False,
) -> list[dict]:
    """OpenRouter Seedance / video catalog (DB-backed)."""
    unlocked = _byok_platforms_arg(byok_platforms)
    try:
        from app.services.llm.catalog_store import list_catalog

        catalog = list_catalog(kind="video", enabled_only=True)
    except Exception:
        catalog = []

    models: list[dict] = []
    for m in catalog:
        provider = str(m.get("provider") or "openrouter")
        if not _provider_unlocked(provider, unlocked, strict=strict):
            continue
        mid = m["id"]
        models.append(
            {
                "id": mid,
                "label": m["label"],
                "description": m.get("description"),
                "provider": provider,
                "kind": "video",
                "apiModel": m.get("apiModel") or mid,
                "iconKey": m.get("iconKey"),
                "iconUrl": m.get("iconUrl"),
                "price": m.get("price"),
                "maxAttachments": int(m.get("maxAttachments") or 4),
            }
        )
    return models


def list_audio_models(
    *,
    byok_platforms: set[str] | frozenset[str] | None = None,
    strict: bool = False,
) -> list[dict]:
    """OpenRouter TTS / speech catalog (DB-backed)."""
    unlocked = _byok_platforms_arg(byok_platforms)
    try:
        from app.services.llm.catalog_store import list_catalog

        catalog = list_catalog(kind="audio", enabled_only=True)
    except Exception:
        catalog = []

    models: list[dict] = []
    for m in catalog:
        provider = str(m.get("provider") or "openrouter")
        if not _provider_unlocked(provider, unlocked, strict=strict):
            continue
        mid = m["id"]
        models.append(
            {
                "id": mid,
                "label": m["label"],
                "description": m.get("description"),
                "provider": provider,
                "kind": "audio",
                "apiModel": m.get("apiModel") or mid,
                "iconKey": m.get("iconKey"),
                "iconUrl": m.get("iconUrl"),
                "price": m.get("price"),
                "maxAttachments": int(m.get("maxAttachments") or 0),
            }
        )
    return models
def list_all_models() -> list[dict]:
    return [
        *list_llm_models(),
        *list_image_models(),
        *list_video_models(),
        *list_audio_models(),
    ]


def _base_url_for(provider: str) -> str:
    """Known providers use fixed bases; LLM_BASE_URL only for unknown names."""
    known = PROVIDER_BASE_URLS.get(provider)
    if known:
        return known.rstrip("/")
    override = (settings.llm_base_url or "").strip()
    if override:
        return override.rstrip("/")
    return PROVIDER_BASE_URLS["doubao"].rstrip("/")


def resolve_provider(model_string: str | None) -> tuple[str, str]:
    """Return (provider, api_model_id) for a catalog id or raw model string."""
    default = (settings.llm_default_model or "").strip()
    model = (model_string or default).strip()
    if not model:
        provider = (settings.llm_provider or "").strip().lower() or "doubao"
        return provider, ""

    catalog = {m["id"]: m for m in list_all_models()}
    meta = catalog.get(model)
    if meta:
        provider = str(meta.get("provider") or settings.llm_provider or "doubao")
        return provider, str(meta.get("apiModel") or meta["id"])

    for m in list_all_models():
        if str(m.get("apiModel") or "") == model:
            return str(m.get("provider") or "doubao"), model

    # provider/model form, e.g. doubao/ep-xxxx or openrouter/anthropic/claude-sonnet-4
    if "/" in model:
        prefix, rest = model.split("/", 1)
        if prefix in PROVIDER_BASE_URLS and rest:
            return prefix, rest

    low = model.lower()
    if (
        low.startswith("ep-")
        or low.startswith("doubao")
        or low.startswith("deepseek-v")
        or "seedream" in low
    ):
        return "doubao", model

    provider = (settings.llm_provider or "doubao").strip().lower()
    if provider not in PROVIDER_BASE_URLS:
        provider = "doubao"
    return provider, model


def get_llm_endpoint(model_string: str | None = None) -> LlmEndpoint:
    """
    Resolve an OpenAI-style chat endpoint.

    Platform keys via apps/api/.env, or BYOK ``custom:<providerId>`` using the
    request-scoped user from ``set_byok_user_id``.
    """
    from app.services.security import get_byok_provider_row, parse_byok_model_ref, redact_secrets

    byok_pid = parse_byok_model_ref(model_string)
    if byok_pid:
        uid = get_byok_user_id()
        if not uid:
            raise RuntimeError("BYOK model requires an authenticated user context")
        row = get_byok_provider_row(uid, byok_pid)
        if not row:
            raise RuntimeError("BYOK provider not found")
        api_key = str(row.get("apiKey") or "").strip()
        base_url = str(row.get("baseUrl") or "").strip().rstrip("/")
        api_model = str(row.get("apiModel") or "").strip()
        if not api_key or not base_url or not api_model:
            raise RuntimeError("BYOK provider is missing apiKey, baseUrl, or apiModel")
        # Never log secrets — touch redact for defensive message shaping.
        _ = redact_secrets
        return LlmEndpoint(
            base_url=base_url,
            api_key=api_key,
            model_id=api_model,
            provider="byok",
        )

    provider, model_id = resolve_provider(model_string)
    api_key = _api_key_for(provider)
    if not api_key:
        raise RuntimeError(
            "No LLM API key configured. Set DOUBAO_API_KEY, DEEPSEEK_API_KEY, "
            "OPENROUTER_API_KEY, or LLM_API_KEY in apps/api/.env"
        )

    return LlmEndpoint(
        base_url=_base_url_for(provider),
        api_key=api_key,
        model_id=model_id,
        provider=provider,
    )


# ---------------------------------------------------------------------------
# LangChain chat model (text only — not image /images/generations)
# ---------------------------------------------------------------------------


def _default_headers_for(endpoint: LlmEndpoint) -> dict[str, str]:
    """OpenRouter attribution headers; other providers need none beyond Bearer."""
    if endpoint.provider != "openrouter":
        return {}
    headers: dict[str, str] = {}
    referer = (settings.openrouter_http_referer or "").strip()
    title = (settings.openrouter_app_title or "").strip() or "recombyn"
    if referer:
        headers["HTTP-Referer"] = referer
    headers["X-Title"] = title
    return headers


_PatchedChatOpenAI: type | None = None
_openai_factory_patched = False


def _patched_chat_openai_cls() -> type:
    """Lazy subclass so langchain-openai is only required at call time."""
    global _PatchedChatOpenAI
    if _PatchedChatOpenAI is not None:
        return _PatchedChatOpenAI

    from langchain_openai import ChatOpenAI
    from langchain_core.outputs import ChatGenerationChunk
    from langchain_core.messages import AIMessageChunk

    class PatchedChatOpenAI(ChatOpenAI):
        """Keep provider reasoning deltas that stock ChatOpenAI drops."""

        def _convert_chunk_to_generation_chunk(
            self,
            chunk: dict,
            default_chunk_class: type,
            base_generation_info: dict | None,
        ) -> ChatGenerationChunk | None:
            gen = super()._convert_chunk_to_generation_chunk(
                chunk, default_chunk_class, base_generation_info
            )
            if gen is None:
                return None
            choices = (
                chunk.get("choices")
                or chunk.get("chunk", {}).get("choices", [])
                or []
            )
            if choices:
                delta = choices[0].get("delta") or {}
                reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                if (
                    isinstance(reasoning, str)
                    and reasoning
                    and isinstance(gen.message, AIMessageChunk)
                ):
                    gen.message.additional_kwargs["reasoning_content"] = reasoning
            rid = chunk.get("id") or chunk.get("request_id")
            if rid and isinstance(gen.message, AIMessageChunk):
                gen.message.response_metadata.setdefault(
                    "provider_request_id", str(rid)
                )
            return gen

    _PatchedChatOpenAI = PatchedChatOpenAI
    return PatchedChatOpenAI


def _ensure_patched_openai_for_factory() -> None:
    """
    Point LangChain's openai provider at PatchedChatOpenAI so
    ``init_chat_model(..., model_provider='openai')`` keeps reasoning deltas.
    """
    global _openai_factory_patched
    if _openai_factory_patched:
        return

    import langchain_openai
    from langchain.chat_models.base import _get_chat_model_creator

    patched = _patched_chat_openai_cls()
    langchain_openai.ChatOpenAI = patched  # type: ignore[misc, assignment]
    _get_chat_model_creator.cache_clear()
    _openai_factory_patched = True


def build_chat_model(
    model: str | None = None,
    *,
    endpoint: LlmEndpoint | None = None,
    max_tokens: int | None = None,
    streaming: bool = False,
    stream_usage: bool = True,
    extra_body: Mapping[str, Any] | None = None,
    timeout: float = 180.0,
    stream_chunk_timeout: float | None = None,
    model_id_override: str | None = None,
    source: str | None = None,
    catalog_model_id: str | None = None,
    with_usage_callback: bool = True,
):
    """
    ``init_chat_model(..., model_provider='openai')`` for our catalog endpoints.

    Resolves base_url/api_key from ``get_llm_endpoint``. Optional usage callback
    writes the billing ledger.

    ``stream_chunk_timeout``: stall detector (seconds between chunks). Structured
    tool-calls often stream under the hood even when ``streaming=False``; without
    a bound, a half-open TCP can sit until the library default (120s).
    """
    from langchain.chat_models import init_chat_model

    ep = endpoint or get_llm_endpoint(model)
    api_model = (model_id_override or ep.model_id).strip()
    _ensure_patched_openai_for_factory()

    kwargs: dict[str, Any] = {
        "api_key": ep.api_key,
        "base_url": ep.base_url,
        "streaming": streaming,
        "stream_usage": stream_usage,
        "timeout": timeout,
        "max_retries": 0,
    }
    if stream_chunk_timeout is not None:
        # None/0 disables in langchain-openai; only pass a positive bound.
        chunk_sec = float(stream_chunk_timeout)
        if chunk_sec > 0:
            kwargs["stream_chunk_timeout"] = chunk_sec
    headers = _default_headers_for(ep)
    if headers:
        kwargs["default_headers"] = headers
    if max_tokens is not None:
        kwargs["max_tokens"] = int(max_tokens)
    if extra_body:
        kwargs["extra_body"] = dict(extra_body)

    llm = init_chat_model(
        api_model,
        model_provider="openai",
        **kwargs,
    )
    llm._recombyn_endpoint = ep  # type: ignore[attr-defined]
    cat = (catalog_model_id or model or api_model or "").strip() or None
    llm._recombyn_catalog_id = cat  # type: ignore[attr-defined]

    if not with_usage_callback:
        return llm

    src = (source or "").strip()
    if not src:
        try:
            from app.services.llm.usage_log import get_usage_context

            ctx = get_usage_context()
            src = (ctx.source if ctx and ctx.source else "") or "llm"
        except Exception:
            src = "llm"

    handler = usage_callback_handler(
        source=src,
        provider=ep.provider,
        catalog_model_id=cat,
        api_model=api_model,
    )
    return llm.with_config(callbacks=[handler])


def usage_callback_handler(
    *,
    source: str,
    provider: str | None = None,
    catalog_model_id: str | None = None,
    api_model: str | None = None,
    kind: str = "llm",
):
    """LangChain Callback — sole path for model/image usage ledger."""
    from langchain_core.callbacks import BaseCallbackHandler

    class _UsageHandler(BaseCallbackHandler):
        def __init__(self) -> None:
            self._started = 0.0
            self._tool_started = 0.0

        def on_llm_start(self, *args: Any, **kwargs: Any) -> None:
            import time as _t

            self._started = _t.time()

        def on_chat_model_start(self, *args: Any, **kwargs: Any) -> None:
            import time as _t

            self._started = _t.time()

        def _usage_from_response(self, response: Any) -> dict[str, Any] | None:
            try:
                gens = getattr(response, "generations", None) or []
                if gens and gens[0]:
                    msg = gens[0][0].message
                    um = getattr(msg, "usage_metadata", None)
                    if isinstance(um, dict):
                        return {
                            "prompt_tokens": um.get("input_tokens"),
                            "completion_tokens": um.get("output_tokens"),
                            "total_tokens": um.get("total_tokens"),
                        }
                    if um is not None:
                        return {
                            "prompt_tokens": getattr(um, "input_tokens", None),
                            "completion_tokens": getattr(um, "output_tokens", None),
                            "total_tokens": getattr(um, "total_tokens", None),
                        }
                # LLMResult.llm_output.token_usage
                out = getattr(response, "llm_output", None) or {}
                if isinstance(out, dict):
                    tu = out.get("token_usage") or out.get("usage")
                    if isinstance(tu, dict):
                        return tu
            except Exception:
                return None
            return None

        def on_llm_end(self, response: Any, **kwargs: Any) -> None:
            import time as _t

            from app.services.llm.usage_log import record_model_usage

            usage = self._usage_from_response(response)
            total = None
            if isinstance(usage, dict) and usage.get("total_tokens") is not None:
                try:
                    total = int(usage["total_tokens"])
                except Exception:
                    total = None
            rid = None
            try:
                gens = getattr(response, "generations", None) or []
                if gens and gens[0]:
                    meta = getattr(gens[0][0].message, "response_metadata", None) or {}
                    if isinstance(meta, dict):
                        rid = meta.get("provider_request_id") or meta.get("id")
            except Exception:
                rid = None
            record_model_usage(
                source=source,
                provider=provider,
                catalog_model_id=catalog_model_id,
                api_model=api_model,
                status="ok",
                latency_ms=int((_t.time() - (self._started or _t.time())) * 1000),
                usage=usage,
                total_tokens=total,
                provider_request_id=str(rid) if rid else None,
                meta={"via": "langchain_callback", "kind": kind},
            )

        def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
            import time as _t

            from app.services.llm.usage_log import record_model_usage

            record_model_usage(
                source=source,
                provider=provider,
                catalog_model_id=catalog_model_id,
                api_model=api_model,
                status="error",
                latency_ms=int((_t.time() - (self._started or _t.time())) * 1000),
                error=str(error)[:800],
                meta={"via": "langchain_callback", "kind": kind},
            )

        def on_tool_start(self, *args: Any, **kwargs: Any) -> None:
            import time as _t

            self._tool_started = _t.time()

        def on_tool_end(self, output: Any, **kwargs: Any) -> None:
            import time as _t

            from app.services.llm.usage_log import record_model_usage

            payload = output
            if isinstance(output, str):
                try:
                    import json as _json

                    payload = _json.loads(output)
                except Exception:
                    payload = output

            image_count = None
            usage = None
            rid = None
            cat = catalog_model_id
            api = api_model
            prov = provider
            if isinstance(payload, dict):
                imgs = payload.get("images")
                if isinstance(imgs, list):
                    image_count = len(imgs) or 1
                m = payload.get("model")
                if isinstance(m, str) and m.strip():
                    cat = m.strip()
                ap = payload.get("_api_model")
                if isinstance(ap, str) and ap.strip():
                    api = ap.strip()
                pr = payload.get("_provider")
                if isinstance(pr, str) and pr.strip():
                    prov = pr.strip()
                u = payload.get("_usage")
                if isinstance(u, dict):
                    usage = u
                r = payload.get("_response_id")
                if isinstance(r, str) and r.strip():
                    rid = r.strip()
            record_model_usage(
                source=source or "image",
                provider=prov,
                catalog_model_id=cat,
                api_model=api,
                status="ok",
                latency_ms=int(
                    (_t.time() - (self._tool_started or self._started or _t.time()))
                    * 1000
                ),
                usage=usage,
                image_count=image_count,
                provider_request_id=rid,
                meta={"via": "langchain_callback", "kind": "tool"},
            )

        def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
            import time as _t

            from app.services.llm.usage_log import record_model_usage

            record_model_usage(
                source=source or "image",
                provider=provider,
                catalog_model_id=catalog_model_id,
                api_model=api_model,
                status="error",
                latency_ms=int(
                    (_t.time() - (self._tool_started or self._started or _t.time()))
                    * 1000
                ),
                error=str(error)[:800],
                meta={"via": "langchain_callback", "kind": "tool"},
            )

    return _UsageHandler()


def build_async_openai_client(
    *,
    endpoint: LlmEndpoint | None = None,
    model: str | None = None,
    provider: str | None = None,
    api_model: str | None = None,
    timeout: float = 180.0,
):
    """
    Async OpenAI SDK client (same stack LangChain ChatOpenAI uses).

    Used for image generation (``/images/generations``, OpenRouter ``/images``,
    chat image modalities) where stock LangChain has no image-gen abstraction.
    Returns ``(client, endpoint)``.
    """
    from openai import AsyncOpenAI

    if endpoint is None:
        if provider and api_model:
            key = _api_key_for(provider)
            if not key:
                raise RuntimeError(
                    f"No API key for provider={provider!r}. "
                    "Set DOUBAO_API_KEY / OPENROUTER_API_KEY / LLM_API_KEY."
                )
            endpoint = LlmEndpoint(
                base_url=_base_url_for(provider),
                api_key=key,
                model_id=api_model,
                provider=provider,
            )
        else:
            endpoint = get_llm_endpoint(model)
    headers = _default_headers_for(endpoint)
    client = AsyncOpenAI(
        api_key=endpoint.api_key,
        base_url=endpoint.base_url,
        timeout=timeout,
        max_retries=0,
        default_headers=headers or None,
    )
    return client, endpoint


def _normalize_openrouter_rel_path(path: str) -> str:
    """Normalize OpenRouter-relative paths for OpenAI SDK clients.

    OpenRouter returns ``polling_url`` values like ``/api/v1/videos/{id}`` while
    our client ``base_url`` is already ``https://openrouter.ai/api/v1``.
    """
    p = (path or "").strip()
    if not p:
        return p
    if p.startswith("http://") or p.startswith("https://"):
        from urllib.parse import urlparse

        parsed = urlparse(p)
        p = parsed.path or "/"
        if parsed.query:
            p = f"{p}?{parsed.query}"
    if p.startswith("/api/v1/"):
        p = p[len("/api/v1") :]
    elif p == "/api/v1":
        p = "/"
    if p and not p.startswith("/"):
        p = f"/{p}"
    return p


def _message_from_http_body(text: str) -> str | None:
    t = (text or "").strip()
    if not t:
        return None
    if t.lstrip().startswith("<!") or "<html" in t[:300].lower():
        return None
    try:
        parsed = json.loads(t)
    except Exception:
        return t[:300] + ("…" if len(t) > 300 else "")
    if isinstance(parsed, dict):
        err = parsed.get("error")
        if isinstance(err, dict):
            msg = err.get("message") or err.get("code")
            if msg:
                return str(msg)
        for key in ("message", "detail"):
            val = parsed.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return None


def _short_openai_sdk_error(err: BaseException, *, method: str, path: str) -> str:
    status = getattr(err, "status_code", None)
    body = getattr(err, "body", None)
    if body is not None:
        if isinstance(body, (dict, list)):
            try:
                body_text = json.dumps(body, ensure_ascii=False)
            except Exception:
                body_text = str(body)
        else:
            body_text = str(body)
        msg = _message_from_http_body(body_text)
        if msg:
            suffix = f" ({status})" if status else ""
            return f"OpenRouter {method} {path} failed{suffix}: {msg}"
        if body_text.lstrip().startswith("<!") or "<html" in body_text[:300].lower():
            suffix = f" ({status})" if status else ""
            return (
                f"OpenRouter {method} {path} failed{suffix}: "
                "provider returned HTML error page (check API path)"
            )
    text = str(err).strip()
    if "<html" in text.lower() or text.lstrip().startswith("<!"):
        suffix = f" ({status})" if status else ""
        return (
            f"OpenRouter {method} {path} failed{suffix}: "
            "provider returned HTML error page (check API path)"
        )
    if len(text) > 500:
        text = text[:500] + "…"
    return text or f"OpenRouter {method} {path} failed"


def _check_http_response(http_resp: Any, *, method: str, path: str) -> None:
    status = int(getattr(http_resp, "status_code", 0) or 0)
    if status < 400:
        return
    text = ""
    try:
        text = str(getattr(http_resp, "text", None) or "")
    except Exception:
        pass
    msg = _message_from_http_body(text)
    if msg:
        raise RuntimeError(f"OpenRouter {method} {path} failed ({status}): {msg}")
    if text.lstrip().startswith("<!") or "<html" in text[:300].lower():
        raise RuntimeError(
            f"OpenRouter {method} {path} failed ({status}): "
            "provider returned HTML error page"
        )
    raise RuntimeError(f"OpenRouter {method} {path} failed ({status})")


async def openai_json_post(
    client: Any,
    path: str,
    body: Mapping[str, Any],
) -> dict[str, Any]:
    """POST JSON via OpenAI SDK (custom paths like OpenRouter ``/images`` / ``/videos``).

    openai>=2: use ``client.post`` — ``with_raw_response`` has no ``.post``.
    """
    rel = _normalize_openrouter_rel_path(path)
    try:
        raw = await client.post(
            rel,
            body=dict(body),
            cast_to=object,
        )
    except Exception as err:
        raise RuntimeError(
            _short_openai_sdk_error(err, method="POST", path=rel)
        ) from err
    if isinstance(raw, dict):
        return raw
    # Some SDK paths return a response wrapper
    try:
        data = raw.parse() if hasattr(raw, "parse") else None
    except Exception:
        data = None
    if isinstance(data, dict):
        return data
    http_resp = getattr(raw, "http_response", None)
    if http_resp is not None:
        _check_http_response(http_resp, method="POST", path=rel)
        try:
            parsed = http_resp.json()
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    raise RuntimeError(f"OpenRouter POST {rel} returned non-JSON payload")


async def openai_json_get(
    client: Any,
    path: str,
) -> dict[str, Any]:
    """GET JSON via OpenAI SDK (OpenRouter video poll)."""
    rel = _normalize_openrouter_rel_path(path)
    try:
        raw = await client.get(rel, cast_to=object)
    except Exception as err:
        raise RuntimeError(
            _short_openai_sdk_error(err, method="GET", path=rel)
        ) from err
    if isinstance(raw, dict):
        return raw
    try:
        data = raw.parse() if hasattr(raw, "parse") else None
    except Exception:
        data = None
    if isinstance(data, dict):
        return data
    http_resp = getattr(raw, "http_response", None)
    if http_resp is not None:
        _check_http_response(http_resp, method="GET", path=rel)
        try:
            parsed = http_resp.json()
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    raise RuntimeError(f"OpenRouter GET {rel} returned non-JSON payload")


async def openai_binary_post(
    client: Any,
    path: str,
    body: Mapping[str, Any],
    *,
    default_content_type: str = "application/octet-stream",
) -> tuple[bytes, str]:
    """POST binary payload via OpenAI SDK (OpenRouter ``/audio/speech``, etc.).

    openai>=2: use ``client.post`` — ``with_raw_response`` has no ``.post``.
    """
    rel = _normalize_openrouter_rel_path(path)
    try:
        raw = await client.post(
            rel,
            body=dict(body),
            cast_to=object,
        )
    except Exception as err:
        raise RuntimeError(
            _short_openai_sdk_error(err, method="POST", path=rel)
        ) from err

    http_resp = getattr(raw, "http_response", None)
    if http_resp is None and isinstance(raw, (bytes, bytearray)):
        return bytes(raw), default_content_type
    if http_resp is None:
        raise RuntimeError(f"OpenRouter POST {rel} returned no HTTP response")

    _check_http_response(http_resp, method="POST", path=rel)
    content = getattr(http_resp, "content", None) or b""
    if not content:
        raise RuntimeError(f"OpenRouter POST {rel} returned empty body")

    ctype = default_content_type
    headers = getattr(http_resp, "headers", None)
    if headers is not None:
        try:
            parsed_ct = str(headers.get("content-type") or "").split(";")[0].strip()
            if parsed_ct:
                ctype = parsed_ct
        except Exception:
            pass

    low_ct = ctype.lower()
    if "json" in low_ct or low_ct.startswith("text/"):
        text = content.decode("utf-8", errors="replace")
        msg = _message_from_http_body(text)
        raise RuntimeError(
            f"OpenRouter POST {rel} returned JSON/text: {msg or text[:400]}"
        )
    if content[:1] in (b"{", b"[") and not ctype.startswith("audio/"):
        text = content.decode("utf-8", errors="replace")
        msg = _message_from_http_body(text)
        raise RuntimeError(
            f"OpenRouter POST {rel} returned JSON: {msg or text[:400]}"
        )

    return bytes(content), ctype


def _image_content_block(url: str) -> Any:
    """LangChain ``ImageContentBlock`` from a data URL or https URL."""
    from langchain_core.messages.content import create_image_block

    u = (url or "").strip()
    if not u:
        raise ValueError("empty image url")
    # Decode data URLs to base64+mime when FE already inlined bytes.
    if u.startswith("data:") and ";base64," in u:
        header, b64 = u.split(";base64,", 1)
        mime = header[5:].strip() if header.startswith("data:") else ""
        if not mime:
            mime = "image/png"
        if b64:
            return create_image_block(base64=b64, mime_type=mime)
    return create_image_block(url=u)


def build_user_message_content(
    text: str,
    images: list[str] | None = None,
) -> str | list[Any]:
    """
    Multimodal user content via LangChain content blocks.

    No images → plain string. With images →
    ``[TextContentBlock, ImageContentBlock, …]`` for ``HumanMessage``.
    Providers still receive OpenAI ``image_url`` after ChatOpenAI conversion.
    """
    from langchain_core.messages.content import create_text_block

    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if not refs:
        return text
    parts: list[Any] = [create_text_block(text or "")]
    for url in refs:
        try:
            parts.append(_image_content_block(url))
        except ValueError:
            continue
    if len(parts) == 1:
        return text
    return parts


def openai_user_content(
    text: str,
    images: list[str] | None = None,
) -> str | list[dict[str, Any]]:
    """Assemble via LangChain blocks, then convert to OpenAI chat ``content`` wire form.

    For raw ``chat.completions.create`` paths that do not go through ChatOpenAI.
    """
    from langchain_core.messages import HumanMessage, convert_to_openai_messages

    content = build_user_message_content(text, images)
    if isinstance(content, str):
        return content
    converted = convert_to_openai_messages([HumanMessage(content=content)])
    if not converted:
        return text
    out = converted[0].get("content")
    if isinstance(out, (str, list)):
        return out  # type: ignore[return-value]
    return text


def to_lc_messages(raw: list[dict[str, Any]] | None) -> list[Any]:
    """OpenAI-style dicts → LangChain ``BaseMessage`` list (System/Human/AI/Tool).

    User ``content`` may already be LangChain multimodal blocks from
    ``build_user_message_content``.
    """
    from langchain_core.messages import (
        AIMessage,
        BaseMessage,
        HumanMessage,
        SystemMessage,
        ToolMessage,
    )

    out: list[BaseMessage] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = item.get("content")
        if role == "system":
            out.append(SystemMessage(content=content if content is not None else ""))
            continue
        if role == "user":
            out.append(HumanMessage(content=content if content is not None else ""))
            continue
        if role == "tool":
            out.append(
                ToolMessage(
                    content=str(content or ""),
                    tool_call_id=str(item.get("tool_call_id") or ""),
                )
            )
            continue
        if role == "assistant":
            tcs = item.get("tool_calls")
            if isinstance(tcs, list) and tcs:
                parsed: list[dict[str, Any]] = []
                for tc in tcs:
                    item_tc = _parse_assistant_tool_call(tc)
                    if item_tc:
                        parsed.append(item_tc)
                out.append(
                    AIMessage(
                        content=content if content is not None else "",
                        tool_calls=parsed,
                    )
                )
            else:
                out.append(AIMessage(content=content if content is not None else ""))
            continue
    return out


def _parse_assistant_tool_call(tc: Any) -> dict[str, Any] | None:
    if not isinstance(tc, dict):
        return None
    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
    args_raw = fn.get("arguments") if fn else tc.get("args")
    if isinstance(args_raw, dict):
        args = args_raw
    else:
        try:
            args = json.loads(args_raw or "{}")
        except Exception:
            args = {"_raw": str(args_raw or "")}
    name = str((fn or {}).get("name") or tc.get("name") or "")
    if not name:
        return None
    return {
        "id": str(tc.get("id") or ""),
        "name": name,
        "args": args,
    }


def thinking_text_from_chunk(chunk: Any) -> str | None:
    """Extract streaming reasoning delta from an AIMessageChunk."""
    ak = getattr(chunk, "additional_kwargs", None) or {}
    if not isinstance(ak, dict):
        return None
    for key in ("reasoning_content", "reasoning"):
        val = ak.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def content_text_from_chunk(chunk: Any) -> str | None:
    """Plain string content from a stream chunk (ignore multimodal lists)."""
    content = getattr(chunk, "content", None)
    if isinstance(content, str) and content:
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str) and block:
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text")
                if isinstance(t, str) and t:
                    parts.append(t)
        joined = "".join(parts)
        return joined or None
    return None


def usage_blob_from_chunk(chunk: Any) -> dict[str, Any] | None:
    """Normalize LangChain usage_metadata → OpenAI-shaped usage dict."""
    um = getattr(chunk, "usage_metadata", None)
    if not um:
        return None
    if isinstance(um, dict):
        inp = um.get("input_tokens")
        out = um.get("output_tokens")
        tot = um.get("total_tokens")
    else:
        inp = getattr(um, "input_tokens", None)
        out = getattr(um, "output_tokens", None)
        tot = getattr(um, "total_tokens", None)
    blob: dict[str, Any] = {}
    if inp is not None:
        blob["prompt_tokens"] = int(inp)
    if out is not None:
        blob["completion_tokens"] = int(out)
    if tot is not None:
        blob["total_tokens"] = int(tot)
    elif blob:
        blob["total_tokens"] = int(blob.get("prompt_tokens") or 0) + int(
            blob.get("completion_tokens") or 0
        )
    return blob or None


def llm_error_detail(exc: BaseException) -> str:
    """Best-effort provider error body for retry / vision heuristics."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        try:
            return json.dumps(body, ensure_ascii=False)[:800]
        except Exception:
            pass
    if isinstance(body, str) and body.strip():
        return body[:800]
    msg = getattr(exc, "message", None)
    if isinstance(msg, str) and msg.strip():
        return msg[:800]
    return str(exc)[:800]
