"""Pricing Registry — versioned provider price sheets (Billing Protocol).

User sell price / host markup stay out of this module.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.core.db import engine
from app.models import LlmModel, PricingVersion

_log = logging.getLogger("llm.pricing_registry")


def _id(prefix: str = "pv") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _rates_list(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
        except Exception:
            return []
    return []


def row_to_dict(row: PricingVersion) -> dict[str, Any]:
    return {
        "pricingVersionId": row.pricing_version_id,
        "pricingId": row.pricing_id,
        "provider": row.provider,
        "modelId": row.model_id,
        "currency": row.currency,
        "rates": _rates_list(row.rates_json),
        "status": row.status,
        "effectiveFrom": row.effective_from,
        "effectiveTo": row.effective_to,
        "source": row.source,
        "notes": row.notes or "",
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def ensure_model_pricing_id(
    *,
    session: Session,
    model_id: str,
    provider: str = "",
) -> str:
    """Ensure LlmModel.pricing_id is set; default family id = ``price:{model_id}``."""
    mid = (model_id or "").strip()
    if not mid:
        return ""
    row = session.get(LlmModel, mid)
    if not row:
        return f"price:{mid}"
    pid = str(row.pricing_id or "").strip()
    if pid:
        return pid
    pid = f"price:{mid}"
    row.pricing_id = pid
    if provider and not row.provider:
        row.provider = provider
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    return pid


def resolve_active_pricing_version_id(
    *,
    catalog_model_id: str | None = None,
    provider: str | None = None,
    at: float | None = None,
) -> str | None:
    """Return active pricing_version_id for a catalog model at ``at`` (unix)."""
    mid = (catalog_model_id or "").strip()
    if not mid:
        return None
    now = float(at) if at is not None else time.time()
    try:
        with Session(engine) as session:
            model = session.get(LlmModel, mid)
            pricing_id = str(getattr(model, "pricing_id", None) or "").strip() if model else ""
            if not pricing_id:
                pricing_id = f"price:{mid}"
            stmt = select(PricingVersion).where(PricingVersion.pricing_id == pricing_id)
            rows = list(session.exec(stmt).all())
            if not rows and mid:
                stmt2 = select(PricingVersion).where(PricingVersion.model_id == mid)
                rows = list(session.exec(stmt2).all())
            candidates: list[PricingVersion] = []
            for r in rows:
                status = str(r.status or "").strip().lower()
                if status not in ("active", "superseded"):
                    continue
                start = r.effective_from
                end = r.effective_to
                if start is not None and now < float(start):
                    continue
                if end is not None and now >= float(end):
                    continue
                if provider and r.provider and r.provider.lower() != provider.lower():
                    continue
                candidates.append(r)
            if not candidates:
                # Prefer explicitly active even without window
                for r in rows:
                    if str(r.status or "").lower() == "active":
                        return r.pricing_version_id
                return None
            candidates.sort(
                key=lambda r: (float(r.effective_from or 0.0), r.pricing_version_id),
                reverse=True,
            )
            return candidates[0].pricing_version_id
    except Exception:
        _log.exception("resolve_active_pricing_version_id failed")
        return None


def list_pricing_versions(
    *,
    status: str | None = None,
    pricing_id: str | None = None,
    model_id: str | None = None,
    provider: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    with Session(engine) as session:
        stmt = select(PricingVersion)
        if status:
            stmt = stmt.where(PricingVersion.status == status.strip())
        if pricing_id:
            stmt = stmt.where(PricingVersion.pricing_id == pricing_id.strip())
        if model_id:
            stmt = stmt.where(PricingVersion.model_id == model_id.strip())
        if provider:
            stmt = stmt.where(PricingVersion.provider == provider.strip())
        stmt = stmt.order_by(col(PricingVersion.updated_at).desc()).limit(max(1, min(limit, 500)))
        return [row_to_dict(r) for r in session.exec(stmt).all()]


def get_pricing_version(pricing_version_id: str) -> dict[str, Any] | None:
    with Session(engine) as session:
        row = session.get(PricingVersion, (pricing_version_id or "").strip())
        return row_to_dict(row) if row else None


def upsert_pricing_version(payload: dict[str, Any]) -> dict[str, Any]:
    """Create or update a draft/pending version. Active publish goes through approve()."""
    now = time.time()
    vid = str(payload.get("pricingVersionId") or "").strip() or _id()
    rates = payload.get("rates")
    if rates is None:
        rates = []
    rates_json = json.dumps(rates, ensure_ascii=False, separators=(",", ":"))
    with Session(engine) as session:
        row = session.get(PricingVersion, vid)
        if row is None:
            row = PricingVersion(
                pricing_version_id=vid,
                created_at=now,
            )
        row.pricing_id = str(payload.get("pricingId") or row.pricing_id or "").strip()
        row.provider = str(payload.get("provider") or row.provider or "").strip()
        row.model_id = str(payload.get("modelId") or row.model_id or "").strip()
        row.currency = str(payload.get("currency") or row.currency or "USD").strip() or "USD"
        row.rates_json = rates_json
        status = str(payload.get("status") or row.status or "draft").strip().lower()
        if status not in (
            "draft",
            "pending_review",
            "active",
            "superseded",
            "rejected",
        ):
            status = "draft"
        # Direct active only when explicitly requested via approve path preferred
        row.status = status
        ef = payload.get("effectiveFrom", row.effective_from)
        et = payload.get("effectiveTo", row.effective_to)
        row.effective_from = float(ef) if ef is not None else row.effective_from
        row.effective_to = float(et) if et is not None else row.effective_to
        row.source = str(payload.get("source") or row.source or "").strip()
        row.notes = str(payload.get("notes") or row.notes or "") or None
        row.updated_at = now
        if row.model_id and not row.pricing_id:
            row.pricing_id = ensure_model_pricing_id(
                session=session, model_id=row.model_id, provider=row.provider
            )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row_to_dict(row)


def submit_pricing_version(pricing_version_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        row = session.get(PricingVersion, (pricing_version_id or "").strip())
        if not row:
            raise ValueError("pricing version not found")
        if str(row.status).lower() not in ("draft", "rejected"):
            raise ValueError(f"cannot submit from status={row.status}")
        row.status = "pending_review"
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return row_to_dict(row)


def approve_pricing_version(pricing_version_id: str) -> dict[str, Any]:
    """Activate version and supersede prior active siblings on same pricing_id."""
    now = time.time()
    with Session(engine) as session:
        row = session.get(PricingVersion, (pricing_version_id or "").strip())
        if not row:
            raise ValueError("pricing version not found")
        if str(row.status).lower() not in ("draft", "pending_review", "rejected"):
            raise ValueError(f"cannot approve from status={row.status}")
        siblings = list(
            session.exec(
                select(PricingVersion).where(
                    PricingVersion.pricing_id == row.pricing_id,
                    PricingVersion.status == "active",
                )
            ).all()
        )
        for s in siblings:
            if s.pricing_version_id == row.pricing_version_id:
                continue
            s.status = "superseded"
            s.effective_to = now
            s.updated_at = now
            session.add(s)
        row.status = "active"
        if row.effective_from is None:
            row.effective_from = now
        row.effective_to = None
        row.updated_at = now
        if row.model_id:
            model = session.get(LlmModel, row.model_id)
            if model:
                model.pricing_id = row.pricing_id or model.pricing_id or f"price:{row.model_id}"
                model.updated_at = now
                session.add(model)
        session.add(row)
        session.commit()
        session.refresh(row)
        return row_to_dict(row)


def reject_pricing_version(pricing_version_id: str, *, notes: str = "") -> dict[str, Any]:
    with Session(engine) as session:
        row = session.get(PricingVersion, (pricing_version_id or "").strip())
        if not row:
            raise ValueError("pricing version not found")
        if str(row.status).lower() not in ("draft", "pending_review"):
            raise ValueError(f"cannot reject from status={row.status}")
        row.status = "rejected"
        if notes:
            row.notes = notes
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return row_to_dict(row)


def record_sync_draft(
    *,
    model_id: str,
    provider: str,
    currency: str,
    rates: list[dict[str, Any]],
    source: str,
    notes: str = "",
) -> dict[str, Any]:
    """Append a pending_review draft from official price sync (never auto-activate)."""
    with Session(engine) as session:
        pricing_id = ensure_model_pricing_id(
            session=session, model_id=model_id, provider=provider
        )
    return upsert_pricing_version(
        {
            "pricing_id": pricing_id,
            "model_id": model_id,
            "provider": provider,
            "currency": currency or "USD",
            "rates": rates,
            "status": "pending_review",
            "source": source,
            "notes": notes or "auto sync draft",
            "effective_from": time.time(),
        }
    )


def margin_summary(*, from_ts: float | None = None, to_ts: float | None = None) -> dict[str, Any]:
    """Roll up usage P&L for Admin Margin Monitor (uses existing usage_log math)."""
    from app.services.llm.usage_log import summarize_model_usage

    summary = summarize_model_usage(ts_from=from_ts, ts_to=to_ts)
    items = summary.get("byModel") or []
    if not isinstance(items, list):
        items = []
    totals = summary.get("totals") if isinstance(summary.get("totals"), dict) else {}
    total_revenue = float(totals.get("revenueCny") or 0)
    total_cost = float(totals.get("actualCostCny") or 0)
    if total_revenue == 0 and total_cost == 0:
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                if it.get("revenueCny") is not None:
                    total_revenue += float(it["revenueCny"])
                if it.get("actualCostCny") is not None:
                    total_cost += float(it["actualCostCny"])
            except (TypeError, ValueError):
                continue
    profit = round(total_revenue - total_cost, 6)
    margin = None
    if total_revenue > 0:
        margin = round(profit / total_revenue * 100.0, 2)
    return {
        "fromTs": from_ts,
        "toTs": to_ts,
        "revenueCny": round(total_revenue, 6),
        "actualCostCny": round(total_cost, 6),
        "profitCny": profit,
        "grossMarginPct": margin,
        "byModel": items,
        "totals": totals,
    }
