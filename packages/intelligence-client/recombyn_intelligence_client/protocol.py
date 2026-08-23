"""IntelligenceProvider protocol — open extension point.

Stable surface (Kernel / DesignIntelligenceClient):
  analyze_reference, research, strategy, propose_candidates, tournament,
  swarm_direction, simulate, counterfactual, review, optimize, govern,
  autonomous_plan, autonomous_sync, retrieve_memory, write_principle

"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class IntelligenceProvider(Protocol):
    """Swappable design-intelligence backend.

    Providers must not mutate SceneDocument / canvas tool_ops unless the
    Kernel explicitly applies returned plans later.
    """

    async def analyze_reference(self, rt: Any) -> dict[str, Any] | None: ...

    async def research(self, rt: Any) -> dict[str, Any] | None: ...

    async def strategy(self, rt: Any) -> dict[str, Any] | None: ...

    async def propose_candidates(self, rt: Any) -> dict[str, Any] | None: ...

    async def tournament(self, rt: Any) -> dict[str, Any] | None: ...

    async def swarm_direction(self, rt: Any) -> dict[str, Any] | None: ...

    async def simulate(self, rt: Any) -> dict[str, Any] | None: ...

    async def counterfactual(self, rt: Any) -> dict[str, Any] | None: ...

    async def review(self, rt: Any) -> dict[str, Any] | None: ...

    async def optimize(self, rt: Any) -> dict[str, Any] | None: ...

    async def govern(self, rt: Any) -> dict[str, Any]: ...

    async def autonomous_plan(self, rt: Any) -> dict[str, Any] | None: ...

    async def autonomous_sync(self, rt: Any) -> dict[str, Any] | None: ...

    async def retrieve_memory(self, rt: Any) -> dict[str, Any] | None: ...

    async def write_principle(self, rt: Any) -> dict[str, Any] | None: ...
