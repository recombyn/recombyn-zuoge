"""One skill step LLM call via LangChain (collect or stream)."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

from app.services.llm import (
    build_chat_model,
    build_user_message_content,
    content_text_from_chunk,
    get_llm_endpoint,
    llm_error_detail,
    thinking_text_from_chunk,
    to_lc_messages,
    usage_blob_from_chunk,
)
from app.services.design.runtime.models_route import (
    ensure_vision_model,
    model_supports_vision,
    resolve_vision_model,
    to_endpoint_model_id,
)

# Default when caller omits max_tokens. Must stay within common provider caps
# (e.g. Ark/Doubao ≤ 131072). Do NOT send 1e9 — providers reject before retry.
_DEFAULT_MAX_TOKENS = 8192
_PROVIDER_HARD_CAP = 131072

_log = logging.getLogger("design.llm_step")


def _provider_user_message(detail: str, *, status: int | None = None) -> str:
    """Human-readable provider error for SSE / chat — message only, not raw JSON."""
    text = (detail or "").strip()
    brace = text.find("{")
    if brace >= 0:
        try:
            obj = json.loads(text[brace:])
        except Exception:
            obj = None
        if isinstance(obj, dict):
            msg = obj.get("message")
            if isinstance(msg, str) and msg.strip():
                return msg.strip()[:300]
            err = obj.get("error")
            if isinstance(err, dict):
                nested = err.get("message")
                if isinstance(nested, str) and nested.strip():
                    return nested.strip()[:300]
            if isinstance(err, str) and err.strip():
                return err.strip()[:300]
    if text and not text.startswith("{"):
        return text[:300]
    if status is not None:
        return f"LLM request failed (HTTP {status})"
    return "LLM request failed"


def _is_image_unsupported_error(detail: str) -> bool:
    """True when the provider rejected multimodal image_url (prefer structured JSON)."""
    text = (detail or "").strip()
    if not text:
        return False
    # Ark / OpenAI-style: {"error":{"param":"image_url","message":"Model do not support…"}}
    brace = text.find("{")
    if brace >= 0:
        try:
            obj = json.loads(text[brace:])
            err = obj.get("error") if isinstance(obj, dict) else None
            if isinstance(err, dict):
                param = str(err.get("param") or "").strip().lower()
                if param in ("image_url", "image", "images", "content"):
                    msg = str(err.get("message") or "").lower()
                    if param == "image_url" or "image" in msg:
                        return True
                msg = str(err.get("message") or "").lower()
                if "image" in msg and "support" in msg:
                    return True
        except Exception:
            pass
    low = text.lower()
    return "image_url" in low and "support" in low


def _images_for_model(
    model_family: str,
    images: list[str] | None,
) -> list[str] | None:
    """Keep images only when this concrete model can accept image_url."""
    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if not refs:
        return None
    model_id = to_endpoint_model_id(model_family)
    api_mid = model_id
    try:
        api_mid = str(get_llm_endpoint(model_id).model_id or model_id)
    except Exception:
        pass
    if (
        model_supports_vision(model_family)
        or model_supports_vision(model_id)
        or model_supports_vision(api_mid)
    ):
        return refs
    return None


def prepare_model_and_images(
    model_family: str,
    images: list[str] | None,
    *,
    rules: dict[str, str] | None = None,
    allow_vision_switch: bool = True,
) -> tuple[str, list[str] | None, str | None]:
    """
    Attachments flow:
      - Switch to ``precheck.vision_model`` (platform or this user's override /
        锁模 pin) and KEEP images when look-at-image is needed.
      - If vision is unavailable or images cannot be attached → soft degrade:
        keep text model, drop images, return ``vision_failed`` (caller notifies FE).
    Returns (effective_family, safe_images_or_none, switch_reason_or_none).
    """
    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    text_family = model_family
    family = model_family
    switch_reason: str | None = None
    if refs:
        family, switch_reason = ensure_vision_model(
            family,
            has_images=True,
            rules=rules,
            allow_switch=allow_vision_switch,
        )
        if switch_reason:
            _log.debug(
                "[llm_step] vision switch %r → %r (%s) refs=%s",
                model_family,
                family,
                switch_reason,
                len(refs),
            )
        elif not allow_vision_switch and not (
            model_supports_vision(family)
            or model_supports_vision(to_endpoint_model_id(family))
        ):
            _log.debug(
                "[llm_step] vision switch disabled — skip images on %r",
                family,
            )
    safe = _images_for_model(family, refs or None)
    if refs and not safe:
        # Soft degrade — do not abort; FE is notified via images_skipped.
        _log.warning(
            "[llm_step] vision unavailable — soft degrade to text %r, drop %s image(s)",
            text_family,
            len(refs),
        )
        return text_family, None, "vision_failed"
    return family, safe, switch_reason


def _resolve_max_tokens(requested: int | None) -> int:
    """Clamp to a provider-safe range. None / <=0 → default 8192."""
    if requested is None:
        return _DEFAULT_MAX_TOKENS
    try:
        n = int(requested)
    except (TypeError, ValueError):
        return _DEFAULT_MAX_TOKENS
    if n <= 0:
        return _DEFAULT_MAX_TOKENS
    return max(1, min(n, _PROVIDER_HARD_CAP))


def _parse_max_tokens_ceiling(detail: str) -> int | None:
    """Extract provider max from errors like: expected a value <= 131072, but got …."""
    text = detail or ""
    # Prefer explicit ceiling comparisons (Ark InvalidParameter wording).
    m = re.search(r"(?:<=|at most)\s*(\d{3,8})", text, flags=re.I)
    if m:
        return max(1, min(int(m.group(1)), _PROVIDER_HARD_CAP))
    m = re.search(
        r"maximum(?:\s+value)?(?:\s+of)?\s*[:=]?\s*(\d{3,8})",
        text,
        flags=re.I,
    )
    if m:
        return max(1, min(int(m.group(1)), _PROVIDER_HARD_CAP))
    return None


def _enable_thinking_extra(endpoint: Any, model_family: str) -> dict[str, Any] | None:
    """Provider-specific body knobs so reasoning_content actually streams."""
    mid = str(getattr(endpoint, "model_id", "") or "").lower()
    family = str(model_family or "").lower()
    provider = str(getattr(endpoint, "provider", "") or "").lower()
    wants = (
        "think" in mid
        or "think" in family
        or "reasoner" in mid
        or mid.endswith("-r1")
        or "reason" in family
    )
    if not wants:
        try:
            from app.services.llm import list_llm_models

            for m in list_llm_models() or []:
                mid_id = str(m.get("id") or "").lower()
                if mid_id in (mid, family) and m.get("thinking"):
                    wants = True
                    break
        except Exception:
            pass
    if not wants:
        return None
    # deepseek-reasoner already thinks; newer DeepSeek models need thinking.enabled.
    if provider == "deepseek" and "reasoner" not in mid:
        return {"thinking": {"type": "enabled"}}
    # Ark / Doubao / Kimi thinking endpoints often accept the same knob.
    if provider in ("doubao", "ark", "volcengine", "moonshot", "kimi"):
        if "reasoner" in mid or "kimi-k2-thinking" in mid:
            return None
        return {"thinking": {"type": "enabled"}}
    return None


def _build_step_llm(
    *,
    family: str,
    tokens: int,
    streaming: bool,
    enable_thinking: bool,
):
    """LangChain chat model + endpoint for one skill step."""
    model_id = to_endpoint_model_id(family)
    endpoint = get_llm_endpoint(model_id)
    extra = _enable_thinking_extra(endpoint, family) if enable_thinking else None
    llm = build_chat_model(
        endpoint=endpoint,
        max_tokens=tokens,
        streaming=streaming,
        stream_usage=streaming,
        extra_body=extra,
        source="design",
        catalog_model_id=family,
    )
    return endpoint, llm


def _step_messages(system: str, user: str, images: list[str] | None) -> list[Any]:
    return to_lc_messages(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": build_user_message_content(user, images)},
        ]
    )


def _http_status(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return int(status) if isinstance(status, int) else None


async def complete_skill_step(
    *,
    model_family: str,
    system: str,
    user: str,
    max_tokens: int | None = None,
    images: list[str] | None = None,
    rules: dict[str, str] | None = None,
    allow_vision_switch: bool = True,
) -> tuple[str, int]:
    """
    Returns (content, approx_tokens).
    Usage logged only via LangChain callbacks on ``build_chat_model``.
    """
    family, safe_images, _ = prepare_model_and_images(
        model_family,
        images,
        rules=rules,
        allow_vision_switch=allow_vision_switch,
    )
    raw_images = [
        u.strip() for u in (images or []) if isinstance(u, str) and u.strip()
    ]
    if raw_images:
        from app.services.vision.rehost import ensure_remote_fetchable_image_refs

        raw_images = await ensure_remote_fetchable_image_refs(raw_images)
        if safe_images:
            safe_images = await ensure_remote_fetchable_image_refs(safe_images)
    tokens = _resolve_max_tokens(max_tokens)
    endpoint, llm = _build_step_llm(
        family=family,
        tokens=tokens,
        streaming=False,
        enable_thinking=False,
    )
    step_images = safe_images

    attempt = 0
    vision_switched_on_reject = False
    soft_degraded = False
    resp: Any = None
    while attempt < 4:
        attempt += 1
        try:
            resp = await llm.ainvoke(_step_messages(system, user, step_images))
            break
        except Exception as err:
            detail = llm_error_detail(err)
            status = _http_status(err) or 400
            ceiling = _parse_max_tokens_ceiling(detail)
            if status == 400 and ceiling is not None and ceiling < tokens:
                tokens = ceiling
                endpoint, llm = _build_step_llm(
                    family=family,
                    tokens=tokens,
                    streaming=False,
                    enable_thinking=False,
                )
                continue
            if status >= 400 and _is_image_unsupported_error(detail):
                vision = resolve_vision_model(rules)
                if (
                    allow_vision_switch
                    and not vision_switched_on_reject
                    and raw_images
                    and vision
                    and vision != family
                    and model_supports_vision(vision)
                ):
                    vision_switched_on_reject = True
                    _log.warning(
                        "[llm_step] image reject on %r — switch to vision %r",
                        family,
                        vision,
                    )
                    family = vision
                    step_images = raw_images
                    endpoint, llm = _build_step_llm(
                        family=family,
                        tokens=tokens,
                        streaming=False,
                        enable_thinking=False,
                    )
                    continue
                if not soft_degraded:
                    soft_degraded = True
                    _log.warning(
                        "[llm_step] image reject on %r — soft degrade text-only → %r",
                        endpoint.model_id,
                        model_family,
                    )
                    family = model_family
                    step_images = None
                    endpoint, llm = _build_step_llm(
                        family=family,
                        tokens=tokens,
                        streaming=False,
                        enable_thinking=False,
                    )
                    continue
            _log.warning("[llm_step] LLM HTTP %s detail=%s", status, detail[:500])
            raise RuntimeError(
                _provider_user_message(detail, status=status)
            ) from err
    if resp is None:
        raise RuntimeError("LLM empty response")

    content = content_text_from_chunk(resp) or (
        str(resp.content) if getattr(resp, "content", None) is not None else ""
    )
    if not isinstance(content, str):
        content = str(content or "")
    usage = usage_blob_from_chunk(resp) or {}
    total = int(usage.get("total_tokens") or 0)
    if total <= 0:
        total = max(1, len(content) // 3)
    return content, total


async def stream_skill_step(
    *,
    model_family: str,
    system: str,
    user: str,
    max_tokens: int | None = None,
    images: list[str] | None = None,
    enable_thinking: bool = True,
    rules: dict[str, str] | None = None,
    allow_vision_switch: bool = True,
) -> AsyncIterator[tuple[str, str | int]]:
    """
    Stream one skill step via LangChain.
    Yields ("model", family) when vision auto-switch changes the model,
    ("thinking", text), ("token", text), then ("usage", approx_tokens).
    Usage logged only via LangChain callbacks on ``build_chat_model``.
    """
    import time as _time

    family, safe_images, switch_reason = prepare_model_and_images(
        model_family,
        images,
        rules=rules,
        allow_vision_switch=allow_vision_switch,
    )
    raw_images = [
        u.strip() for u in (images or []) if isinstance(u, str) and u.strip()
    ]
    if raw_images:
        from app.services.vision.rehost import ensure_remote_fetchable_image_refs

        raw_images = await ensure_remote_fetchable_image_refs(raw_images)
        if safe_images:
            safe_images = await ensure_remote_fetchable_image_refs(safe_images)
    tokens = _resolve_max_tokens(max_tokens)
    endpoint, llm = _build_step_llm(
        family=family,
        tokens=tokens,
        streaming=True,
        enable_thinking=enable_thinking,
    )
    step_images = safe_images
    content_len = 0
    usage_total = 0
    t0 = _time.time()
    first = True
    if switch_reason == "vision_failed":
        yield ("images_skipped", "vision_failed")
    elif switch_reason or family != model_family:
        yield ("model", family)
        if switch_reason:
            yield ("model_reason", switch_reason)
    if raw_images and not safe_images and switch_reason != "vision_failed":
        yield ("images_skipped", "vision_failed")
    open_msg = (
        f"[llm_step] +0.00s  open model={family!r} "
        f"(from={model_family!r}) api_model={endpoint.model_id!r} "
        f"max_tokens={tokens} images={len(step_images or [])} "
        f"via=langchain"
    )
    _log.debug(open_msg)

    async def _consume() -> AsyncIterator[tuple[str, str | int]]:
        nonlocal content_len, usage_total, first
        async for chunk in llm.astream(_step_messages(system, user, step_images)):
            usage = usage_blob_from_chunk(chunk)
            if usage:
                tot = int(usage.get("total_tokens") or 0)
                if tot > 0:
                    usage_total = tot

            thought = thinking_text_from_chunk(chunk)
            if thought:
                content_len += len(thought)
                if first:
                    first = False
                    _log.debug(
                        "[llm_step] +%.2fs  first_delta thinking chars=%s",
                        _time.time() - t0,
                        len(thought),
                    )
                yield ("thinking", thought)

            text = content_text_from_chunk(chunk)
            if text:
                content_len += len(text)
                if first:
                    first = False
                    _log.debug(
                        "[llm_step] +%.2fs  first_delta token chars=%s",
                        _time.time() - t0,
                        len(text),
                    )
                yield ("token", text)

        approx = max(1, content_len // 3) if content_len else 1
        yield ("usage", int(usage_total) if usage_total > 0 else approx)

    attempt = 0
    vision_switched_on_reject = False
    soft_degraded = False
    while attempt < 4:
        attempt += 1
        try:
            _log.debug(
                "[llm_step] +%.2fs  http_ok via=langchain attempt=%s",
                _time.time() - t0,
                attempt,
            )
            async for item in _consume():
                yield item
            return
        except Exception as err:
            detail = llm_error_detail(err)
            status = _http_status(err) or 400
            if content_len > 0:
                _log.warning("[llm_step] LLM HTTP %s detail=%s", status, detail[:500])
                raise RuntimeError(
                    _provider_user_message(detail, status=status)
                ) from err
            ceiling = _parse_max_tokens_ceiling(detail)
            if status == 400 and ceiling is not None and ceiling < tokens:
                tokens = ceiling
                _log.debug(
                    "[llm_step] +%.2fs  max_tokens retry →%s",
                    _time.time() - t0,
                    ceiling,
                )
                endpoint, llm = _build_step_llm(
                    family=family,
                    tokens=tokens,
                    streaming=True,
                    enable_thinking=enable_thinking,
                )
                continue
            if (
                status == 400
                and _is_image_unsupported_error(detail)
                and not soft_degraded
            ):
                vision = resolve_vision_model(rules)
                if (
                    allow_vision_switch
                    and not vision_switched_on_reject
                    and raw_images
                    and vision
                    and vision != family
                    and model_supports_vision(vision)
                ):
                    vision_switched_on_reject = True
                    family = vision
                    step_images = raw_images
                    _log.warning(
                        "[llm_step] image reject — switch to vision %r",
                        family,
                    )
                    yield ("model", family)
                    yield ("model_reason", "vision_reject_retry")
                    endpoint, llm = _build_step_llm(
                        family=family,
                        tokens=tokens,
                        streaming=True,
                        enable_thinking=enable_thinking,
                    )
                    continue
                soft_degraded = True
                _log.warning(
                    "[llm_step] image reject on %r — soft degrade → %r",
                    endpoint.model_id,
                    model_family,
                )
                if family != model_family:
                    family = model_family
                    yield ("model", family)
                yield ("images_skipped", "vision_failed")
                step_images = None
                endpoint, llm = _build_step_llm(
                    family=family,
                    tokens=tokens,
                    streaming=True,
                    enable_thinking=enable_thinking,
                )
                continue
            _log.warning("[llm_step] LLM HTTP %s detail=%s", status, detail[:500])
            raise RuntimeError(
                _provider_user_message(detail, status=status)
            ) from err
    raise RuntimeError("LLM stream failed after retries")
