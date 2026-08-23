"""Open Design Intelligence client.

Runtime talks to a DesignIntelligenceClient. Operators supply an
IntelligenceProvider (default: host BasicLocal). Remote HTTP adapter ships here;
proprietary Cloud engines stay private.
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
