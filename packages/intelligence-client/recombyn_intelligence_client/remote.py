"""Optional HTTP IntelligenceProvider adapter.

Host supplies ``apply_result`` to write usable payloads into Runtime slots.
Design Runtime in this monorepo uses BasicLocal instead.
"""

from __future__ import annotations

import logging
import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from recombyn_protocol.intelligence import remote_result_usable
from recombyn_runtime import build_intelligence_request

_log = logging.getLogger("recombyn_intelligence_client.remote")

ApplyResultFn = Callable[[str, Any, dict[str, Any] | None], dict[str, Any] | None]
HopKey = tuple[str, str, str]
HopGetFn = Callable[[HopKey], dict[str, Any] | None]
HopPutFn = Callable[[HopKey, dict[str, Any]], None]


def _wire_method(name: str) -> str:
    return str(name or "").strip()


def _hop_key(payload: dict[str, Any], method: str) -> HopKey:
    return (
        str(payload.get("run_id") or ""),
        _wire_method(method),
        str(payload.get("input_hash") or ""),
    )


class RemoteIntelligenceProvider:
    """POST ``{base}/v1/{canonical}`` — usable results optionally applied via hook."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        timeout_sec: float = 30.0,
        circuit_sec: float = 30.0,
        fallback: Any | None = None,
        apply_result: ApplyResultFn | None = None,
        hop_get: HopGetFn | None = None,
        hop_put: HopPutFn | None = None,
    ) -> None:
        self._base = str(base_url or "").rstrip("/")
        self._api_key = str(api_key or "").strip()
        self._timeout = float(timeout_sec or 30.0)
        self._circuit_sec = float(circuit_sec or 30.0)
        self._fallback = fallback
        self._apply = apply_result
        self._hop_get = hop_get
        self._hop_put = hop_put
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()
        self._circuit_open_until = 0.0
        self._failure_count = 0
        self._dedupe: dict[HopKey, dict[str, Any]] = {}

    async def _http_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            async with self._client_lock:
                if self._client is None or self._client.is_closed:
                    self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    def _circuit_open(self) -> bool:
        return time.monotonic() < self._circuit_open_until

    def _circuit_remaining_ms(self) -> int:
        return max(0, int((self._circuit_open_until - time.monotonic()) * 1000))

    def _mark_failure(self) -> None:
        self._failure_count += 1
        if self._failure_count >= 1:
            window = min(max(0.0, self._circuit_sec), max(0.0, self._timeout))
            self._circuit_open_until = time.monotonic() + window

    def _mark_success(self) -> None:
        self._failure_count = 0
        self._circuit_open_until = 0.0

    def _cache_get(self, key: HopKey) -> dict[str, Any] | None:
        if not key[0]:
            return None
        hit = self._dedupe.get(key)
        if isinstance(hit, dict):
            return hit
        if self._hop_get is None:
            return None
        try:
            stored = self._hop_get(key)
        except Exception:
            _log.debug("intelligence hop cache get failed", exc_info=True)
            return None
        if not isinstance(stored, dict) or not stored:
            return None
        self._dedupe[key] = stored
        return stored

    def _cache_put(self, key: HopKey, payload: dict[str, Any]) -> None:
        if not key[0] or not isinstance(payload, dict) or not payload:
            return
        self._dedupe[key] = payload
        if len(self._dedupe) > 128:
            self._dedupe.pop(next(iter(self._dedupe)))
        if self._hop_put is None:
            return
        try:
            self._hop_put(key, payload)
        except Exception:
            _log.debug("intelligence hop cache put failed", exc_info=True)

    def _apply_payload(
        self, method: str, rt: Any, payload: dict[str, Any]
    ) -> dict[str, Any] | None:
        if self._apply is not None:
            return self._apply(method, rt, payload)
        return payload

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _post(self, method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self._base:
            return None
        wire = _wire_method(method)
        if self._circuit_open():
            _log.warning(
                "circuit_open method=%s remaining_ms=%s",
                wire,
                self._circuit_remaining_ms(),
            )
            return None
        url = f"{self._base}/v1/{wire}"
        try:
            client = await self._http_client()
            res = await client.post(url, json=payload, headers=self._headers())
            if res.status_code >= 400:
                self._mark_failure()
                _log.warning("intelligence remote %s status=%s", wire, res.status_code)
                return None
            data = res.json()
            if not isinstance(data, dict) or not remote_result_usable(wire, data):
                self._mark_failure()
                return None
            self._mark_success()
            return data
        except Exception:
            self._mark_failure()
            _log.warning("intelligence remote %s failed", wire, exc_info=True)
            return None

    async def _call(self, method: str, rt: Any) -> dict[str, Any] | None:
        request = build_intelligence_request(_wire_method(method), rt)
        key = _hop_key(request, method)
        cached = self._cache_get(key)
        if cached is not None:
            return self._apply_payload(method, rt, cached)
        remote = await self._post(method, request)
        if remote_result_usable(method, remote) and isinstance(remote, dict):
            result = self._apply_payload(method, rt, remote)
            self._cache_put(key, remote)
            return result
        if self._fallback is not None:
            fn = getattr(self._fallback, method, None)
            if callable(fn):
                result = await fn(rt)
                if isinstance(result, dict):
                    self._cache_put(key, result)
                return result
        return None

    async def analyze_reference(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("analyze_reference", rt)

    async def research(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("research", rt)

    async def strategy(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("strategy", rt)

    async def propose_candidates(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("propose_candidates", rt)

    async def tournament(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("tournament", rt)

    async def swarm_direction(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("swarm_direction", rt)

    async def simulate(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("simulate", rt)

    async def counterfactual(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("counterfactual", rt)

    async def review(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("review", rt)

    async def optimize(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("optimize", rt)

    async def govern(self, rt: Any) -> dict[str, Any]:
        out = await self._call("govern", rt)
        return out if isinstance(out, dict) else {"status": "pass"}

    async def autonomous_plan(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("autonomous_plan", rt)

    async def autonomous_sync(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("autonomous_sync", rt)

    async def retrieve_memory(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("retrieve_memory", rt)

    async def write_principle(self, rt: Any) -> dict[str, Any] | None:
        return await self._call("write_principle", rt)

# Satisfy type checkers that treat unused Awaitable
_ = Awaitable
