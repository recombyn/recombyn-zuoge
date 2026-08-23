"""DesignIntelligenceClient — Kernel-facing facade over IntelligenceProvider."""

from __future__ import annotations

from typing import Any

from recombyn_intelligence_client.protocol import IntelligenceProvider


class DesignIntelligenceClient:
    """Single entry used by Design Runtime. Does not embed provider logic.

    Stable canonical method names are the only contract.
    """

    def __init__(self, provider: IntelligenceProvider) -> None:
        self._provider = provider

    @property
    def provider(self) -> IntelligenceProvider:
        return self._provider

    async def analyze_reference(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.analyze_reference(rt)

    async def research(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.research(rt)

    async def strategy(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.strategy(rt)

    async def propose_candidates(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.propose_candidates(rt)

    async def tournament(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.tournament(rt)

    async def swarm_direction(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.swarm_direction(rt)

    async def simulate(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.simulate(rt)

    async def counterfactual(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.counterfactual(rt)

    async def review(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.review(rt)

    async def optimize(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.optimize(rt)

    async def govern(self, rt: Any) -> dict[str, Any]:
        return await self._provider.govern(rt)

    async def autonomous_plan(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.autonomous_plan(rt)

    async def autonomous_sync(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.autonomous_sync(rt)

    async def retrieve_memory(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.retrieve_memory(rt)

    async def write_principle(self, rt: Any) -> dict[str, Any] | None:
        return await self._provider.write_principle(rt)
