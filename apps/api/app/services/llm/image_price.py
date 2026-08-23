"""Image list-price (CNY / image) — Ark and OpenRouter use separate formulas.

Ark (Doubao Seedream)
  - Vendor bills 元/张 (docs 82379/1544106).
  - Pro may use a high-pixel tier (>2.36M px → higher 元/张).
  - Resolution chips only select size; price does NOT use pixel÷256 tokens.

OpenRouter
  - Prefer endpoint unit: flat per image, or output_image_token × fixed tokens.
  - Gemini Nano Banana / Pro Image: fixed tokens by resolution tier
    (1K/2K → 1120, 4K → 2000), never area/256.
"""

from __future__ import annotations

import math
from typing import Any

_RES_AREA: dict[str, int] = {
    "512": 512 * 512,
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "3K": 3072 * 3072,
    "4K": 4096 * 4096,
}

# Google Gemini native image output tokens (Nano Banana / Pro Image).
_GEMINI_OUTPUT_TOKENS: dict[str, int] = {
    "512": 1120,
    "1K": 1120,
    "2K": 1120,
    "3K": 2000,
    "4K": 2000,
}

DEFAULT_IMAGE_RESOLUTION = "2K"
DEFAULT_USD_CNY = 7.2


def normalize_resolution(raw: str | None) -> str:
    r = str(raw or "").strip().upper().replace(" ", "")
    if r in _RES_AREA:
        return r
    return DEFAULT_IMAGE_RESOLUTION


def parse_price_amount(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        n = float(s.split()[0])
    except (TypeError, ValueError, IndexError):
        return None
    return n if math.isfinite(n) and n >= 0 else None


def default_gemini_token_by_resolution() -> dict[str, int]:
    return dict(_GEMINI_OUTPUT_TOKENS)


def estimate_openrouter_output_tokens(
    resolution: str | None,
    *,
    token_by_resolution: dict[str, Any] | None = None,
) -> int:
    """OpenRouter / Gemini image output tokens for one image (fixed tiers)."""
    res = normalize_resolution(resolution)
    if isinstance(token_by_resolution, dict) and token_by_resolution:
        raw = token_by_resolution.get(res)
        try:
            n = int(raw) if raw is not None else 0
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return n
    return int(_GEMINI_OUTPUT_TOKENS.get(res, _GEMINI_OUTPUT_TOKENS[DEFAULT_IMAGE_RESOLUTION]))



def price_by_resolution_map(meta: dict[str, Any] | None) -> dict[str, float]:
    if not isinstance(meta, dict):
        return {}
    raw = meta.get("price_by_resolution_cny")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for k, v in raw.items():
        n = parse_price_amount(v)
        if n is not None:
            out[str(k).strip().upper()] = n
    return out


def _provider_kind(
    provider: str | None,
    price_meta: dict[str, Any] | None,
) -> str:
    """Return 'openrouter' | 'ark' | 'other'."""
    meta = price_meta if isinstance(price_meta, dict) else {}
    src = str(meta.get("source") or "").lower()
    if src == "openrouter" or src.startswith("openrouter"):
        return "openrouter"
    if src in ("ark_docs", "ark", "doubao"):
        return "ark"
    prov = (provider or "").strip().lower()
    if prov == "openrouter":
        return "openrouter"
    if prov in ("doubao", "ark", "volcengine", "火山", "方舟"):
        return "ark"
    unit = str(meta.get("unit") or "").lower()
    if "token" in unit:
        return "openrouter"
    return "other"


def resolve_ark_image_unit_cny(
    *,
    price: Any,
    price_meta: dict[str, Any] | None = None,
    resolution: str | None = None,
) -> float | None:
    """方舟 Seedream：按张计费；Pro 可按总像素档切换单价。"""
    meta = price_meta if isinstance(price_meta, dict) else {}
    res = normalize_resolution(
        resolution or meta.get("base_resolution") or DEFAULT_IMAGE_RESOLUTION
    )

    out_lo = parse_price_amount(meta.get("output_image"))
    out_hi = parse_price_amount(meta.get("output_image_high"))
    thr = meta.get("high_pixels_threshold")
    try:
        thr_n = int(thr) if thr is not None else 0
    except (TypeError, ValueError):
        thr_n = 0
    if out_lo is not None and out_hi is not None and thr_n > 0:
        area = _RES_AREA.get(res, _RES_AREA[DEFAULT_IMAGE_RESOLUTION])
        return out_hi if area > thr_n else out_lo

    if out_lo is not None:
        return out_lo

    return parse_price_amount(price)


def resolve_openrouter_image_unit_cny(
    *,
    price: Any,
    price_meta: dict[str, Any] | None = None,
    resolution: str | None = None,
) -> float | None:
    """OpenRouter：flat 元/张，或 output_image_token × 固定档 tokens。"""
    meta = price_meta if isinstance(price_meta, dict) else {}
    res = normalize_resolution(
        resolution or meta.get("base_resolution") or DEFAULT_IMAGE_RESOLUTION
    )

    by_res = price_by_resolution_map(meta)
    if res in by_res:
        return by_res[res]

    unit = str(meta.get("unit") or "").lower()
    usd_tok = meta.get("usd_per_output_token")
    try:
        usd_tok_f = float(usd_tok) if usd_tok is not None else None
    except (TypeError, ValueError):
        usd_tok_f = None

    if usd_tok_f and usd_tok_f > 0 and "token" in unit:
        fx = float(meta.get("fx_usd_cny") or DEFAULT_USD_CNY)
        if not math.isfinite(fx) or fx <= 0:
            fx = DEFAULT_USD_CNY
        tok_map = meta.get("token_by_resolution")
        tokens = estimate_openrouter_output_tokens(
            res,
            token_by_resolution=tok_map if isinstance(tok_map, dict) else None,
        )
        return round(tokens * usd_tok_f * fx, 6)

    if unit == "image" or meta.get("usd") is not None:
        return parse_price_amount(price)

    return parse_price_amount(price)


def resolve_image_unit_cny(
    *,
    price: Any,
    price_meta: dict[str, Any] | None = None,
    resolution: str | None = None,
    provider: str | None = None,
) -> float | None:
    """Dispatch Ark vs OpenRouter image unit price (CNY / image)."""
    kind = _provider_kind(provider, price_meta)
    if kind == "openrouter":
        return resolve_openrouter_image_unit_cny(
            price=price, price_meta=price_meta, resolution=resolution
        )
    if kind == "ark":
        return resolve_ark_image_unit_cny(
            price=price, price_meta=price_meta, resolution=resolution
        )
    # Unknown provider: prefer explicit OR token meta, else flat catalog price.
    meta = price_meta if isinstance(price_meta, dict) else {}
    unit = str(meta.get("unit") or "").lower()
    if "token" in unit:
        return resolve_openrouter_image_unit_cny(
            price=price, price_meta=price_meta, resolution=resolution
        )
    return resolve_ark_image_unit_cny(
        price=price, price_meta=price_meta, resolution=resolution
    )


def build_token_price_by_resolution_cny(
    usd_per_token: float,
    *,
    fx: float = DEFAULT_USD_CNY,
    token_by_resolution: dict[str, int] | None = None,
) -> dict[str, float]:
    """OpenRouter-only helper: build 1K/2K/4K CNY map from token rate."""
    tok_map = token_by_resolution or dict(_GEMINI_OUTPUT_TOKENS)
    out: dict[str, float] = {}
    for res in _RES_AREA:
        tokens = estimate_openrouter_output_tokens(res, token_by_resolution=tok_map)
        out[res] = round(tokens * float(usd_per_token) * float(fx), 4)
    return out
