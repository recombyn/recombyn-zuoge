"""Design Intelligence client.

Runtime talks to a DesignIntelligenceClient. The API process uses
BasicLocalProvider in-process. An optional HTTP adapter is exported for
experiments; production Design Runtime does not call it.
"""

from __future__ import annotations

from recombyn_intelligence_client.client import DesignIntelligenceClient
from recombyn_intelligence_client.protocol import IntelligenceProvider
from recombyn_intelligence_client.remote import RemoteIntelligenceProvider

__all__ = [
    "DesignIntelligenceClient",
    "IntelligenceProvider",
    "RemoteIntelligenceProvider",
]
