"""API-side Intelligence providers + client factory.

Runtime always builds ``BasicLocalProvider`` in-process. Optional remote
billing helpers may still read config URLs; Design floors do not call a
remote Intelligence HTTP service.

Stable surface matches ``DesignIntelligenceClient`` canonical methods.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from recombyn_intelligence_client import DesignIntelligenceClient

from app.core.config import settings

_log = logging.getLogger("app.design.intelligence")

_client: DesignIntelligenceClient | None = None

_INTEL_HOP_TTL_SEC = 3600
_INTEL_HOP_META_MAX = 32


def _wire_method(name: str) -> str:
    """Canonical HTTP path segment."""
    return str(name or "").strip()


def _intel_hop_redis() -> Any | None:
    try:
        url = str(getattr(settings, "redis_url", "") or "").strip()
        if not url:
            return None
        import redis

        return redis.Redis.from_url(
            url, decode_responses=True, socket_connect_timeout=0.4, socket_timeout=0.4
        )
    except Exception:
        return None


def _intel_hop_redis_key(run_id: str, method: str, input_hash: str) -> str:
    return f"design:intel-hop:{run_id}:{method}:{input_hash}"


def _intel_hop_meta_key(method: str, input_hash: str) -> str:
    return f"{method}:{input_hash}"


def _intel_hop_entry_at(entry: Any) -> float:
    if not isinstance(entry, dict):
        return 0.0
    try:
        return float(entry.get("at") or 0)
    except (TypeError, ValueError):
        return 0.0


def _intel_hop_from_redis(run_id: str, method: str, input_hash: str) -> dict[str, Any] | None:
    r = _intel_hop_redis()
    if r is None:
        return None
    try:
        raw = r.get(_intel_hop_redis_key(run_id, method, input_hash))
    except Exception:
        _log.debug("intelligence hop redis get failed", exc_info=True)
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _intel_hop_to_redis(
    run_id: str, method: str, input_hash: str, payload: dict[str, Any]
) -> None:
    r = _intel_hop_redis()
    if r is None:
        return
    try:
        r.setex(
            _intel_hop_redis_key(run_id, method, input_hash),
            _INTEL_HOP_TTL_SEC,
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        )
    except Exception:
        _log.debug("intelligence hop redis put failed", exc_info=True)


def _intel_hop_from_task_meta(
    run_id: str, method: str, input_hash: str
) -> dict[str, Any] | None:
    from app.services.design.admin.task_store import get_design_task, parse_task_meta

    row = get_design_task(run_id)
    if not row:
        return None
    cache = parse_task_meta(row.get("meta_json")).get("intelligence_cache")
    if not isinstance(cache, dict):
        return None
    entry = cache.get(_intel_hop_meta_key(method, input_hash))
    if not isinstance(entry, dict):
        return None
    at = _intel_hop_entry_at(entry)
    if at <= 0 or time.time() - at > _INTEL_HOP_TTL_SEC:
        return None
    payload = entry.get("payload")
    return payload if isinstance(payload, dict) else None


def _intel_hop_to_task_meta(
    run_id: str, method: str, input_hash: str, payload: dict[str, Any]
) -> None:
    from app.services.design.admin.task_store import (
        get_design_task,
        merge_task_meta,
        parse_task_meta,
    )

    row = get_design_task(run_id)
    if not row:
        return
    now = time.time()
    prior = parse_task_meta(row.get("meta_json")).get("intelligence_cache")
    cache: dict[str, Any] = {}
    if isinstance(prior, dict):
        for key, entry in prior.items():
            if not isinstance(entry, dict):
                continue
            at = _intel_hop_entry_at(entry)
            if at <= 0 or now - at > _INTEL_HOP_TTL_SEC:
                continue
            cache[str(key)] = entry
    cache[_intel_hop_meta_key(method, input_hash)] = {"payload": payload, "at": now}
    if len(cache) > _INTEL_HOP_META_MAX:
        keep = sorted(
            cache.items(),
            key=lambda item: _intel_hop_entry_at(item[1]),
            reverse=True,
        )[:_INTEL_HOP_META_MAX]
        cache = dict(keep)
    merge_task_meta(run_id, {"intelligence_cache": cache})


def get_intelligence_hop(key: tuple[str, str, str]) -> dict[str, Any] | None:
    run_id, method, input_hash = key
    if not run_id or not method or not input_hash:
        return None
    hit = _intel_hop_from_redis(run_id, method, input_hash)
    if hit is not None:
        return hit
    return _intel_hop_from_task_meta(run_id, method, input_hash)


def put_intelligence_hop(key: tuple[str, str, str], payload: dict[str, Any]) -> None:
    run_id, method, input_hash = key
    if not run_id or not method or not input_hash or not isinstance(payload, dict):
        return
    _intel_hop_to_redis(run_id, method, input_hash, payload)
    _intel_hop_to_task_meta(run_id, method, input_hash, payload)


def apply_intelligence_result(
    method: str, rt: Any, data: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Write a Provider payload into Runtime slots (Decide ignores return values).

    BasicLocal runners already apply in-place. Remote must call this after a
    usable HTTP body, or Kernel never sees Research/Strategy/….
    """
    if not isinstance(data, dict) or not data:
        return None
    name = _wire_method(method)

    if name == "analyze_reference":
        from app.services.design.runtime.graph.nodes.decide import (
            apply_reference_intelligence,
        )
        from app.services.design.runtime.graph.state import (
            compile_reference_intelligence,
        )

        if data.get("analyze") or data.get("dna") or data.get("lock"):
            apply_reference_intelligence(rt, data)
        else:
            apply_reference_intelligence(
                rt,
                compile_reference_intelligence(data, data.get("visual_dna")),
            )
        return data

    if name == "research":
        from app.services.design.runtime.graph.nodes.research import (
            apply_research_to_runtime,
        )

        apply_research_to_runtime(rt, data)
        return data

    if name == "strategy":
        from app.services.design.runtime.graph.nodes.strategy import (
            apply_strategy_to_runtime,
        )

        apply_strategy_to_runtime(rt, data)
        return data

    if name == "propose_candidates":
        from app.services.design.runtime.graph.nodes.candidates import (
            apply_candidates_to_runtime,
        )

        apply_candidates_to_runtime(rt, data)
        return data

    if name == "tournament":
        from app.services.design.runtime.graph.nodes.tournament import (
            apply_tournament_to_runtime,
        )

        apply_tournament_to_runtime(rt, data)
        return data

    if name == "swarm_direction":
        from app.services.design.runtime.graph.nodes.swarm import apply_swarm_to_runtime

        apply_swarm_to_runtime(rt, data)
        return data

    if name == "simulate":
        from app.services.design.runtime.graph.nodes.simulation import (
            apply_simulation_to_runtime,
        )

        apply_simulation_to_runtime(rt, data)
        return data

    if name == "counterfactual":
        from app.services.design.runtime.graph.nodes.counterfactual import (
            apply_counterfactual_to_runtime,
        )

        apply_counterfactual_to_runtime(rt, data)
        return data

    if name == "govern":
        from app.services.design.runtime.graph.nodes.governance import (
            apply_governance_to_runtime,
        )

        apply_governance_to_runtime(rt, data)
        return data

    if name in ("autonomous_plan", "autonomous_sync"):
        from app.services.design.runtime.graph.nodes.autonomous import (
            apply_autonomous_to_runtime,
        )

        apply_autonomous_to_runtime(rt, data)
        return data

    # review / optimize / memory / principle — optional Remote enrichment slots
    if name == "review":
        if data.get("score") is not None or data.get("status"):
            prior = getattr(rt, "judge_verdict", None)
            if not isinstance(prior, dict):
                prior = {}
            merged = dict(prior)
            merged.update(
                {
                    "status": data.get("status"),
                    "score": data.get("score"),
                    "issues": data.get("issues"),
                    "summary": data.get("summary"),
                    "provider": data.get("provider"),
                }
            )
            rt.judge_verdict = merged
        return data

    if name == "optimize":
        rt.optimization = data
        return data

    if name == "retrieve_memory":
        if isinstance(getattr(rt, "flags", None), dict):
            rt.flags["intelligence_memory"] = data
            notes = data.get("notes")
            if isinstance(notes, list):
                rt.flags["memory_notes"] = [str(x) for x in notes if str(x).strip()][:16]
            if data.get("category"):
                rt.flags["taste_category"] = str(data.get("category"))
            if isinstance(data.get("preferences"), dict):
                rt.flags["taste_preferences"] = data["preferences"]
            if isinstance(data.get("principles"), list):
                rt.flags["taste_principles"] = [
                    str(x) for x in data["principles"] if str(x).strip()
                ][:12]
            if data.get("retrieval"):
                rt.flags["taste_retrieval"] = str(data.get("retrieval"))
            if data.get("embed_backend"):
                rt.flags["taste_embed_backend"] = str(data.get("embed_backend"))
            if data.get("embed_model"):
                rt.flags["taste_embed_model"] = str(data.get("embed_model"))
            if isinstance(data.get("scores"), list):
                rt.flags["taste_scores"] = list(data.get("scores") or [])[:12]
            if isinstance(data.get("related_triples"), list):
                rt.flags["taste_related_triples"] = list(
                    data.get("related_triples") or []
                )[:8]
        return data

    if name == "write_principle":
        if isinstance(getattr(rt, "flags", None), dict):
            rt.flags["intelligence_principle_write"] = data
            if data.get("written"):
                rt.flags["knowledge_written"] = True
            if data.get("ids"):
                rt.flags["taste_principle_ids"] = list(data.get("ids") or [])[:12]
        return data

    # review / optimize / retrieve_memory / write_principle — optional; no slot yet.
    return data


class BasicLocalProvider:
    """Default open provider — BasicLocal P32–P42 floors (no private data)."""

    async def analyze_reference(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.decide import (
            run_reference_intelligence,
        )

        return await run_reference_intelligence(rt)

    async def research(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.research import run_design_research

        return await run_design_research(rt)

    async def strategy(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.strategy import run_design_strategy

        return await run_design_strategy(rt)

    async def propose_candidates(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.candidates import run_multi_candidate

        return await run_multi_candidate(rt)

    async def tournament(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.tournament import (
            run_design_tournament,
        )

        return await run_design_tournament(rt)

    async def swarm_direction(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.swarm import run_design_swarm

        return await run_design_swarm(rt)

    async def simulate(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.simulation import (
            run_design_simulation,
        )

        return await run_design_simulation(rt)

    async def counterfactual(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.counterfactual import (
            run_design_counterfactual,
        )

        return await run_design_counterfactual(rt)

    async def review(self, rt: Any) -> dict[str, Any] | None:
        """Advanced review/judge hook. Kernel Review node remains authoritative.

        BasicLocal is a no-op so Host merge / seven-lane Review stay in Kernel.
        Cloud providers may return production judge payloads here.
        """
        return None

    async def optimize(self, rt: Any) -> dict[str, Any] | None:
        """Advanced optimization hook. BasicLocal leaves Kernel Opt controller."""
        return None

    async def govern(self, rt: Any) -> dict[str, Any]:
        from app.services.design.runtime.graph.nodes.governance import (
            gate_governance_before_settle,
        )

        return await gate_governance_before_settle(rt)

    async def autonomous_plan(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.autonomous import (
            run_autonomous_controller,
        )

        return await run_autonomous_controller(rt, phase="plan")

    async def autonomous_sync(self, rt: Any) -> dict[str, Any] | None:
        from app.services.design.runtime.graph.nodes.autonomous import (
            run_autonomous_controller,
        )

        return await run_autonomous_controller(rt, phase="sync")

    async def retrieve_memory(self, rt: Any) -> dict[str, Any] | None:
        """Taste / preference retrieval. BasicLocal has no private embeddings."""
        return None

    async def write_principle(self, rt: Any) -> dict[str, Any] | None:
        """Principle / knowledge write-back. BasicLocal has no private KG writer."""
        return None



def build_design_intelligence_client() -> DesignIntelligenceClient:
    """Always BasicLocal — no remote Intelligence HTTP service."""
    return DesignIntelligenceClient(BasicLocalProvider())


def get_design_intelligence_client() -> DesignIntelligenceClient:
    """Process-wide client (settings-stable)."""
    global _client
    if _client is None:
        _client = build_design_intelligence_client()
    return _client


def reset_design_intelligence_client() -> None:
    """Test helper — drop cached client."""
    global _client
    _client = None

def remote_billing_base_url() -> str:
    """No remote Intelligence host — billing quotes stay local."""
    return ""


def _remote_billing_headers() -> dict[str, str]:
    key = str(getattr(settings, "intelligence_remote_api_key", "") or "").strip()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def call_remote_billing(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """HTTP call to optional host ``/billing/quote``. Returns None if unavailable."""
    import urllib.error
    import urllib.request

    base = remote_billing_base_url()
    if not base:
        return None
    url = f"{base}{path}"
    timeout = float(getattr(settings, "intelligence_remote_timeout_sec", 30.0) or 30.0)
    data = None
    headers = _remote_billing_headers()
    if json_body is not None or method.upper() in ("POST", "PUT"):
        import json as _json

        raw = _json.dumps(json_body or {}).encode("utf-8")
        data = raw
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            import json as _json

            body = _json.loads(resp.read().decode("utf-8"))
            return body if isinstance(body, dict) else None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
        _log.warning("remote billing %s %s failed: %s", method, path, e)
        return None


def quote_remote_task_credits(body: dict[str, Any]) -> dict[str, Any] | None:
    """Optional host credit quote — wire returns credits only."""
    return call_remote_billing("POST", "/billing/quote", json_body=body)
