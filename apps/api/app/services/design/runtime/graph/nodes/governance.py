"""Design Governance (P41) — compliance lanes on the Review hop.

Not a separate LangGraph node. Review Agent calls ``govern`` after a
design-intent craft pass. Chat / canvas_op never enter Review, so they
never show the quality checklist.

IntelligenceClient.govern → BasicLocal → gate_governance_before_settle.

BasicLocal: Brand / A11y / Copyright / Reference / Design System /
Content / Tool Permission.

PASS → settle continues. FAIL → Explain → Repair Plan (never silent success).
"""
from __future__ import annotations

import re
from typing import Any

from app.services.design.runtime.graph.state import (
    GOVERNANCE_LANES,
    AgentRuntime,
    parse_design_governance,
)
from app.services.design.runtime.graph.emit_sse import _emit
from app.services.design.runtime.models_route import normalize_user_intent

_HEX = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
_COPYRIGHT_RX = re.compile(
    r"stock\s*photo|getty|shutterstock|unsplash\s*steal|盗图|侵权素材",
    re.I,
)
_CONTENT_RX = re.compile(
    r"\b(hate\s*speech|csam|未成年色情)\b",
    re.I,
)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    raw = str(hex_color or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return None
    try:
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    except ValueError:
        return None


def _rel_luminance(rgb: tuple[int, int, int]) -> float:
    def chan(c: int) -> float:
        x = c / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast_ratio(fg: str, bg: str) -> float | None:
    """WCAG contrast ratio. Runtime-owned."""
    a = _hex_to_rgb(fg)
    b = _hex_to_rgb(bg)
    if not a or not b:
        return None
    l1 = _rel_luminance(a)
    l2 = _rel_luminance(b)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return round((lighter + 0.05) / (darker + 0.05), 2)


def _palette_colors(brief: dict[str, Any] | None) -> list[str]:
    src = brief if isinstance(brief, dict) else {}
    colors: list[str] = []
    pal = src.get("palette")
    if isinstance(pal, dict):
        for key in ("dominant", "secondary", "accent", "allowed", "colors"):
            val = pal.get(key)
            if isinstance(val, list):
                colors.extend(str(x) for x in val)
            elif isinstance(val, str):
                colors.append(val)
    elif isinstance(pal, list):
        colors.extend(str(x) for x in pal)
    tokens = src.get("tokens")
    if isinstance(tokens, dict):
        for key in ("color", "colors", "brand"):
            val = tokens.get(key)
            if isinstance(val, list):
                colors.extend(str(x) for x in val)
            elif isinstance(val, dict):
                colors.extend(str(v) for v in val.values())
            elif isinstance(val, str):
                colors.append(val)
    out: list[str] = []
    for c in colors:
        for hit in _HEX.findall(str(c)):
            out.append(hit.lower())
    return list(dict.fromkeys(out))


def _observed_colors(
    *,
    observe_facts: dict[str, Any] | None,
    prompt: str,
    strategy: dict[str, Any] | None,
) -> list[str]:
    found: list[str] = []
    blob = str(prompt or "")
    facts = observe_facts if isinstance(observe_facts, dict) else {}
    for key in ("colors", "palette", "used_colors"):
        val = facts.get(key)
        if isinstance(val, list):
            blob += " " + " ".join(str(x) for x in val)
        elif isinstance(val, str):
            blob += " " + val
    if isinstance(strategy, dict):
        blob += " " + str(strategy.get("color_strategy") or "")
    for hit in _HEX.findall(blob):
        found.append(hit.lower())
    flags_colors = facts.get("unauthorized_colors")
    if isinstance(flags_colors, list):
        found.extend(str(x).lower() for x in flags_colors)
    return list(dict.fromkeys(found))


def check_brand_lane(
    *,
    brief: dict[str, Any] | None,
    observe_facts: dict[str, Any] | None,
    prompt: str = "",
    strategy: dict[str, Any] | None = None,
    force_unauthorized: list[str] | None = None,
) -> dict[str, Any]:
    allowed = set(_palette_colors(brief))
    used = list(force_unauthorized or []) or _observed_colors(
        observe_facts=observe_facts, prompt=prompt, strategy=strategy
    )
    # Only fail when allow-list exists and used colors escape it.
    if allowed and used:
        bad = [c for c in used if c not in allowed]
        if bad:
            return {
                "lane": "brand",
                "status": "fail",
                "message": "unauthorized color",
                "evidence": bad[:6],
                "fix": "replace unauthorized colors with Brief palette tokens",
            }
    return {
        "lane": "brand",
        "status": "pass",
        "message": "brand colors ok",
        "evidence": [],
        "fix": "",
    }


def check_accessibility_lane(
    *,
    fg: str = "",
    bg: str = "",
    brief: dict[str, Any] | None = None,
    min_ratio: float = 4.5,
) -> dict[str, Any]:
    src = brief if isinstance(brief, dict) else {}
    a11y = src.get("accessibility") if isinstance(src.get("accessibility"), dict) else {}
    fg_c = str(fg or a11y.get("fg") or "").strip()
    bg_c = str(bg or a11y.get("bg") or "").strip()
    # Spec example path: explicit contrast 2.8:1 fails.
    explicit = a11y.get("contrast_ratio")
    if explicit is not None:
        try:
            ratio = float(explicit)
        except (TypeError, ValueError):
            ratio = None
        if ratio is not None and ratio < min_ratio:
            return {
                "lane": "accessibility",
                "status": "fail",
                "message": f"contrast {ratio}:1",
                "evidence": [f"contrast={ratio}"],
                "fix": "raise text/background contrast to ≥4.5:1",
            }
    if fg_c and bg_c:
        ratio = contrast_ratio(fg_c, bg_c)
        if ratio is not None and ratio < min_ratio:
            return {
                "lane": "accessibility",
                "status": "fail",
                "message": f"contrast {ratio}:1",
                "evidence": [f"fg={fg_c}", f"bg={bg_c}", f"contrast={ratio}"],
                "fix": "raise text/background contrast to ≥4.5:1",
            }
    return {
        "lane": "accessibility",
        "status": "pass",
        "message": "accessibility ok",
        "evidence": [],
        "fix": "",
    }


def check_copyright_lane(*, prompt: str = "", brief: dict[str, Any] | None = None) -> dict[str, Any]:
    blob = str(prompt or "")
    if isinstance(brief, dict):
        blob += " " + str(brief.get("visual_thesis") or "") + " " + str(brief.get("purpose") or "")
    if _COPYRIGHT_RX.search(blob):
        return {
            "lane": "copyright",
            "status": "fail",
            "message": "copyright risk in materials",
            "evidence": [_COPYRIGHT_RX.search(blob).group(0)],  # type: ignore[union-attr]
            "fix": "replace risky stock/stolen references with licensed or original assets",
        }
    return {
        "lane": "copyright",
        "status": "pass",
        "message": "copyright ok",
        "evidence": [],
        "fix": "",
    }


def check_reference_similarity_lane(
    *,
    reference_lock: dict[str, Any] | None = None,
    visual_diff: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    flag = flags if isinstance(flags, dict) else {}
    sim = flag.get("reference_similarity")
    if sim is None and isinstance(reference_lock, dict):
        sim = reference_lock.get("similarity")
    try:
        score = float(sim) if sim is not None else None
    except (TypeError, ValueError):
        score = None
    # High similarity to reference without intentional lock → fail/warn.
    if score is not None and score >= 0.92 and not (
        isinstance(reference_lock, dict) and reference_lock.get("allow_high_similarity")
    ):
        return {
            "lane": "reference_similarity",
            "status": "fail",
            "message": "similarity too high",
            "evidence": [f"similarity={score}"],
            "fix": "increase differentiation from reference; keep DNA locks only",
        }
    diff = visual_diff if isinstance(visual_diff, dict) else {}
    deltas = diff.get("deltas") if isinstance(diff.get("deltas"), dict) else {}
    # Near-zero change vs reference snapshot can warn.
    if deltas and all(abs(float(v or 0)) < 0.01 for v in list(deltas.values())[:6]):
        return {
            "lane": "reference_similarity",
            "status": "warn",
            "message": "little visual change vs prior",
            "evidence": ["deltas≈0"],
            "fix": "push originality while respecting Brief locks",
        }
    return {
        "lane": "reference_similarity",
        "status": "pass",
        "message": "reference similarity ok",
        "evidence": [],
        "fix": "",
    }


def check_design_system_lane(*, brief: dict[str, Any] | None = None) -> dict[str, Any]:
    src = brief if isinstance(brief, dict) else {}
    tokens = src.get("tokens") if isinstance(src.get("tokens"), dict) else {}
    spacing = tokens.get("spacing") if isinstance(tokens.get("spacing"), dict) else {}
    # Explicit violation flag or non-token spacing values.
    if tokens.get("spacing_violation"):
        return {
            "lane": "design_system",
            "status": "fail",
            "message": "spacing token violation",
            "evidence": ["spacing_token_violation"],
            "fix": "align spacing to design-system tokens",
        }
    raw_spacing = spacing.get("used")
    allowed = spacing.get("allowed")
    if isinstance(raw_spacing, list) and isinstance(allowed, list) and allowed:
        bad = [x for x in raw_spacing if x not in allowed]
        if bad:
            return {
                "lane": "design_system",
                "status": "fail",
                "message": "spacing token violation",
                "evidence": [str(x) for x in bad[:6]],
                "fix": "align spacing to design-system tokens",
            }
    return {
        "lane": "design_system",
        "status": "pass",
        "message": "design system ok",
        "evidence": [],
        "fix": "",
    }


def check_content_lane(*, prompt: str = "", brief: dict[str, Any] | None = None) -> dict[str, Any]:
    blob = str(prompt or "")
    if isinstance(brief, dict):
        blob += " " + str(brief.get("purpose") or "")
    m = _CONTENT_RX.search(blob)
    if m:
        return {
            "lane": "content",
            "status": "fail",
            "message": "content policy violation",
            "evidence": [m.group(0)],
            "fix": "remove disallowed content",
        }
    return {
        "lane": "content",
        "status": "pass",
        "message": "content ok",
        "evidence": [],
        "fix": "",
    }


def check_tool_permission_lane(
    *,
    apply_ops: list[Any] | None = None,
    allowed_ops: set[str] | None = None,
) -> dict[str, Any]:
    ops = [o for o in list(apply_ops or []) if isinstance(o, dict)]
    if not ops:
        return {
            "lane": "tool_permission",
            "status": "pass",
            "message": "tool permission ok",
            "evidence": [],
            "fix": "",
        }
    allow = allowed_ops
    if allow is None:
        from app.services.design.ops.tool_ops_contract import allowed_canvas_tool_keys

        allow = set(allowed_canvas_tool_keys())
    bad: list[str] = []
    for op in ops:
        name = str(op.get("name") or "").strip()
        if name and name not in allow:
            bad.append(name)
    if bad:
        return {
            "lane": "tool_permission",
            "status": "fail",
            "message": "unauthorized tool op",
            "evidence": bad[:8],
            "fix": "drop unauthorized ops; use allow-listed canvas tools only",
        }
    return {
        "lane": "tool_permission",
        "status": "pass",
        "message": "tool permission ok",
        "evidence": [],
        "fix": "",
    }


def compile_governance_repair(lanes: list[dict[str, Any]]) -> dict[str, Any]:
    """FAIL → Repair Plan draft (not canvas ops)."""
    actions: list[dict[str, Any]] = []
    for row in lanes:
        if str(row.get("status") or "") != "fail":
            continue
        actions.append(
            {
                "lane": row.get("lane"),
                "action": "repair",
                "fix": row.get("fix") or "",
                "evidence": list(row.get("evidence") or [])[:6],
            }
        )
    return {
        "source": "governance",
        "applied": False,
        "actions": actions,
        "note": "FAIL→Explain→Repair draft; settle hard-gated until pass",
    }


def run_design_governance_pipeline(
    *,
    brief: dict[str, Any] | None = None,
    observe_facts: dict[str, Any] | None = None,
    strategy: dict[str, Any] | None = None,
    reference_lock: dict[str, Any] | None = None,
    visual_diff: dict[str, Any] | None = None,
    prompt: str = "",
    apply_ops: list[Any] | None = None,
    flags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Full governance check. Deterministic. Never mutates SceneDocument."""
    flag = flags if isinstance(flags, dict) else {}
    lanes = [
        check_brand_lane(
            brief=brief,
            observe_facts=observe_facts,
            prompt=prompt,
            strategy=strategy,
            force_unauthorized=flag.get("unauthorized_colors")
            if isinstance(flag.get("unauthorized_colors"), list)
            else None,
        ),
        check_accessibility_lane(brief=brief),
        check_copyright_lane(prompt=prompt, brief=brief),
        check_reference_similarity_lane(
            reference_lock=reference_lock,
            visual_diff=visual_diff,
            flags=flag,
        ),
        check_design_system_lane(brief=brief),
        check_content_lane(prompt=prompt, brief=brief),
        check_tool_permission_lane(apply_ops=apply_ops),
    ]
    # Preserve lane order from contract.
    by_name = {str(l.get("lane")): l for l in lanes}
    ordered = [by_name[name] for name in GOVERNANCE_LANES if name in by_name]
    fails = [l for l in ordered if str(l.get("status") or "") == "fail"]
    explain = [
        f"{l.get('lane')}: {l.get('message')}"
        for l in ordered
        if str(l.get("status") or "") in ("fail", "warn")
    ]
    status = "fail" if fails else "pass"
    repair = compile_governance_repair(ordered) if fails else None
    summary = f"governance {status} · fails={len(fails)}"
    return parse_design_governance(
        {
            "status": status,
            "lanes": ordered,
            "explain": explain,
            "repair_plan": repair,
            "summary": summary,
            "provider": "basic-local",
        }
    )


def apply_governance_to_runtime(rt: AgentRuntime, result: dict[str, Any]) -> None:
    rt.design_governance = parse_design_governance(result)


def format_governance_for_settle(result: dict[str, Any] | None) -> str:
    """Developer / log dump — never stream this as user chat prose."""
    src = result if isinstance(result, dict) else {}
    if not src:
        return ""
    lines = [
        f"DESIGN_GOVERNANCE: {src.get('status') or ''}",
        str(src.get("summary") or ""),
    ]
    for row in list(src.get("lanes") or []):
        if not isinstance(row, dict):
            continue
        mark = {"pass": "✓", "fail": "✗", "warn": "⚠"}.get(
            str(row.get("status") or ""), "?"
        )
        lines.append(f"{mark} {row.get('lane')}: {row.get('message')}")
    if src.get("explain"):
        lines.append("EXPLAIN:")
        lines.extend(f"- {x}" for x in list(src.get("explain") or [])[:8])
    if src.get("repair_plan"):
        lines.append("REPAIR: draft ready (not applied)")
    return "\n".join(lines)[:1600]


def format_governance_fail_reply(
    result: dict[str, Any] | None, *, locale: str = "zh-CN"
) -> str:
    """User-facing settle reply when governance hard-gates."""
    src = result if isinstance(result, dict) else {}
    explain = [str(x) for x in list(src.get("explain") or [])[:6] if str(x).strip()]
    loc = str(locale or "zh-CN")
    if loc.startswith("zh"):
        head = "设计质量检查未通过："
        foot = "已生成修复草稿（尚未应用到画布）。"
        bullets = "\n".join(f"- {x}" for x in explain) if explain else "- 请根据检查结果调整后重试"
        return f"{head}\n{bullets}\n{foot}"[:2000]
    head = "Design quality check failed:"
    foot = "Repair draft ready (not applied)."
    bullets = "\n".join(f"- {x}" for x in explain) if explain else "- Adjust and retry"
    return f"{head}\n{bullets}\n{foot}"[:2000]


def _gate_intent_of(rt: AgentRuntime) -> str:
    """Frozen classify label. Empty / create|edit → chat / canvas_op."""
    flags = getattr(rt, "flags", None)
    if isinstance(flags, dict):
        frozen = str(flags.get("gate_intent") or "").strip()
        if frozen:
            return normalize_user_intent(frozen)
    classified = str(getattr(rt, "classified_intent", None) or "").strip()
    return normalize_user_intent(classified)


def _has_design_craft_contract(rt: AgentRuntime) -> bool:
    """True when a real design pass left Brief / Strategy / reference — not a tool-op."""
    candidates: list[Any] = [
        getattr(rt, "design_brief", None),
        getattr(rt, "design_strategy", None),
        getattr(rt, "design_research", None),
        getattr(rt, "reference_lock", None),
        getattr(rt, "reference_dna", None),
    ]
    return any(isinstance(blob, dict) and blob for blob in candidates)


def should_route_to_governance(rt: AgentRuntime) -> bool:
    """User-facing 7-lane checklist: design intent, a painted craft pass, and a contract."""
    if _gate_intent_of(rt) != "design":
        return False
    st = getattr(rt, "run", None)
    if st is None or not bool(getattr(st, "painted", False)):
        return False
    return _has_design_craft_contract(rt)


def should_skip_design_governance(rt: AgentRuntime) -> bool:
    """Inverse of ``should_route_to_governance`` (Review belt / tests)."""
    return not should_route_to_governance(rt)


def skipped_governance_result() -> dict[str, Any]:
    """Settle continues; do not emit a user-facing quality-check panel."""
    return {
        "status": "pass",
        "skipped": True,
        "lanes": [],
        "explain": [],
        "summary": "governance skipped · chat/canvas_op",
    }


def run_design_governance(rt: AgentRuntime) -> dict[str, Any]:
    """Execute governance gate and stash. Always returns a report."""
    flags = rt.flags if isinstance(rt.flags, dict) else {}
    brief = rt.design_brief if isinstance(rt.design_brief, dict) else None
    result = run_design_governance_pipeline(
        brief=brief,
        observe_facts=getattr(rt, "observe_facts", None)
        if isinstance(getattr(rt, "observe_facts", None), dict)
        else None,
        strategy=getattr(rt, "design_strategy", None)
        if isinstance(getattr(rt, "design_strategy", None), dict)
        else None,
        reference_lock=getattr(rt, "reference_lock", None)
        if isinstance(getattr(rt, "reference_lock", None), dict)
        else None,
        visual_diff=getattr(rt, "visual_diff", None)
        if isinstance(getattr(rt, "visual_diff", None), dict)
        else None,
        prompt=str(getattr(rt, "prompt", "") or ""),
        apply_ops=list(getattr(rt, "apply_ops", None) or []),
        flags=flags,
    )
    apply_governance_to_runtime(rt, result)
    return result


def _lane_activity_items(result: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for i, row in enumerate(list(result.get("lanes") or [])):
        if not isinstance(row, dict):
            continue
        lane = str(row.get("lane") or "").strip()
        if not lane:
            continue
        items.append(
            {
                "id": f"gov-lane-{lane or i}",
                "name": lane,
                "summary": str(row.get("status") or "").strip() or "pass",
            }
        )
    return items


def _emit_user_quality_check(
    *,
    status: str,
    running: bool,
    result: dict[str, Any] | None = None,
) -> None:
    """One timeline row. Not ``explored`` (that merges into 设计材料 and jumps the panel)."""
    payload: dict[str, Any] = {
        "type": "activity",
        "id": "design-governance",
        "kind": "tool",
        "status": "running" if running else ("done" if status == "pass" else "error"),
        "code": "design_quality_check",
        "visibility": "user",
        "item": {
            "id": "design-quality-check",
            "name": "design_quality_check",
            "summary": "" if running else status,
        },
    }
    if not running:
        payload["detail"] = status
        items = _lane_activity_items(result or {})
        if items:
            payload["items"] = items
            payload["item"]["summary"] = status
    _emit(payload)


async def gate_governance_before_settle(rt: AgentRuntime) -> dict[str, Any]:
    """Design-branch hard gate. FAIL emits explain; caller must not claim success.

    Chat / canvas_op / unpainted / no Brief never enter this emit path.
    User stream is one sequential ``activity`` row (not a sibling panel).
    Structured ``design_governance`` stays developer-only.
    """
    if should_skip_design_governance(rt):
        return skipped_governance_result()
    st = rt.run
    _emit_user_quality_check(status="pass", running=True)
    try:
        result = run_design_governance(rt)
        status = str(result.get("status") or "pass")
        fails = sum(
            1
            for l in list(result.get("lanes") or [])
            if isinstance(l, dict) and l.get("status") == "fail"
        )
        st.push_log(
            phase="design_governance",
            summary=str(result.get("summary") or "")[:160],
            status=status,
            fails=fails or None,
        )
        _emit_user_quality_check(status=status, running=False, result=result)
        _emit(
            {
                "type": "design_governance",
                "visibility": "developer",
                "status": status,
                "skipped": False,
                "lanes": [
                    {
                        "lane": l.get("lane"),
                        "status": l.get("status"),
                        "message": l.get("message"),
                    }
                    for l in list(result.get("lanes") or [])
                    if isinstance(l, dict)
                ],
                "explain": list(result.get("explain") or [])[:8],
                "summary": str(result.get("summary") or "")[:240],
            }
        )
        # Developer-only essay — never dump into user chat analysis_delta.
        block = format_governance_for_settle(result)
        if block:
            _emit(
                {
                    "type": "analysis_delta",
                    "text": block[:1200],
                    "visibility": "developer",
                }
            )
        if status == "fail":
            _emit(
                {
                    "type": "governance_fail",
                    "visibility": "user",
                    "explain": list(result.get("explain") or [])[:8],
                    "repair_plan": result.get("repair_plan"),
                }
            )
        return result
    except Exception as err:  # noqa: BLE001
        # Fail-closed on governance errors: do not silent-pass settle.
        st.note_error(f"design_governance_failed: {err}"[:240])
        failed = parse_design_governance(
            {
                "status": "fail",
                "lanes": [
                    {
                        "lane": "tool_permission",
                        "status": "fail",
                        "message": "governance engine error",
                        "evidence": [str(err)[:120]],
                        "fix": "retry governance",
                    }
                ],
                "explain": [f"governance engine error: {err}"[:200]],
                "summary": "governance fail · engine error",
            }
        )
        apply_governance_to_runtime(rt, failed)
        _emit_user_quality_check(status="fail", running=False, result=failed)
        return failed
