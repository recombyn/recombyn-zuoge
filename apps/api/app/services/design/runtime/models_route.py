"""LangChain-style model routing for the design agent runtime graph.

Flow (recommended LC pattern):
  1) Router node: cheap model + structured output → ``ModelRouteDecision``
  2) Map ``lane`` → catalog id via Admin ``precheck.model_threshold``
  3) Lock / user Auto overrides / vision soft-switch / fallback_chain

Lanes (not difficulty tiers):
  - fast      — Q&A, tiny tweaks, no layout redesign
  - standard  — typical canvas edits / moderate posters
  - reasoning — blank create, multi-artboard, design systems, hard multi-step
  - vision    — must understand attached images
  - image     — image-generation catalog slot (not a text chat lane)

"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)


class IntentClassifyError(RuntimeError):
    """Intent classification failed — no heuristic fallback."""


class ModelRouteError(RuntimeError):
    """Model route classification failed — no heuristic fallback."""


ROUTE_LANES = ("fast", "standard", "reasoning", "vision")
IMAGE_SLOT = "image"

LANE_LABELS_ZH = {
    "fast": "轻量",
    "standard": "标准",
    "reasoning": "推理",
    "vision": "看图",
    "image": "生图",
}

_ROUTER_SYSTEM_KEY = "precheck.router_system"
_INTENT_SYSTEM_KEY = "agent.prompt.intent_classify"


class ModelRouteDecision(BaseModel):
    """Structured router output (LangChain ``response_format`` / ``with_structured_output``)."""

    lane: Literal["fast", "standard", "reasoning", "vision"] = Field(
        description="Model lane for this turn",
    )
    needs_image_gen: bool = Field(
        default=False,
        description="True when the user needs AI image generation",
    )
    rationale: str = Field(
        default="",
        description="Short reason for the lane choice",
    )


# Gate intents — judged by LLM against the canvas tools catalog.
USER_INTENTS = ("chat", "canvas_op", "design")
# Continues into paint / decide (not chat-end).
CANVAS_WORK_INTENTS = frozenset({"canvas_op", "design"})
# Paint tool family for canvas_op / design (create_* vs update_*).
PAINT_LANES = ("create", "edit")
# Ask pending proposal side-channel (only when PENDING_PROPOSAL is injected).
PROPOSAL_ACTIONS = ("apply", "dismiss", "revise")
# Host session meta-commands (clear chat / stop generation) — not canvas work.
SESSION_ACTIONS = ("clear_context", "stop")


class ClarificationOption(BaseModel):
    """A visible target choice with its verified scene-node identity."""

    label: str = Field(description="Human-readable target label")
    target_id: str = Field(description="Matching id from SCENE_TARGETS")


class DesignPlan(BaseModel):
    """Typed hand-off from intent classification to execution.

    This is deliberately deterministic for direct canvas edits. Creative design
    still expands it in the design stage, while all stages share the same
    target, constraint and acceptance vocabulary.
    """

    goal: str
    intent: Literal["canvas_op", "design"]
    paint_lane: Literal["create", "edit"]
    target_node_ids: list[str] = Field(default_factory=list)
    target_frame_id: str = ""
    constraints: list[str] = Field(default_factory=list)
    candidate_operations: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)


def build_design_plan(
    *,
    prompt: str,
    intent: str,
    paint_lane: str,
    focus_frame_id: str | None,
    scene_nodes: list[dict[str, Any]] | None,
) -> DesignPlan | None:
    """Create the stable minimal plan used by deterministic edit execution."""
    if intent not in CANVAS_WORK_INTENTS or paint_lane not in PAINT_LANES:
        return None
    text = str(prompt or "").strip()
    target_ids: list[str] = []
    # Choice chips write this exact, machine-readable marker into the next turn.
    match = re.search(r"(?:^|\n)id:\s*([^\s]+)", text)
    if match:
        candidate = match.group(1).strip()[:64]
        live_ids = {str(node.get("id") or "").strip() for node in (scene_nodes or []) if isinstance(node, dict)}
        if candidate in live_ids:
            target_ids.append(candidate)
    operation = "create_node" if paint_lane == "create" else "update_node"
    return DesignPlan(
        goal=text[:1200],
        intent=intent,
        paint_lane=paint_lane,
        target_node_ids=target_ids,
        target_frame_id=str(focus_frame_id or "").strip()[:64],
        constraints=["preserve_unselected_nodes"] if paint_lane == "edit" else [],
        candidate_operations=[operation],
        acceptance_criteria=["tool_operations_confirmed", "scene_feedback_confirmed"],
    )


class IntentClassifyDecision(BaseModel):
    """Narrow intent gate before decide / paint.

    - chat: no canvas work
    - canvas_op: request is achievable with catalog canvas tools (create_shape,
      update_node, …) — direct tool path, no methodology skills
    - design: needs design composition / creative judgment beyond a single tool op
    - proposal_action: only when a PENDING_PROPOSAL block is present
    - session_action: host UI control (clear chat / stop) — intent stays chat
    """

    intent: Literal["chat", "canvas_op", "design"] = Field(
        default="chat",
        description=(
            "chat=greet/end; canvas_op=doable via canvas tool catalog; "
            "design=creative layout/page/poster work"
        ),
    )
    paint_lane: Literal["create", "edit", ""] = Field(
        default="",
        description=(
            "When intent is canvas_op or design: create=add new nodes; "
            "edit=change existing. Empty when intent=chat."
        ),
    )
    proposal_action: Literal["apply", "dismiss", "revise", ""] = Field(
        default="",
        description=(
            "Only when PENDING_PROPOSAL is present: apply=confirm held ops; "
            "dismiss=cancel proposal; revise=change requirements and continue; "
            "empty=no pending / ignore pending"
        ),
    )
    session_action: Literal["clear_context", "stop", ""] = Field(
        default="",
        description=(
            "Host meta-command: clear_context=new chat / wipe dialogue memory; "
            "stop=abort in-flight generation; empty=normal turn"
        ),
    )
    reply: str = Field(
        default="",
        description=(
            "Short reply in the user's language when intent=chat or "
            "proposal_action=dismiss; empty otherwise"
        ),
    )
    needs_clarification: bool = Field(
        default=False,
        description=(
            "True only when an edit/delete/reorder request has multiple plausible "
            "scene targets and neither selection nor target chip resolves it."
        ),
    )
    clarification: str = Field(
        default="",
        description=(
            "One short, user-language question when needs_clarification=true; "
            "empty otherwise."
        ),
    )
    clarification_options: list[ClarificationOption] = Field(
        default_factory=list,
        description=(
            "Up to four concrete target labels from the live scene when "
            "needs_clarification=true; empty otherwise."
        ),
    )
    rationale: str = Field(
        default="",
        description="Short reason — cite tool names from the catalog when canvas_op",
    )


def normalize_session_action(raw: str | None) -> str:
    s = str(raw or "").strip().lower()
    if s in SESSION_ACTIONS:
        return s
    return ""


def normalize_proposal_action(
    raw: str | None, *, has_pending: bool
) -> str:
    """Return apply|dismiss|revise|'' — empty when no pending proposal."""
    if not has_pending:
        return ""
    s = str(raw or "").strip().lower()
    if s in PROPOSAL_ACTIONS:
        return s
    return ""


def _pending_proposal_ready(pending: dict[str, Any] | None) -> bool:
    return bool(
        isinstance(pending, dict) and pending.get("ops") and pending.get("id")
    )


def _pending_proposal_user_block(pending: dict[str, Any]) -> str:
    detail = str(pending.get("detail") or "").strip()
    pid = str(pending.get("id") or "").strip()
    return (
        "PENDING_PROPOSAL (Ask mode — ops are held until confirmed):\n"
        f"proposal_id={pid}\n"
        f"ops_summary={detail or '(ops prepared)'}\n"
        "Set proposal_action: apply=user confirms held ops; "
        "dismiss=user cancels; revise=user wants changes — then also set "
        "intent to canvas_op|design as usual.\n"
        "Do NOT set intent=chat for a confirmation like 确认/ok/yes.\n\n"
    )


def normalize_paint_lane(raw: str | None, *, intent: str) -> str:
    if intent == "chat":
        return ""
    s = str(raw or "").strip().lower()
    if s in PAINT_LANES:
        return s
    return "create"


def normalize_user_intent(raw: str | None) -> str:
    """Accept only the canonical classifier intents."""
    s = str(raw or "").strip().lower()
    if s in USER_INTENTS:
        return s
    return "chat"


def normalize_intent_decision(
    raw_intent: str | None,
    raw_lane: str | None = None,
) -> tuple[str, str]:
    """Return the canonical (intent, paint_lane) pair."""
    s = str(raw_intent or "").strip().lower()
    lane = str(raw_lane or "").strip().lower()
    intent = normalize_user_intent(s)
    return intent, normalize_paint_lane(lane, intent=intent)


def paint_ops_intent(classified: str | None, paint_lane: str | None = None) -> str:
    """Map gate → paint tool lane (create | edit)."""
    intent = normalize_user_intent(classified)
    lane = normalize_paint_lane(paint_lane, intent=intent)
    if lane in PAINT_LANES:
        return lane
    return "create"


def _split_list(raw: str, seps: str = "|;,") -> list[str]:


    if not raw:
        return []
    parts = re.split(f"[{re.escape(seps)}]+", raw)
    return [p.strip() for p in parts if p.strip()]


def normalize_lane(raw: str | None) -> str:
    s = str(raw or "").strip().lower()
    if not s:
        return "standard"
    if s in ROUTE_LANES or s == IMAGE_SLOT:
        return s
    return "standard"


def parse_model_lanes(rules: dict[str, str] | None) -> dict[str, str]:
    """Parse Admin lane→model map from ``precheck.model_threshold``."""
    raw = str((rules or {}).get("precheck.model_threshold") or "").strip()
    out: dict[str, str] = {}
    if not raw:
        return out
    for part in raw.split(";"):
        part = part.strip()
        if not part or "->" not in part:
            continue
        left, right = part.split("->", 1)
        left_l = left.strip().lower()
        allowed = set(ROUTE_LANES) | {IMAGE_SLOT, "else"}
        if left_l not in allowed:
            continue
        key = left_l
        val = right.strip()
        if key and val:
            out[key] = val
    if "else" in out:
        out.setdefault("fast", out["else"])
        out.setdefault("standard", out["else"])
    else:
        else_src = out.get("standard") or out.get("reasoning") or out.get("fast")
        if else_src:
            out["else"] = else_src
    return out


def parse_fallback_chain(rules: dict[str, str] | None) -> list[str]:
    raw = str((rules or {}).get("precheck.fallback_chain") or "").strip()
    if not raw:
        lanes = parse_model_lanes(rules)
        chain: list[str] = []
        for k in ("reasoning", "standard", "else", "fast"):
            m = lanes.get(k)
            if m and m not in chain:
                chain.append(m)
        return chain
    return _split_list(raw, "|;,")


def enabled_lanes(rules: dict[str, str] | None) -> list[str]:
    raw = str(
        (rules or {}).get("precheck.route_lanes")
        or "fast|standard|reasoning|vision"
    ).strip()
    lanes = [normalize_lane(x) for x in _split_list(raw, "|;,")]
    # Drop image from chat lanes if present.
    lanes = [x for x in lanes if x in ROUTE_LANES]
    return lanes or ["fast", "standard", "reasoning", "vision"]


def clamp_lane(lane: str, enabled: list[str] | None) -> str:
    t = normalize_lane(lane)
    if t == "vision" and (not enabled or "vision" in [x.lower() for x in (enabled or [])]):
        if not enabled or "vision" in [x.lower() for x in enabled]:
            return "vision"
    if not enabled:
        return t if t in ROUTE_LANES else "standard"
    enabled_l = [normalize_lane(x) for x in enabled]
    if t in enabled_l:
        return t
    order = ["reasoning", "standard", "fast", "vision"]
    try:
        idx = order.index(t)
    except ValueError:
        idx = 1
    for cand in order[idx:]:
        if cand in enabled_l:
            return cand
    return enabled_l[0]


def pick_fallback_model(
    primary: str,
    rules: dict[str, str] | None,
    *,
    attempt: int = 0,
) -> str:
    chain = parse_fallback_chain(rules)
    if not chain:
        return primary
    ordered = [primary] + [m for m in chain if m != primary]
    if attempt <= 0:
        return ordered[0]
    return ordered[min(attempt, len(ordered) - 1)]


def normalize_model_ref(selected: str | None) -> str:
    s = str(selected if selected is not None else "auto").strip()
    low = s.lower()
    if not low or low == "auto":
        return "auto"
    # Preserve BYOK provider id casing after prefix.
    if low.startswith("custom:") or low.startswith("byok:"):
        prefix, _, rest = s.partition(":")
        return f"{prefix.lower()}:{rest.strip()}"
    s = low
    if s in ("doubao-seed", "doubao-pro"):
        return "doubao"
    if s in ("deepseek-chat", "deepseek-reasoner"):
        return "deepseek"
    return s


def _is_concrete(ref: str) -> bool:
    low = str(ref or "").strip().lower()
    if low.startswith("custom:") or low.startswith("byok:"):
        return bool(low.split(":", 1)[-1].strip())
    return ref not in ("doubao", "deepseek", "auto", "glm", "kimi") and bool(ref)


_VISION_MODEL_MARKERS = (
    "vision",
    "seed-2-1-pro",
    "seed-2-1-turbo",
    "seed-2.1-pro",
    "seed-2.1-turbo",
)


def model_supports_vision(model_ref: str | None) -> bool:
    """Whether chat/completions may include image_url for this model."""
    ref = str(model_ref or "").strip()
    low = ref.lower()
    if not low or "seedream" in low:
        return False
    from app.services.security import parse_byok_model_ref

    byok_pid = parse_byok_model_ref(ref)
    if byok_pid:
        try:
            from app.services.llm import get_byok_user_id
            from app.services.security import get_byok_provider_row

            uid = get_byok_user_id()
            if uid:
                row = get_byok_provider_row(uid, byok_pid)
                if row:
                    return str(row.get("modelKind") or "").strip().lower() == "vision"
        except Exception:
            pass
        return False
    try:
        from app.services.llm.catalog_store import get_model

        item = get_model(low)
        if item:
            types = item.get("referenceTypes") or []
            if isinstance(types, list) and types:
                return "vision" in types
    except Exception:
        pass
    if "mini" in low or "flash" in low:
        return False
    return any(m in low for m in _VISION_MODEL_MARKERS)


def _vision_ok(model_ref: str | None) -> bool:
    return model_supports_vision(model_ref)


def resolve_vision_model(rules: dict[str, str] | None) -> str:
    candidates: list[str] = []
    raw = str((rules or {}).get("precheck.vision_model") or "").strip()
    if raw:
        candidates.append(raw)
    lanes = parse_model_lanes(rules)
    if lanes.get("vision"):
        candidates.append(lanes["vision"])
    candidates.extend(parse_fallback_chain(rules))
    candidates.extend(lanes.values())
    for mid in candidates:
        if _vision_ok(mid):
            return mid
    return ""


def resolve_review_model(
    rules: dict[str, str] | None,
    *,
    user_selected_model: str | None = None,
    design_model: str | None = None,
) -> tuple[str, str]:
    """Pick Review model.

    Order: user lock → settings.design_review_model → Admin agent.review.model
    → follow this-turn design_model (Auto) → vision default.
    """
    locked = normalize_model_ref(user_selected_model)
    if _is_concrete(locked):
        return locked, "review_user_lock"

    try:
        from app.core.config import settings

        pinned = str(getattr(settings, "design_review_model", "") or "").strip()
    except Exception:
        pinned = ""
    if not pinned:
        pinned = str((rules or {}).get("agent.review.model") or "").strip()
    if pinned and _vision_ok(pinned):
        return pinned, "review_pinned"
    if pinned:
        return pinned, "review_pinned_non_vision"

    follow = normalize_model_ref(design_model)
    if _is_concrete(follow):
        return follow, "review_follow_design"

    vision = resolve_vision_model(rules)
    return vision, "review_vision_default"


def ensure_vision_model(
    model_ref: str,
    *,
    has_images: bool,
    rules: dict[str, str] | None = None,
    prefer: str | None = None,
    allow_switch: bool = True,
) -> tuple[str, str | None]:
    if not has_images:
        return model_ref, None
    if _vision_ok(model_ref):
        return model_ref, None
    if not allow_switch:
        return model_ref, None
    vision = (prefer or "").strip()
    if not _vision_ok(vision):
        vision = resolve_vision_model(rules)
    if not _vision_ok(vision):
        return model_ref, None
    if vision == model_ref:
        return model_ref, None
    return vision, f"precheck_vision_from_{normalize_model_ref(model_ref)}"


def is_user_locked_model(user_selected_model: str | None) -> bool:
    return _is_concrete(normalize_model_ref(user_selected_model))


def pin_user_locked_model_routes(
    rules: dict[str, str] | None,
    user_selected_model: str | None,
) -> dict[str, str]:
    """Lock: all lanes + vision + fallback pin to the concrete catalog id."""
    out = dict(rules or {})
    mid = normalize_model_ref(user_selected_model)
    if not _is_concrete(mid):
        return out
    out["precheck.model_threshold"] = (
        f"fast->{mid};standard->{mid};reasoning->{mid};else->{mid}"
    )
    out["precheck.vision_model"] = mid
    out["precheck.fallback_chain"] = mid
    out["agent.review.model"] = mid
    return out


def apply_user_route_overrides(
    rules: dict[str, str] | None,
    overrides: dict[str, Any] | None,
) -> dict[str, str]:
    """Merge user Auto preferences for canonical model lanes."""
    out = dict(rules or {})
    if not overrides or not isinstance(overrides, dict):
        return out

    lanes = parse_model_lanes(out)
    for key in ("fast", "standard", "reasoning"):
        raw = overrides.get(key)
        mid = str(raw or "").strip()
        if mid and mid.lower() not in ("auto", "platform", "default"):
            lanes[normalize_lane(key)] = mid
    if lanes:
        if "else" not in lanes:
            lanes["else"] = (
                lanes.get("standard")
                or lanes.get("reasoning")
                or lanes.get("fast")
                or resolve_vision_model(out)
            )
        serialized = ";".join(
            f"{k}->{v}"
            for k, v in lanes.items()
            if k and v and k in ("fast", "standard", "reasoning", "else", "vision", "image")
        )
        out["precheck.model_threshold"] = serialized

    vision = str(overrides.get("vision") or "").strip()
    if vision and vision.lower() not in ("auto", "platform", "default"):
        out["precheck.vision_model"] = vision

    image = str(overrides.get("image") or "").strip()
    if image and image.lower() not in ("auto", "platform", "default"):
        out["assets.image_default_model"] = image

    return out


def _serialize_lanes(lanes: dict[str, str]) -> str:
    return ";".join(
        f"{k}->{v}"
        for k, v in lanes.items()
        if k and v and k in ("fast", "standard", "reasoning", "else", "vision", "image")
    )


def sanitize_rules_for_openrouter_region(
    rules: dict[str, str] | None,
    *,
    platform_rules: dict[str, str] | None,
    country: str | None,
) -> dict[str, str]:
    """Replace OpenRouter lane models with Standard (platform) map when region blocks OR."""
    from app.services.geoip import is_openrouter_model_ref, openrouter_allowed_for_country

    out = dict(rules or {})
    if openrouter_allowed_for_country(country):
        return out
    plat = parse_model_lanes(platform_rules)
    lanes = parse_model_lanes(out)
    changed = False
    for key in ("fast", "standard", "reasoning", "else", "vision", "image"):
        mid = str(lanes.get(key) or "").strip()
        if not is_openrouter_model_ref(mid):
            continue
        fallback = (
            str(plat.get(key) or "").strip()
            or str(plat.get("standard") or "").strip()
            or str(plat.get("else") or "").strip()
            or mid
        )
        if fallback and fallback != mid:
            lanes[key] = fallback
            changed = True
    if changed:
        serialized = _serialize_lanes(lanes)
        out["precheck.model_threshold"] = serialized
    vision = str(out.get("precheck.vision_model") or "").strip()
    if is_openrouter_model_ref(vision):
        out["precheck.vision_model"] = (
            str(plat.get("vision") or "").strip()
            or str(platform_rules or {}).get("precheck.vision_model")
            or str(plat.get("standard") or "").strip()
            or vision
        )
    image = str(out.get("assets.image_default_model") or "").strip()
    if is_openrouter_model_ref(image):
        out["assets.image_default_model"] = (
            str(plat.get("image") or "").strip()
            or str(platform_rules or {}).get("assets.image_default_model")
            or image
        )
    return out


def sanitize_model_ref_for_openrouter_region(
    model_ref: str | None,
    *,
    platform_rules: dict[str, str] | None,
    country: str | None,
) -> str:
    """Locked/BYOK OpenRouter picks fall back to platform standard lane when blocked."""
    from app.services.geoip import is_openrouter_model_ref, openrouter_allowed_for_country

    mid = str(model_ref or "").strip()
    if not mid or mid.lower() in ("auto", "platform", "default"):
        return mid or "auto"
    if openrouter_allowed_for_country(country) or not is_openrouter_model_ref(mid):
        return mid
    plat = parse_model_lanes(platform_rules)
    return (
        str(plat.get("standard") or "").strip()
        or str(plat.get("else") or "").strip()
        or "auto"
    )


def heuristic_route_lane(
    prompt: str,
    *,
    has_images: bool = False,
    canvas_node_count: int = 0,
    scene: str | None = None,
) -> ModelRouteDecision:
    """Deterministic fallback when the LLM router is unavailable.

    Structural only (images). No prompt length tiers / keyword lists —
    content judgment belongs to the LLM router pack.
    """
    del prompt, canvas_node_count, scene
    if has_images:
        return ModelRouteDecision(
            lane="vision",
            needs_image_gen=False,
            rationale="heuristic: has_images",
        )
    return ModelRouteDecision(
        lane="standard",
        needs_image_gen=False,
        rationale="heuristic: default_standard",
    )


def model_for_lane(
    lane: str,
    rules: dict[str, str] | None,
) -> str:
    lanes = parse_model_lanes(rules)
    key = normalize_lane(lane)
    if key == "vision":
        return (
            str((rules or {}).get("precheck.vision_model") or "").strip()
            or lanes.get("vision")
            or resolve_vision_model(rules)
        )
    return lanes.get(key) or lanes.get("else") or lanes.get("standard") or ""


def family_from_precheck(
    prompt: str,
    rules: dict[str, str] | None,
    *,
    skill_category: str | None = None,
    scene: str | None = None,
    has_images: bool = False,
    canvas_node_count: int = 0,
    route_lane: str | None = None,
) -> tuple[str | None, str]:
    """Return (model_ref, lane). Uses ``route_lane`` when provided (from LLM router)."""
    del skill_category
    if route_lane:
        lane = clamp_lane(route_lane, enabled_lanes(rules))
    else:
        lane = clamp_lane(
            heuristic_route_lane(
                prompt,
                has_images=has_images,
                canvas_node_count=canvas_node_count,
                scene=scene,
            ).lane,
            enabled_lanes(rules),
        )
    return model_for_lane(lane, rules), lane


def router_model_id(rules: dict[str, str] | None) -> str:
    """Cheap model for the LangChain structured router call."""
    raw = str((rules or {}).get("precheck.router_model") or "").strip()
    if raw:
        return raw
    lanes = parse_model_lanes(rules)
    return lanes.get("fast") or lanes.get("else") or ""


def _user_request_core(prompt: str) -> str:
    """Strip FE ``User request:`` wrapper so the core ask is visible to heuristics."""
    p = (prompt or "").strip()
    m = re.search(r"(?is)\buser\s*request\s*:\s*(.*)\Z", p)
    if m:
        return (m.group(1) or "").strip()
    return p


def scene_target_catalog(scene_nodes: list[dict[str, Any]] | None) -> str:
    """Compact, factual target inventory for intent disambiguation only."""
    rows: list[str] = []
    for node in list(scene_nodes or [])[:24]:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "").strip()[:64]
        node_type = str(node.get("type") or "node").strip()[:32]
        if not node_id:
            continue
        name = ""
        for key in ("name", "text"):
            value = str(node.get(key) or "").strip().replace("\n", " ")
            if value:
                name = value[:80]
                break
        geometry = " ".join(
            f"{key}={node[key]}"
            for key in ("x", "y", "w", "h")
            if isinstance(node.get(key), (int, float))
        )
        detail = f' name="{name}"' if name else ""
        rows.append(f"- id={node_id} type={node_type}{detail} {geometry}".strip())
    return "\n".join(rows)


def normalize_clarification(
    raw_needed: Any,
    raw_question: Any,
    raw_options: Any,
    *,
    has_target: bool,
    intent: str,
    scene_nodes: list[dict[str, Any]] | None,
) -> tuple[bool, str, list[dict[str, str]]]:
    """Validate an intent-gate clarification without inventing target choices."""
    if has_target or intent not in CANVAS_WORK_INTENTS or raw_needed is not True:
        return False, "", []
    question = str(raw_question or "").strip()[:240]
    if not question or not isinstance(raw_options, list):
        return False, "", []
    live_ids = {
        str(node.get("id") or "").strip()
        for node in list(scene_nodes or [])
        if isinstance(node, dict) and str(node.get("id") or "").strip()
    }
    seen: set[str] = set()
    options: list[dict[str, str]] = []
    for raw in raw_options[:4]:
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label") or "").strip()[:80]
        target_id = str(raw.get("target_id") or "").strip()[:64]
        if label and target_id in live_ids and target_id not in seen:
            seen.add(target_id)
            options.append({"label": label, "target_id": target_id})
    return len(options) >= 2, question, options


def heuristic_user_intent(
    prompt: str,
    *,
    has_images: bool = False,
    canvas_node_count: int = 0,
) -> IntentClassifyDecision:
    """Fallback when the intent LLM is unavailable.

    Structural only (images / target chip / empty prompt). Never maps
    greetings or content keywords → chat vs design — that belongs to
    ``agent.prompt.intent_classify``. Non-empty text fail-opens to
    design/create so craft still gets a plate path when the classifier is down.
    """
    del canvas_node_count
    full = str(prompt or "")
    has_target = "[Target element" in full or "Target element —" in full
    if has_images:
        return IntentClassifyDecision(
            intent="design",
            paint_lane="edit" if has_target else "create",
            reply="",
            rationale="heuristic_images",
        )
    if has_target:
        return IntentClassifyDecision(
            intent="canvas_op",
            paint_lane="edit",
            reply="",
            rationale="heuristic_target",
        )
    if not _user_request_core(full).strip():
        return IntentClassifyDecision(
            intent="chat", paint_lane="", reply="", rationale="heuristic_empty"
        )
    return IntentClassifyDecision(
        intent="design",
        paint_lane="create",
        reply="",
        rationale="heuristic_default_design",
    )


async def classify_user_intent(
    *,
    prompt: str,
    rules: dict[str, str] | None = None,
    has_images: bool = False,
    canvas_node_count: int = 0,
    scene: str | None = None,
    scene_nodes: list[dict[str, Any]] | None = None,
    interaction_mode: str | None = None,
    pending_proposal: dict[str, Any] | None = None,
    recent_dialogue: str | None = None,
) -> IntentClassifyDecision:
    """Structured intent gate via LLM. Raises ``IntentClassifyError`` on any failure.

    Injects the live canvas tools catalog so the model judges canvas_op vs design
    against real capabilities. When ``pending_proposal`` is set, also judges
    proposal_action (apply / dismiss / revise).
    """
    has_pending = _pending_proposal_ready(pending_proposal)
    mode = str(interaction_mode or "").strip().lower()
    from app.services.design.runtime.agent_profile import resolve_tool_host

    tools_catalog = resolve_tool_host().format_catalog(rules)
    pending_block = (
        _pending_proposal_user_block(pending_proposal)
        if has_pending and isinstance(pending_proposal, dict)
        else ""
    )
    dialogue = str(recent_dialogue or "").strip()[:1200]
    targets = scene_target_catalog(scene_nodes)
    user_blob = "".join(
        (
            f"scene={scene or 'unknown'}\n",
            f"has_images={bool(has_images)}\n",
            f"canvas_node_count={int(len(scene_nodes or []))}\n",
            f"interaction_mode={mode or 'agent'}\n",
            f"has_pending_proposal={has_pending}\n",
            f"SCENE_TARGETS:\n{targets}\n\n" if targets else "",
            f"{tools_catalog}\n\n",
            pending_block,
            f"RECENT_DIALOGUE:\n{dialogue}\n\n" if dialogue else "",
            f"user_prompt:\n{(prompt or '').strip()[:4000]}",
        )
    )
    from app.services.design.prompts.prompt_pack_store import render_prompt_body
    from app.services.llm.agent import ainvoke_structured

    from app.services.design.runtime.agent_profile import (
        get_active_agent_profile,
        resolve_contract_schema,
    )

    intent_key = get_active_agent_profile().intent_prompt or _INTENT_SYSTEM_KEY
    system = render_prompt_body(intent_key, rules=rules)
    if not system:
        raise IntentClassifyError(f"intent_classify: prompt pack missing for {intent_key}")
    out = await ainvoke_structured(
        schema=resolve_contract_schema("intent"),
        messages=[{"role": "user", "content": user_blob}],
        model=router_model_id(rules),
        system=system,
        source="intent_classify",
    )
    structured = out.get("structured")
    if isinstance(structured, IntentClassifyDecision):
        raw_intent = structured.intent
        raw_lane = structured.paint_lane
        rationale = structured.rationale
        reply = structured.reply
        raw_action = structured.proposal_action
        raw_session = structured.session_action
        raw_clarification_needed = structured.needs_clarification
        raw_clarification = structured.clarification
        raw_clarification_options = [
            option.model_dump() for option in structured.clarification_options
        ]
    elif isinstance(structured, dict):
        raw_intent = structured.get("intent")
        raw_lane = structured.get("paint_lane")
        rationale = structured.get("rationale")
        reply = structured.get("reply")
        raw_action = structured.get("proposal_action")
        raw_session = structured.get("session_action")
        raw_clarification_needed = structured.get("needs_clarification")
        raw_clarification = structured.get("clarification")
        raw_clarification_options = structured.get("clarification_options")
    else:
        raise IntentClassifyError(
            f"intent_classify: structured output empty or unparsed (type={type(structured).__name__})"
        )
    intent, lane = normalize_intent_decision(raw_intent, raw_lane)
    if intent not in USER_INTENTS:
        raise IntentClassifyError(f"intent_classify: invalid intent={raw_intent!r}")
    action = normalize_proposal_action(raw_action, has_pending=has_pending)
    session_action = normalize_session_action(raw_session)
    # Trust the intent LLM fully — no chitchat / length / keyword demotion.
    reply_s = str(reply or "").strip()
    if intent != "chat" and action != "dismiss" and not session_action:
        reply_s = ""
    # Classifier never sees pixels — blind chat replies must not answer for the user.
    if intent == "chat" and has_images and not session_action and action != "dismiss":
        reply_s = ""
    # Confirm held ops — do not short-circuit as chat.
    if action == "apply":
        intent = "design"
        lane = lane or "create"
        reply_s = ""
        session_action = ""
    if session_action:
        intent = "chat"
        lane = ""
    needs_clarification, clarification, clarification_options = (
        normalize_clarification(
            raw_clarification_needed,
            raw_clarification,
            raw_clarification_options,
            has_target=("[Target element" in prompt or "Target element —" in prompt),
            intent=intent,
            scene_nodes=scene_nodes,
        )
    )
    if session_action or action == "apply":
        needs_clarification, clarification, clarification_options = False, "", []
    return IntentClassifyDecision(
        intent=intent,  # type: ignore[arg-type]
        paint_lane=lane if intent != "chat" else "",  # type: ignore[arg-type]
        proposal_action=action,  # type: ignore[arg-type]
        session_action=session_action,  # type: ignore[arg-type]
        reply=reply_s[:500],
        needs_clarification=needs_clarification,
        clarification=clarification,
        clarification_options=clarification_options,
        rationale=str(rationale or "").strip() or "llm_intent",
    )


async def classify_model_route(

    *,
    prompt: str,
    rules: dict[str, str] | None = None,
    has_images: bool = False,
    canvas_node_count: int = 0,
    scene: str | None = None,
    interaction_mode: str | None = None,
) -> ModelRouteDecision:
    """LangChain structured router. Raises ``ModelRouteError`` on any failure."""
    mode = str(interaction_mode or "").strip().lower()
    if mode == "ask" and not has_images:
        return ModelRouteDecision(
            lane="fast",
            needs_image_gen=False,
            rationale="ask mode → fast",
        )

    user_blob = (
        f"scene={scene or 'unknown'}\n"
        f"has_images={bool(has_images)}\n"
        f"canvas_node_count={int(canvas_node_count)}\n"
        f"interaction_mode={mode or 'agent'}\n"
        f"user_prompt:\n{(prompt or '').strip()[:4000]}"
    )
    from app.services.design.prompts.prompt_pack_store import render_prompt_body
    from app.services.llm.agent import ainvoke_structured

    from app.services.design.runtime.agent_profile import get_active_agent_profile

    router_key = get_active_agent_profile().router_prompt or _ROUTER_SYSTEM_KEY
    router_system = render_prompt_body(router_key, rules=rules).strip()
    if not router_system:
        raise ModelRouteError(f"model_route: prompt pack missing for {router_key}")
    out = await ainvoke_structured(
        schema=ModelRouteDecision,
        messages=[{"role": "user", "content": user_blob}],
        model=router_model_id(rules),
        system=router_system,
        source="model_route",
    )
    structured = out.get("structured")
    if isinstance(structured, ModelRouteDecision):
        decision = structured
    elif isinstance(structured, dict):
        decision = ModelRouteDecision.model_validate(structured)
    else:
        raise ModelRouteError(
            f"model_route: structured output empty or unparsed (type={type(structured).__name__})"
        )
    lane = clamp_lane(decision.lane, enabled_lanes(rules))
    if has_images and lane == "fast":
        lane = "vision"
    return ModelRouteDecision(
        lane=lane,  # type: ignore[arg-type]
        needs_image_gen=bool(decision.needs_image_gen),
        rationale=(decision.rationale or "").strip() or "llm_router",
    )


async def apply_classified_model_route(rt: Any) -> None:
    """Run LLM model router and persist lane on runtime for downstream resolution."""
    from app.services.design.runtime.graph.state import AgentRuntime

    if not isinstance(rt, AgentRuntime):
        raise TypeError("apply_classified_model_route expects AgentRuntime")
    st = rt.run
    decision = await classify_model_route(
        prompt=rt.prompt,
        rules=rt.rules,
        has_images=bool(rt.images),
        canvas_node_count=len(rt.scene_nodes or []),
        scene=rt.scene_key,
        interaction_mode=str(rt.flags.get("mode") or rt.mode or ""),
    )
    lane = decision.lane
    rt.flags["route_lane"] = lane
    rt.flags["route_rationale"] = decision.rationale
    st.task_tier = lane
    tier_label = lane or "-"
    st.push_log(
        phase="route",
        task_tier=st.task_tier or None,
        has_images=bool(rt.images) or None,
        vision=None,
        user_selected_model=(rt.user_selected_model or "auto"),
        run_mode=rt.mode,
        summary=(
            f"task_tier={tier_label}"
            + (" · images" if rt.images else "")
            + f" · mode={rt.mode}"
            + (f" · {(decision.rationale or '')[:80]}" if decision.rationale else "")
        ),
    )
    if str(rt.flags.get("mode") or "").strip().lower() not in ("agent", "ask"):
        rt.flags["mode"] = "agent"
    rt.flags["task_tier"] = st.task_tier


def resolve_model_for_skill(
    *,
    skill: dict[str, Any],
    user_selected_model: str | None,
    run_mode: str,
    is_premium: bool = False,
    prompt: str = "",
    rules: dict[str, str] | None = None,
    scene: str | None = None,
    attempt: int = 0,
    has_images: bool = False,
    canvas_node_count: int = 0,
    route_lane: str | None = None,
) -> tuple[str, str]:
    """Returns (model_ref, reason). Auto follows lane map; lock skips classifier."""
    del is_premium
    selected = normalize_model_ref(user_selected_model)
    skill_default = str(skill.get("default_model") or "doubao").strip().lower() or "doubao"

    def from_precheck(reason_prefix: str) -> tuple[str, str]:
        pre, lane = family_from_precheck(
            prompt,
            rules,
            scene=scene,
            has_images=has_images,
            canvas_node_count=canvas_node_count,
            route_lane=route_lane,
        )
        primary = pre or skill_default
        if primary in ("doubao", "deepseek", "glm", "kimi"):
            lanes = parse_model_lanes(rules)
            primary = (
                lanes.get("else")
                or lanes.get("standard")
                or lanes.get("reasoning")
                or (parse_fallback_chain(rules) or [primary])[0]
            )
        chosen = pick_fallback_model(primary, rules, attempt=attempt)
        reason = f"{reason_prefix}_{lane}"
        if attempt > 0 and chosen != primary:
            reason = f"{reason_prefix}_fallback_{lane}_attempt_{attempt}"
        if has_images and not _vision_ok(chosen):
            vision = resolve_vision_model(rules)
            return vision, f"{reason}+precheck_vision"
        if lane == "vision" and not _vision_ok(chosen):
            return resolve_vision_model(rules), f"{reason}+lane_vision"
        return chosen, reason

    def lock_or_vision(model_ref: str, reason: str) -> tuple[str, str]:
        if has_images and not _vision_ok(model_ref):
            return resolve_vision_model(rules), f"{reason}+precheck_vision"
        return model_ref, reason

    # Legacy partial is an alias of single_model (orchestrator remaps before graph).
    if run_mode in ("single_model", "partial"):
        if _is_concrete(selected):
            return lock_or_vision(selected, "user_single_model")
        if selected in ("doubao", "deepseek", "glm", "kimi", "auto") or not selected:
            return from_precheck("single_precheck")
        return lock_or_vision(skill_default, "single_model_fallback_default")

    if selected in ("auto", "doubao", "deepseek", "glm", "kimi") or not selected:
        return from_precheck("precheck_lane")

    if _is_concrete(selected):
        return lock_or_vision(selected, "user_locked")

    return from_precheck("precheck_lane")


def to_endpoint_model_id(model_ref: str) -> str:
    """Pass through catalog / rule ids — no family→concrete inventing."""
    return str(model_ref or "").strip().lower()
