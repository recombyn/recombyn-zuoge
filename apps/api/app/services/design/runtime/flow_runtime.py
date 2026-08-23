"""Graph-driven agent flow scheduler (walker).

Edges decide transitions via condition / priority / isDefault.
Nodes of kind parallel fan-out all outs; join waits by joinMode.
"""

from __future__ import annotations

from typing import Any


def _edge_condition(edge: dict[str, Any]) -> str:
    """Semantic when-predicate only. Never fall back to display label.

    Labels like 「其他未命中」「Agent 主线」 are UI copy; using them as conditions
    makes every branch fail and runtime falls through to settle.
    """
    return str(edge.get("condition") or "").strip()


def _edge_priority(edge: dict[str, Any]) -> int:
    try:
        return int(edge.get("priority", 100))
    except (TypeError, ValueError):
        return 100


def _edge_is_default(edge: dict[str, Any]) -> bool:
    return bool(edge.get("isDefault"))


def eval_edge_condition(condition: str, ctx: dict[str, Any] | None) -> bool:
    """Match schedule condition against dry-run / runtime context.

    Supported forms:
    - empty → always true (unconditional)
    - flag name → ctx[flag] truthy, or flag in ctx["flags"]
    - field=value / field==value → string equality on ctx[field]
    - a&b / a&&b → all conjuncts true (recursive)
    """
    cond = (condition or "").strip()
    if not cond:
        return True
    # AND first so mode=ask&op_failed does not split on '=' incorrectly.
    if "&&" in cond or "&" in cond:
        parts = [p.strip() for p in cond.replace("&&", "&").split("&") if p.strip()]
        return all(eval_edge_condition(p, ctx) for p in parts) if parts else True

    data = ctx or {}
    flags = data.get("flags")
    flag_set = {str(x).strip() for x in flags} if isinstance(flags, (list, set, tuple)) else set()

    for sep in ("==", "="):
        if sep in cond:
            left, right = cond.split(sep, 1)
            key = left.strip()
            want = right.strip()
            if not key:
                return False
            got = data.get(key)
            if got is None and key in flag_set:
                return want.lower() in {"1", "true", "yes"}
            return str(got).strip() == want

    if cond in flag_set:
        return True
    if cond in data:
        return bool(data.get(cond))
    return False


def choose_outgoing_edges(
    *,
    node: dict[str, Any],
    edges: list[dict[str, Any]],
    ctx: dict[str, Any] | None = None,
    explore_all: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Pick next edges and explain why (match / default / unconditional / none).

    Returns (edges, detail). detail keys: via, edge_id, condition, priority,
    is_default, candidate_count.
    """
    outs = sorted(edges, key=lambda e: (_edge_priority(e), str(e.get("id") or "")))
    empty: dict[str, Any] = {
        "via": "none",
        "edge_id": None,
        "condition": None,
        "priority": None,
        "is_default": False,
        "candidate_count": len(outs),
    }
    if not outs:
        return [], empty
    # Fan-out only when explore_all (Admin dry-run). Runtime uses exclusive match
    # so parallel gateways still honor condition/priority/isDefault.
    if explore_all:
        first = outs[0]
        cond = _edge_condition(first) or None
        return list(outs), {
            "via": "parallel",
            "edge_id": str(first.get("id") or "") or None,
            "condition": cond,
            "priority": _edge_priority(first),
            "is_default": _edge_is_default(first),
            "candidate_count": len(outs),
        }

    matched: list[dict[str, Any]] = []
    defaults: list[dict[str, Any]] = []
    for e in outs:
        if _edge_is_default(e):
            defaults.append(e)
            continue
        cond = _edge_condition(e)
        # Empty condition is unconditional fallback, not an always-match branch.
        if not cond:
            continue
        if eval_edge_condition(cond, ctx):
            matched.append(e)

    def _detail(edge: dict[str, Any], via: str) -> dict[str, Any]:
        cond = _edge_condition(edge) or None
        return {
            "via": via,
            "edge_id": str(edge.get("id") or "") or None,
            "condition": cond,
            "priority": _edge_priority(edge),
            "is_default": _edge_is_default(edge),
            "candidate_count": len(outs),
        }

    if matched:
        return [matched[0]], _detail(matched[0], "match")
    if defaults:
        return [defaults[0]], _detail(defaults[0], "default")
    unconditional = [e for e in outs if not _edge_condition(e)]
    if len(outs) == 1:
        return outs, _detail(outs[0], "single")
    if unconditional:
        return [unconditional[0]], _detail(unconditional[0], "unconditional")
    return [], empty


def select_outgoing_edges(
    *,
    node: dict[str, Any],
    edges: list[dict[str, Any]],
    ctx: dict[str, Any] | None = None,
    explore_all: bool = False,
) -> list[dict[str, Any]]:
    """Pick next edges from a finished node.

    - parallel / explore_all: all outs
    - otherwise exclusive: first matching by priority; else default edge(s)
    """
    chosen, _detail = choose_outgoing_edges(
        node=node, edges=edges, ctx=ctx, explore_all=explore_all
    )
    return chosen


def walk_agent_flow(
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    start_ids: list[str] | None = None,
    ctx: dict[str, Any] | None = None,
    max_steps: int = 500,
    explore_all: bool = False,
) -> dict[str, Any]:
    """Dry-run / schedule walk from start with exclusive branch + AND/OR join.

    explore_all=True: take every outbound edge (Admin connectivity dry-run).
    explore_all=False: exclusive matching via condition/priority/isDefault.
    """
    node_by_id = {str(n.get("id") or ""): n for n in nodes if n.get("id")}
    outgoing: dict[str, list[dict[str, Any]]] = {}
    incoming: dict[str, list[str]] = {}
    for e in edges:
        src = str(e.get("source") or "")
        tgt = str(e.get("target") or "")
        if src not in node_by_id:
            continue
        outgoing.setdefault(src, []).append(e)
        if tgt in node_by_id:
            incoming.setdefault(tgt, []).append(src)

    def _is_join(nid: str) -> bool:
        n = node_by_id.get(nid) or {}
        return str(n.get("kind") or "").lower() == "join"

    def _join_mode(nid: str) -> str:
        n = node_by_id.get(nid) or {}
        mode = str(n.get("joinMode") or "and").lower()
        return "or" if mode == "or" else "and"

    if start_ids is None:
        starts = [
            str(n.get("id"))
            for n in nodes
            if str(n.get("kind") or "").lower() == "start" or str(n.get("id")) == "start"
        ]
        if not starts:
            inbound = {str(e.get("target") or "") for e in edges}
            starts = [str(n.get("id")) for n in nodes if n.get("id") and str(n.get("id")) not in inbound]
        start_ids = [s for s in starts if s]

    steps: list[dict[str, Any]] = []
    visited: set[str] = set()
    taken_edges: list[str] = []
    join_arrivals: dict[str, set[str]] = {}
    queue: list[str] = list(start_ids)
    order = 0
    warnings: list[dict[str, Any]] = []

    def _join_ready(tgt: str) -> bool:
        need = set(incoming.get(tgt) or [])
        arrived = join_arrivals.get(tgt) or set()
        if not need:
            return True
        if _join_mode(tgt) == "or":
            return bool(arrived)
        return need <= arrived

    def _try_enqueue(src: str, tgt: str) -> None:
        if not tgt or tgt in visited or tgt in queue:
            return
        if not _is_join(tgt):
            queue.append(tgt)
            return
        arrived = join_arrivals.setdefault(tgt, set())
        arrived.add(src)
        if _join_ready(tgt):
            queue.append(tgt)

    while queue and order < max_steps:
        nid = queue.pop(0)
        if not nid or nid in visited:
            continue
        if _is_join(nid) and not _join_ready(nid):
            continue
        visited.add(nid)
        n = node_by_id.get(nid) or {}
        outs = outgoing.get(nid) or []
        kind = str(n.get("kind") or "node").lower()
        chosen = select_outgoing_edges(node=n, edges=outs, ctx=ctx, explore_all=explore_all)
        order += 1
        steps.append(
            {
                "order": order,
                "nodeId": nid,
                "label": str(n.get("label") or nid),
                "kind": str(n.get("kind") or "node"),
                "phaseKey": str(n.get("phaseKey") or ""),
                "parallel": kind == "parallel",
                "join": kind == "join",
                "joinMode": _join_mode(nid) if kind == "join" else None,
                "branches": [
                    {
                        "edgeId": str(e.get("id") or ""),
                        "condition": _edge_condition(e),
                        "priority": _edge_priority(e),
                        "isDefault": _edge_is_default(e),
                        "target": str(e.get("target") or ""),
                        "taken": e in chosen,
                    }
                    for e in outs
                ],
            }
        )
        for e in chosen:
            eid = str(e.get("id") or "")
            if eid:
                taken_edges.append(eid)
            _try_enqueue(nid, str(e.get("target") or ""))

    for n in nodes:
        nid = str(n.get("id") or "")
        if not nid or not _is_join(nid) or nid in visited:
            continue
        need = set(incoming.get(nid) or [])
        arrived = join_arrivals.get(nid) or set()
        missing = sorted(need - arrived)
        if missing and _join_mode(nid) == "and":
            warnings.append(
                {
                    "level": "warning",
                    "code": "join_wait",
                    "message": f"汇聚 {nid} 未触发：仍等待 {', '.join(missing[:8])}",
                    "nodeId": nid,
                    "waitingFrom": missing[:20],
                }
            )

    return {
        "steps": steps,
        "visitedNodeIds": list(visited),
        "takenEdgeIds": taken_edges,
        "warnings": warnings,
        "truncated": order >= max_steps,
        "exploreAll": explore_all,
    }


def next_nodes_after(
    *,
    node_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    ctx: dict[str, Any] | None = None,
) -> list[str]:
    """Runtime helper: given current node + context, return next node ids."""
    node_by_id = {str(n.get("id") or ""): n for n in nodes if n.get("id")}
    node = node_by_id.get(node_id)
    if not node:
        return []
    outs = [e for e in edges if str(e.get("source") or "") == node_id]
    chosen = select_outgoing_edges(node=node, edges=outs, ctx=ctx)
    return [str(e.get("target") or "") for e in chosen if e.get("target")]


_INJECT_SOURCES = frozenset(
    {"canvas_tools", "memory", "prompt", "fonts"}
)
_INJECT_MODES = frozenset({"none", "catalog", "details"})


def normalize_inject(raw: Any) -> dict[str, Any]:
    """Clean node.inject object for persistence / runtime."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    mode = str(raw.get("mode") or "").strip().lower()
    if mode in _INJECT_MODES:
        out["mode"] = mode
    source = str(raw.get("source") or "").strip().lower()
    if source in _INJECT_SOURCES:
        out["source"] = source
    catalogs: list[str] = []
    for item in raw.get("catalogs") or []:
        s = str(item or "").strip().lower()
        if s in _INJECT_SOURCES and s not in catalogs:
            catalogs.append(s)
    if catalogs:
        out["catalogs"] = catalogs
    specs = [str(x).strip() for x in (raw.get("specs") or []) if str(x).strip()]
    if specs:
        out["specs"] = specs[:20]
    validate = [str(x).strip() for x in (raw.get("validate") or []) if str(x).strip()]
    if validate:
        out["validate"] = validate[:20]
    if "deferDetails" in raw:
        out["deferDetails"] = bool(raw.get("deferDetails"))
    return out


def default_inject_for_node(node: dict[str, Any]) -> dict[str, Any] | None:
    """Seed inject from phaseKey / capability when missing."""
    pk = str(node.get("phaseKey") or node.get("id") or "").strip()
    cap = str(node.get("capability") or "").strip().lower()
    kind = str(node.get("kind") or "").strip().lower()
    table: dict[str, dict[str, Any]] = {
        "thought": {
            "mode": "catalog",
            "catalogs": ["canvas_tools"],
            "deferDetails": True,
            "specs": ["agent.prompt.react_system"],
            "validate": ["json_contract"],
        },
        "dual_sample": {
            "mode": "catalog",
            "catalogs": ["canvas_tools"],
            "deferDetails": True,
        },
        "plan": {"mode": "none", "specs": ["agent.prompt.plan_system"]},
        "intent_classify": {
            "mode": "none",
            "specs": ["agent.prompt.intent_classify"],
        },
        "memory": {"mode": "details", "source": "memory"},
        "need_tools": {"mode": "catalog", "source": "canvas_tools"},
        "tool_details": {
            "mode": "details",
            "source": "canvas_tools",
            "validate": ["tool_args_schema"],
        },
        "action": {
            "mode": "details",
            "source": "canvas_tools",
            "validate": ["svg_markup", "tool_args_schema", "validate.checklist"],
        },
        "validate_fail": {
            "mode": "none",
            "validate": ["validate.checklist", "svg_markup"],
        },
        "clarify": {"mode": "none", "specs": ["agent.prompt.ask_system"]},
        "propose": {"mode": "none", "specs": ["agent.prompt.ask_system"]},
    }
    if pk in table:
        return dict(table[pk])
    if kind == "guard":
        return {"mode": "none", "validate": ["validate.checklist", "svg_markup"]}
    if kind == "prompt" or (cap == "prompt" and kind in ("resource", "prompt")):
        return {"mode": "details", "source": "prompt"}
    if cap == "canvas_tools":
        return {"mode": "details", "source": "canvas_tools"}
    return None


def catalogs_from_need_edge_conditions(conditions: list[str]) -> list[str]:
    """Outbound need_* edge conditions → inject catalog sources."""
    out: list[str] = []
    for raw in conditions:
        c = str(raw or "")
        for token, src in (
            ("need_tools", "canvas_tools"),
            ("need_skills", "prompt"),
        ):
            if token in c and src not in out:
                out.append(src)
    return out


def index_inject_by_phase(graph: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Map phaseKey (and node id) → normalized inject.

    Thought-like catalogs prefer outbound need_* edges over stale node.inject.catalogs.
    """
    raw = graph if isinstance(graph, dict) else {}
    nodes = [n for n in (raw.get("nodes") or []) if isinstance(n, dict)]
    edges = [e for e in (raw.get("edges") or []) if isinstance(e, dict)]
    conditions_by_source: dict[str, list[str]] = {}
    for e in edges:
        sid = str(e.get("source") or "").strip()
        if not sid:
            continue
        conditions_by_source.setdefault(sid, []).append(str(e.get("condition") or ""))

    out: dict[str, dict[str, Any]] = {}
    for n in nodes:
        inj = normalize_inject(n.get("inject"))
        if not inj:
            seeded = default_inject_for_node(n)
            inj = normalize_inject(seeded) if seeded else {}
        if not inj:
            continue
        nid = str(n.get("id") or "").strip()
        pk = str(n.get("phaseKey") or "").strip()
        edge_cats = catalogs_from_need_edge_conditions(conditions_by_source.get(nid, []))
        if edge_cats and (
            inj.get("catalogs")
            or str(inj.get("mode") or "").lower() == "catalog"
            or bool(inj.get("deferDetails"))
        ):
            inj = {**inj, "catalogs": edge_cats, "mode": inj.get("mode") or "catalog"}
        if nid:
            out[nid] = inj
        if pk:
            out[pk] = inj
    return out


def resolve_node_inject(
    inject_index: dict[str, dict[str, Any]],
    *keys: str,
) -> dict[str, Any]:
    for key in keys:
        k = str(key or "").strip()
        if k and k in inject_index:
            return dict(inject_index[k])
    return {}


def inject_allows(inject: dict[str, Any] | None, *, want_mode: str | None = None) -> bool:
    """True when inject should run (not mode=none)."""
    inj = inject or {}
    mode = str(inj.get("mode") or "").strip().lower()
    if mode == "none":
        return False
    if want_mode and mode and mode != want_mode:
        return False
    return True


def build_catalog_blocks(
    *,
    catalogs: list[str],
    rules: dict[str, str] | None,
    scene: str,
) -> list[str]:
    """Format short catalog blocks for thought system prompt."""
    from app.services.design.ops.tool_ops_contract import format_canvas_tools_catalog
    from app.services.fonts_store import format_fonts_catalog

    blocks: list[str] = []
    for src in catalogs:
        if src == "canvas_tools":
            blocks.append(format_canvas_tools_catalog(rules))
        elif src == "fonts":
            blocks.append(format_fonts_catalog())
    return [b for b in blocks if b]


def build_full_tools_block(rules: dict[str, str] | None) -> str:
    from app.services.design.ops.tool_ops_contract import format_canvas_tools_for_model

    return format_canvas_tools_for_model(rules)


def load_default_flow_inject_index() -> dict[str, dict[str, Any]]:
    """Admin flowchart removed — no inject index from published graph."""
    return {}

