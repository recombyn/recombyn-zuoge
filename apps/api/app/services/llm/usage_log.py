"""Per-call model usage ledger — every LLM / image provider hit is recorded.

Stores the full provider ``usage`` blob plus normalized token/cost fields so Admin
can aggregate by model. Never raises into the request path.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from typing import Any, Iterator

from app.services.db import init_schema

_log = logging.getLogger("llm.usage_log")

_TABLE_READY = False
_USAGE_WRITE_LOCK = threading.Lock()

# OpenRouter ``usage.cost`` is USD; convert for Admin CNY P&L.
_USD_CNY = 7.2


def _credits_to_revenue_cny(credits: Any) -> float | None:
    """Wallet 积分 face value → CNY (Plus ¥49 / 340 积分)."""
    try:
        n = float(credits)
    except Exception:
        return None
    if not math.isfinite(n) or n < 0:
        return None
    try:
        from app.services.wallet.billing import credits_per_cny

        rate = float(credits_per_cny())
        if rate <= 0:
            return None
        return round(n / rate, 6)
    except Exception:
        return round(n * 29.0 / 200.0, 6)


def _actual_cost_cny(
    cost_raw: Any,
    *,
    provider: str | None = None,
    meta: dict[str, Any] | None = None,
) -> float | None:
    """Normalize stored cost to CNY (OpenRouter USD → CNY)."""
    try:
        if cost_raw is None or cost_raw == "":
            return None
        n = float(cost_raw)
    except Exception:
        return None
    if not math.isfinite(n) or n < 0:
        return None
    prov = (provider or "").strip().lower()
    meta = meta or {}
    currency = str(meta.get("cost_currency") or "").lower()
    # Only FX when explicitly USD / OpenRouter. Domestic providers keep CNY as-is.
    if currency == "cny":
        return round(n, 6)
    if currency == "usd" or prov == "openrouter":
        n = n * _USD_CNY
    return round(n, 6)


def _profit_cny(revenue: float | None, actual_cost: float | None) -> float | None:
    if revenue is None or actual_cost is None:
        return None
    return round(float(revenue) - float(actual_cost), 6)


def _money_fields(
    *,
    credits: Any,
    cost_raw: Any,
    provider: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, float | None]:
    revenue = _credits_to_revenue_cny(credits)
    actual = _actual_cost_cny(cost_raw, provider=provider, meta=meta)
    return {
        "revenueCny": revenue,
        "actualCostCny": actual,
        "profitCny": _profit_cny(revenue, actual),
    }


@dataclass
class UsageContext:
    user_id: str | None = None
    task_id: str | None = None
    source: str = "unknown"
    credits_charged: int | None = None
    meta: dict[str, Any] = field(default_factory=dict)


_CTX: ContextVar[UsageContext | None] = ContextVar("model_usage_ctx", default=None)


def get_usage_context() -> UsageContext | None:
    return _CTX.get()


def bind_usage_context(
    *,
    user_id: str | None = None,
    task_id: str | None = None,
    source: str | None = None,
    credits_charged: int | None = None,
    meta: dict[str, Any] | None = None,
) -> UsageContext:
    """Set request-scoped identity (asyncio Task-local; no exit needed)."""
    prev = _CTX.get()
    base = prev or UsageContext()
    nxt = replace(
        base,
        user_id=user_id if user_id is not None else base.user_id,
        task_id=task_id if task_id is not None else base.task_id,
        source=source if source is not None else base.source,
        credits_charged=(
            credits_charged if credits_charged is not None else base.credits_charged
        ),
        meta={**(base.meta or {}), **(meta or {})},
    )
    _CTX.set(nxt)
    return nxt


@contextmanager
def usage_context(
    *,
    user_id: str | None = None,
    task_id: str | None = None,
    source: str | None = None,
    credits_charged: int | None = None,
    meta: dict[str, Any] | None = None,
) -> Iterator[UsageContext]:
    """Bind caller identity for nested LLM / image calls."""
    prev = _CTX.get()
    base = prev or UsageContext()
    nxt = replace(
        base,
        user_id=user_id if user_id is not None else base.user_id,
        task_id=task_id if task_id is not None else base.task_id,
        source=source if source is not None else base.source,
        credits_charged=(
            credits_charged if credits_charged is not None else base.credits_charged
        ),
        meta={**(base.meta or {}), **(meta or {})},
    )
    token = _CTX.set(nxt)
    try:
        yield nxt
    finally:
        _CTX.reset(token)


def ensure_model_usage_table(conn: Any | None = None, *, mysql: bool | None = None) -> None:
    """Ensure ``model_usage`` exists via Alembic (``init_schema``)."""
    global _TABLE_READY
    if _TABLE_READY and conn is None:
        return
    del mysql  # signature kept for callers
    try:
        init_schema()
        _TABLE_READY = True
    except Exception:
        _log.exception("ensure_model_usage_table failed")


def _as_int(v: Any) -> int | None:
    try:
        if v is None or v == "":
            return None
        n = int(v)
        return n if n >= 0 else None
    except Exception:
        return None


def _as_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except Exception:
        return None


def parse_usage_fields(usage: Any) -> dict[str, Any]:
    """Normalize OpenAI/Ark/OpenRouter usage objects into flat columns."""
    out: dict[str, Any] = {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
        "cached_tokens": None,
        "reasoning_tokens": None,
        "cost_cny": None,
        "image_count": None,
    }
    if not isinstance(usage, dict):
        return out

    out["prompt_tokens"] = _as_int(
        usage.get("prompt_tokens")
        if usage.get("prompt_tokens") is not None
        else usage.get("input_tokens")
    )
    out["completion_tokens"] = _as_int(
        usage.get("completion_tokens")
        if usage.get("completion_tokens") is not None
        else usage.get("output_tokens")
    )
    out["total_tokens"] = _as_int(
        usage.get("total_tokens")
        if usage.get("total_tokens") is not None
        else usage.get("total")
    )

    # Nested detail bags (OpenAI / Ark variants).
    for bag_key in (
        "prompt_tokens_details",
        "input_tokens_details",
        "prompt_token_details",
    ):
        bag = usage.get(bag_key)
        if isinstance(bag, dict):
            cached = _as_int(bag.get("cached_tokens") or bag.get("cache_tokens"))
            if cached is not None:
                out["cached_tokens"] = cached
            break
    for bag_key in (
        "completion_tokens_details",
        "output_tokens_details",
    ):
        bag = usage.get(bag_key)
        if isinstance(bag, dict):
            reason = _as_int(
                bag.get("reasoning_tokens")
                or bag.get("reasoning_token_count")
                or bag.get("reasoning")
            )
            if reason is not None:
                out["reasoning_tokens"] = reason
            break

    if out["cached_tokens"] is None:
        out["cached_tokens"] = _as_int(
            usage.get("cached_tokens") or usage.get("cache_tokens")
        )
    if out["reasoning_tokens"] is None:
        out["reasoning_tokens"] = _as_int(
            usage.get("reasoning_tokens") or usage.get("reasoning_token_count")
        )

    # Cost: OpenRouter `usage.cost` (USD) or Ark CNY fields when present.
    cost = None
    for key in ("cost", "total_cost", "cost_usd", "usd"):
        cost = _as_float(usage.get(key))
        if cost is not None:
            # OpenRouter documents cost in USD — store as CNY estimate ×7.2 if USD-ish
            # and no explicit currency. Prefer raw number in cost_cny when provider
            # already uses CNY (Ark). Tag currency in meta via caller if needed.
            out["cost_cny"] = cost
            out["_cost_raw"] = cost
            out["_cost_key"] = key
            break
    if cost is None:
        costs = usage.get("costs")
        if isinstance(costs, dict):
            for key in ("total", "total_cost", "cny", "usd"):
                cost = _as_float(costs.get(key))
                if cost is not None:
                    out["cost_cny"] = cost
                    out["_cost_raw"] = cost
                    out["_cost_key"] = f"costs.{key}"
                    break

    # Image-generation usage variants.
    gen = usage.get("generated_images") or usage.get("image_count") or usage.get("n")
    out["image_count"] = _as_int(gen)

    if out["total_tokens"] is None:
        p = out["prompt_tokens"] or 0
        c = out["completion_tokens"] or 0
        if p or c:
            out["total_tokens"] = p + c

    return out


def estimate_image_cost_cny(catalog_model_id: str | None, image_count: int = 1) -> float | None:
    """Catalog 元/张 × count when provider did not return a cost."""
    try:
        from app.services.wallet.billing import parse_price_amount
        from app.services.llm import list_llm_models

        mid = (catalog_model_id or "").strip()
        if not mid:
            return None
        for m in list_llm_models() or []:
            if str(m.get("id") or "") == mid:
                price = parse_price_amount(m.get("price"))
                if price is not None and price > 0:
                    return float(price) * max(1, int(image_count or 1))
                break
    except Exception:
        pass
    return None


def record_model_usage(
    *,
    source: str | None = None,
    provider: str | None = None,
    catalog_model_id: str | None = None,
    api_model: str | None = None,
    status: str = "ok",
    latency_ms: int | None = None,
    usage: Any = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    image_count: int | None = None,
    credits_charged: int | None = None,
    cost_cny: float | None = None,
    provider_request_id: str | None = None,
    user_id: str | None = None,
    task_id: str | None = None,
    meta: dict[str, Any] | None = None,
    error: str | None = None,
    response: Any = None,
    pricing_version_id: str | None = None,
) -> None:
    """Insert one usage row. Safe to call from any path (swallows errors).

    DB write runs off the caller thread so LangChain callbacks / Agent stream
    do not block the ASGI event loop (Admin list timeouts while chatting).
    """
    # ContextVar must be read on the request / callback thread.
    try:
        ctx = get_usage_context()
    except Exception:
        ctx = None

    def _write() -> None:
        try:
            ensure_model_usage_table()
            parsed = parse_usage_fields(usage if isinstance(usage, dict) else {})

            # Prefer explicit args, then usage blob, then context.
            p_tok = prompt_tokens if prompt_tokens is not None else parsed.get("prompt_tokens")
            c_tok = (
                completion_tokens
                if completion_tokens is not None
                else parsed.get("completion_tokens")
            )
            t_tok = total_tokens if total_tokens is not None else parsed.get("total_tokens")
            img_n = image_count if image_count is not None else parsed.get("image_count")

            cost = cost_cny
            if cost is None:
                cost = parsed.get("cost_cny")

            if cost is None and (img_n or 0) > 0:
                cost = estimate_image_cost_cny(catalog_model_id, int(img_n or 1))

            req_id = provider_request_id
            if not req_id and isinstance(response, dict):
                req_id = str(response.get("id") or response.get("request_id") or "") or None

            meta_out: dict[str, Any] = {}
            if ctx and ctx.meta:
                meta_out.update(ctx.meta)
            if meta:
                meta_out.update(meta)
            if parsed.get("_cost_key"):
                meta_out.setdefault("cost_field", parsed.get("_cost_key"))
                meta_out.setdefault("cost_raw", parsed.get("_cost_raw"))
            # Persist vendor cost as CNY; OpenRouter usage.cost is USD.
            prov_l = (provider or "").strip().lower()
            if (
                cost is not None
                and prov_l == "openrouter"
                and meta_out.get("cost_currency") != "cny"
            ):
                meta_out.setdefault("cost_currency", "usd")
                meta_out.setdefault("cost_usd", cost)
                cost = round(float(cost) * _USD_CNY, 6)
                meta_out["cost_currency"] = "cny"
                meta_out["usd_cny"] = _USD_CNY
            elif cost is not None:
                meta_out.setdefault("cost_currency", "cny")

            pv_id = (pricing_version_id or "").strip() or None
            if not pv_id:
                try:
                    from app.services.llm.pricing_registry import (
                        resolve_active_pricing_version_id,
                    )

                    pv_id = resolve_active_pricing_version_id(
                        catalog_model_id=catalog_model_id,
                        provider=provider,
                    )
                except Exception:
                    pv_id = None
            if pv_id:
                meta_out.setdefault("pricing_version_id", pv_id)

            # Persist full usage + any leftover top-level response usage-like keys.
            usage_blob: Any = usage
            if usage_blob is None and isinstance(response, dict) and isinstance(
                response.get("usage"), dict
            ):
                usage_blob = response.get("usage")

            row = {
                "created_at": time.time(),
                "user_id": user_id or (ctx.user_id if ctx else None),
                "task_id": task_id or (ctx.task_id if ctx else None),
                "source": (source or (ctx.source if ctx else None) or "unknown")[:32],
                "provider": (provider or "")[:64] or None,
                "catalog_model_id": (catalog_model_id or "")[:128] or None,
                "api_model": (api_model or "")[:256] or None,
                "status": (status or "ok")[:32],
                "latency_ms": int(latency_ms) if latency_ms is not None else None,
                "prompt_tokens": p_tok,
                "completion_tokens": c_tok,
                "total_tokens": t_tok,
                "cached_tokens": parsed.get("cached_tokens"),
                "reasoning_tokens": parsed.get("reasoning_tokens"),
                "image_count": img_n,
                "credits_charged": (
                    credits_charged
                    if credits_charged is not None
                    else (ctx.credits_charged if ctx else None)
                ),
                "cost_cny": cost,
                "pricing_version_id": (pv_id or "")[:128] or None,
                "provider_request_id": (req_id or "")[:128] or None,
                "usage_json": (
                    json.dumps(usage_blob, ensure_ascii=False)
                    if usage_blob is not None
                    else None
                ),
                "meta_json": (
                    json.dumps(meta_out, ensure_ascii=False) if meta_out else None
                ),
                "error": (error or "")[:4000] or None,
            }

            with _USAGE_WRITE_LOCK:
                from sqlmodel import Session

                from app import crud
                from app.core.db import engine
                from app.models import ModelUsage

                with Session(engine) as session:
                    crud.insert_model_usage(
                        session=session,
                        row=ModelUsage(
                            created_at=float(row["created_at"]),
                            user_id=row["user_id"],
                            task_id=row["task_id"],
                            source=row["source"],
                            provider=row["provider"],
                            catalog_model_id=row["catalog_model_id"],
                            api_model=row["api_model"],
                            status=row["status"],
                            latency_ms=row["latency_ms"],
                            prompt_tokens=row["prompt_tokens"],
                            completion_tokens=row["completion_tokens"],
                            total_tokens=row["total_tokens"],
                            cached_tokens=row["cached_tokens"],
                            reasoning_tokens=row["reasoning_tokens"],
                            image_count=row["image_count"],
                            credits_charged=row["credits_charged"],
                            cost_cny=row["cost_cny"],
                            pricing_version_id=row["pricing_version_id"],
                            provider_request_id=row["provider_request_id"],
                            usage_json=row["usage_json"],
                            meta_json=row["meta_json"],
                            error=row["error"],
                        ),
                    )
        except Exception:
            _log.exception("record_model_usage failed")

    try:
        threading.Thread(target=_write, name="model-usage-write", daemon=True).start()
    except Exception:
        _write()


def _meta_fields(meta: Any) -> tuple[str | None, str | None]:
    if not isinstance(meta, dict):
        return None, None
    via = meta.get("via")
    kind = meta.get("kind")
    via_s = str(via).strip() if via is not None and str(via).strip() else None
    kind_s = str(kind).strip() if kind is not None and str(kind).strip() else None
    return via_s, kind_s


def _usage_row_to_admin_item(r: Any) -> dict[str, Any]:
    usage = None
    raw_usage = getattr(r, "usage_json", None)
    if isinstance(raw_usage, str) and raw_usage.strip():
        try:
            usage = json.loads(raw_usage)
        except Exception:
            usage = raw_usage
    meta = None
    raw_meta = getattr(r, "meta_json", None)
    if isinstance(raw_meta, str) and raw_meta.strip():
        try:
            parsed = json.loads(raw_meta)
            if isinstance(parsed, dict):
                meta = parsed
        except Exception:
            meta = None
    via_v, kind_v = _meta_fields(meta)
    money = _money_fields(
        credits=getattr(r, "credits_charged", None),
        cost_raw=getattr(r, "cost_cny", None),
        provider=str(getattr(r, "provider", None) or ""),
        meta=meta,
    )
    return {
        "id": getattr(r, "id", None),
        "createdAt": getattr(r, "created_at", None),
        "userId": getattr(r, "user_id", None),
        "taskId": getattr(r, "task_id", None),
        "source": getattr(r, "source", None),
        "provider": getattr(r, "provider", None),
        "catalogModelId": getattr(r, "catalog_model_id", None),
        "apiModel": getattr(r, "api_model", None),
        "status": getattr(r, "status", None),
        "latencyMs": getattr(r, "latency_ms", None),
        "promptTokens": getattr(r, "prompt_tokens", None),
        "completionTokens": getattr(r, "completion_tokens", None),
        "totalTokens": getattr(r, "total_tokens", None),
        "cachedTokens": getattr(r, "cached_tokens", None),
        "reasoningTokens": getattr(r, "reasoning_tokens", None),
        "imageCount": getattr(r, "image_count", None),
        "creditsCharged": getattr(r, "credits_charged", None),
        "costCny": money["actualCostCny"],
        "revenueCny": money["revenueCny"],
        "actualCostCny": money["actualCostCny"],
        "profitCny": money["profitCny"],
        "providerRequestId": getattr(r, "provider_request_id", None),
        "usage": usage,
        "meta": meta,
        "via": via_v,
        "kind": kind_v,
        "error": getattr(r, "error", None),
    }


def list_model_usage(
    *,
    page: int = 1,
    page_size: int = 50,
    source: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    user_id: str | None = None,
    status: str | None = None,
    via: str | None = None,
    kind: str | None = None,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> dict[str, Any]:
    ensure_model_usage_table()
    page = max(1, int(page or 1))
    page_size = max(1, min(200, int(page_size or 50)))
    via_s = (via or "").strip()
    kind_s = (kind or "").strip()

    # JSON path filters use Session + dialect-aware extract in crud.
    if via_s or kind_s:
        from sqlmodel import Session

        from app import crud
        from app.core.db import engine

        with Session(engine) as session:
            rows, total = crud.list_model_usage_rows_json_meta(
                session=session,
                page=page,
                page_size=page_size,
                source=source,
                provider=provider,
                model=model,
                user_id=user_id,
                status=status,
                via=via_s or None,
                kind=kind_s or None,
                ts_from=ts_from,
                ts_to=ts_to,
            )
        items = [_usage_mapping_to_admin_item(r) for r in rows]
        return {
            "items": items,
            "total": total,
            "page": page,
            "pageSize": page_size,
        }

    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        rows, total = crud.list_model_usage_rows(
            session=session,
            page=page,
            page_size=page_size,
            source=source,
            provider=provider,
            model=model,
            user_id=user_id,
            status=status,
            ts_from=ts_from,
            ts_to=ts_to,
        )
    items = [_usage_row_to_admin_item(r) for r in rows]
    return {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


def _usage_mapping_to_admin_item(r: Any) -> dict[str, Any]:
    """Admin item from a RowMapping (json-meta list path)."""
    d = dict(r) if not isinstance(r, dict) else r
    for k in ("usage_json", "meta_json"):
        raw = d.get(k)
        if isinstance(raw, str) and raw.strip():
            try:
                d[k.replace("_json", "")] = json.loads(raw)
            except Exception:
                d[k.replace("_json", "")] = raw
        d.pop(k, None)
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else None
    via_v, kind_v = _meta_fields(meta)
    money = _money_fields(
        credits=d.get("credits_charged"),
        cost_raw=d.get("cost_cny"),
        provider=str(d.get("provider") or ""),
        meta=meta,
    )
    return {
        "id": d.get("id"),
        "createdAt": d.get("created_at"),
        "userId": d.get("user_id"),
        "taskId": d.get("task_id"),
        "source": d.get("source"),
        "provider": d.get("provider"),
        "catalogModelId": d.get("catalog_model_id"),
        "apiModel": d.get("api_model"),
        "status": d.get("status"),
        "latencyMs": d.get("latency_ms"),
        "promptTokens": d.get("prompt_tokens"),
        "completionTokens": d.get("completion_tokens"),
        "totalTokens": d.get("total_tokens"),
        "cachedTokens": d.get("cached_tokens"),
        "reasoningTokens": d.get("reasoning_tokens"),
        "imageCount": d.get("image_count"),
        "creditsCharged": d.get("credits_charged"),
        "costCny": money["actualCostCny"],
        "revenueCny": money["revenueCny"],
        "actualCostCny": money["actualCostCny"],
        "profitCny": money["profitCny"],
        "providerRequestId": d.get("provider_request_id"),
        "usage": d.get("usage"),
        "meta": meta,
        "via": via_v,
        "kind": kind_v,
        "error": d.get("error"),
    }


def list_model_usage_for_task(task_id: str, *, limit: int = 40) -> list[dict[str, Any]]:
    """Model calls for one design task (Admin 运行监测 drawer)."""
    tid = str(task_id or "").strip()
    if not tid:
        return []
    ensure_model_usage_table()
    lim = max(1, min(100, int(limit or 40)))
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        rows = crud.list_model_usage_for_task_rows(
            session=session, task_id=tid, limit=lim
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        meta = None
        raw_meta = r.meta_json
        if isinstance(raw_meta, str) and raw_meta.strip():
            try:
                parsed = json.loads(raw_meta)
                if isinstance(parsed, dict):
                    meta = parsed
            except Exception:
                meta = None
        via_v, kind_v = _meta_fields(meta)
        out.append(
            {
                "id": r.id,
                "createdAt": r.created_at,
                "source": r.source,
                "provider": r.provider,
                "catalogModelId": r.catalog_model_id,
                "apiModel": r.api_model,
                "status": r.status,
                "latencyMs": r.latency_ms,
                "promptTokens": r.prompt_tokens,
                "completionTokens": r.completion_tokens,
                "totalTokens": r.total_tokens,
                "imageCount": r.image_count,
                "costCny": r.cost_cny,
                "via": via_v,
                "kind": kind_v,
                "error": r.error,
            }
        )
    return out

def summarize_model_usage(
    *,
    ts_from: float | None = None,
    ts_to: float | None = None,
) -> dict[str, Any]:
    """Aggregate by model / provider / source for Admin dashboard."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_model_usage_table()

    with Session(engine) as session:
        agg = crud.summarize_model_usage_rows(
            session=session, ts_from=ts_from, ts_to=ts_to
        )
    totals = agg["totals"]
    by_model = agg["by_model"]
    by_source = agg["by_source"]
    by_provider = agg["by_provider"]

    # JSON path aggregates use Session + dialect-aware extract in crud.
    with Session(engine) as session:
        via_kind = crud.summarize_model_usage_by_via_kind(
            session=session, ts_from=ts_from, ts_to=ts_to
        )
    by_via = via_kind["by_via"]
    by_kind = via_kind["by_kind"]

    def _cell(row: Any, key: str) -> Any:
        if row is None:
            return None
        if hasattr(row, key):
            return getattr(row, key)
        if hasattr(row, "_mapping"):
            return row._mapping.get(key)
        try:
            return row[key]
        except Exception:
            try:
                return row.get(key)
            except Exception:
                return None

    def _num(row: Any, key: str) -> float:
        try:
            return float(_cell(row, key) or 0)
        except Exception:
            return 0.0

    def _row_money(credits: float, cost: float, provider: str = "") -> dict[str, float | None]:
        revenue = _credits_to_revenue_cny(credits)
        actual = (
            _actual_cost_cny(cost, provider=provider) if cost else None
        )
        return {
            "revenueCny": revenue,
            "actualCostCny": actual,
            "profitCny": _profit_cny(revenue, actual),
        }

    t = totals
    t_credits = _num(t, "credits")
    t_cost = _num(t, "cost_cny")
    t_money = _row_money(t_credits, t_cost)
    return {
        "totals": {
            "calls": int(_num(t, "calls")),
            "ok": int(_num(t, "ok")),
            "failed": int(_num(t, "failed")),
            "promptTokens": int(_num(t, "prompt_tokens")),
            "completionTokens": int(_num(t, "completion_tokens")),
            "totalTokens": int(_num(t, "total_tokens")),
            "images": int(_num(t, "images")),
            "credits": int(t_credits),
            "costCny": round(t_cost, 6),
            "revenueCny": t_money["revenueCny"],
            "actualCostCny": t_money["actualCostCny"],
            "profitCny": t_money["profitCny"],
            "avgLatencyMs": int(_num(t, "avg_latency_ms")),
        },
        "byModel": [
            {
                "model": _cell(r, "model"),
                "provider": _cell(r, "provider"),
                "calls": int(_num(r, "calls")),
                "failed": int(_num(r, "failed")),
                "promptTokens": int(_num(r, "prompt_tokens")),
                "completionTokens": int(_num(r, "completion_tokens")),
                "totalTokens": int(_num(r, "total_tokens")),
                "images": int(_num(r, "images")),
                "credits": int(_num(r, "credits")),
                "costCny": round(_num(r, "cost_cny"), 6),
                "avgLatencyMs": int(_num(r, "avg_latency_ms")),
                **_row_money(
                    _num(r, "credits"),
                    _num(r, "cost_cny"),
                    str(_cell(r, "provider") or ""),
                ),
            }
            for r in by_model or []
        ],
        "bySource": [
            {
                "source": _cell(r, "source"),
                "calls": int(_num(r, "calls")),
                "totalTokens": int(_num(r, "total_tokens")),
                "images": int(_num(r, "images")),
                "credits": int(_num(r, "credits")),
                "costCny": round(_num(r, "cost_cny"), 6),
                **_row_money(_num(r, "credits"), _num(r, "cost_cny")),
            }
            for r in by_source or []
        ],
        "byProvider": [
            {
                "provider": _cell(r, "provider"),
                "calls": int(_num(r, "calls")),
                "totalTokens": int(_num(r, "total_tokens")),
                "credits": int(_num(r, "credits")),
                "costCny": round(_num(r, "cost_cny"), 6),
                **_row_money(
                    _num(r, "credits"),
                    _num(r, "cost_cny"),
                    str(_cell(r, "provider") or ""),
                ),
            }
            for r in by_provider or []
        ],
        "byVia": [
            {
                "via": r.get("via") if hasattr(r, "get") else r["via"],
                "calls": int(_num(r, "calls")),
                "failed": int(_num(r, "failed")),
                "totalTokens": int(_num(r, "total_tokens")),
                "credits": int(_num(r, "credits")),
                "avgLatencyMs": int(_num(r, "avg_latency_ms")),
            }
            for r in by_via or []
        ],
        "byKind": [
            {
                "kind": r.get("kind") if hasattr(r, "get") else r["kind"],
                "calls": int(_num(r, "calls")),
                "failed": int(_num(r, "failed")),
                "totalTokens": int(_num(r, "total_tokens")),
                "credits": int(_num(r, "credits")),
                "avgLatencyMs": int(_num(r, "avg_latency_ms")),
            }
            for r in by_kind or []
        ],
    }


