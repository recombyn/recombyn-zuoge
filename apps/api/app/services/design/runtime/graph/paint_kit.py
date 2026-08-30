from __future__ import annotations

"""Paint-stage tool kit, artboard helpers, and ops logging."""

import logging
import re
from typing import Any
from app.services.design.ops.tool_ops_contract import format_canvas_tools_details
from app.services.design.runtime.host import (
    assemble_stage_system,
)
from app.services.design.runtime.host.ops_gate import _op_name
from app.services.design.runtime.host.placement import (
    _focus_frame_from_rt,
    _format_spatial_placement,
)
from app.services.design.runtime.models_route import normalize_user_intent
from app.services.design.runtime.graph.state import (
    _DEFAULT_PAINT_CREATE_TOOLS,
    _DEFAULT_PAINT_EDIT_TOOLS,
    format_design_brief_for_paint,
)

_log = logging.getLogger(__name__)



def _ops_patch_too_broad(
    ops: list[dict[str, Any]],
    scene_nodes: list[dict[str, Any]],
    *,
    intent: str,
) -> tuple[bool, str]:
    """Heuristic: edit rounds should not wipe / flood the canvas in one batch."""
    if (intent or "").strip().lower() == "create":
        return False, ""
    batch = [o for o in (ops or []) if isinstance(o, dict)]
    if not batch:
        return False, ""
    names = [_op_name(o) for o in batch]
    wipe = {"clear_canvas", "reset_scene", "delete_all", "clear_artboard"}
    if any(n in wipe for n in names):
        return True, "single-round canvas wipe op"
    deletes = [
        n for n in names if n.startswith("delete") or n in ("remove_node", "remove_nodes")
    ]
    creates = [
        n
        for n in names
        if n.startswith("create_") or n in ("add_node", "add_text", "add_image", "add_shape")
    ]
    n_scene = len([n for n in (scene_nodes or []) if isinstance(n, dict) and n.get("id")])
    if n_scene >= 4 and len(deletes) >= max(6, int(0.55 * n_scene)):
        return True, f"too many deletes ({len(deletes)}/{n_scene})"
    if n_scene >= 1 and len(creates) > 40:
        return True, f"too many creates on edit ({len(creates)})"
    if len(batch) > 60:
        return True, f"too many ops ({len(batch)})"
    return False, ""

def _count_ok_creates(
    paint_ops: list[dict[str, Any]] | None,
    op_results: list[dict[str, Any]] | None,
    failed_ids: set[str],
) -> int:
    """Count create_* ops that FE reported ok (by op_id or name)."""
    if not op_results:
        return 0
    ok_creates = 0
    for op in paint_ops or []:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        if not name.startswith("create_"):
            continue
        oid = str(op.get("op_id") or "")
        if oid and oid in failed_ids:
            continue
        if oid:
            matched = next(
                (
                    r
                    for r in op_results
                    if isinstance(r, dict) and str(r.get("op_id") or "") == oid
                ),
                None,
            )
            if matched is not None and matched.get("ok", True):
                ok_creates += 1
            continue
        if any(
            isinstance(r, dict)
            and r.get("ok", True)
            and str(r.get("name") or "") == name
            for r in op_results
        ):
            ok_creates += 1
    return ok_creates


def _append_empty_board_issues(
    issues: list[str],
    *,
    intent_l: str,
    clean_nodes: list[dict[str, Any]],
    clean_frames: list[dict[str, Any]],
    scene_lag: bool,
) -> list[str] | None:
    """Append empty-board issues. Returns a finished list when caller should stop."""
    if intent_l not in ("edit", "create"):
        return None
    if not clean_nodes and not clean_frames:
        if scene_lag:
            return []
        issues.append("canvas empty after apply (no nodes/frames)")
        return issues
    if (
        clean_frames
        and not clean_nodes
        and all(bool(f.get("is_empty")) for f in clean_frames)
    ):
        if scene_lag:
            return []
        issues.append("artboard still empty after apply")
    return None


def _structure_verify_issues(
    *,
    nodes: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    painted: bool,
    intent: str,
    paint_ops: list[dict[str, Any]] | None = None,
    op_results: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Deterministic canvas sanity checks — fact flags only, no routing.

    When FE reports create ops as ok but inventory is still empty, treat as
    scene-sync lag (do not force re-paint). Trust per-op results over a stale
    empty snapshot.
    """
    if not painted:
        return []
    issues: list[str] = []
    clean_nodes = [n for n in (nodes or []) if isinstance(n, dict) and n.get("id")]
    clean_frames = [f for f in (frames or []) if isinstance(f, dict) and f.get("id")]
    intent_l = (intent or "").strip().lower()

    failed_ids = {
        str(r.get("op_id") or "")
        for r in (op_results or [])
        if isinstance(r, dict) and not r.get("ok", True)
    }
    ok_creates = _count_ok_creates(paint_ops, op_results, failed_ids)
    # FE said creates applied — empty inventory is lag, not a structural miss.
    scene_lag = ok_creates > 0 and not clean_nodes

    early = _append_empty_board_issues(
        issues,
        intent_l=intent_l,
        clean_nodes=clean_nodes,
        clean_frames=clean_frames,
        scene_lag=scene_lag,
    )
    if early is not None:
        return early
    zero_box = 0
    for n in clean_nodes[:80]:
        try:
            w = float(n.get("w") or 0)
            h = float(n.get("h") or 0)
        except (TypeError, ValueError):
            w, h = 0.0, 0.0
        if w <= 0 or h <= 0:
            zero_box += 1
    if clean_nodes and zero_box >= max(3, int(0.7 * len(clean_nodes))):
        issues.append(f"most nodes have invalid size ({zero_box}/{len(clean_nodes)})")
    return issues

# Multi-screen / multi-poster sets in one paint batch (login + home + …).
_MAX_CREATE_FRAMES_PER_BATCH = 8


def _op_tool_name(o: dict[str, Any]) -> str:
    return str(o.get("name") or "").strip()


def _ops_have_create_frame(ops: list[dict[str, Any]]) -> bool:
    return _count_create_frame_ops(ops) > 0


def _count_create_frame_ops(ops: list[dict[str, Any]]) -> int:
    n = 0
    for o in ops or []:
        if isinstance(o, dict) and _op_tool_name(o) == "create_frame":
            n += 1
    return n


def _is_multi_artboard_batch(ops: list[dict[str, Any]]) -> bool:
    """Two+ create_frame → FE applies each plate; host must not collapse to one."""
    return _count_create_frame_ops(ops) >= 2


def _cap_create_frame_ops(
    ops: list[dict[str, Any]],
    *,
    limit: int = _MAX_CREATE_FRAMES_PER_BATCH,
) -> list[dict[str, Any]]:
    """Keep at most ``limit`` create_frame ops; content after a dropped frame still applies."""
    if limit <= 0:
        return [o for o in (ops or []) if isinstance(o, dict)]
    out: list[dict[str, Any]] = []
    kept = 0
    for o in ops or []:
        if not isinstance(o, dict):
            continue
        if _op_tool_name(o) == "create_frame":
            if kept >= limit:
                continue
            kept += 1
        out.append(o)
    return out


def _wh_from_create_frame_ops(ops: list[dict[str, Any]]) -> tuple[int, int]:
    """First create_frame width/height in a validated op batch."""
    for o in ops or []:
        if not isinstance(o, dict):
            continue
        if _op_tool_name(o) != "create_frame":
            continue
        args = o.get("args") if isinstance(o.get("args"), dict) else {}
        try:
            fw = int(args.get("width") or 0)
            fh = int(args.get("height") or 0)
        except (TypeError, ValueError):
            continue
        if fw > 0 and fh > 0:
            return fw, fh
    return 0, 0


def _strip_create_frame_ops(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Host opens the artboard; drop model create_frame to avoid a second plate."""
    out: list[dict[str, Any]] = []
    for o in ops or []:
        if not isinstance(o, dict):
            continue
        if _op_tool_name(o) == "create_frame":
            continue
        out.append(o)
    return out


def _paint_ops_for_host(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Single create_frame → host owns the plate (strip). Multi → keep create_frame ops."""
    capped = _cap_create_frame_ops(ops)
    if _is_multi_artboard_batch(capped):
        return capped
    if _ops_have_create_frame(capped):
        return _strip_create_frame_ops(capped)
    return capped

def _prompt_compact_len(prompt: str | None) -> int:
    return len(re.sub(r"\s+", "", str(prompt or "")))

def _is_animation_paint_turn(rt: Any) -> bool:
    if bool((getattr(rt, "flags", None) or {}).get("animation_path")):
        return True
    return normalize_user_intent(getattr(rt, "classified_intent", None)) == "animation"


def _format_motion_brief_for_paint(brief: Any) -> str:
    if not isinstance(brief, dict) or not brief:
        return ""
    lines: list[str] = []
    goal = str(brief.get("goal") or "").strip()
    if goal:
        lines.append(f"- goal: {goal[:600]}")
    if "loop" in brief:
        lines.append(f"- loop: {bool(brief.get('loop'))}")
    tempo = str(brief.get("tempo") or "").strip()
    if tempo:
        lines.append(f"- tempo: {tempo}")
    movers = brief.get("movers")
    if movers is not None:
        lines.append(f"- movers: {movers}")
    return "\n".join(lines)


def _is_lean_paint_turn(rt: Any) -> bool:
    """Slim paint path for LLM-classified canvas_op only (no length/keyword guess)."""
    if bool(getattr(rt, "images", None)):
        return False
    return normalize_user_intent(getattr(rt, "classified_intent", None)) == "canvas_op"

def _paint_tool_keys_for_turn(rt: Any) -> list[str]:
    """Structural paint tool kit — not hard-coded to one shape type.

    - Always: create_shape + create_text.
    - create_frame: design/create only — canvas_op uses infinite-canvas tools.
    - create_icon / create_svg: UI glyphs & marks (else models fake icons with emoji text).
    - create_image: attachments **or** create/design turns (genPrompt hero / lettering).
    - create_lottie: create/design turns (motion / looping UI icons) — must be in TOOL_DETAILS
      or the model silently falls back to create_image.
    - update/delete when paint_lane=edit and scene has nodes.
    - Plus preferred_tools from loaded skills and any tools already in tools_loaded.
    - animation intent: create_lottie (+ update_node on edit) only — no poster/image stand-ins.
    """
    from app.services.design.runtime.graph.turns import _resolve_paint_want
    st = rt.run
    classified = normalize_user_intent(
        getattr(rt, "classified_intent", None) or ""
    )
    want = _resolve_paint_want(rt)
    has_images = bool(getattr(rt, "images", None))
    nodes = [
        n for n in (getattr(rt, "scene_nodes", None) or [])
        if isinstance(n, dict) and n.get("id")
    ]

    # Dedicated animation path — never substitute create_image / create_frame.
    if _is_animation_paint_turn(rt):
        keys: list[str] = ["create_lottie"]
        if want == "edit" and nodes:
            keys.append("update_node")
        return keys

    keys = ["create_shape", "create_text"]
    # Intent LLM owns the split: only design/create may open a plate.
    allow_frame = classified == "design" and want == "create"
    if allow_frame:
        keys.insert(0, "create_frame")
    # Glyph tools must be visible or paint substitutes emoji / multi-shape decoys.
    if want in ("create", "edit"):
        for k in ("create_icon", "create_svg"):
            if k not in keys:
                keys.append(k)
    # Without this, no-ref poster create never sees create_image in TOOL_DETAILS
    # and falls back to shape-only "programmer art".
    if has_images or want == "create":
        keys.append("create_image")
    # Motion / Lottie must be visible on create (and edit) or paint substitutes create_image.
    if want in ("create", "edit"):
        keys.append("create_lottie")
    if want == "edit" and nodes:
        for k in ("update_node", "delete_nodes"):
            if k not in keys:
                keys.append(k)

    # Loaded skill preferred_tools → TOOL_DETAILS (icon_set / mobile_app_ui / …).
    skill_keys = [str(k).strip() for k in (st.skills_loaded or []) if str(k).strip()]
    if skill_keys:
        try:
            from app.services.design.prompts.skill_store import preferred_tools_allowlist

            allow = preferred_tools_allowlist(
                skill_keys, scene=str(getattr(rt, "scene_key", None) or "")
            )
            if allow:
                for k in sorted(allow):
                    if k and k not in keys:
                        keys.append(k)
        except Exception:
            _log.debug("preferred_tools merge skipped", exc_info=True)

    for raw in st.tools_loaded or []:
        k = str(raw or "").strip()
        if k and k not in keys:
            keys.append(k)
    return keys[:14]

def _ensure_paint_tool_details(rt: Any) -> None:
    """Guarantee TOOL_DETAILS before the paint stage (no narrate-only escape)."""
    from app.services.design.runtime.graph.turns import _resolve_paint_want
    st = rt.run
    keys = _paint_tool_keys_for_turn(rt)
    if not keys:
        want = _resolve_paint_want(rt, st.intent)
        keys = list(
            _DEFAULT_PAINT_EDIT_TOOLS if want == "edit" else _DEFAULT_PAINT_CREATE_TOOLS
        )
    details = format_canvas_tools_details(keys, rules=rt.rules)
    if not details:
        return
    rt.pending_tool_details = "TOOL_DETAILS:\n" + details
    for k in keys:
        if k not in st.tools_loaded:
            st.tools_loaded.append(k)

def _paint_ops_system(rt: Any) -> str:
    """Paint stage system via assemble_stage_system (pack-only).

    Fonts catalog only when create_text / create path may need typefaces —
    Decide never gets fonts (keeps decide tokens lean).
    """
    flags = getattr(rt, "flags", None)
    if not isinstance(flags, dict):
        flags = {}
    ask_mode = str(flags.get("mode") or "").strip().lower() == "ask"
    fonts_block = ""
    want_fonts = True
    anim = _is_animation_paint_turn(rt)
    try:
        from app.services.design.runtime.graph.turns import _resolve_paint_want

        want = _resolve_paint_want(rt)
        lean = _is_lean_paint_turn(rt)
        # Lean canvas_op / animation rarely need font catalog.
        want_fonts = not anim and (not lean or want == "create")
    except Exception:
        want_fonts = not anim
    if want_fonts:
        try:
            from app.services.fonts_store import format_fonts_catalog

            fonts_block = format_fonts_catalog()
        except Exception:
            fonts_block = ""
    catalog = [fonts_block] if fonts_block else None
    if anim:
        anim_overlay = (
            "ANIMATION_PATH (authoritative for this turn):\n"
            "- Emit create_lottie with a tight genPrompt (what moves, loop vs one-shot, "
            "tempo, colors, purpose). Prefer FOCUS / open 动画工作台 when present.\n"
            "- Never emit create_frame, create_image, or create_shape as a motion stand-in.\n"
            "- Do NOT open a poster loading artboard. Size via create_lottie width/height.\n"
            "- Follow SKILL_DETAILS (animation_workbench) and MOTION_BRIEF when present."
        )
        catalog = [*(catalog or []), anim_overlay]
    return assemble_stage_system(
        rt.rules,
        stage="paint",
        ask_mode=ask_mode,
        persona=str(getattr(rt, "persona", "") or ""),
        catalog_blocks=catalog,
        locale=str((getattr(rt, "flags", None) or {}).get("output_locale") or "") or None,
    )


def _paint_ops_user(rt: Any) -> str:
    from app.services.design.runtime.graph.turns import _thought_prompt_variables

    vars_ = _thought_prompt_variables(rt, stage="paint")
    spatial = (
        getattr(rt, "spatial_summary", None)
        if isinstance(getattr(rt, "spatial_summary", None), dict)
        else {}
    )
    focus_frame = _focus_frame_from_rt(rt)
    spatial_hint = _format_spatial_placement(spatial, focus_frame=focus_frame)
    lean = _is_lean_paint_turn(rt)
    anim = _is_animation_paint_turn(rt)
    parts = [
        f"USER_PROMPT:\n{vars_['prompt']}",
        f"CANVAS_SIZE: {vars_['canvas_size']}",
        f"SCENE: {vars_['scene']}",
        vars_["scene_digest"],
        spatial_hint,
        vars_["plan_block"],
        vars_["pending_blocks"],
    ]
    motion = _format_motion_brief_for_paint(
        (getattr(rt, "flags", None) or {}).get("motion_brief")
    )
    if anim and motion:
        parts.append(
            "MOTION_BRIEF (authoritative — execute this; genPrompt must match):\n"
            + motion
        )
    brief = format_design_brief_for_paint(getattr(rt, "design_brief", None))
    skip_design_brief = bool(
        (getattr(rt, "flags", None) or {}).get("skip_design_brief")
    )
    if brief and not lean and not anim and not skip_design_brief:
        parts.append(
            "DESIGN_BRIEF (authoritative — execute this; genPrompt must match):\n"
            + brief[:2000]
        )
    if anim:
        skill_keys = list(getattr(getattr(rt, "run", None), "skills_loaded", None) or [])
        if skill_keys:
            from app.services.design.prompts.skill_store import format_skills_details

            paint_skills = format_skills_details(
                keys=skill_keys,
                scene=str(getattr(rt, "scene_key", "") or ""),
                role="paint",
                stage="paint",
                has_design_brief=False,
            )
            if paint_skills:
                parts.append(paint_skills[:4000])
        parts.append(
            "ANIMATION_PAINT: emit create_lottie only (update_node on edit). "
            "Never create_frame / create_image. Prefer FOCUS animation workbench."
        )
    elif not lean:
        skill_keys = list(getattr(getattr(rt, "run", None), "skills_loaded", None) or [])
        if skill_keys:
            from app.services.design.prompts.skill_store import format_skills_details

            paint_skills = format_skills_details(
                keys=skill_keys,
                scene=str(getattr(rt, "scene_key", "") or ""),
                role="paint",
                stage="paint",
                has_design_brief=bool(brief),
            )
            if paint_skills:
                parts.append(paint_skills[:4000])
        edit_ctx = str(vars_.get("edit_context") or "").strip()
        if edit_ctx:
            parts.append(edit_ctx[:2500])
    else:
        parts.append(
            "LEAN_CANVAS_OP: do NOT emit create_frame / open a new artboard. "
            "Infinite canvas — place create_* with free-canvas world x/y "
            "(near existing boards is fine). Only set frameId when FOCUS_FRAME_ID "
            "or a user @ board is already set. "
            "DELETE SAFETY: never delete_nodes an artboard/frame id "
            "(use delete_frame). COLOR: match user color intent via SCENE fill/stroke."
        )
    parts.append(vars_["error_block"])
    parts.append("Emit PaintOpsSchema now: non-empty tool_ops first.")
    user = "\n\n".join(p for p in parts if str(p or "").strip())
    _log.debug("paint user_chars=%s lean=%s anim=%s", len(user), lean, anim)
    return user

def _op_errors_for_log(errors: list[Any] | None, *, limit: int = 20) -> list[str] | None:
    out: list[str] = []
    for e in list(errors or [])[:limit]:
        s = str(e or "").strip()
        if s:
            out.append(s[:400])
    return out or None

def _op_error_codes(errors: list[Any] | None, *, limit: int = 4) -> list[str]:
    codes: list[str] = []
    for e in list(errors or []):
        s = str(e or "").strip()
        if not s:
            continue
        code = s
        if "code=" in s:
            code = s.split("code=", 1)[1].split(";", 1)[0].strip()
        if code and code not in codes:
            codes.append(code)
        if len(codes) >= limit:
            break
    return codes

def _ops_for_log(ops: list[dict[str, Any]] | None, *, limit: int = 30) -> list[dict[str, Any]]:
    """Compact tool ops for execution_log (name + truncated args)."""
    out: list[dict[str, Any]] = []
    for op in list(ops or [])[:limit]:
        if not isinstance(op, dict):
            continue
        name = str(op.get("name") or "").strip()
        args = op.get("args") if isinstance(op.get("args"), dict) else {}
        slim: dict[str, Any] = {}
        for k, v in list(args.items())[:12]:
            key = str(k)[:48]
            if isinstance(v, (int, float, bool)) or v is None:
                slim[key] = v
            elif isinstance(v, str):
                slim[key] = v[:160]
            elif isinstance(v, (list, dict)):
                slim[key] = str(v)[:160]
            else:
                slim[key] = str(v)[:80]
        row: dict[str, Any] = {"name": name or "op"}
        if slim:
            row["args"] = slim
        out.append(row)
    return out

__all__ = [
    '_ops_patch_too_broad',
    '_structure_verify_issues',
    '_ops_have_create_frame',
    '_count_create_frame_ops',
    '_is_multi_artboard_batch',
    '_cap_create_frame_ops',
    '_wh_from_create_frame_ops',
    '_strip_create_frame_ops',
    '_paint_ops_for_host',
    '_prompt_compact_len',
    '_is_lean_paint_turn',
    '_is_animation_paint_turn',
    '_format_motion_brief_for_paint',
    '_paint_tool_keys_for_turn',
    '_ensure_paint_tool_details',
    '_paint_ops_system',
    '_paint_ops_user',
    '_op_errors_for_log',
    '_op_error_codes',
    '_ops_for_log',
]
