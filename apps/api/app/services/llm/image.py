"""Image generation via LangChain/OpenAI SDK (same stack as text models).

Paths:
  - Doubao Ark → ``images.generate`` (``/images/generations``)
  - OpenRouter Gemini chat-image → ``chat.completions`` + modalities
  - OpenRouter other → POST ``/images``
"""

from __future__ import annotations

import math
from typing import Any

from app.core.config import settings
from app.services.llm import (
    LlmEndpoint,
    _api_key_for,
    build_async_openai_client,
    llm_error_detail,
    list_image_models,
    openai_json_post,
    openai_user_content,
)
# 1K — base ~1024 area
_ASPECT_TO_SIZE_1K: dict[str, str] = {
    "1:1": "1024x1024",
    "1:2": "768x1536",
    "2:1": "1536x768",
    "9:16": "720x1280",
    "16:9": "1280x720",
    "3:4": "864x1152",
    "4:3": "1152x864",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "5:4": "1280x1024",
    "4:5": "1024x1280",
    "21:9": "1680x720",
    "9:21": "720x1680",
}

_ASPECT_TO_SIZE_2K: dict[str, str] = {
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "3024x1296",
    "9:21": "1296x3024",
    "5:4": "2304x1792",
    "4:5": "1792x2304",
    "1:2": "1440x2880",
    "2:1": "2880x1440",
}

_ASPECT_TO_SIZE_4K: dict[str, str] = {
    "1:1": "4096x4096",
    "4:3": "4704x3520",
    "3:4": "3520x4704",
    "16:9": "5504x3040",
    "9:16": "3040x5504",
    "3:2": "4992x3328",
    "2:3": "3328x4992",
    "21:9": "6240x2656",
    "9:21": "2656x6240",
    "5:4": "4608x3584",
    "4:5": "3584x4608",
    "1:2": "2880x5760",
    "2:1": "5760x2880",
}

_RESOLUTION_TABLES: dict[str, dict[str, str]] = {
    "1K": _ASPECT_TO_SIZE_1K,
    "2K": _ASPECT_TO_SIZE_2K,
    "4K": _ASPECT_TO_SIZE_4K,
}

_RESOLUTION_BASE_AREA: dict[str, int] = {
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 4096 * 4096,
}

# Seedream pixel budgets — defaults only; prefer catalog image_limits.
_SEEDREAM_5_MIN_PIXELS = 2560 * 1440  # 3_686_400
_SEEDREAM_4_MIN_PIXELS = 1280 * 720  # 921_600
_SEEDREAM_MAX_PIXELS = 4096 * 4096  # 16_777_216

_DEFAULT_IMAGE_MODEL = "doubao-seedream-5-0-lite"


def _admin_image_default() -> str:
    """Admin global rule assets.image_default_model (falls back to env)."""
    try:
        from app.services.design.readpath.catalog import get_global_rules

        return (get_global_rules().get("assets.image_default_model") or "").strip()
    except Exception:
        return ""


def resolve_image_model(model: str | None = None) -> str:
    mid = (model or _admin_image_default() or settings.image_default_model or "").strip()
    known = {m["id"]: m for m in list_image_models()}
    if mid in known:
        return mid
    if mid:
        return mid
    if known:
        return next(iter(known))
    return _DEFAULT_IMAGE_MODEL


def _api_model_id(catalog_id: str) -> str:
    """Catalog id may differ from the Ark model / endpoint id."""
    for m in list_image_models():
        if m["id"] == catalog_id:
            return str(m.get("apiModel") or m["id"])
    return catalog_id or (_admin_image_default() or settings.image_default_model or _DEFAULT_IMAGE_MODEL).strip()


def _round_dim(n: float) -> int:
    """Round to nearest multiple of 16 (Seedream-friendly)."""
    v = int(round(n / 16)) * 16
    return max(16, v)


def _parse_aspect(aspect_ratio: str) -> tuple[float, float]:
    raw = aspect_ratio.strip()
    if ":" in raw:
        parts = raw.split(":", 1)
        try:
            w, h = float(parts[0]), float(parts[1])
            if w > 0 and h > 0:
                return w, h
        except ValueError:
            pass
    if "x" in raw.lower():
        parts = raw.lower().split("x", 1)
        try:
            w, h = float(parts[0]), float(parts[1])
            if w > 0 and h > 0:
                return w, h
        except ValueError:
            pass
    return 1.0, 1.0


def _size_from_area_and_aspect(area: int, aspect_ratio: str) -> str:
    w_r, h_r = _parse_aspect(aspect_ratio)
    ratio = w_r / h_r
    h = math.sqrt(area / ratio)
    w = h * ratio
    return f"{_round_dim(w)}x{_round_dim(h)}"


def _normalize_resolution(resolution: str | None) -> str:
    raw = (resolution or "2K").strip().upper()
    if raw in _RESOLUTION_TABLES or raw in ("3K", "512"):
        return raw
    if raw in ("1024", "1"):
        return "1K"
    if raw in ("2048", "2"):
        return "2K"
    if raw in ("3072", "3"):
        return "3K"
    if raw in ("4096", "4"):
        return "4K"
    return "2K"


def _size_for_aspect(
    aspect_ratio: str | None,
    resolution: str | None = None,
) -> str:
    raw = (aspect_ratio or "1:1").strip()
    if "x" in raw.lower() and ":" not in raw:
        return raw
    res_key = _normalize_resolution(resolution)
    table = _RESOLUTION_TABLES[res_key]
    if raw in table:
        return table[raw]
    area = _RESOLUTION_BASE_AREA.get(res_key, _RESOLUTION_BASE_AREA["2K"])
    return _size_from_area_and_aspect(area, raw)


def _parse_wxh(size: str) -> tuple[int, int] | None:
    raw = (size or "").strip().lower()
    if "x" not in raw:
        return None
    left, right = raw.split("x", 1)
    try:
        w, h = int(float(left)), int(float(right))
    except ValueError:
        return None
    if w <= 0 or h <= 0:
        return None
    return w, h


def _catalog_image_limits(catalog_id: str) -> dict[str, Any]:
    """Read size contract from admin catalog (推理集群); fall back by provider."""
    try:
        from app.services.llm.catalog_store import get_model, resolve_image_limits

        row = get_model(catalog_id) or {}
        limits = resolve_image_limits(row.get("imageLimits"))
        if limits:
            return limits
        provider = str(row.get("provider") or "").strip().lower()
        if provider == "openrouter":
            from app.services.llm.catalog_store import IMAGE_LIMIT_PRESETS

            return dict(IMAGE_LIMIT_PRESETS.get("openrouter_image") or {})
    except Exception:
        pass
    for m in list_image_models():
        if m.get("id") == catalog_id:
            lim = m.get("imageLimits")
            if isinstance(lim, dict) and lim:
                return lim
            if str(m.get("provider") or "").lower() == "openrouter":
                try:
                    from app.services.llm.catalog_store import IMAGE_LIMIT_PRESETS

                    return dict(IMAGE_LIMIT_PRESETS.get("openrouter_image") or {})
                except Exception:
                    pass
            break
    return {
        "min_pixels": _SEEDREAM_5_MIN_PIXELS,
        "max_pixels": _SEEDREAM_MAX_PIXELS,
        "resolutions": ["2K", "3K", "4K"],
        "default_resolution": "2K",
        "supports_output_format": True,
        "transport": "doubao",
    }


def _pick_resolution(resolution: str | None, limits: dict[str, Any]) -> str:
    allowed = [
        str(x).strip().upper()
        for x in (limits.get("resolutions") or ["2K"])
        if str(x).strip()
    ] or ["2K"]
    default = str(
        limits.get("default_resolution") or allowed[0]
    ).strip().upper()
    if default not in allowed:
        default = allowed[0]
    raw = _normalize_resolution(resolution)
    # Extend normalizer for 3K.
    r0 = (resolution or "").strip().upper()
    if r0 in ("3K", "3", "3072"):
        raw = "3K"
    if raw in allowed:
        return raw
    if raw == "1K" and "1K" not in allowed:
        return default
    if raw == "3K" and "3K" not in allowed:
        return "4K" if "4K" in allowed else default
    if raw == "4K" and "4K" not in allowed:
        return "2K" if "2K" in allowed else default
    return default


def _size_for_catalog(
    aspect_ratio: str | None,
    resolution: str | None,
    limits: dict[str, Any],
) -> str:
    raw = (aspect_ratio or "1:1").strip()
    if "x" in raw.lower() and ":" not in raw:
        size = raw
    else:
        res_key = _pick_resolution(resolution, limits)
        tables = limits.get("size_tables") if isinstance(limits.get("size_tables"), dict) else {}
        table = tables.get(res_key) if isinstance(tables, dict) else None
        if isinstance(table, dict) and raw in table:
            size = str(table[raw])
        elif isinstance(table, dict) and "1:1" in table:
            # Scale from table 1:1 area for custom ratios.
            base = _parse_wxh(str(table["1:1"]))
            area = (base[0] * base[1]) if base else _RESOLUTION_BASE_AREA.get(res_key, 2048 * 2048)
            size = _size_from_area_and_aspect(int(area), raw)
        else:
            size = _size_for_aspect(aspect_ratio, res_key if res_key != "3K" else "2K")
            if res_key == "3K":
                size = _size_from_area_and_aspect(3072 * 3072, raw)
    min_px = int(limits.get("min_pixels") or _SEEDREAM_5_MIN_PIXELS)
    max_px = int(limits.get("max_pixels") or _SEEDREAM_MAX_PIXELS)
    return _clamp_seedream_size(size, min_pixels=min_px, max_pixels=max_px)


def _clamp_seedream_size(size: str, *, min_pixels: int, max_pixels: int = _SEEDREAM_MAX_PIXELS) -> str:
    """Scale WxH into Seedream total-pixel range while keeping aspect ratio."""
    parsed = _parse_wxh(size)
    if not parsed:
        return size
    w, h = parsed
    area = w * h
    if min_pixels <= area <= max_pixels:
        return f"{w}x{h}"
    target = float(min_pixels if area < min_pixels else max_pixels)
    scale = math.sqrt(target / float(area))
    nw = _round_dim(w * scale)
    nh = _round_dim(h * scale)
    # Rounding can undershoot the floor — nudge the short side.
    while nw * nh < min_pixels:
        if nw <= nh:
            nw += 16
        else:
            nh += 16
    while nw * nh > max_pixels and (nw > 16 or nh > 16):
        if nw >= nh and nw > 16:
            nw -= 16
        elif nh > 16:
            nh -= 16
        else:
            break
    return f"{nw}x{nh}"


def _optimize_prompt_options(quality: str | None) -> dict[str, str] | None:
    q = (quality or "standard").strip().lower()
    if q == "low":
        return {"mode": "fast"}
    if q in ("standard", "high"):
        return {"mode": "standard"}
    return {"mode": "standard"}


def _extract_images(payload: dict[str, Any]) -> list[str]:
    images: list[str] = []
    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if isinstance(url, str) and url.strip():
            images.append(url.strip())
            continue
        b64 = item.get("b64_json")
        if isinstance(b64, str) and b64.strip():
            media = str(item.get("media_type") or "image/png").strip() or "image/png"
            images.append(f"data:{media};base64,{b64.strip()}")
    return images


def _extract_chat_images(payload: dict[str, Any]) -> list[str]:
    """OpenRouter chat/completions image modality → data URLs / http URLs."""
    images: list[str] = []
    choices = payload.get("choices") or []
    if not isinstance(choices, list):
        return images
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        msg = choice.get("message")
        if not isinstance(msg, dict):
            continue
        for item in msg.get("images") or []:
            if not isinstance(item, dict):
                continue
            image_url = item.get("image_url")
            if isinstance(image_url, dict):
                url = image_url.get("url")
            else:
                url = item.get("url")
            if isinstance(url, str) and url.strip():
                images.append(url.strip())
        # Some providers put multimodal parts on content.
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "") not in ("image_url", "output_image", "image"):
                    continue
                image_url = part.get("image_url")
                if isinstance(image_url, dict):
                    url = image_url.get("url")
                else:
                    url = part.get("url") or part.get("image")
                if isinstance(url, str) and url.strip():
                    images.append(url.strip())
    return images


def _image_provider(catalog_id: str) -> str:
    for m in list_image_models():
        if m.get("id") == catalog_id:
            return str(m.get("provider") or "doubao").strip().lower() or "doubao"
    return "doubao"


def _max_refs_for(catalog_id: str, default: int = 14) -> int:
    for m in list_image_models():
        if m.get("id") == catalog_id:
            raw = m.get("maxAttachments")
            if isinstance(raw, int) and raw > 0:
                return raw
            break
    return default


def _normalize_or_quality(quality: str | None) -> str | None:
    q = (quality or "").strip().lower()
    if q in ("auto", "low", "medium", "high"):
        return q
    if q in ("hd", "premium", "pro"):
        return "high"
    if q in ("standard", "std", "normal"):
        return "medium"
    return None


def _normalize_or_resolution(resolution: str | None) -> str | None:
    r = (resolution or "").strip().upper().replace(" ", "")
    if r in ("512", "1K", "2K", "3K", "4K"):
        return r
    if r in ("1", "1024"):
        return "1K"
    if r in ("2", "2048"):
        return "2K"
    if r in ("3", "3072"):
        return "3K"
    if r in ("4", "4096"):
        return "4K"
    return None


def _normalize_or_aspect(aspect_ratio: str | None, limits: dict[str, Any] | None = None) -> str | None:
    raw = (aspect_ratio or "").strip()
    if not raw:
        return None
    if raw.lower() in ("smart", "auto"):
        return "auto"
    # Canvas WxH mistaken as ratio → reduce when possible.
    if "x" in raw.lower() and ":" not in raw:
        parts = raw.lower().split("x", 1)
        try:
            w, h = float(parts[0]), float(parts[1])
            if w > 0 and h > 0:
                g = math.gcd(int(round(w)), int(round(h)))
                raw = f"{int(round(w)) // g}:{int(round(h)) // g}"
        except ValueError:
            pass
    allowed = None
    if isinstance(limits, dict):
        ars = limits.get("aspect_ratios")
        if isinstance(ars, list) and ars:
            allowed = {str(x).strip() for x in ars if str(x).strip()}
    if allowed and raw not in allowed and "auto" in allowed:
        # Keep explicit ratios even if not listed when provider clamps.
        pass
    return raw


def _openrouter_uses_chat_image(api_model: str, limits: dict[str, Any] | None = None) -> bool:
    """Gemini Nano Banana family generates via chat/completions + modalities."""
    if isinstance(limits, dict) and limits.get("transport") == "openrouter_chat":
        return True
    mid = (api_model or "").strip().lower()
    return mid.startswith("google/gemini-") and "image" in mid


async def _generate_openrouter_chat_image(
    *,
    catalog_id: str,
    api_model: str,
    prompt: str,
    aspect_ratio: str | None,
    resolution: str | None,
    images: list[str] | None,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    api_key = _api_key_for("openrouter")
    if not api_key:
        raise RuntimeError(
            "No OpenRouter API key configured. Set OPENROUTER_API_KEY in apps/api/.env"
        )
    endpoint = LlmEndpoint(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        model_id=api_model,
        provider="openrouter",
    )

    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    refs = refs[: _max_refs_for(catalog_id, 14)]
    content = openai_user_content(prompt, refs or None)

    lim = limits or _catalog_image_limits(catalog_id)
    image_config: dict[str, Any] = {}
    ar = _normalize_or_aspect(aspect_ratio, lim)
    if ar:
        image_config["aspect_ratio"] = ar
    res = _pick_resolution(resolution, lim)
    if res:
        image_config["image_size"] = res

    extra_body: dict[str, Any] = {"modalities": ["image", "text"]}
    if image_config:
        extra_body["image_config"] = image_config

    # Same OpenAI client stack LangChain ChatOpenAI uses (keeps message.images).
    client, _ = build_async_openai_client(endpoint=endpoint)

    try:
        completion = await client.chat.completions.create(
            model=api_model,
            messages=[{"role": "user", "content": content}],
            extra_body=extra_body,
        )
    except Exception as err:
        raise RuntimeError(
            f"OpenRouter chat-image failed: {llm_error_detail(err)}"
        ) from err

    data = completion.model_dump() if hasattr(completion, "model_dump") else {}
    if not isinstance(data, dict):
        data = {}
    out = _extract_chat_images(data)
    if not out:
        raise RuntimeError(f"OpenRouter chat-image returned no images: {str(data)[:400]}")
    usage = data.get("usage")
    return {
        "images": out,
        "text": None,
        "model": catalog_id,
        "_usage": usage if isinstance(usage, dict) else None,
        "_response_id": (
            str(data.get("id") or data.get("request_id") or "") or None
        ),
    }


async def _generate_openrouter_image(
    *,
    catalog_id: str,
    api_model: str,
    prompt: str,
    aspect_ratio: str | None,
    quality: str | None,
    resolution: str | None,
    images: list[str] | None,
) -> dict[str, Any]:
    limits = _catalog_image_limits(catalog_id)
    if _openrouter_uses_chat_image(api_model, limits):
        return await _generate_openrouter_chat_image(
            catalog_id=catalog_id,
            api_model=api_model,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            images=images,
            limits=limits,
        )
    if not _api_key_for("openrouter"):
        raise RuntimeError(
            "No OpenRouter API key configured. Set OPENROUTER_API_KEY in apps/api/.env"
        )
    client, _endpoint = build_async_openai_client(
        provider="openrouter",
        api_model=api_model,
    )
    body: dict[str, Any] = {
        "model": api_model,
        "prompt": prompt,
    }
    if limits.get("supports_output_format", True):
        body["output_format"] = "png"
    ar = _normalize_or_aspect(aspect_ratio, limits)
    if ar:
        body["aspect_ratio"] = ar
    res = _pick_resolution(resolution, limits)
    if res:
        body["resolution"] = res
    if limits.get("supports_quality", True):
        q = _normalize_or_quality(quality)
        if q:
            body["quality"] = q
    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if refs:
        refs = refs[: _max_refs_for(catalog_id, 16)]
        # Provider /images input_references still expects OpenAI image_url parts;
        # assemble via LangChain blocks then strip text.
        wire = openai_user_content("", refs)
        if isinstance(wire, list):
            body["input_references"] = [
                p
                for p in wire
                if isinstance(p, dict) and str(p.get("type") or "") == "image_url"
            ]
        else:
            body["input_references"] = [
                {"type": "image_url", "image_url": {"url": u}} for u in refs
            ]

    try:
        data = await openai_json_post(client, "/images", body)
    except Exception as err:
        raise RuntimeError(
            f"OpenRouter image failed: {llm_error_detail(err)}"
        ) from err

    out = _extract_images(data if isinstance(data, dict) else {})
    if not out:
        raise RuntimeError(f"OpenRouter image returned no images: {str(data)[:400]}")
    usage = data.get("usage") if isinstance(data, dict) else None
    return {
        "images": out,
        "text": None,
        "model": catalog_id,
        "_usage": usage if isinstance(usage, dict) else None,
        "_response_id": (
            str(data.get("id") or data.get("request_id") or "")
            if isinstance(data, dict)
            else ""
        )
        or None,
    }


# OpenAI gpt-image-1 only accepts a fixed size set; map aspect → nearest.
_OPENAI_IMAGE_SIZES: dict[str, str] = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "16:9": "1536x1024",
    "4:3": "1536x1024",
    "2:3": "1024x1536",
    "9:16": "1024x1536",
    "3:4": "1024x1536",
}


def _byok_image_transport(base_url: str) -> str:
    """Infer the images API size contract from the provider host.

    ``openai_image`` = fixed OpenAI size set (gpt-image-1 / DALL·E set).
    ``ark_image`` = arbitrary WxH (Volcengine Ark / Doubao and most aggregators).
    """
    host = (base_url or "").strip().lower()
    if "api.openai.com" in host or "openai.azure" in host:
        return "openai_image"
    return "ark_image"


def _openai_image_size(aspect_ratio: str | None) -> str:
    raw = (aspect_ratio or "1:1").strip()
    if "x" in raw.lower() and ":" not in raw:
        return raw
    return _OPENAI_IMAGE_SIZES.get(raw, "1024x1024")


def _byok_ark_limits() -> dict[str, Any]:
    """Generic arbitrary-WxH limits for BYOK Ark-style image providers."""
    return {
        "resolutions": ["1K", "2K", "4K"],
        "default_resolution": "2K",
        "size_tables": _RESOLUTION_TABLES,
        "min_pixels": _SEEDREAM_5_MIN_PIXELS,
        "max_pixels": _SEEDREAM_MAX_PIXELS,
        "supports_output_format": False,
    }


async def _generate_byok_image(
    *,
    endpoint: LlmEndpoint,
    prompt: str,
    aspect_ratio: str | None,
    quality: str | None,
    resolution: str | None,
    images: list[str] | None,
) -> dict[str, Any]:
    """Generate via a user's BYOK OpenAI-style ``images.generate`` endpoint.

    Uses the user's own key/quota — never platform credits.
    """
    transport = _byok_image_transport(endpoint.base_url)
    api_model = endpoint.model_id
    client, _ep = build_async_openai_client(endpoint=endpoint)

    kwargs: dict[str, Any] = {
        "model": api_model,
        "prompt": prompt,
        "response_format": "url",
    }
    if transport == "openai_image":
        kwargs["size"] = _openai_image_size(aspect_ratio)
    else:
        kwargs["size"] = _size_for_catalog(aspect_ratio, resolution, _byok_ark_limits())

    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if refs:
        kwargs["extra_body"] = {"image": refs[0] if len(refs) == 1 else refs}

    try:
        result = await client.images.generate(**kwargs)
    except Exception as err:
        # Some endpoints reject response_format — retry without it once.
        detail = llm_error_detail(err).lower()
        if "response_format" in detail or "unknown parameter" in detail:
            kwargs.pop("response_format", None)
            try:
                result = await client.images.generate(**kwargs)
            except Exception as err2:
                raise RuntimeError(
                    f"BYOK image failed: {llm_error_detail(err2)}"
                ) from err2
        else:
            raise RuntimeError(f"BYOK image failed: {llm_error_detail(err)}") from err

    data = result.model_dump() if hasattr(result, "model_dump") else {}
    if not isinstance(data, dict):
        data = {}
    out = _extract_images(data)
    if not out:
        raise RuntimeError(f"BYOK image returned no images: {str(data)[:400]}")
    return {
        "images": out,
        "text": None,
        "model": f"byok:{api_model}",
        "_provider": "byok",
        "_api_model": api_model,
    }


async def _generate_image_core(
    *,
    prompt: str,
    model: str | None = None,
    aspect_ratio: str | None = None,
    quality: str | None = None,
    resolution: str | None = None,
    images: list[str] | None = None,
) -> dict[str, Any]:
    """
    Provider dispatch (BYOK / Doubao / OpenRouter) — used by LangChain image tool.

    Usage is logged only via LangChain tool callbacks on ``image_chain.ainvoke``.
    Private ``_usage`` / ``_response_id`` / ``_provider`` / ``_api_model`` keys
    stay on the dict for the callback, then are stripped by ``generate_image``.
    """
    from app.services.llm import get_llm_endpoint
    from app.services.security import parse_byok_model_ref

    if parse_byok_model_ref(model):
        # Custom provider — resolve the user's endpoint from the BYOK vault.
        endpoint = get_llm_endpoint(model)
        return await _generate_byok_image(
            endpoint=endpoint,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            quality=quality,
            resolution=resolution,
            images=images,
        )

    catalog_id = resolve_image_model(model)
    api_model = _api_model_id(catalog_id)
    provider = _image_provider(catalog_id)
    if provider == "openrouter":
        result = await _generate_openrouter_image(
            catalog_id=catalog_id,
            api_model=api_model,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            quality=quality,
            resolution=resolution,
            images=images,
        )
    else:
        result = await _generate_doubao_image(
            catalog_id=catalog_id,
            api_model=api_model,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            quality=quality,
            resolution=resolution,
            images=images,
        )
    if isinstance(result, dict):
        result.setdefault("_provider", provider)
        result.setdefault("_api_model", api_model)
    return result


def _build_image_chain():
    """LangChain StructuredTool — Agent / hydrate / API all go through this.

    Convention: function ``__name__`` / ``__doc__`` + Pydantic ``args_schema``.
    """
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field

    class ImageGenerateInput(BaseModel):
        prompt: str = Field(description="Image generation prompt")
        model: str | None = Field(default=None, description="Catalog image model id")
        aspect_ratio: str | None = Field(default=None)
        quality: str | None = Field(default=None)
        resolution: str | None = Field(default=None)
        images: list[str] | None = Field(
            default=None, description="Optional reference image URLs"
        )

    async def generate_image(
        prompt: str,
        model: str | None = None,
        aspect_ratio: str | None = None,
        quality: str | None = None,
        resolution: str | None = None,
        images: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate an image via configured providers (Doubao Seedream / OpenRouter).

        Returns {images, text, model}.
        """
        return await _generate_image_core(
            prompt=prompt,
            model=model,
            aspect_ratio=aspect_ratio,
            quality=quality,
            resolution=resolution,
            images=images,
        )

    return StructuredTool.from_function(
        coroutine=generate_image,
        args_schema=ImageGenerateInput,
    )


image_chain = _build_image_chain()


async def generate_image(
    *,
    prompt: str,
    model: str | None = None,
    aspect_ratio: str | None = None,
    quality: str | None = None,
    resolution: str | None = None,
    images: list[str] | None = None,
) -> dict[str, Any]:
    """
    Generate images via LangChain ``image_chain`` (Doubao / OpenRouter).
    Optional ``images`` enables image-to-image when the provider supports it.
    Usage logged only via LangChain tool callbacks.
    """
    from app.services.llm import usage_callback_handler

    handler = usage_callback_handler(source="image", kind="tool")
    result = await image_chain.ainvoke(
        {
            "prompt": prompt,
            "model": model,
            "aspect_ratio": aspect_ratio,
            "quality": quality,
            "resolution": resolution,
            "images": images,
        },
        config={"callbacks": [handler]},
    )
    if isinstance(result, dict):
        return {
            k: v
            for k, v in result.items()
            if not (isinstance(k, str) and k.startswith("_"))
        }
    raise RuntimeError(f"image_chain returned unexpected type: {type(result)!r}")


async def _generate_doubao_image(
    *,
    catalog_id: str,
    api_model: str,
    prompt: str,
    aspect_ratio: str | None,
    quality: str | None,
    resolution: str | None,
    images: list[str] | None,
) -> dict[str, Any]:
    if not _api_key_for("doubao"):
        raise RuntimeError(
            "No Doubao API key configured. Set DOUBAO_API_KEY (or LLM_API_KEY) in apps/api/.env"
        )

    client, _endpoint = build_async_openai_client(
        provider="doubao",
        api_model=api_model,
    )
    limits = _catalog_image_limits(catalog_id)
    size = _size_for_catalog(aspect_ratio, resolution, limits)

    extra_body: dict[str, Any] = {"watermark": False}
    opt = _optimize_prompt_options(quality)
    if opt:
        extra_body["optimize_prompt_options"] = opt
    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if refs:
        refs = refs[: _max_refs_for(catalog_id, 14)]
        extra_body["image"] = refs[0] if len(refs) == 1 else refs

    use_output_format = bool(limits.get("supports_output_format", True))
    kwargs: dict[str, Any] = {
        "model": api_model,
        "prompt": prompt,
        "size": size,
        "response_format": "url",
        "extra_body": extra_body,
    }
    if use_output_format:
        kwargs["output_format"] = "png"

    try:
        result = await client.images.generate(**kwargs)
    except Exception as err:
        detail = llm_error_detail(err).lower()
        if use_output_format and any(
            k in detail
            for k in (
                "output_format",
                "output format",
                "unknown parameter",
                "unsupported",
                "invalid parameter",
                "not support",
            )
        ):
            kwargs.pop("output_format", None)
            try:
                result = await client.images.generate(**kwargs)
            except Exception as err2:
                raise RuntimeError(
                    f"Image generation failed: {llm_error_detail(err2)}"
                ) from err2
        else:
            raise RuntimeError(
                f"Image generation failed: {llm_error_detail(err)}"
            ) from err

    data = result.model_dump() if hasattr(result, "model_dump") else {}
    if not isinstance(data, dict):
        data = {}
    out = _extract_images(data)
    if not out:
        raise RuntimeError(f"Image generation returned no images: {str(data)[:400]}")

    usage = data.get("usage")
    return {
        "images": out,
        "text": None,
        "model": catalog_id,
        "_usage": usage if isinstance(usage, dict) else None,
        "_response_id": (
            str(data.get("id") or data.get("request_id") or "") or None
        ),
    }
