"""HTTP client for closed-source intelligence mockup rendering."""

from __future__ import annotations

import base64
from typing import Any

import httpx

from app.services.vision.ilp_client import _base_url, _headers, _load_bytes, _timeout, ilp_enabled


def mockup_enabled() -> bool:
    return ilp_enabled()


async def list_mockup_templates() -> list[dict[str, Any]]:
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Mockup service is not configured (set RECOMBYN_INTELLIGENCE_URL)"
        )
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.get(f"{base}/api/v1/mockup/templates", headers=_headers())
        if resp.status_code >= 400:
            raise RuntimeError(f"mockup templates failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        templates = data.get("templates") if isinstance(data, dict) else None
        return list(templates or [])


async def fetch_mockup_template_kit(
    template_id: str = "demo-cylinder",
    *,
    scale: float = 0.5,
) -> dict[str, Any]:
    """Download UV/mask/base kit for FE live remap."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Mockup service is not configured (set RECOMBYN_INTELLIGENCE_URL)"
        )
    tid = (template_id or "demo-cylinder").strip() or "demo-cylinder"
    sc = max(0.25, min(1.0, float(scale or 0.5)))
    # Kit payload is multi-MB JSON; allow longer than default ILP connect budget.
    kit_timeout = httpx.Timeout(120.0, connect=30.0)
    async with httpx.AsyncClient(timeout=kit_timeout) as client:
        resp = await client.get(
            f"{base}/api/v1/mockup/templates/{tid}/kit",
            params={"scale": sc},
            headers=_headers(),
        )
        if resp.status_code >= 400:
            detail = (resp.text or "").strip()[:300] or resp.reason_phrase or "error"
            raise RuntimeError(f"mockup kit failed ({resp.status_code}): {detail}")
        data = resp.json()
        if not isinstance(data, dict) or not data.get("uvBase64"):
            raise RuntimeError("mockup kit returned invalid payload")
        return data


async def render_mockup_via_intelligence(
    image_ref: str,
    *,
    template_id: str = "demo-cylinder",
) -> dict[str, Any]:
    """Render design onto mockup; returns data URL + metadata."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Mockup service is not configured (set RECOMBYN_INTELLIGENCE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/mockup/render",
            files={"file": (filename, content, "application/octet-stream")},
            data={
                "template_id": template_id.strip() or "demo-cylinder",
                "return_meta": "true",
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"mockup render failed ({resp.status_code}): {resp.text[:300]}")
        b64 = base64.b64encode(resp.content).decode("ascii")
        meta_raw = resp.headers.get("X-Mockup-Meta") or "{}"
        try:
            import json

            meta = json.loads(meta_raw)
        except Exception:
            meta = {}
        return {
            "image": f"data:image/png;base64,{b64}",
            "kind": "mockup",
            "template_id": meta.get("template_id") or template_id,
            "width": meta.get("width"),
            "height": meta.get("height"),
            "engines": [str(meta.get("engine") or "mockup:2.5d-pbr")],
            "elapsed_ms": meta.get("elapsed_ms"),
            "features": meta.get("features"),
            "warnings": [],
        }


async def render_mockup_batch_via_intelligence(
    items: list[dict[str, str]],
) -> dict[str, Any]:
    """Sync batch render via intelligence (≤64 items)."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Mockup service is not configured (set RECOMBYN_INTELLIGENCE_URL)"
        )
    payload_items = []
    for row in items:
        content, _ = await _load_bytes(row["image"])
        payload_items.append(
            {
                "design_b64": base64.b64encode(content).decode("ascii"),
                "template_id": row.get("template_id") or "demo-cylinder",
                "name": row.get("name") or "",
            }
        )
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/mockup/render/batch",
            json={"items": payload_items},
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"mockup batch failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        for item in data.get("items") or []:
            b64 = str(item.get("image_b64") or "")
            if b64:
                item["image"] = f"data:image/png;base64,{b64}"
        return data
