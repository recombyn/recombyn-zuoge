"""Backend-owned user-facing error and UX tip copy (localized)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.services.design.prompts.rules_text import _as_text, _rule_text
from app.services.design.runtime.host.prompts import normalize_locale


_CATALOG_DIR = Path(__file__).resolve().parent / "catalog"


def _load_catalog(name: str) -> dict[str, dict[str, str]]:
    path = _CATALOG_DIR / name
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"invalid i18n catalog: {path}")
    out: dict[str, dict[str, str]] = {}
    for code, row in data.items():
        if not isinstance(row, dict):
            continue
        out[str(code)] = {str(k): str(v) for k, v in row.items()}
    return out


_ERROR_CATALOG: dict[str, dict[str, str]] = _load_catalog("errors.json")
_UX_TIP_CATALOG: dict[str, dict[str, str]] = _load_catalog("ux_tips.json")

# Same user-facing copy — keep distinct wire codes, one catalog row.
_ERROR_CODE_ALIASES: dict[str, str] = {
    "missing_tool_ops": "paint_ops_failed",
}


def localize_error(code: str, locale: str | None = None, **params: Any) -> str:
    """Localized user-facing message for a stable error code."""
    loc = normalize_locale(locale)
    key = str(code or "").strip().lower() or "internal_error"
    key = _ERROR_CODE_ALIASES.get(key, key)
    row = _ERROR_CATALOG.get(key) or _ERROR_CATALOG["internal_error"]
    tmpl = row.get(loc) or row.get("en") or row.get("zh-CN") or key
    try:
        return str(tmpl.format(**params)).strip() or tmpl
    except (KeyError, ValueError):
        return tmpl


def localize_ux_tip(code: str, locale: str | None = None, **params: Any) -> str:
    """Localized UX tip for SSE token.code payloads."""
    loc = normalize_locale(locale)
    key = str(code or "").strip().lower()
    key = _ERROR_CODE_ALIASES.get(key, key)
    row = (
        _UX_TIP_CATALOG.get(key)
        or _ERROR_CATALOG.get(key)
        or _ERROR_CATALOG.get("internal_error", {})
    )
    tmpl = row.get(loc) or row.get("en") or "Something went wrong. Please retry."
    clean = {k: str(v if v is not None else "").strip()[:200] for k, v in params.items()}
    try:
        from app.services.design.prompts.rules_text import render_prompt_template

        return render_prompt_template(tmpl, **clean).strip() or tmpl
    except Exception:
        try:
            return str(tmpl.format(**clean)).strip() or tmpl
        except (KeyError, ValueError):
            return tmpl


def api_error_detail(
    code: str,
    locale: str | None = None,
    **params: Any,
) -> dict[str, str]:
    """Standard FastAPI ``detail`` object for REST errors."""
    return {
        "code": str(code or "").strip().lower() or "internal_error",
        "message": localize_error(code, locale, **params),
    }


def upload_value_error_code(msg: str) -> str:
    """Map upload job ``ValueError`` text to a stable error code."""
    low = str(msg or "").strip().lower()
    if "too large" in low:
        return "upload_too_large"
    if "empty file" in low:
        return "empty_file"
    if "invalid part number" in low:
        return "upload_invalid_part"
    if "part size mismatch" in low:
        return "upload_part_size_mismatch"
    if "incomplete upload" in low:
        return "upload_incomplete"
    if "not accepting parts" in low or "not ready to assemble" in low:
        return "upload_job_invalid_state"
    return "request_failed"


def http_error(
    status_code: int,
    code: str,
    locale: str | None = None,
    *,
    headers: dict[str, str] | None = None,
    **params: Any,
):
    """Build a localized ``HTTPException`` for FastAPI routes."""
    from fastapi import HTTPException

    return HTTPException(
        status_code=status_code,
        detail=api_error_detail(code, locale, **params),
        headers=headers,
    )


def service_error_http(
    code: str,
    locale: str | None,
    *,
    status: int = 400,
    message: str | None = None,
) -> HTTPException:
    """Map a service-layer error code to localized HTTP ``detail``."""
    from fastapi import HTTPException

    key = str(code or "request_failed").strip().lower()
    resolved = _ERROR_CODE_ALIASES.get(key, key)
    in_catalog = resolved in _ERROR_CATALOG
    detail = api_error_detail(key if in_catalog else "request_failed", locale)
    msg = str(message or "").strip()
    if msg and not in_catalog:
        detail = {"code": key, "message": msg[:500]}
    return HTTPException(status_code=status, detail=detail)


def value_error_http(
    err: ValueError,
    locale: str | None,
    *,
    status: int = 400,
    known: dict[str, tuple[int, str]] | None = None,
):
    """Map ``ValueError`` text to localized HTTP errors."""
    msg = str(err).strip()
    mapping = known or {}
    if msg in mapping:
        st, code = mapping[msg]
        return http_error(st, code, locale)
    resolved = _ERROR_CODE_ALIASES.get(msg, msg)
    if msg in _ERROR_CATALOG or resolved in _ERROR_CATALOG:
        return http_error(status, msg, locale)
    from fastapi import HTTPException

    return HTTPException(
        status_code=status,
        detail={"code": "request_failed", "message": msg},
    )


def _json_error_message(raw: str) -> str | None:
    text = str(raw or "").strip()
    if not text.startswith("{"):
        return None
    try:
        import json

        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    for key in ("message", "detail", "error", "msg"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def localize_run_error(
    err: BaseException | str,
    *,
    rules: dict[str, str] | None = None,
    locale: str | None = None,
) -> str:
    """SSE / chat-facing error text — backend-owned, locale-aware."""
    from app.services.design.runtime.pipeline_support import _run_error_code

    raw = _as_text(err).strip()
    reason = raw
    if raw.lower().startswith("skill_failed:"):
        parts = raw.split(":", 2)
        reason = parts[2].strip() if len(parts) >= 3 else raw
    low = reason.lower()

    def rule_msg(key: str, code: str) -> str:
        custom = _rule_text(rules, key).strip()
        if custom:
            return custom
        return localize_error(code, locale)

    if "intent_classify" in low:
        return rule_msg("error.intent_classify_failed", "intent_classify_failed")
    if "model_route" in low:
        return rule_msg("error.model_route_failed", "model_route_failed")
    if "structured_output_failed" in low or "decide_structured" in low:
        return rule_msg("error.structured_output_failed", "structured_output_failed")
    if "vision_chat_failed" in low:
        return rule_msg("error.vision_chat_failed", "vision_chat_failed")
    if "review_agent_llm_failed" in low or "review_lanes_unavailable" in low:
        return rule_msg("error.review_failed", "review_failed")
    if "decide_agent" in low or "decide_structured" in low or "agent_turn" in low:
        return rule_msg("error.decide_failed", "decide_failed")
    if "missing_tool_ops" in low:
        return rule_msg("error.missing_tool_ops", "missing_tool_ops")
    if "tool_ops_invalid" in low or low.startswith("paint_ops"):
        return rule_msg("error.tool_ops_invalid", "paint_ops_failed")
    if "free_daily_exhausted" in low:
        return localize_error("free_daily_exhausted", locale)
    if "insufficient" in low and "credit" in low:
        return rule_msg("error.insufficient_credits", "insufficient_credits")
    if "validate_failed" in low or "final_validate" in low or "sparse_svg" in low:
        return rule_msg("error.validate_failed", "validate_failed")
    if "no_vision_model" in low or "vision_rejected" in low:
        return rule_msg("error.vision_unavailable", "vision_unavailable")
    if low.startswith("blocked:") or raw.lower().startswith("blocked:"):
        return rule_msg("error.blocked", "blocked")
    if low == "cancelled" or low.endswith(":cancelled"):
        return localize_error("cancelled", locale)

    http_body = reason
    m_http = re.match(r"^LLM HTTP\s+\d+:\s*(.*)$", reason, re.I | re.S)
    if m_http:
        http_body = m_http.group(1).strip()
    extracted = _json_error_message(http_body) or _json_error_message(reason)
    if extracted:
        return extracted[:300]
    if m_http and http_body and not http_body.startswith("{"):
        return http_body[:300]

    code = _run_error_code(err)
    generic = rule_msg("error.generic", code if code != "internal_error" else "internal_error")
    if raw.lower().startswith("skill_failed:") or re.match(r"^[a-z][a-z0-9_]*(:|$)", low):
        return generic
    if http_body.startswith("{") or reason.startswith("{"):
        return generic
    if raw and not re.match(r"^[a-z][a-z0-9_]+:", low):
        return raw[:300]
    return generic
