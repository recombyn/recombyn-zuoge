from __future__ import annotations

import re
from typing import Any

from app.services.design.prompts.prompt_pack_store import render_prompt_body
from app.services.design.prompts.rules_text import render_prompt_template
from app.services.design.runtime.agent_profile import (
    AgentProfile,
    get_active_agent_profile,
)

_CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_SUPPORTED_LOCALES = ("zh-CN", "zh-TW", "en", "ja")


def normalize_locale(raw: str | None, *, default: str = "zh-CN") -> str:
    """Map UI / Accept-Language style tags onto supported product locales."""
    s = str(raw or "").strip().replace("_", "-")
    if not s:
        return default
    low = s.lower()
    if low in ("zh-cn", "zh-hans", "zh"):
        return "zh-CN"
    if low in ("zh-tw", "zh-hant", "zh-hk"):
        return "zh-TW"
    if low.startswith("ja"):
        return "ja"
    if low.startswith("en"):
        return "en"
    for known in _SUPPORTED_LOCALES:
        if low == known.lower():
            return known
    return default


def detect_locale_from_text(text: str) -> str | None:
    """Cheap input-language hint — CJK → zh-CN; otherwise None."""
    sample = str(text or "")[:800]
    if not sample.strip():
        return None
    if _CJK_RE.search(sample):
        return "zh-CN"
    return None


def resolve_output_locale(
    *,
    client_locale: str | None = None,
    profile_locale: str | None = None,
    prompt: str = "",
    default: str = "zh-CN",
) -> str:
    """Language Context Layer: client UI → prompt script → AgentProfile → default."""
    client = normalize_locale(client_locale, default="") if client_locale else ""
    if client:
        return client
    detected = detect_locale_from_text(prompt)
    if detected:
        return detected
    return normalize_locale(profile_locale, default=default)


def locale_for_runtime(rt: Any | None = None, *, explicit: str | None = None) -> str:
    """Resolve output locale from AgentRuntime flags + profile + prompt."""
    client = str(explicit or "").strip() or None
    prompt = ""
    if rt is not None:
        flags = getattr(rt, "flags", None)
        if isinstance(flags, dict) and not client:
            client = str(flags.get("output_locale") or "").strip() or None
        prompt = str(getattr(rt, "prompt", "") or "")
    profile_locale = "zh-CN"
    try:
        profile_locale = get_active_agent_profile().locale or "zh-CN"
    except Exception:
        pass
    return resolve_output_locale(
        client_locale=client,
        profile_locale=profile_locale,
        prompt=prompt,
    )


def language_directive(locale: str) -> str:
    """Inject into every stage system prompt — agents must not pick English by default."""
    loc = normalize_locale(locale)
    return (
        "OUTPUT LANGUAGE\n"
        f"- output_language: {loc}\n"
        "- Always answer the user in output_language.\n"
        "- Do not switch to English unless the user explicitly asks for English.\n"
        "- Keep tool schemas / op names / hex colors as-is; user-facing prose follows output_language."
    )


def require_prompt_pack(rules: dict[str, str] | None, key: str, **variables: Any) -> str:
    """Load Admin pack body; missing pack is a hard error (no code fallback prose)."""
    try:
        text = render_prompt_body(key, rules=rules, **variables).strip()
    except Exception:
        text = ""
        if rules is not None:
            from app.services.design.prompts.rules_text import _rule_text

            raw = _rule_text(rules, key).strip()
            if raw:
                text = render_prompt_template(raw, **variables).strip() if variables else raw
    if not text:
        raise RuntimeError(
            f"missing prompt pack: {key} "
            "(Admin → 系统提示词 / seeds/design_prompt_packs)"
        )
    return text


def interaction_mode_rules_pack(
    rules: dict[str, str] | None,
    *,
    ask_mode: bool,
    profile: AgentProfile | None = None,
) -> str:
    """Mode-only rules: Ask → ask overlay; Agent → agent overlay (from Profile)."""
    prof = profile or get_active_agent_profile()
    key = prof.mode_overlay_key(ask_mode=ask_mode)
    try:
        return require_prompt_pack(rules, key)
    except RuntimeError:
        return ""


def assemble_stage_system(
    rules: dict[str, str] | None,
    *,
    stage: str,
    ask_mode: bool,
    persona: str = "",
    catalog_blocks: list[str] | None = None,
    profile: AgentProfile | None = None,
    locale: str | None = None,
) -> str:
    """Assemble stage system prompt from Profile pack keys + Ask/Agent mode pack."""
    prof = profile or get_active_agent_profile()
    stage_key = str(stage or "").strip().lower()
    protocol_key = prof.stage_protocol(stage_key)
    out_locale = resolve_output_locale(
        client_locale=locale,
        profile_locale=prof.locale,
    )

    parts: list[str] = []
    persona_s = str(persona or "").strip()
    if persona_s:
        parts.append(
            persona_s
            if persona_s.startswith("IDENTITY:")
            else f"IDENTITY: {persona_s}"
        )
    parts.append(language_directive(out_locale))
    parts.append(require_prompt_pack(rules, protocol_key))
    # Review (and any stage with mode_overlay: false) stays undiluted.
    if prof.stage_uses_mode_overlay(stage_key):
        mode_pack = interaction_mode_rules_pack(
            rules, ask_mode=ask_mode, profile=prof
        )
        if mode_pack.strip():
            parts.append(mode_pack.strip())
    for block in catalog_blocks or []:
        b = str(block or "").strip()
        if b:
            parts.append(b)
    return "\n\n".join(parts)
