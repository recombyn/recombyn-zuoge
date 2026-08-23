"""Sync catalog list prices from providers.

- OpenRouter: live ``/models`` + ``/images/models`` pricing APIs.
- Doubao Ark: no public price-list API — apply curated snapshot from docs
  82379/1544106 (``services.llm.ark_prices``).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.services.llm import PROVIDER_BASE_URLS, _api_key_for
from app.services.llm.catalog_store import list_admin_models, upsert_model
from app.services.llm.image_price import (
    DEFAULT_IMAGE_RESOLUTION,
    build_token_price_by_resolution_cny,
    default_gemini_token_by_resolution,
    estimate_openrouter_output_tokens,
)

# Align with usage_log OpenRouter USD→CNY for admin P&L.
_USD_CNY = 7.2


def _f(raw: Any) -> float | None:
    try:
        if raw is None or raw == "":
            return None
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return n


def _usd_to_cny(usd: float) -> float:
    return round(float(usd) * _USD_CNY, 6)


def _fmt_cny(n: float, *, digits: int = 4) -> str:
    s = f"{n:.{digits}f}".rstrip("0").rstrip(".")
    return s or "0"


def _pick_image_billing(
    pricing: dict[str, Any] | None, endpoints: list[dict[str, Any]] | None
) -> dict[str, Any] | None:
    """Return {mode: per_image|per_token, usd: ...} from Images endpoints."""
    per_image: float | None = None
    per_token: float | None = None

    def _scan_lines(lines: Any) -> None:
        nonlocal per_image, per_token
        if not isinstance(lines, list):
            return
        for line in lines:
            if not isinstance(line, dict):
                continue
            billable = str(line.get("billable") or "").lower()
            unit = str(line.get("unit") or "").lower()
            c = _f(line.get("cost_usd") if "cost_usd" in line else line.get("cost"))
            if c is None or c <= 0:
                continue
            if unit == "image" or (
                billable in ("output_image", "image_output", "image") and unit != "token"
            ):
                if per_image is None:
                    per_image = c
            elif unit == "token" and billable in (
                "output_image",
                "image_output",
                "completion",
                "output",
            ):
                if per_token is None:
                    per_token = c

    if isinstance(endpoints, list):
        for ep in endpoints:
            if isinstance(ep, dict):
                _scan_lines(ep.get("pricing"))

    if isinstance(pricing, dict):
        # Legacy flat fields are usually per-image USD (not per-token).
        for key in ("image_output", "imageOutput", "image", "request"):
            c = _f(pricing.get(key))
            if c is not None and c > 0 and per_image is None and c >= 0.001:
                per_image = c

    if per_image is not None:
        return {"mode": "per_image", "usd": per_image}
    if per_token is not None:
        return {"mode": "per_token", "usd_per_output_token": per_token}
    return None


def _pick_text_usd_per_mtok(pricing: dict[str, Any] | None) -> float | None:
    """USD per 1M prompt tokens → used as catalog 元/百万tokens after FX."""
    if not isinstance(pricing, dict):
        return None
    prompt = _f(pricing.get("prompt"))
    if prompt is None:
        return None
    # OpenRouter: USD per token
    return prompt * 1_000_000.0


def _fetch_openrouter_catalog() -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Return (models_by_id, image_endpoints_by_id)."""
    api_key = _api_key_for("openrouter")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    base = PROVIDER_BASE_URLS["openrouter"].rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    models_by_id: dict[str, dict[str, Any]] = {}
    endpoints_by_id: dict[str, list[dict[str, Any]]] = {}
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        resp = client.get(f"{base}/models", headers=headers, params={"output_modalities": "all"})
        if resp.status_code >= 400:
            # Older query may reject output_modalities — retry bare list.
            resp = client.get(f"{base}/models", headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"OpenRouter /models HTTP {resp.status_code}: {(resp.text or '')[:400]}")
        data = resp.json() if resp.content else {}
        for m in data.get("data") or []:
            if isinstance(m, dict) and m.get("id"):
                models_by_id[str(m["id"])] = m

        img = client.get(f"{base}/images/models", headers=headers)
        if img.status_code < 400:
            payload = img.json() if img.content else {}
            for m in payload.get("data") or []:
                if not isinstance(m, dict) or not m.get("id"):
                    continue
                mid = str(m["id"])
                models_by_id.setdefault(mid, m)
                # Per-endpoint pricing (definitive for image gen).
                ep_url = m.get("endpoints")
                if isinstance(ep_url, str) and ep_url.startswith("http"):
                    url = ep_url
                else:
                    url = f"{base}/images/models/{mid}/endpoints"
                try:
                    er = client.get(url, headers=headers)
                    if er.status_code < 400:
                        edata = er.json() if er.content else {}
                        eps = edata.get("endpoints") if isinstance(edata, dict) else None
                        if isinstance(eps, list):
                            endpoints_by_id[mid] = [e for e in eps if isinstance(e, dict)]
                except Exception:
                    pass
    return models_by_id, endpoints_by_id


def sync_openrouter_catalog_prices(*, only_empty: bool = False) -> dict[str, Any]:
    """
    Overwrite OpenRouter catalog ``price`` from live OpenRouter pricing.

    - Image models: CNY per image (USD×FX)
    - Text models: CNY per 1M prompt tokens (USD/token×1e6×FX)
    """
    models_by_id, endpoints_by_id = _fetch_openrouter_catalog()
    rows = list_admin_models()
    updated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    now = int(time.time())

    for row in rows:
        if str(row.get("provider") or "").lower() != "openrouter":
            continue
        api_model = str(row.get("apiModel") or "").strip()
        if not api_model:
            skipped.append({"id": row.get("id"), "reason": "no api_model"})
            continue
        if only_empty and str(row.get("price") or "").strip():
            skipped.append({"id": row.get("id"), "reason": "price_set"})
            continue
        remote = models_by_id.get(api_model)
        if not remote:
            skipped.append({"id": row.get("id"), "reason": "not_on_openrouter", "apiModel": api_model})
            continue

        kind = str(row.get("kind") or "text").lower()
        pricing = remote.get("pricing") if isinstance(remote.get("pricing"), dict) else None
        endpoints = endpoints_by_id.get(api_model)

        price_meta: dict[str, Any]
        if kind == "image" or "image" in (row.get("referenceTypes") or []):
            bill = _pick_image_billing(pricing, endpoints)
            if bill is None:
                skipped.append({"id": row.get("id"), "reason": "no_image_price", "apiModel": api_model})
                continue
            if bill.get("mode") == "per_token":
                usd_tok = float(bill["usd_per_output_token"])
                tok_map = default_gemini_token_by_resolution()
                by_res = build_token_price_by_resolution_cny(
                    usd_tok, fx=_USD_CNY, token_by_resolution=tok_map
                )
                base_cny = by_res.get(DEFAULT_IMAGE_RESOLUTION) or by_res.get("2K") or 0.0
                price_str = _fmt_cny(base_cny, digits=4)
                unit = "output_image_token"
                usd_raw = usd_tok
                base_tok = estimate_openrouter_output_tokens(
                    DEFAULT_IMAGE_RESOLUTION, token_by_resolution=tok_map
                )
                price_meta = {
                    "source": "openrouter",
                    "currency": "CNY",
                    "unit": "output_image_token",
                    "usd_per_output_token": usd_tok,
                    "base_resolution": DEFAULT_IMAGE_RESOLUTION,
                    "token_by_resolution": tok_map,
                    "price_by_resolution_cny": by_res,
                    "fx_usd_cny": _USD_CNY,
                    "synced_at": now,
                    "note": (
                        "Gemini 生图按固定 output tokens 估算"
                        f"（{DEFAULT_IMAGE_RESOLUTION}≈{base_tok} tokens），非像素/256"
                    ),
                }
            else:
                usd = float(bill["usd"])
                cny = _usd_to_cny(usd)
                price_str = _fmt_cny(cny, digits=4)
                unit = "image"
                usd_raw = usd
                price_meta = {
                    "source": "openrouter",
                    "currency": "CNY",
                    "unit": "image",
                    "usd": usd_raw,
                    "fx_usd_cny": _USD_CNY,
                    "synced_at": now,
                }
        else:
            usd_mtok = _pick_text_usd_per_mtok(pricing)
            if usd_mtok is None:
                skipped.append({"id": row.get("id"), "reason": "no_text_price", "apiModel": api_model})
                continue
            cny = _usd_to_cny(usd_mtok)
            price_str = _fmt_cny(cny, digits=4)
            unit = "prompt_mtok"
            usd_raw = usd_mtok
            price_meta = {
                "source": "openrouter",
                "currency": "CNY",
                "unit": unit,
                "usd": usd_raw,
                "fx_usd_cny": _USD_CNY,
                "synced_at": now,
            }

        payload = {
            "id": row["id"],
            "label": row.get("label") or row["id"],
            "kind": kind if kind in ("text", "image") else "text",
            "referenceTypes": row.get("referenceTypes") or ["text"],
            "provider": "openrouter",
            "apiModel": api_model,
            "description": row.get("description"),
            "iconKey": row.get("iconKey"),
            "iconUrl": row.get("iconUrl"),
            "price": price_str,
            "maxAttachments": int(row.get("maxAttachments") or 8),
            "thinking": bool(row.get("thinking")),
            "enabled": bool(row.get("enabled", True)),
            "sortOrder": int(row.get("sortOrder") or 100),
            "imageLimits": row.get("imageLimits"),
            "priceMeta": price_meta,
        }
        item = upsert_model(payload)
        try:
            from app.services.llm.pricing_registry import record_sync_draft
            from recombyn_protocol.billing import money_to_micros

            rates: list[dict] = []
            if isinstance(usd_raw, (int, float)) and float(usd_raw) > 0:
                rates.append(
                    {
                        "metric": "input_tokens",
                        "unit": "per_1m_tokens",
                        "amount_micros": money_to_micros(usd_raw),
                        "currency": "USD",
                    }
                )
            out_usd = price_meta.get("usd_per_output_token")
            if isinstance(out_usd, (int, float)) and float(out_usd) > 0:
                rates.append(
                    {
                        "metric": "output_tokens",
                        "unit": "per_1m_tokens",
                        "amount_micros": money_to_micros(out_usd),
                        "currency": "USD",
                    }
                )
            if rates:
                record_sync_draft(
                    model_id=str(item.get("id") or ""),
                    provider="openrouter",
                    currency="USD",
                    rates=rates,
                    source="openrouter",
                    notes="openrouter sync → pending_review",
                )
        except Exception:
            pass
        updated.append(
            {
                "id": item.get("id"),
                "price": item.get("price"),
                "unit": unit,
                "usd": usd_raw,
            }
        )

    return {
        "provider": "openrouter",
        "updated": updated,
        "skipped": skipped,
        "fx_usd_cny": _USD_CNY,
        "remote_models": len(models_by_id),
    }


def sync_ark_catalog_prices(*, only_empty: bool = False) -> dict[str, Any]:
    """Apply curated Ark docs reference prices to known catalog ids.

    Admin sync defaults to overwrite; boot path uses ``only_empty=True``.
    """
    from app.services.llm.catalog_store import apply_ark_reference_prices

    result = apply_ark_reference_prices(only_empty=only_empty)
    return {
        "provider": "ark",
        "updated": [{"id": mid} for mid in result.get("updated") or []],
        "skipped": [{"id": mid, "reason": "skipped"} for mid in result.get("skipped") or []],
        "updated_count": int(result.get("updated_count") or 0),
        "source": "ark_docs",
        "doc": "82379/1544106",
        "only_empty": only_empty,
    }
