"""Live design-run helpers: refs, precheck, user-facing errors."""

from __future__ import annotations

import json
import re

from app.services.design.prompts.rules_text import _as_text, _rule_text


def _json_error_message(text: str) -> str | None:
    """Pull provider ``message`` out of a JSON error body when present."""
    raw = (text or "").strip()
    brace = raw.find("{")
    if brace < 0:
        return None
    try:
        obj = json.loads(raw[brace:])
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    msg = obj.get("message")
    if isinstance(msg, str) and msg.strip():
        return msg.strip()
    err = obj.get("error")
    if isinstance(err, dict):
        nested = err.get("message")
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
    if isinstance(err, str) and err.strip():
        return err.strip()
    return None


def _normalize_ref_images(
    images: list[str] | None,
    *,
    rules: dict[str, str] | None = None,
    limit: int | None = None,
    max_data_url_chars: int | None = None,
) -> list[str]:
    """Keep valid data-URL / https reference images; drop oversized payloads.

    Limits come from Admin ``agent.attach.max_images`` /
    ``agent.attach.max_data_url_chars`` (or explicit kwargs).
    Missing Admin keys fall back to seed defaults (4 / 2.5M) — empty used to
    mean 0 and silently stripped every attachment (ref-UI paint saw no pixels).
    """
    # Match apps/api/seeds/stage_rule_defaults.json
    _FALLBACK_MAX_IMAGES = 4
    _FALLBACK_MAX_DATA_URL_CHARS = 2_500_000
    rules = rules or {}
    if limit is None:
        raw_lim = str(rules.get("agent.attach.max_images") or "").strip()
        if not raw_lim:
            limit = _FALLBACK_MAX_IMAGES
        else:
            try:
                limit = max(0, int(raw_lim))
            except ValueError:
                limit = _FALLBACK_MAX_IMAGES
    if max_data_url_chars is None:
        raw_chars = str(rules.get("agent.attach.max_data_url_chars") or "").strip()
        if not raw_chars:
            max_data_url_chars = _FALLBACK_MAX_DATA_URL_CHARS
        else:
            try:
                max_data_url_chars = max(0, int(raw_chars))
            except ValueError:
                max_data_url_chars = _FALLBACK_MAX_DATA_URL_CHARS
    out: list[str] = []
    for img in images or []:
        if not isinstance(img, str):
            continue
        s = img.strip()
        if not s:
            continue
        if s.startswith("data:image/"):
            if max_data_url_chars <= 0 or len(s) > max_data_url_chars:
                continue
            out.append(s)
        elif s.startswith("https://") or s.startswith("http://"):
            out.append(s)
        if limit > 0 and len(out) >= limit:
            break
    return out[:limit] if limit > 0 else []


def _attached_images_prompt_note(
    ref_images: list[str],
    *,
    rules: dict[str, str] | None = None,
) -> str:
    """Short note for the model about attached images. Empty Admin hint → skip."""
    n = len(ref_images or [])
    if n <= 0:
        return ""
    rules = rules or {}
    custom = str(rules.get("agent.attach.place_hint") or "").strip()
    if not custom:
        return ""
    try:
        from app.services.design.prompts.rules_text import render_prompt_template

        return render_prompt_template(custom, n=n, max_index=max(0, n - 1))
    except Exception:
        return custom


def _run_error_code(err: BaseException | str) -> str:
    """Stable machine code for SSE ``error.code`` (FE i18n); not user-facing copy."""
    raw = _as_text(err).strip()
    low = raw.lower()
    if low == "free_daily_exhausted" or "free_daily_exhausted" in low:
        return "free_daily_exhausted"
    if low == "insufficient_credits" or (
        "insufficient" in low and "credit" in low
    ):
        return "insufficient_credits"
    if low in {"prompt_required", "invalid_run_mode", "invalid_canvas_size"}:
        return low
    if low in {
        "task_not_found",
        "forbidden",
        "resume_token_mismatch",
        "checkpoint_empty",
        "checkpoint_corrupt",
        "lease_held",
    }:
        return "auth_forbidden" if low != "task_not_found" else "task_not_found"
    if low == "cancelled" or low.endswith(":cancelled"):
        return "cancelled"
    if "missing_tool_ops" in low or "tool_ops_invalid" in low or low.startswith(
        "paint_ops"
    ):
        return "paint_ops_failed"
    if (
        "validate_failed" in low
        or "final_validate" in low
        or "sparse_svg" in low
    ):
        return "validate_failed"
    if "no_vision_model" in low or "vision_rejected" in low:
        return "vision_unavailable"
    if low.startswith("blocked:") or "blocked:" in low:
        return "blocked"
    if "timeout" in low:
        return "timeout"
    if "intent_classify" in low:
        return "intent_classify_failed"
    if "model_route" in low:
        return "model_route_failed"
    if "structured_output_failed" in low:
        return "structured_output_failed"
    if "vision_chat_failed" in low:
        return "vision_chat_failed"
    if "review_agent_llm_failed" in low or "review_lanes_unavailable" in low:
        return "review_failed"
    if "decide_agent" in low or "decide_structured" in low:
        return "decide_failed"
    if "agent_turn" in low:
        return "decide_failed"
    if low.startswith("skill_failed:") or re.match(
        r"name\s+['`].+['`]\s+is not defined", low
    ):
        return "internal_error"
    if re.match(r"^[a-z][a-z0-9_]+:", low) and " " not in low[:40]:
        head = low.split(":", 1)[0]
        if head in {
            "free_daily_exhausted",
            "insufficient_credits",
            "prompt_required",
            "invalid_run_mode",
            "invalid_canvas_size",
            "cancelled",
            "intent_classify",
            "model_route",
            "structured_output_failed",
            "vision_chat_failed",
            "review_agent_llm_failed",
            "review_lanes_unavailable",
            "decide_agent",
            "decide_structured",
            "agent_turn",
            "vision_unavailable",
        }:
            return {
                "intent_classify": "intent_classify_failed",
                "model_route": "model_route_failed",
                "structured_output_failed": "structured_output_failed",
                "vision_chat_failed": "vision_chat_failed",
                "review_agent_llm_failed": "review_failed",
                "review_lanes_unavailable": "review_failed",
                "decide_agent": "decide_failed",
                "decide_structured": "decide_failed",
                "agent_turn": "decide_failed",
                "vision_unavailable": "vision_unavailable",
            }.get(head, head)
        return "internal_error"
    return "internal_error"


def _user_facing_run_error(
    err: BaseException | str,
    *,
    rules: dict[str, str] | None = None,
    locale: str | None = None,
) -> str:
    """SSE / chat-facing error text — localized on the backend."""
    from app.services.i18n.errors import localize_run_error

    return localize_run_error(err, rules=rules, locale=locale)


def _precheck_block(
    prompt: str,
    canvas_size: str | None,
    rules: dict[str, str],
    *,
    has_images: bool = False,
    user_selected_model: str | None = None,
) -> str | None:
    """Hard blocks from Admin ``precheck.block_rules``. Returns blocked:code or None."""
    del has_images, user_selected_model
    blocks = (rules.get("precheck.block_rules") or "").lower()
    if "empty_prompt" in blocks and not (prompt or "").strip():
        return "blocked:empty_prompt"
    if "oversized_canvas" in blocks and canvas_size:
        raw = canvas_size.lower().replace("*", "x")
        if "x" in raw:
            try:
                a, b = raw.split("x", 1)
                if int(a) * int(b) > 8000 * 8000:
                    return "blocked:oversized_canvas"
            except ValueError:
                pass
    banned = "banned_words" in blocks
    if banned and re.search(r"\b(nsfw|porn)\b", prompt or "", re.I):
        return "blocked:banned_words"
    return None
