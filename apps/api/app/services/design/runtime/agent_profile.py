"""AgentProfile — config-driven Voice + Policy + Topology + Roles + SubAgents.

Seed: ``seeds/agents/profiles/{id}.yaml`` + ``seeds/agents/bindings.yaml``.

- Voice: stage / persona / router pack keys (``host/prompts.py``, models_route).
- Policy: ``apply_profile_rules`` overlays model lanes / flags onto global KV rules
  before user pin / OpenRouter sanitize. Values may be literals or ``$kv:ruleKey``.
- Topology: ``topology.template`` selects a live LangGraph builder in
  ``graph/build.py`` (Admin flow JSON remains dry-run only).
- Roles: primary + specialists map stages on the live graph.
- SubAgents: **forked** children (``runtime/subagent.py``) — fresh
  context, typed return, optional parallel spawn. Specialists with
  ``isolation: forked_context`` must link ``subagent: <id>``.
- Surface: ``contracts.*.schema`` + ``capabilities.tools.host`` resolve via
  registries in this module (P3).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from app.core.config import resolve_seed_dir, settings
from app.services.design.runtime.subagent import SubAgentDef

from recombyn_agent_sdk import (
    DEFAULT_CONTRACT_IDS,
    KERNEL_CANVAS_REQUIRED,
    PROFILE_KIND,
)

_LOCK = threading.RLock()
_PROFILE_CACHE: dict[str, "AgentProfile"] = {}
_BINDINGS_CACHE: dict[str, Any] | None = None
_ACTIVE_ID: str | None = None

_DEFAULT_CONTRACTS: dict[str, str] = {
    k: v for k, v in DEFAULT_CONTRACT_IDS.items() if k in ("intent", "decide", "act", "review")
}

_CONTRACT_SCHEMA_REGISTRY: dict[str, Any] | None = None
_TOOL_HOST_REGISTRY: dict[str, ToolHostAdapter] | None = None

_FLAG_RULE_KEYS = {
    "defer_tools": "agent.react.defer_tools",
    "dual_sample": "agent.react.dual_sample",
    "short_plan": "agent.react.short_plan",
    "critique_enabled": "design.critique.enabled",
}

# Non-bool runtime flags → KV (values preserved as strings).
_STRING_FLAG_RULE_KEYS = {
    "review_mode": "design.review.mode",
}

_MEMORY_RULE_KEYS = {
    "recent_turns": "memory.dialogue.recent_turns",
    "recent_chars": "memory.dialogue.recent_chars",
    "summary_chars": "memory.dialogue.summary_chars",
    "facts_max": "memory.dialogue.facts_max",
    "per_turn_chars": "memory.dialogue.per_turn_chars",
}

_ATTACH_RULE_KEYS = {
    "max_images": "agent.attach.max_images",
    "max_data_url_chars": "agent.attach.max_data_url_chars",
    "place_hint": "agent.attach.place_hint",
    "place_hint_pack": "agent.attach.place_hint",
}


@dataclass(frozen=True)
class StagePromptSpec:
    protocol: str
    mode_overlay: bool = True


@dataclass(frozen=True)
class AgentRoleSpec:
    """Role on the live graph; may delegate a stage to a forked SubAgent."""

    id: str
    kind: str  # primary | specialist
    stages: tuple[str, ...]
    # shared_state = same LangGraph thread; forked_context = spawn SubAgent.
    isolation: str = "shared_state"
    subagent_id: str | None = None


@dataclass(frozen=True)
class ToolHostAdapter:
    """Execution surface for deferred tools + ops validation."""

    id: str
    catalog_id: str
    schema_version: str
    format_catalog: Any
    format_details: Any
    format_full: Any
    validate_ops: Any


@dataclass(frozen=True)
class AgentProfile:
    id: str
    version: int
    status: str
    display_name: str
    locale: str
    persona_auto: str
    persona_locked: str
    router_prompt: str
    overlay_ask: str
    overlay_agent: str
    stages: dict[str, StagePromptSpec]
    intent_prompt: str
    # P1 policy: rule_key → value or ``$kv:other_key`` (resolved at apply time).
    policy_patches: dict[str, str] = field(default_factory=dict)
    runtime_flags: dict[str, Any] = field(default_factory=dict)
    # P2 topology — live LangGraph selected by template id (not Admin flow JSON).
    topology_template: str = "canvas_ops_v1"
    stages_enabled: tuple[str, ...] = KERNEL_CANVAS_REQUIRED
    topology_loops: tuple[tuple[str, str, str, int], ...] = ()
    # Roles — primary + specialists. forked_context → SubAgent catalog.
    roles: tuple[AgentRoleSpec, ...] = ()
    # Spawn catalog (see runtime/subagent.py).
    subagents: tuple[SubAgentDef, ...] = ()
    # P3 contracts + capabilities.
    contracts: dict[str, str] = field(default_factory=dict)  # stage → schema id
    tools_catalog: str = "canvas_actions"
    tools_host: str = "canvas_fe"
    tools_defer: bool = True
    skills_catalog: str = "design_skills"
    skills_auto_triggers: bool = True
    skills_namespaces: tuple[str, ...] = ("core", "ext", "user")
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    def stage_protocol(self, stage: str) -> str:
        spec = self.stages.get(str(stage or "").strip().lower())
        if spec is None or not spec.protocol:
            raise ValueError(f"profile {self.id!r}: unknown or empty stage {stage!r}")
        return spec.protocol

    def stage_uses_mode_overlay(self, stage: str) -> bool:
        spec = self.stages.get(str(stage or "").strip().lower())
        if spec is None:
            raise ValueError(f"profile {self.id!r}: unknown stage {stage!r}")
        return bool(spec.mode_overlay)

    def mode_overlay_key(self, *, ask_mode: bool) -> str:
        return self.overlay_ask if ask_mode else self.overlay_agent

    def critique_enabled(self, *, default: bool = True) -> bool:
        if "critique_enabled" in self.runtime_flags:
            return bool(self.runtime_flags["critique_enabled"])
        return default

    def role_for_stage(self, stage: str) -> AgentRoleSpec | None:
        key = str(stage or "").strip().lower()
        if not key:
            return None
        for role in self.roles or ():
            if key in role.stages:
                return role
        return None

    def primary_role(self) -> AgentRoleSpec | None:
        for role in self.roles or ():
            if role.kind == "primary":
                return role
        return None

    def get_subagent(self, agent_id: str) -> SubAgentDef | None:
        key = str(agent_id or "").strip().lower()
        if not key:
            return None
        for item in self.subagents or ():
            if str(item.id).lower() == key:
                return item
        return None

    def subagent_for_stage(self, stage: str) -> SubAgentDef | None:
        role = self.role_for_stage(stage)
        if role is None:
            return None
        if role.isolation != "forked_context":
            return None
        sid = str(role.subagent_id or role.id or "").strip()
        return self.get_subagent(sid)

    def contract_schema_id(self, stage: str) -> str:
        key = str(stage or "").strip().lower()
        sid = str((self.contracts or {}).get(key) or "").strip()
        if not sid:
            raise ValueError(f"profile {self.id!r}: no contract for stage {stage!r}")
        return sid


def agents_data_dir() -> Path:
    return resolve_seed_dir("agents")


def agent_overrides_dir() -> Path:
    from app.core.config import _API_ROOT

    return _API_ROOT / "agent-overrides"


def _apply_profile_overlays(raw: dict[str, Any], profile_id: str) -> dict[str, Any]:
    """Deep-merge optional patch layers (seeds/overlays + local agent-overrides)."""
    from app.services.agent_memory.schema import deep_merge

    merged = dict(raw)
    pid = _as_text(profile_id).replace("\\", "").replace("/", "")
    candidates = [
        agents_data_dir() / "overlays" / f"{pid}.patch.yaml",
        agents_data_dir() / "overlays" / "local.patch.yaml",
        agent_overrides_dir() / "local.patch.yaml",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        patch = _load_yaml(path)
        if isinstance(patch, dict):
            merged = deep_merge(merged, patch)
    return merged


def profiles_dir() -> Path:
    return agents_data_dir() / "profiles"


def clear_agent_profile_cache() -> None:
    global _BINDINGS_CACHE, _ACTIVE_ID, _CONTRACT_SCHEMA_REGISTRY
    with _LOCK:
        _PROFILE_CACHE.clear()
        _BINDINGS_CACHE = None
        _ACTIVE_ID = None
        _CONTRACT_SCHEMA_REGISTRY = None


def _as_map(raw: Any) -> dict[str, Any]:
    return raw if isinstance(raw, dict) else {}


def _as_text(raw: Any, default: str = "") -> str:
    s = str(raw if raw is not None else default).strip()
    return s or default


def _parse_stage_spec(raw: Any, *, default_mode_overlay: bool) -> StagePromptSpec | None:
    if isinstance(raw, str):
        protocol = raw.strip()
        if not protocol:
            return None
        return StagePromptSpec(protocol=protocol, mode_overlay=default_mode_overlay)
    if not isinstance(raw, dict):
        return None
    protocol = _as_text(raw.get("protocol") or "")
    if not protocol:
        return None
    mode = raw.get("mode_overlay")
    if mode is None:
        mode_overlay = default_mode_overlay
    else:
        mode_overlay = bool(mode)
    return StagePromptSpec(protocol=protocol, mode_overlay=mode_overlay)


def _is_kv_ref(raw: Any) -> str | None:
    """Return referenced rule key if value is ``$kv:rule.key``, else None."""
    s = _as_text(raw)
    if s.startswith("$kv:"):
        key = s[4:].strip()
        return key or None
    return None


def _boolish(raw: Any) -> bool | None:
    if isinstance(raw, bool):
        return raw
    s = _as_text(raw).lower()
    if s in ("1", "true", "on", "yes"):
        return True
    if s in ("0", "false", "off", "no"):
        return False
    return None


def _serialize_lanes(raw: Any) -> str | None:
    """Dict lanes → ``fast->m;standard->n``; string passthrough (non-$kv)."""
    if isinstance(raw, dict):
        parts: list[str] = []
        for k, v in raw.items():
            lk = _as_text(k).lower()
            lv = _as_text(v)
            if not lk or not lv or _is_kv_ref(lv):
                continue
            parts.append(f"{lk}->{lv}")
        return ";".join(parts) if parts else None
    if _is_kv_ref(raw):
        return None
    s = _as_text(raw)
    return s or None


def _serialize_fallback(raw: Any) -> str | None:
    if _is_kv_ref(raw):
        return None
    if isinstance(raw, list):
        parts = [_as_text(x) for x in raw if _as_text(x) and not _is_kv_ref(x)]
        return ",".join(parts) if parts else None
    s = _as_text(raw)
    return s or None


def _policy_from_routing(routing: dict[str, Any]) -> dict[str, str]:
    """Build rule_key → literal-or-$kv patches from ``routing`` block."""
    patches: dict[str, str] = {}

    def put(rule_key: str, value: Any, *, serialize: str | None = None) -> None:
        kv = _is_kv_ref(value)
        if kv is not None:
            # Alias: write target key from another KV key at apply time.
            patches[rule_key] = f"$kv:{kv}"
            return
        if serialize == "lanes":
            text = _serialize_lanes(value)
        elif serialize == "fallback":
            text = _serialize_fallback(value)
        else:
            text = _as_text(value) if not isinstance(value, (dict, list)) else ""
            if not text and isinstance(value, (dict, list)):
                return
        if text:
            patches[rule_key] = text

    if "lanes" in routing:
        put("precheck.model_threshold", routing.get("lanes"), serialize="lanes")
    if "fallback" in routing:
        put("precheck.fallback_chain", routing.get("fallback"), serialize="fallback")
    if "vision_model" in routing:
        put("precheck.vision_model", routing.get("vision_model"))
    if "image_model" in routing:
        put("assets.image_default_model", routing.get("image_model"))

    pins = _as_map(routing.get("stage_pins"))
    if "review" in pins:
        put("agent.review.model", pins.get("review"))

    presets = _as_map(routing.get("user_presets"))
    for name, body in presets.items():
        key = _as_text(name).lower()
        if not key:
            continue
        rule = f"precheck.user_preset.{key}"
        if isinstance(body, dict):
            text = _serialize_lanes(body)
            if text:
                patches[rule] = text
        else:
            put(rule, body, serialize="lanes")

    return patches


def _policy_from_runtime(runtime: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any]]:
    patches: dict[str, str] = {}
    flags_out: dict[str, Any] = {}

    flags = _as_map(runtime.get("flags"))
    for name, rule_key in _FLAG_RULE_KEYS.items():
        if name not in flags:
            continue
        b = _boolish(flags.get(name))
        if b is None:
            continue
        flags_out[name] = b
        patches[rule_key] = "1" if b else "0"

    for name, rule_key in _STRING_FLAG_RULE_KEYS.items():
        if name not in flags:
            continue
        raw = str(flags.get(name) or "").strip().lower()
        if name == "review_mode" and raw in ("auto", "off", "always"):
            flags_out[name] = raw
            patches[rule_key] = raw
            continue
        if raw:
            flags_out[name] = raw
            patches[rule_key] = raw

    memory = _as_map(runtime.get("memory"))
    for name, rule_key in _MEMORY_RULE_KEYS.items():
        if name not in memory:
            continue
        kv = _is_kv_ref(memory.get(name))
        if kv is not None:
            patches[rule_key] = f"$kv:{kv}"
            continue
        val = memory.get(name)
        if val is None:
            continue
        patches[rule_key] = str(val).strip()

    attach = _as_map(runtime.get("attach"))
    for name, rule_key in _ATTACH_RULE_KEYS.items():
        if name not in attach:
            continue
        kv = _is_kv_ref(attach.get(name))
        if kv is not None:
            patches[rule_key] = f"$kv:{kv}"
            continue
        val = attach.get(name)
        if val is None:
            continue
        patches[rule_key] = str(val).strip()

    limits = _as_map(runtime.get("limits"))
    if "max_graph_turns" in limits:
        patches["agent.graph.max_turns"] = str(limits.get("max_graph_turns")).strip()

    retry = _as_map(runtime.get("retry"))
    if retry:
        mx = retry.get("max")
        backoff = retry.get("backoff")
        if mx is not None or backoff is not None:
            cur_max = str(mx if mx is not None else 2).strip()
            cur_bo = str(backoff if backoff is not None else 1.5).strip()
            patches["precheck.retry_policy"] = f"max={cur_max},backoff={cur_bo}"

    return patches, flags_out


def _parse_topology(
    raw: dict[str, Any], *, source: str
) -> tuple[str, tuple[str, ...], tuple[tuple[str, str, str, int], ...]]:
    topo = _as_map(raw.get("topology"))
    template = _as_text(topo.get("template"), "canvas_ops_v1") or "canvas_ops_v1"

    stages_raw = topo.get("stages_enabled")
    stages: list[str] = []
    if isinstance(stages_raw, list):
        for item in stages_raw:
            s = _as_text(item).lower()
            if s and s not in stages:
                stages.append(s)
    if not stages:
        stages = list(KERNEL_CANVAS_REQUIRED)

    loops: list[tuple[str, str, str, int]] = []
    loops_raw = topo.get("loops")
    if isinstance(loops_raw, list):
        for row in loops_raw:
            if not isinstance(row, dict):
                continue
            frm = _as_text(row.get("from")).lower()
            when = _as_text(row.get("when")).lower()
            to = _as_text(row.get("to")).lower()
            try:
                mx = int(row.get("max") if row.get("max") is not None else 2)
            except (TypeError, ValueError):
                mx = 2
            if frm and to:
                loops.append((frm, when or "retry", to, max(0, mx)))

    if not template:
        raise ValueError(f"{source}: topology.template is required")
    return template, tuple(stages), tuple(loops)


_LIVE_ROLE_ISOLATIONS = frozenset({"shared_state", "forked_context"})
_LIVE_SUBAGENT_ISOLATIONS = frozenset({"forked_context"})


def _default_roles_from_stages(stages_enabled: tuple[str, ...]) -> tuple[AgentRoleSpec, ...]:
    """Infer primary + optional review specialist when YAML omits ``roles``."""
    enabled = [s for s in stages_enabled if s]
    if not enabled:
        enabled = list(KERNEL_CANVAS_REQUIRED)
    specialists = [s for s in enabled if s == "review"]
    primary_stages = tuple(s for s in enabled if s != "review") or ("decide",)
    roles: list[AgentRoleSpec] = [
        AgentRoleSpec(
            id="design",
            kind="primary",
            stages=primary_stages,
            isolation="shared_state",
        )
    ]
    if specialists:
        roles.append(
            AgentRoleSpec(
                id="review",
                kind="specialist",
                stages=tuple(specialists),
                isolation="shared_state",
            )
        )
    return tuple(roles)


def _parse_roles(
    raw: dict[str, Any],
    *,
    stages_enabled: tuple[str, ...],
    source: str,
) -> tuple[AgentRoleSpec, ...]:
    block = _as_map(raw.get("roles"))
    if not block:
        return _default_roles_from_stages(stages_enabled)

    roles: list[AgentRoleSpec] = []

    def _add(kind: str, body: Any, *, default_id: str) -> None:
        if not isinstance(body, dict):
            raise ValueError(f"{source}: roles.{kind} must be a mapping")
        rid = _as_text(body.get("id"), default_id) or default_id
        stages: list[str] = []
        stages_raw = body.get("stages")
        if isinstance(stages_raw, list):
            for item in stages_raw:
                s = _as_text(item).lower()
                if s and s not in stages:
                    stages.append(s)
        if not stages and kind == "primary":
            stages = [s for s in stages_enabled if s != "review"] or ["decide"]
        if not stages and kind == "specialist":
            raise ValueError(f"{source}: roles specialist {rid!r} needs stages")
        isolation = _as_text(body.get("isolation"), "shared_state").lower() or "shared_state"
        if isolation not in _LIVE_ROLE_ISOLATIONS:
            raise ValueError(
                f"{source}: roles {rid!r} isolation {isolation!r} not live "
                f"(supported: {', '.join(sorted(_LIVE_ROLE_ISOLATIONS))})"
            )
        subagent_id = _as_text(body.get("subagent")) or None
        if isolation == "forked_context" and not subagent_id:
            subagent_id = rid
        roles.append(
            AgentRoleSpec(
                id=rid,
                kind=kind,
                stages=tuple(stages),
                isolation=isolation,
                subagent_id=subagent_id,
            )
        )

    primary = block.get("primary")
    if primary is not None:
        _add("primary", primary, default_id="design")

    specs = block.get("specialists")
    if isinstance(specs, list):
        for i, row in enumerate(specs):
            if not isinstance(row, dict):
                continue
            _add("specialist", row, default_id=f"specialist_{i}")
    elif isinstance(specs, dict):
        # Allow map form: specialists.review: { stages: [...] }
        for name, row in specs.items():
            if not isinstance(row, dict):
                continue
            body = dict(row)
            body.setdefault("id", _as_text(name) or "specialist")
            _add("specialist", body, default_id=_as_text(name) or "specialist")

    if not any(r.kind == "primary" for r in roles):
        # YAML only listed specialists — synthesize primary from leftover stages.
        claimed = {s for r in roles for s in r.stages}
        primary_stages = tuple(s for s in stages_enabled if s not in claimed) or ("decide",)
        roles.insert(
            0,
            AgentRoleSpec(
                id="design",
                kind="primary",
                stages=primary_stages,
                isolation="shared_state",
            ),
        )

    primaries = [r for r in roles if r.kind == "primary"]
    if len(primaries) != 1:
        raise ValueError(f"{source}: roles must declare exactly one primary")

    enabled_set = set(stages_enabled) or set(primaries[0].stages)
    covered = {s for r in roles for s in r.stages}
    missing = sorted(enabled_set - covered)
    if missing:
        raise ValueError(
            f"{source}: roles do not cover stages_enabled {missing}"
        )
    return tuple(roles)


def _parse_subagents(raw: dict[str, Any], *, source: str) -> tuple[SubAgentDef, ...]:
    """Parse spawn catalog under ``subagents:``."""
    block = raw.get("subagents")
    if block is None:
        return ()
    if not isinstance(block, dict):
        raise ValueError(f"{source}: subagents must be a mapping")

    out: list[SubAgentDef] = []
    for name, body in block.items():
        if not isinstance(body, dict):
            raise ValueError(f"{source}: subagents.{name} must be a mapping")
        sid = _as_text(body.get("id"), _as_text(name)) or _as_text(name)
        if not sid:
            continue
        isolation = (
            _as_text(body.get("isolation"), "forked_context").lower() or "forked_context"
        )
        if isolation not in _LIVE_SUBAGENT_ISOLATIONS:
            raise ValueError(
                f"{source}: subagents.{sid} isolation {isolation!r} not live "
                f"(supported: {', '.join(sorted(_LIVE_SUBAGENT_ISOLATIONS))})"
            )
        stage = _as_text(body.get("stage"), sid).lower() or sid
        system_key = _as_text(body.get("system"), "")
        contract = _as_text(body.get("contract"), "")
        model_ref = _as_text(body.get("model"), "")
        tools: list[str] = []
        tools_raw = body.get("tools")
        if isinstance(tools_raw, list):
            for t in tools_raw:
                ts = _as_text(t)
                if ts and ts not in tools:
                    tools.append(ts)
        try:
            max_turns = int(body.get("max_turns") if body.get("max_turns") is not None else 1)
        except (TypeError, ValueError):
            max_turns = 1
        parallel_b = _boolish(body.get("parallel"))
        parallel_ok = True if parallel_b is None else parallel_b
        out.append(
            SubAgentDef(
                id=sid,
                description=_as_text(body.get("description"), "") or "",
                isolation=isolation,
                model_ref=model_ref,
                system_key=system_key,
                stage=stage,
                contract=contract,
                tools=tuple(tools),
                max_turns=max(1, max_turns),
                parallel_ok=bool(parallel_ok),
            )
        )
    return tuple(out)


def _parse_contracts(raw: dict[str, Any]) -> dict[str, str]:
    out = dict(_DEFAULT_CONTRACTS)
    block = _as_map(raw.get("contracts"))
    for stage, body in block.items():
        key = _as_text(stage).lower()
        if not key:
            continue
        if isinstance(body, str):
            sid = body.strip()
        elif isinstance(body, dict):
            sid = _as_text(body.get("schema") or "")
        else:
            sid = ""
        if sid:
            out[key] = sid
    return out


def _parse_capabilities(
    raw: dict[str, Any],
) -> tuple[str, str, bool, str, bool, tuple[str, ...]]:
    caps = _as_map(raw.get("capabilities"))
    tools = _as_map(caps.get("tools"))
    skills = _as_map(caps.get("skills"))

    tools_catalog = _as_text(tools.get("catalog"), "canvas_actions") or "canvas_actions"
    tools_host = _as_text(tools.get("host"), "canvas_fe") or "canvas_fe"
    defer_b = _boolish(tools.get("defer"))
    tools_defer = True if defer_b is None else defer_b

    skills_catalog = _as_text(skills.get("catalog"), "design_skills") or "design_skills"
    auto_b = _boolish(skills.get("auto_triggers"))
    skills_auto = True if auto_b is None else auto_b

    ns_raw = skills.get("namespaces")
    namespaces: list[str] = []
    if isinstance(ns_raw, list):
        for item in ns_raw:
            s = _as_text(item).lower()
            if s and s not in namespaces:
                namespaces.append(s)
    if not namespaces:
        namespaces = ["core", "ext", "user"]

    return (
        tools_catalog,
        tools_host,
        tools_defer,
        skills_catalog,
        skills_auto,
        tuple(namespaces),
    )


def _profile_from_dict(raw: dict[str, Any], *, source: str) -> AgentProfile:
    if _as_text(raw.get("apiVersion")) != "recombyn.agent/v1":
        raise ValueError(f"{source}: unsupported apiVersion {raw.get('apiVersion')!r}")
    if _as_text(raw.get("kind")) != PROFILE_KIND:
        raise ValueError(f"{source}: kind must be {PROFILE_KIND}")

    pid = _as_text(raw.get("id"))
    if not pid:
        raise ValueError(f"{source}: missing id")

    meta = _as_map(raw.get("metadata"))
    identity = _as_map(raw.get("identity"))
    prompts = _as_map(identity.get("prompts"))
    persona = _as_map(prompts.get("persona"))
    overlays = _as_map(prompts.get("overlays"))
    stages_raw = _as_map(prompts.get("stages"))
    topology_template, stages_enabled, topology_loops = _parse_topology(raw, source=source)
    roles = _parse_roles(raw, stages_enabled=stages_enabled, source=source)
    subagents = _parse_subagents(raw, source=source)
    # forked_context roles must resolve to a catalog entry
    for role in roles:
        if role.isolation != "forked_context":
            continue
        sid = str(role.subagent_id or role.id or "").strip()
        if not any(s.id == sid for s in subagents):
            raise ValueError(
                f"{source}: roles.{role.id} isolation=forked_context needs "
                f"subagents.{sid} in catalog"
            )

    stages: dict[str, StagePromptSpec] = {}
    for name, body in stages_raw.items():
        key = _as_text(name).lower()
        if not key:
            continue
        default_overlay = key != "review"
        if key == "intent":
            continue
        spec = _parse_stage_spec(body, default_mode_overlay=default_overlay)
        if spec is None:
            raise ValueError(f"{source}: stages.{key} missing protocol")
        stages[key] = spec

    required_prompt_stages = ["decide"]
    if "paint" in stages_enabled:
        required_prompt_stages.append("paint")
    if "act" in stages_enabled:
        required_prompt_stages.append("act")
    for required in required_prompt_stages:
        if required not in stages:
            raise ValueError(f"{source}: stages.{required} is required")

    intent_prompt = ""
    intent_raw = stages_raw.get("intent")
    if isinstance(intent_raw, str):
        intent_prompt = intent_raw.strip()
    elif isinstance(intent_raw, dict):
        intent_prompt = _as_text(intent_raw.get("protocol") or "")

    routing_patches = _policy_from_routing(_as_map(raw.get("routing")))
    runtime_patches, runtime_flags = _policy_from_runtime(_as_map(raw.get("runtime")))
    policy_patches = {**routing_patches, **runtime_patches}
    contracts = _parse_contracts(raw)
    (
        tools_catalog,
        tools_host,
        tools_defer,
        skills_catalog,
        skills_auto_triggers,
        skills_namespaces,
    ) = _parse_capabilities(raw)

    return AgentProfile(
        id=pid,
        version=int(raw.get("version") or 1),
        status=_as_text(raw.get("status"), "active") or "active",
        display_name=_as_text(meta.get("display_name"), pid) or pid,
        locale=_as_text(identity.get("locale"), "zh-CN") or "zh-CN",
        persona_auto=_as_text(persona.get("auto"), "agent.persona.auto")
        or "agent.persona.auto",
        persona_locked=_as_text(persona.get("locked"), "agent.persona.locked")
        or "agent.persona.locked",
        router_prompt=_as_text(prompts.get("router"), "precheck.router_system")
        or "precheck.router_system",
        overlay_ask=_as_text(overlays.get("ask"), "agent.prompt.ask_system")
        or "agent.prompt.ask_system",
        overlay_agent=_as_text(overlays.get("agent"), "agent.prompt.agent_system")
        or "agent.prompt.agent_system",
        stages=stages,
        intent_prompt=intent_prompt or "agent.prompt.intent_classify",
        policy_patches=policy_patches,
        runtime_flags=runtime_flags,
        topology_template=topology_template,
        stages_enabled=stages_enabled,
        topology_loops=topology_loops,
        roles=roles,
        subagents=subagents,
        contracts=contracts,
        tools_catalog=tools_catalog,
        tools_host=tools_host,
        tools_defer=tools_defer,
        skills_catalog=skills_catalog,
        skills_auto_triggers=skills_auto_triggers,
        skills_namespaces=skills_namespaces,
        raw=raw,
    )


def apply_profile_rules(
    base_rules: dict[str, str] | None,
    *,
    profile: AgentProfile | None = None,
) -> dict[str, str]:
    """Overlay AgentProfile policy onto platform KV rules.

    - Literal patch values replace the rule key.
    - ``$kv:other.key`` copies ``base_rules[other.key]`` onto the target key when
      present (no-op when missing — keeps prior value).
    - Unmentioned keys pass through unchanged.
    """
    out = dict(base_rules or {})
    prof = profile or get_active_agent_profile()
    for rule_key, raw_val in (prof.policy_patches or {}).items():
        kv = _is_kv_ref(raw_val)
        if kv is not None:
            if kv in out and str(out.get(kv) or "").strip():
                out[rule_key] = str(out[kv]).strip()
            continue
        text = _as_text(raw_val)
        if text:
            out[rule_key] = text
    return out


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"AgentProfile file not found: {path}")
    text = path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(text)
    if not isinstance(parsed, dict):
        raise ValueError(f"AgentProfile must be a mapping: {path}")
    return parsed


def load_agent_profile(profile_id: str, *, force: bool = False) -> AgentProfile:
    """Load profile by id from ``seeds/agents/profiles/{id}.yaml``."""
    pid = _as_text(profile_id)
    if not pid:
        raise ValueError("profile_id is required")
    # Allow dotted ids as filenames (design.canvas.yaml).
    safe = pid.replace("\\", "").replace("/", "")
    if safe != pid or ".." in pid:
        raise ValueError(f"invalid profile id: {profile_id!r}")

    with _LOCK:
        if not force and pid in _PROFILE_CACHE:
            return _PROFILE_CACHE[pid]

    path = profiles_dir() / f"{pid}.yaml"
    raw = _load_yaml(path)
    raw = _apply_profile_overlays(raw, pid)
    profile = _profile_from_dict(raw, source=str(path))
    if profile.id != pid:
        raise ValueError(f"{path}: id {profile.id!r} != filename id {pid!r}")

    with _LOCK:
        _PROFILE_CACHE[pid] = profile
    return profile


def load_bindings() -> dict[str, Any]:
    global _BINDINGS_CACHE
    with _LOCK:
        if _BINDINGS_CACHE is not None:
            return _BINDINGS_CACHE
    path = agents_data_dir() / "bindings.yaml"
    if not path.is_file():
        data: dict[str, Any] = {"default": "design.canvas", "bindings": []}
    else:
        data = _load_yaml(path)
    with _LOCK:
        _BINDINGS_CACHE = data
    return data


def resolve_profile_id(
    *,
    explicit: str | None = None,
    product: str | None = None,
    surface: str | None = None,
) -> str:
    """Resolve profile id: explicit → settings → bindings match → bindings.default."""
    if explicit and str(explicit).strip():
        return str(explicit).strip()

    configured = _as_text(getattr(settings, "agent_profile_id", "") or "")
    if configured:
        return configured

    bindings = load_bindings()
    want_product = _as_text(product).lower()
    want_surface = _as_text(surface).lower()
    rows = bindings.get("bindings") if isinstance(bindings, dict) else None
    if (want_product or want_surface) and isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            when = _as_map(row.get("when"))
            bp = _as_text(when.get("product")).lower()
            bs = _as_text(when.get("surface")).lower()
            if want_product and bp and bp != want_product:
                continue
            if want_surface and bs and bs != want_surface:
                continue
            if want_product and not bp:
                continue
            if want_surface and not bs:
                continue
            pid = _as_text(row.get("profile"))
            if pid:
                return pid

    default = _as_text((bindings or {}).get("default"), "design.canvas")
    return default or "design.canvas"


def get_active_agent_profile(
    *,
    profile_id: str | None = None,
    product: str | None = None,
    surface: str | None = None,
    force: bool = False,
) -> AgentProfile:
    """Active profile for this process / request (cached by id)."""
    global _ACTIVE_ID
    pid = resolve_profile_id(
        explicit=profile_id, product=product, surface=surface
    )
    profile = load_agent_profile(pid, force=force)
    with _LOCK:
        _ACTIVE_ID = profile.id
    return profile


def active_profile_id() -> str | None:
    with _LOCK:
        return _ACTIVE_ID


def ensure_contract_registry() -> dict[str, Any]:
    """Lazy map schema id → Pydantic model (avoids import cycles)."""
    global _CONTRACT_SCHEMA_REGISTRY
    if _CONTRACT_SCHEMA_REGISTRY is not None:
        return _CONTRACT_SCHEMA_REGISTRY
    from recombyn_protocol import (
        AutonomousArtDirectorSchema,
        DecideTurnSchema,
        DesignCandidateSetSchema,
        DesignCounterfactualSchema,
        DesignGovernanceSchema,
        DesignResearchReportSchema,
        DesignSimulationSchema,
        DesignStrategySchema,
        DesignSwarmResultSchema,
        DesignTournamentResultSchema,
        PaintOpsSchema,
        ReferenceIntelligenceTurnSchema,
        ResearchTurnSchema,
        ReviewLaneSchema,
        ReviewTurnSchema,
        VisionScoutTurnSchema,
    )
    from app.services.design.runtime.models_route import IntentClassifyDecision

    _CONTRACT_SCHEMA_REGISTRY = {
        "IntentTurn.v1": IntentClassifyDecision,
        "DecideTurn.v1": DecideTurnSchema,
        "ToolOpsBatch.v1": PaintOpsSchema,
        "ReviewTurn.v1": ReviewTurnSchema,
        "ReviewLane.v1": ReviewLaneSchema,
        "VisionScoutTurn.v1": VisionScoutTurnSchema,
        "ResearchTurn.v1": ResearchTurnSchema,
        "DesignResearch.v1": DesignResearchReportSchema,
        "DesignStrategy.v1": DesignStrategySchema,
        "DesignCandidates.v1": DesignCandidateSetSchema,
        "DesignTournament.v1": DesignTournamentResultSchema,
        "DesignSwarm.v1": DesignSwarmResultSchema,
        "DesignSimulation.v1": DesignSimulationSchema,
        "DesignCounterfactual.v1": DesignCounterfactualSchema,
        "DesignGovernance.v1": DesignGovernanceSchema,
        "AutonomousArtDirector.v1": AutonomousArtDirectorSchema,
        "ReferenceIntel.v1": ReferenceIntelligenceTurnSchema,
    }
    return _CONTRACT_SCHEMA_REGISTRY


def list_contract_schema_ids() -> list[str]:
    return sorted(ensure_contract_registry().keys())


def resolve_contract_schema(
    stage: str,
    *,
    profile: AgentProfile | None = None,
) -> Any:
    """Return Pydantic schema class for a Profile contract stage."""
    prof = profile or get_active_agent_profile()
    sid = prof.contract_schema_id(stage)
    reg = ensure_contract_registry()
    schema = reg.get(sid)
    if schema is None:
        known = ", ".join(list_contract_schema_ids()) or "(none)"
        raise ValueError(
            f"profile {prof.id!r}: unknown contract schema {sid!r} "
            f"for stage {stage!r}; known: {known}"
        )
    return schema


def _build_canvas_fe_host() -> ToolHostAdapter:
    from app.services.design.ops.tool_ops_contract import (
        TOOL_OPS_SCHEMA_VERSION,
        format_canvas_tools_catalog,
        format_canvas_tools_details,
        format_canvas_tools_for_model,
    )
    from app.services.design.runtime.host.ops_gate import validate_paint_ops

    return ToolHostAdapter(
        id="canvas_fe",
        catalog_id="canvas_actions",
        schema_version=str(TOOL_OPS_SCHEMA_VERSION),
        format_catalog=format_canvas_tools_catalog,
        format_details=format_canvas_tools_details,
        format_full=format_canvas_tools_for_model,
        validate_ops=validate_paint_ops,
    )


def ensure_tool_host_registry() -> dict[str, ToolHostAdapter]:
    global _TOOL_HOST_REGISTRY
    if _TOOL_HOST_REGISTRY is not None:
        return _TOOL_HOST_REGISTRY
    host = _build_canvas_fe_host()
    _TOOL_HOST_REGISTRY = {host.id: host}
    return _TOOL_HOST_REGISTRY


def list_tool_host_ids() -> list[str]:
    return sorted(ensure_tool_host_registry().keys())


def resolve_tool_host(*, profile: AgentProfile | None = None) -> ToolHostAdapter:
    """Resolve ToolHost for the active / given profile."""
    prof = profile or get_active_agent_profile()
    hid = _as_text(prof.tools_host, "canvas_fe") or "canvas_fe"
    reg = ensure_tool_host_registry()
    host = reg.get(hid)
    if host is None:
        known = ", ".join(list_tool_host_ids()) or "(none)"
        raise ValueError(
            f"profile {prof.id!r}: unknown tools.host {hid!r}; known: {known}"
        )
    # Catalog id is informational for now; canvas_fe only serves canvas_actions.
    if host.catalog_id and prof.tools_catalog and host.catalog_id != prof.tools_catalog:
        raise ValueError(
            f"profile {prof.id!r}: tools.catalog {prof.tools_catalog!r} "
            f"incompatible with host {hid!r} (expects {host.catalog_id!r})"
        )
    return host


def validate_profile_surface(profile: AgentProfile) -> None:
    """Fail-fast on unknown contracts / tool host / catalog mismatch / roles."""
    reg = ensure_contract_registry()
    for stage, sid in (profile.contracts or {}).items():
        if sid not in reg:
            raise ValueError(
                f"profile {profile.id!r}: unknown contract schema {sid!r} "
                f"(stage {stage})"
            )
    resolve_tool_host(profile=profile)
    if not profile.roles:
        raise ValueError(f"profile {profile.id!r}: roles required")
    if sum(1 for r in profile.roles if r.kind == "primary") != 1:
        raise ValueError(f"profile {profile.id!r}: exactly one primary role required")
    for role in profile.roles:
        if role.isolation not in _LIVE_ROLE_ISOLATIONS:
            raise ValueError(
                f"profile {profile.id!r}: role {role.id!r} isolation "
                f"{role.isolation!r} not live"
            )
        if role.isolation == "forked_context":
            sid = str(role.subagent_id or role.id or "").strip()
            if profile.get_subagent(sid) is None:
                raise ValueError(
                    f"profile {profile.id!r}: role {role.id!r} missing "
                    f"subagents.{sid}"
                )
    for sa in profile.subagents or ():
        if sa.isolation not in _LIVE_SUBAGENT_ISOLATIONS:
            raise ValueError(
                f"profile {profile.id!r}: subagent {sa.id!r} isolation "
                f"{sa.isolation!r} not live"
            )
        cid = str(sa.contract or "").strip()
        if cid and cid not in reg:
            raise ValueError(
                f"profile {profile.id!r}: subagent {sa.id!r} unknown contract "
                f"schema {cid!r}"
            )
